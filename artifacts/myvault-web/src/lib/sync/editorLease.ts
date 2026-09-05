import { getActiveAccountId } from "@/lib/sync/accountContext";
import { saveLocalNoteDraft, type LocalNoteDraft } from "@/lib/restore/localRestoreStore";

const failedSaves = new Map<string, { accountId: string; draft: LocalNoteDraft; release?: () => void }>();
const retries = new Map<string, Promise<void>>();
export function retainFailedEditorSave(accountId: string, draft: LocalNoteDraft, release?: () => void) {
  const key = `${accountId}:${draft.noteId}`;
  const previous = failedSaves.get(key);
  failedSaves.set(key, { accountId, draft, release: () => { previous?.release?.(); release?.(); } });
  window.dispatchEvent(new Event("myvault-local-save-failed"));
}
export function hasFailedEditorSaves(accountId = getActiveAccountId()) {
  return [...failedSaves.values()].some((entry) => entry.accountId === accountId);
}
export function retryFailedEditorSaves(accountId = getActiveAccountId()) {
  const existing = retries.get(accountId);
  if (existing) return existing;
  const retry = (async () => {
    for (const [key, entry] of failedSaves) {
      if (entry.accountId !== accountId) continue;
      await saveLocalNoteDraft(entry.draft, accountId);
      if (failedSaves.get(key) === entry) {
        failedSaves.delete(key);
        entry.release?.();
      }
    }
    window.dispatchEvent(new Event("myvault-local-save-failed"));
  })();
  retries.set(accountId, retry);
  void retry.finally(() => retries.delete(accountId)).catch(() => undefined);
  return retry;
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", (event) => {
  if (failedSaves.size) { event.preventDefault(); event.returnValue = ""; }
});

function lockName(accountId: string) {
  return `myvault-local-vault:${accountId}`;
}

export class ActiveEditorError extends Error {
  constructor() {
    super("The latest backup is ready. Close any open note editors, including other tabs, then retry. Your edits have not been replaced.");
  }
}

export async function acquireNoteEditorLease(accountId: string): Promise<() => void> {
  await retryFailedEditorSaves(accountId);
  if (!navigator.locks) return Promise.resolve(() => undefined);
  return new Promise((resolve, reject) => {
    void navigator.locks.request(lockName(accountId), { mode: "shared" }, () => new Promise<void>((release) => {
      resolve(release);
    })).catch(reject);
  });
}

export async function withLocalVaultUpdate<T>(accountId: string, callback: () => Promise<T>) {
  await retryFailedEditorSaves(accountId);
  // Without cross-tab locks, downloading is safe but replacing an open editor's
  // base is not. Keep the staged copy and leave the local vault untouched.
  if (!navigator.locks) throw new ActiveEditorError();
  return navigator.locks.request(lockName(accountId), { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new ActiveEditorError();
    if (getActiveAccountId() !== accountId) throw new Error("The Google account changed. Nothing was applied.");
    return callback();
  });
}
