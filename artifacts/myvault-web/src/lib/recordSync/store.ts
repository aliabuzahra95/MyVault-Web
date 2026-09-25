import { getActiveAccountId } from "@/lib/sync/accountContext";
import { openRestoreDatabase } from "@/lib/restore/localRestoreStore";
import type { RecordSyncEntityType, RecordSyncRevision } from "./protocol";

const CONTROL = "record-sync-control";
const PENDING = "record-sync-pending";
const HEADS = "record-sync-heads";
const FILES = "record-sync-files";
const RECORDS = "record-sync-records";
const CONFLICTS = "record-sync-conflicts";
const ENABLED_FLAG_PREFIX = "myvault-record-sync-enabled::";

export type RecordSyncControl = {
  accountId: string;
  clientId: string;
  enabled: boolean;
  paused: boolean;
  restoreReconciliationRequired?: boolean;
  cursor: string | null;
};

export type RecordSyncPending = {
  accountId: string;
  entityType: RecordSyncEntityType;
  entityId: string;
  generation: number;
  changedAt: number;
  baseRevisionId: string | null;
  prepared: RecordSyncRevision | null;
  excludedReason: string | null;
};

export type RecordSyncHead = {
  accountId: string;
  entityType: RecordSyncEntityType;
  entityId: string;
  revisionId: string;
  contentHash: string;
  deleted: boolean;
};

export type RecordSyncFileIndex = {
  accountId: string;
  fileId: string;
  entityType: RecordSyncEntityType;
  entityId: string;
  revisionId: string;
  mutationId: string;
};

export type RecordSyncConflict = {
  accountId: string;
  entityType: RecordSyncEntityType;
  entityId: string;
  remoteRevisionId: string;
  localRevisionId: string | null;
  remotePayloadJson: string | null;
  remoteDeleted: boolean;
  createdAt: number;
  resolvedAt: number | null;
};

function key(accountId: string, type: RecordSyncEntityType, id: string) {
  return `${accountId}::${type}:${id}`;
}

function accountRange(accountId: string) {
  return IDBKeyRange.bound(`${accountId}::`, `${accountId}::\uffff`);
}

function openStore(): Promise<IDBDatabase> {
  return openRestoreDatabase();
}

async function read<T>(store: string, id: string): Promise<T | null> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).get(id);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = tx.onabort = tx.onerror = () => db.close();
  });
}

async function all<T>(store: string, accountId: string): Promise<T[]> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).getAll(accountRange(accountId));
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = tx.onabort = tx.onerror = () => db.close();
  });
}

async function write(store: string, id: string, value: unknown): Promise<void> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Automatic Sync storage was not saved.")); };
  });
}

export function loadRecordSyncControl(accountId = getActiveAccountId()) {
  return read<RecordSyncControl>(CONTROL, accountId);
}

export async function saveRecordSyncControl(control: RecordSyncControl) {
  await write(CONTROL, control.accountId, control);
  if (typeof localStorage !== "undefined") {
    const flag = `${ENABLED_FLAG_PREFIX}${control.accountId}`;
    if (control.enabled || (control.cursor && !control.paused)) localStorage.setItem(flag, "1");
    else localStorage.removeItem(flag);
  }
}

export function mayHaveRecordSyncEnabled(accountId = getActiveAccountId()) {
  return typeof localStorage !== "undefined" && localStorage.getItem(`${ENABLED_FLAG_PREFIX}${accountId}`) === "1";
}

export function loadRecordSyncPending(accountId = getActiveAccountId()) {
  return all<RecordSyncPending>(PENDING, accountId);
}

export function loadRecordSyncPendingEntity(accountId: string, entityType: RecordSyncEntityType, entityId: string) {
  return read<RecordSyncPending>(PENDING, key(accountId, entityType, entityId));
}

async function updatePendingIfGeneration(
  pending: RecordSyncPending,
  update: (current: RecordSyncPending) => RecordSyncPending,
): Promise<boolean> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING, "readwrite");
    const store = tx.objectStore(PENDING);
    const request = store.get(key(pending.accountId, pending.entityType, pending.entityId));
    let changed = false;
    request.onsuccess = () => {
      const current = request.result as RecordSyncPending | undefined;
      if (!current || current.generation !== pending.generation) return;
      store.put(update(current), key(pending.accountId, pending.entityType, pending.entityId));
      changed = true;
    };
    tx.oncomplete = () => { db.close(); resolve(changed); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Pending sync state was not saved.")); };
  });
}

