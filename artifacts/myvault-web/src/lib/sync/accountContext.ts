const ACTIVE_ACCOUNT_STORAGE_KEY = "myvault-active-google-account-id";
const ACCOUNT_CHANGE_EVENT = "myvault-active-account-changed";
const LOCAL_ACCOUNT_ID = "local-unlinked";
const CHANNEL_NAME = "myvault-account-coordination";

let activeAccountId = readStoredAccountId();
let channel: BroadcastChannel | null = null;

function normalizeAccountId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/[^a-zA-Z0-9._-]/g, "_") : LOCAL_ACCOUNT_ID;
}

function readStoredAccountId() {
  if (typeof window === "undefined") return LOCAL_ACCOUNT_ID;
  return normalizeAccountId(localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY));
}

function notifyAccountChange(accountId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT, { detail: { accountId } }));
  getChannel()?.postMessage({ type: "account-changed", accountId });
}

function getChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (event: MessageEvent<{ type?: string; accountId?: string }>) => {
    if (event.data?.type !== "account-changed") return;
    // The token and account ID are written before this message is sent. Re-read
    // the current session so a delayed message cannot reactivate an old account.
    const nextAccountId = readStoredAccountId();
    if (nextAccountId === activeAccountId) return;
    activeAccountId = nextAccountId;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT, { detail: { accountId: nextAccountId } }));
    }
  });
  return channel;
}

if (typeof window !== "undefined") {
  getChannel();
  window.addEventListener("storage", (event) => {
    if (event.key !== ACTIVE_ACCOUNT_STORAGE_KEY) return;
    const nextAccountId = readStoredAccountId();
    if (nextAccountId === activeAccountId) return;
    activeAccountId = nextAccountId;
    window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT, { detail: { accountId: nextAccountId } }));
  });
}

export function getActiveAccountId() {
  return activeAccountId;
}

export function setActiveGoogleAccount(permissionId: string) {
  const nextAccountId = normalizeAccountId(permissionId);
  if (nextAccountId === LOCAL_ACCOUNT_ID) {
    throw new Error("Google Drive did not provide a stable account identifier.");
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, nextAccountId);
  }
  if (nextAccountId !== activeAccountId) {
    activeAccountId = nextAccountId;
    notifyAccountChange(nextAccountId);
  }
  return nextAccountId;
}

export function clearActiveGoogleAccount() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
  }
  if (activeAccountId !== LOCAL_ACCOUNT_ID) {
    activeAccountId = LOCAL_ACCOUNT_ID;
    notifyAccountChange(activeAccountId);
  }
}

export function accountStorageKey(id: string, accountId = getActiveAccountId()) {
  return `${normalizeAccountId(accountId)}::${id}`;
}

export function accountStorageRange(accountId = getActiveAccountId()) {
  const prefix = `${normalizeAccountId(accountId)}::`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

export function onActiveAccountChange(listener: (accountId: string) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ accountId?: string }>).detail;
    listener(normalizeAccountId(detail?.accountId));
  };
  window.addEventListener(ACCOUNT_CHANGE_EVENT, handler);
  return () => window.removeEventListener(ACCOUNT_CHANGE_EVENT, handler);
}

export async function withAccountSyncLock<T>(accountId: string, callback: () => Promise<T>) {
  const lockName = `myvault-drive-commit:${normalizeAccountId(accountId)}`;
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(lockName, { mode: "exclusive" }, callback);
  }
  return callback();
}