export async function seedRecordSyncPending(accountId: string, entityType: RecordSyncEntityType, entityId: string) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PENDING, HEADS], "readwrite");
    const entityKey = key(accountId, entityType, entityId);
    const existing = tx.objectStore(PENDING).get(entityKey);
    const head = tx.objectStore(HEADS).get(entityKey);
    let ready = 0;
    const seed = () => {
      if (++ready !== 2 || existing.result) return;
      tx.objectStore(PENDING).put({
        accountId, entityType, entityId, generation: 1, changedAt: Date.now(),
        baseRevisionId: (head.result as RecordSyncHead | undefined)?.revisionId ?? null,
        prepared: null, excludedReason: null,
      } satisfies RecordSyncPending, entityKey);
    };
    existing.onsuccess = seed;
    head.onsuccess = seed;
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Initial sync change was not recorded.")); };
  });
}

export async function prepareRecordSyncPending(pending: RecordSyncPending, revision: RecordSyncRevision) {
  return updatePendingIfGeneration(pending, (current) => ({ ...current, prepared: revision }));
}

export async function excludeRecordSyncPending(pending: RecordSyncPending, reason: string) {
  await updatePendingIfGeneration(pending, (current) => ({ ...current, prepared: null, excludedReason: reason }));
}

export function loadRecordSyncHeads(accountId = getActiveAccountId()) {
  return all<RecordSyncHead>(HEADS, accountId);
}

export function loadRecordSyncHead(accountId: string, entityType: RecordSyncEntityType, entityId: string) {
  return read<RecordSyncHead>(HEADS, key(accountId, entityType, entityId));
}

export function loadRecordSyncRecords(accountId = getActiveAccountId()) {
  return all<RecordSyncRevision>(RECORDS, accountId);
}

export function loadRecordSyncConflicts(accountId = getActiveAccountId()) {
  return all<RecordSyncConflict>(CONFLICTS, accountId);
}

export function loadRecordSyncFile(fileId: string, accountId = getActiveAccountId()) {
  return read<RecordSyncFileIndex>(FILES, `${accountId}::${fileId}`);
}

export function rememberRecordSyncFile(accountId: string, fileId: string, revision: RecordSyncRevision) {
  return write(FILES, `${accountId}::${fileId}`, {
    accountId, fileId, entityType: revision.entityType, entityId: revision.entityId,
    revisionId: revision.revisionId, mutationId: revision.mutationId,
  } satisfies RecordSyncFileIndex);
}

export function saveRecordSyncConflict(conflict: RecordSyncConflict) {
  return write(CONFLICTS, `${key(conflict.accountId, conflict.entityType, conflict.entityId)}:${conflict.remoteRevisionId}`, conflict);
}

export async function applyRecordSyncRevision(accountId: string, fileId: string, revision: RecordSyncRevision) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([HEADS, FILES, RECORDS], "readwrite");
    const entityKey = key(accountId, revision.entityType, revision.entityId);
    tx.objectStore(HEADS).put({
      accountId, entityType: revision.entityType, entityId: revision.entityId,
      revisionId: revision.revisionId, contentHash: revision.contentHash, deleted: revision.deleted,
    } satisfies RecordSyncHead, entityKey);
    tx.objectStore(FILES).put({
      accountId, fileId, entityType: revision.entityType, entityId: revision.entityId,
      revisionId: revision.revisionId, mutationId: revision.mutationId,
    } satisfies RecordSyncFileIndex, `${accountId}::${fileId}`);
    tx.objectStore(RECORDS).put(revision, entityKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Incoming sync revision was not saved.")); };
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
}

export async function acknowledgeRecordSyncPending(accountId: string, fileId: string, revision: RecordSyncRevision, generation: number) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PENDING, HEADS, FILES, RECORDS], "readwrite");
    const entityKey = key(accountId, revision.entityType, revision.entityId);
    const pending = tx.objectStore(PENDING).get(entityKey);
    pending.onsuccess = () => {
      const latest = pending.result as RecordSyncPending | undefined;
      if (latest?.generation === generation) tx.objectStore(PENDING).delete(entityKey);
      else if (latest) tx.objectStore(PENDING).put({ ...latest, baseRevisionId: revision.revisionId, prepared: null }, entityKey);
    };
    tx.objectStore(HEADS).put({
      accountId, entityType: revision.entityType, entityId: revision.entityId,
      revisionId: revision.revisionId, contentHash: revision.contentHash, deleted: revision.deleted,
    } satisfies RecordSyncHead, entityKey);
    tx.objectStore(FILES).put({
      accountId, fileId, entityType: revision.entityType, entityId: revision.entityId,
      revisionId: revision.revisionId, mutationId: revision.mutationId,
    } satisfies RecordSyncFileIndex, `${accountId}::${fileId}`);
    tx.objectStore(RECORDS).put(revision, entityKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Automatic Sync acknowledgement was not saved.")); };
  });
}
