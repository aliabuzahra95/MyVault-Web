import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { Attachment, Block, Folder, Note } from "@workspace/api-client-react";
import {
  blocksToVaultRichText,
  parseVaultRichTextDocument,
  type VaultRichTextDocument,
} from "@/lib/restore/vaultRichText";
import type { RestoredPdfAnnotation } from "@/lib/restore/restoredCorpus";
import {
  accountStorageKey,
  accountStorageRange,
  getActiveAccountId,
} from "@/lib/sync/accountContext";

const DATABASE_NAME = "myvault-web-restore";
const DATABASE_VERSION = 9;
const METADATA_STORE = "metadata-bundles";
const NOTE_DRAFT_STORE = "note-drafts";
const CREATED_FOLDER_STORE = "created-folders";
const CREATED_NOTE_STORE = "created-notes";
const CREATED_ATTACHMENT_STORE = "created-attachments";
const ATTACHMENT_BLOB_STORE = "attachment-blobs";
const PDF_READER_STATE_STORE = "pdf-reader-state";
const PDF_ANNOTATION_CHANGE_STORE = "pdf-annotation-changes";
const CREATED_COURSE_STORE = "created-courses";
const CREATED_COURSE_FOLDER_STORE = "created-course-folders";
const CREATED_COURSE_STICKY_STORE = "created-course-sticky-notes";
const CREATED_COURSE_CONCEPT_STORE = "created-course-concepts";
const SYNC_BASE_STORE = "sync-bases";
const SYNC_JOURNAL_STORE = "sync-journal";
const SYNC_CONFLICT_STORE = "sync-conflicts";
const RECOVERY_SNAPSHOT_STORE = "recovery-snapshots";
const SYNC_LOG_STORE = "sync-log";
const ACCOUNT_META_STORE = "account-meta";
const CURRENT_METADATA_KEY = "current";
const PENDING_LOCAL_CHANGE_STORES = [
  NOTE_DRAFT_STORE,
  CREATED_FOLDER_STORE,
  CREATED_NOTE_STORE,
  CREATED_ATTACHMENT_STORE,
  PDF_READER_STATE_STORE,
  PDF_ANNOTATION_CHANGE_STORE,
  CREATED_COURSE_STORE,
  CREATED_COURSE_FOLDER_STORE,
  CREATED_COURSE_STICKY_STORE,
  CREATED_COURSE_CONCEPT_STORE,
] as const;
export const LOCAL_COURSE_CHANGE_EVENT = "myvault-local-course-changed";
export const LOCAL_CONTENT_CHANGE_EVENT = "myvault-local-content-changed";
const LEGACY_DEMO_NOTE = {
  id: "in1",
  title: "Tawakkul — Complete Reliance on Allah",
};
const LEGACY_MIGRATABLE_STORES = [
  METADATA_STORE,
  NOTE_DRAFT_STORE,
  CREATED_FOLDER_STORE,
  CREATED_NOTE_STORE,
  CREATED_ATTACHMENT_STORE,
  ATTACHMENT_BLOB_STORE,
  PDF_READER_STATE_STORE,
  PDF_ANNOTATION_CHANGE_STORE,
  CREATED_COURSE_STORE,
  CREATED_COURSE_FOLDER_STORE,
  CREATED_COURSE_STICKY_STORE,
  CREATED_COURSE_CONCEPT_STORE,
] as const;

export type LocalNoteDraft = {
  schemaVersion: 1;
  noteId: string;
  baseCloudVersion: number;
  baseUpdatedAt: number;
  baseRevisionId?: string;
  title: string;
  mode: "rich_text" | "blocks";
  richTextDocument: VaultRichTextDocument | null;
  blocks: Block[];
  isPinned: boolean;
  savedAt: number;
  pendingDriveSync: true;
};

export type LocalPdfReaderState = {
  schemaVersion: 1;
  attachmentId: string;
  pageIndex: number;
  pageCount: number;
  progressPercent: number;
  zoom: number;
  lastOpenedAt: number;
  updatedAt: number;
  pendingDriveSync: true;
  deletedAt?: number | null;
};

export type LocalPdfAnnotationChange = {
  schemaVersion: 1;
  id: string;
  attachmentId: string;
  operation: "upsert" | "delete";
  annotation: RestoredPdfAnnotation | null;
  savedAt: number;
  pendingDriveSync: true;
};

export type LocalCourseFolder = {
  schemaVersion: 1;
  id: string;
  courseId: string;
  parentId: string | null;
  mode: `course:${string}`;
  title: string;
  description: string | null;
  orderIndex: number;
  createdAt: number;
  updatedAt: number;
  pendingDriveSync: true;
  deletedAt?: number | null;
};

export type LocalCourse = {
  schemaVersion: 1;
  id: string;
  title: string;
  rootFolderId: string | null;
  lastOpenedNoteId: string | null;
  noteCount: number;
  conceptCount: number;
  stickyNoteCount: number;
  createdAt: number;
  updatedAt: number;
  pendingDriveSync: true;
  deletedAt?: number | null;
};

export type LocalCourseStickyNote = {
  schemaVersion: 1;
  id: string;
  courseId: string;
  folderId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pendingDriveSync: true;
  deletedAt?: number | null;
};

export type LocalCourseConcept = {
  schemaVersion: 1;
  id: string;
  courseId: string;
  term: string;
  arabicTerm: string | null;
  definition: string;
  details: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  pendingDriveSync: true;
  deletedAt?: number | null;
};

export type LocallyManaged<T> = T & { deletedAt?: number | null };

export type LocalSyncRevision = {
  schemaVersion: 1;
  revisionId: string;
  cloudVersion: number;
  manifestSha256: string;
  entrySha256: string;
  capturedAt: string;
};

export type LocalSyncBase = {
  schemaVersion: 1;
  accountId: string;
  revision: LocalSyncRevision;
  bundle: MetadataRestoreBundle;
};

export type LocalSyncOperation = {
  schemaVersion: 1;
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  operation: string;
  createdAt: string;
  status: "pending" | "committed";
};

export type LocalSyncConflict = {
  schemaVersion: 1;
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  kind: string;
  baseRevisionId: string;
  remoteRevisionId: string;
  operationIds: string[];
  createdAt: string;
  resolvedAt: string | null;
  resolution: "keep-web" | "keep-android" | "keep-both" | null;
  fileName?: string;
  fieldNames?: string[];
  baseValue?: unknown;
  webValue?: unknown;
  remoteValue?: unknown;
};

export type LocalRecoverySnapshot = {
  schemaVersion: 1;
  id: string;
  accountId: string;
  reason: string;
  createdAt: string;
  base: LocalSyncBase | null;
  bundle: MetadataRestoreBundle | null;
  pendingOperationIds: string[];
};

export function isLocallyDeleted(value: unknown): value is { deletedAt: number } {
  return typeof value === "object" && value !== null && typeof (value as { deletedAt?: unknown }).deletedAt === "number";
}

function notifyLocalContentChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_CONTENT_CHANGE_EVENT));
}

function notifyLocalCourseChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_COURSE_CHANGE_EVENT));
  notifyLocalContentChange();
}

function openRestoreDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support local restore storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE);
      }
      if (!database.objectStoreNames.contains(NOTE_DRAFT_STORE)) {
        database.createObjectStore(NOTE_DRAFT_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_FOLDER_STORE)) {
        database.createObjectStore(CREATED_FOLDER_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_NOTE_STORE)) {
        database.createObjectStore(CREATED_NOTE_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_ATTACHMENT_STORE)) {
        database.createObjectStore(CREATED_ATTACHMENT_STORE);
      }
      if (!database.objectStoreNames.contains(ATTACHMENT_BLOB_STORE)) {
        database.createObjectStore(ATTACHMENT_BLOB_STORE);
      }
      if (!database.objectStoreNames.contains(PDF_READER_STATE_STORE)) {
        database.createObjectStore(PDF_READER_STATE_STORE);
      }
      if (!database.objectStoreNames.contains(PDF_ANNOTATION_CHANGE_STORE)) {
        database.createObjectStore(PDF_ANNOTATION_CHANGE_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_COURSE_STORE)) {
        database.createObjectStore(CREATED_COURSE_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_COURSE_FOLDER_STORE)) {
        database.createObjectStore(CREATED_COURSE_FOLDER_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_COURSE_STICKY_STORE)) {
        database.createObjectStore(CREATED_COURSE_STICKY_STORE);
      }
      if (!database.objectStoreNames.contains(CREATED_COURSE_CONCEPT_STORE)) {
        database.createObjectStore(CREATED_COURSE_CONCEPT_STORE);
      }
      if (!database.objectStoreNames.contains(SYNC_BASE_STORE)) {
        database.createObjectStore(SYNC_BASE_STORE);
      }
      if (!database.objectStoreNames.contains(SYNC_JOURNAL_STORE)) {
        database.createObjectStore(SYNC_JOURNAL_STORE);
      }
      if (!database.objectStoreNames.contains(SYNC_CONFLICT_STORE)) {
        database.createObjectStore(SYNC_CONFLICT_STORE);
      }
      if (!database.objectStoreNames.contains(RECOVERY_SNAPSHOT_STORE)) {
        database.createObjectStore(RECOVERY_SNAPSHOT_STORE);
      }
      if (!database.objectStoreNames.contains(SYNC_LOG_STORE)) {
        database.createObjectStore(SYNC_LOG_STORE);
      }
      if (!database.objectStoreNames.contains(ACCOUNT_META_STORE)) {
        database.createObjectStore(ACCOUNT_META_STORE);
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open local restore storage."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function putForAccount<T>(storeName: string, id: string, value: T) {
  return runStoreTransaction(storeName, "readwrite", (store) => store.put(value, accountStorageKey(id))).then(() => undefined);
}

function getForAccount<T>(storeName: string, id: string) {
  return runStoreTransaction<T | undefined>(storeName, "readonly", (store) => store.get(accountStorageKey(id))).then((value) => value ?? null);
}

function getAllForAccount<T>(storeName: string) {
  return runStoreTransaction<T[]>(storeName, "readonly", (store) => store.getAll(accountStorageRange()));
}

function deleteForAccount(storeName: string, id: string) {
  return runStoreTransaction(storeName, "readwrite", (store) => store.delete(accountStorageKey(id))).then(() => undefined);
}

function clearAccountStore(storeName: string, accountId = getActiveAccountId()) {
  return new Promise<void>((resolve, reject) => {
    void openRestoreDatabase().then((database) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.getAllKeys(accountStorageRange(accountId));
      request.onsuccess = () => request.result.forEach((key) => store.delete(key));
      request.onerror = () => reject(request.error ?? new Error("Local account storage could not be read."));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        const error = transaction.error ?? new Error("Local account storage could not be cleared.");
        database.close();
        reject(error);
      };
    }).catch(reject);
  });
}

function newOperationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `operation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function copyLegacyStoreToAccount(storeName: string, accountId: string) {
  return new Promise<number>((resolve, reject) => {
    void openRestoreDatabase().then((database) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      let copied = 0;
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (!key.includes("::")) {
          store.put(cursor.value, accountStorageKey(key, accountId));
          copied += 1;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Legacy browser data could not be read."));
      transaction.oncomplete = () => {
        database.close();
        resolve(copied);
      };
      transaction.onerror = () => {
        const error = transaction.error ?? new Error("Legacy browser data could not be migrated.");
        database.close();
        reject(error);
      };
    }).catch(reject);
  });
}

async function migrateLegacyStorage(accountId: string) {
  const owner = await runStoreTransaction<string | undefined>(ACCOUNT_META_STORE, "readonly", (store) => store.get("legacy-owner"));
  if (owner) return { owner, copied: 0 };

  let copied = 0;
  for (const storeName of LEGACY_MIGRATABLE_STORES) {
    copied += await copyLegacyStoreToAccount(storeName, accountId);
  }
  await runStoreTransaction(ACCOUNT_META_STORE, "readwrite", (store) => store.put(accountId, "legacy-owner"));
  return { owner: accountId, copied };
}

export async function prepareAccountStorage(accountId: string) {
  const runMigration = () => migrateLegacyStorage(accountId);
  const result = typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request("myvault-legacy-storage-migration", { mode: "exclusive" }, runMigration)
    : await runMigration();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
  }
  return result;
}

export function appendLocalSyncOperation(entityType: string, entityId: string, operation: string) {
  const accountId = getActiveAccountId();
  const record: LocalSyncOperation = {
    schemaVersion: 1,
    id: newOperationId(),
    accountId,
    entityType,
    entityId,
    operation,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  return putForAccount(SYNC_JOURNAL_STORE, record.id, record).then(() => {
    notifyLocalContentChange();
    return record;
  });
}

export function loadLocalSyncOperations() {
  return getAllForAccount<LocalSyncOperation>(SYNC_JOURNAL_STORE);
}

export function loadPendingLocalSyncOperations() {
  return loadLocalSyncOperations().then((operations) => operations.filter((operation) => operation.status === "pending"));
}

export async function hasPendingLocalChanges() {
  const [operations, ...legacyPending] = await Promise.all([
    loadPendingLocalSyncOperations(),
    ...PENDING_LOCAL_CHANGE_STORES.map((storeName) => getAllForAccount(storeName)),
  ]);
  return operations.length > 0 || legacyPending.some((records) => records.length > 0);
}

export function saveLocalSyncBase(base: LocalSyncBase) {
  return putForAccount(SYNC_BASE_STORE, "base", base);
}

export function loadLocalSyncBase() {
  return getForAccount<LocalSyncBase>(SYNC_BASE_STORE, "base");
}

export function applyMetadataRestoreAtomically(bundle: MetadataRestoreBundle, base: LocalSyncBase) {
  const accountId = getActiveAccountId();
  return new Promise<void>((resolve, reject) => {
    void openRestoreDatabase().then((database) => {
      const transaction = database.transaction([METADATA_STORE, SYNC_BASE_STORE], "readwrite");
      transaction.objectStore(METADATA_STORE).put(bundle, accountStorageKey(CURRENT_METADATA_KEY, accountId));
      transaction.objectStore(SYNC_BASE_STORE).put(base, accountStorageKey("base", accountId));
      transaction.oncomplete = () => {
        database.close();
        if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
        resolve();
      };
      transaction.onerror = () => {
        const error = transaction.error ?? new Error("The validated restore could not be applied. The previous local vault was preserved.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error ?? new Error("The validated restore was cancelled. The previous local vault was preserved.");
        database.close();
        reject(error);
      };
    }).catch(reject);
  });
}

export type PreservingMetadataRestoreResult = {
  preservedLocalChanges: boolean;
  preservedExistingBase: boolean;
};

export function applyMetadataRestorePreservingLocalChangesAtomically(
  bundle: MetadataRestoreBundle,
  nextBase: LocalSyncBase,
) {
  const accountId = getActiveAccountId();
  const stores = [METADATA_STORE, SYNC_BASE_STORE, SYNC_JOURNAL_STORE, ...PENDING_LOCAL_CHANGE_STORES];

  return new Promise<PreservingMetadataRestoreResult>((resolve, reject) => {
    void openRestoreDatabase().then((database) => {
      const transaction = database.transaction(stores, "readwrite");
      const range = accountStorageRange(accountId);
      const journalRequest = transaction.objectStore(SYNC_JOURNAL_STORE).getAll(range) as IDBRequest<LocalSyncOperation[]>;
      const overlayRequests = PENDING_LOCAL_CHANGE_STORES.map(
        (storeName) => transaction.objectStore(storeName).count(range),
      );
      const readRequests: IDBRequest[] = [journalRequest, ...overlayRequests];
      let remainingReads = readRequests.length;
      let result: PreservingMetadataRestoreResult | null = null;

      const applyRestore = () => {
        remainingReads -= 1;
        if (remainingReads > 0) return;

        const hasPendingJournalOperation = journalRequest.result.some((operation) => operation.status === "pending");
        const hasPendingOverlay = overlayRequests.some((request) => request.result > 0);
        const preservedLocalChanges = hasPendingJournalOperation || hasPendingOverlay;
        const preservedExistingBase = false;

        transaction.objectStore(METADATA_STORE).put(bundle, accountStorageKey(CURRENT_METADATA_KEY, accountId));
        transaction.objectStore(SYNC_BASE_STORE).put(nextBase, accountStorageKey("base", accountId));
        result = { preservedLocalChanges, preservedExistingBase };
      };

      readRequests.forEach((request) => {
        request.onsuccess = applyRestore;
      });

      transaction.oncomplete = () => {
        database.close();
        if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
        resolve(result ?? { preservedLocalChanges: false, preservedExistingBase: false });
      };
      transaction.onerror = () => {
        const error = transaction.error ?? new Error("The validated restore could not be applied. The previous local vault was preserved.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error ?? new Error("The validated restore was cancelled. The previous local vault was preserved.");
        database.close();
        reject(error);
      };
    }).catch(reject);
  });
}

export function saveLocalSyncConflict(conflict: LocalSyncConflict) {
  return putForAccount(SYNC_CONFLICT_STORE, conflict.id, conflict);
}

export function loadLocalSyncConflicts() {
  return getAllForAccount<LocalSyncConflict>(SYNC_CONFLICT_STORE);
}

export async function createLocalRecoverySnapshot(reason: string) {
  const accountId = getActiveAccountId();
  const [base, bundle, operations] = await Promise.all([
    loadLocalSyncBase(),
    loadMetadataRestoreBundle(),
    loadPendingLocalSyncOperations(),
  ]);
  const snapshot: LocalRecoverySnapshot = {
    schemaVersion: 1,
    id: newOperationId(),
    accountId,
    reason,
    createdAt: new Date().toISOString(),
    base,
    bundle,
    pendingOperationIds: operations.map((operation) => operation.id),
  };
  await putForAccount(RECOVERY_SNAPSHOT_STORE, snapshot.id, snapshot);
  return snapshot;
}

function runStoreTransaction<T>(storeName: string, mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    void openRestoreDatabase()
      .then((database) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = callback(store);

        request.onerror = () => {
          reject(request.error ?? new Error("Local restore storage request failed."));
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        transaction.oncomplete = () => {
          database.close();
        };

        transaction.onerror = () => {
          reject(transaction.error ?? new Error("Local restore storage transaction failed."));
          database.close();
        };
      })
      .catch(reject);
  });
}

export async function saveMetadataRestoreBundle(bundle: MetadataRestoreBundle) {
  await putForAccount(METADATA_STORE, CURRENT_METADATA_KEY, bundle);
  await reconcileLocalNoteDrafts(bundle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
}

export function loadMetadataRestoreBundle() {
  return getForAccount<MetadataRestoreBundle>(METADATA_STORE, CURRENT_METADATA_KEY);
}

export function clearMetadataRestoreBundle() {
  return deleteForAccount(METADATA_STORE, CURRENT_METADATA_KEY);
}

export async function saveLocalNoteDraft(draft: LocalNoteDraft) {
  await putForAccount(NOTE_DRAFT_STORE, draft.noteId, draft);
  await appendLocalSyncOperation("note", draft.noteId, "update");
}

export function loadLocalNoteDraft(noteId: string) {
  return getForAccount<LocalNoteDraft>(NOTE_DRAFT_STORE, noteId);
}

export function loadLocalNoteDrafts() {
  return getAllForAccount<LocalNoteDraft>(NOTE_DRAFT_STORE);
}

export function clearLocalNoteDraft(noteId: string) {
  return deleteForAccount(NOTE_DRAFT_STORE, noteId);
}

async function clearPendingNoteOperations(noteId: string) {
  const operations = await loadPendingLocalSyncOperations();
  await Promise.all(
    operations
      .filter((operation) => operation.entityType === "note" && operation.entityId === noteId)
      .map((operation) => deleteForAccount(SYNC_JOURNAL_STORE, operation.id)),
  );
}

function restoredRichTextForNote(bundle: MetadataRestoreBundle, noteId: string) {
  const blocks = bundle.files.find((file) => file.fileName === "blocks.json")?.json;
  if (!Array.isArray(blocks)) return null;
  const richText = blocks.find((value) => (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    value.noteId === noteId && value.type === "rich_text" && typeof value.content === "string"
  ));
  if (!richText || typeof richText !== "object" || !("content" in richText) || typeof richText.content !== "string") return null;
  return parseVaultRichTextDocument(richText.content);
}

function stableRichText(document: VaultRichTextDocument | null) {
  if (!document) return null;
  return JSON.stringify({
    text: document.text,
    styleMarks: document.styleMarks
      .map((mark) => ({ ...mark }))
      .sort((first, second) => first.start - second.start || first.end - second.end || first.style.localeCompare(second.style)),
    noteLinks: document.noteLinks
      .map((link) => ({ ...link }))
      .sort((first, second) => first.start - second.start || first.end - second.end || first.noteId.localeCompare(second.noteId)),
  });
}

export async function forkLocalNoteDraftAsRecoveredCopy(
  noteId: string,
  targetBase: LocalSyncBase,
  label = "Recovered website edit",
) {
  const draft = await loadLocalNoteDraft(noteId);
  if (!draft) return null;
  const restored = restoredNoteRows(targetBase.bundle).find((note) => note.id === noteId);
  if (!restored) return null;

  const document = draft.richTextDocument ?? blocksToVaultRichText(draft.blocks);
  const now = Date.now();
  const recoveredId = `web-recovered-${crypto.randomUUID()}`;
  const recoveredTitle = `${draft.title.trim() || String(restored.title || "Untitled note")} (${label})`;
  const recoveredNote: Note = {
    id: recoveredId,
    folderId: typeof restored.folderId === "string" ? restored.folderId : null,
    parentNoteId: typeof restored.parentNoteId === "string" ? restored.parentNoteId : null,
    title: recoveredTitle,
    bodyPreview: document.text,
    wordCount: document.text.trim() ? document.text.trim().split(/\s+/u).length : 0,
    characterCount: document.text.length,
    isPinned: false,
    isFolderPinned: false,
    orderIndex: typeof restored.orderIndex === "number" ? restored.orderIndex + 1 : 0,
    tagNames: [],
    createdAt: now,
    updatedAt: now,
  };
  const recoveredDraft: LocalNoteDraft = {
    ...draft,
    noteId: recoveredId,
    baseCloudVersion: targetBase.bundle.cloudVersion,
    baseUpdatedAt: now,
    baseRevisionId: targetBase.revision.revisionId,
    title: recoveredTitle,
    richTextDocument: document,
    savedAt: now,
  };

  await saveLocalCreatedNote(recoveredNote);
  await saveLocalNoteDraft(recoveredDraft);
  await clearPendingNoteOperations(noteId);
  await clearLocalNoteDraft(noteId);
  return recoveredId;
}

export async function recoverUnsafelyRebasedLegacyNoteDrafts(base: LocalSyncBase) {
  const capturedAt = Date.parse(base.revision.capturedAt);
  if (!Number.isFinite(capturedAt)) return { recovered: 0, removedRedundant: 0 };

  const [drafts, createdNotes] = await Promise.all([loadLocalNoteDrafts(), loadLocalCreatedNotes()]);
  const createdNoteIds = new Set(createdNotes.map((note) => note.id));
  const notes = restoredNoteRows(base.bundle);
  let recovered = 0;
  let removedRedundant = 0;

  for (const draft of drafts) {
    if (draft.baseRevisionId || createdNoteIds.has(draft.noteId) || draft.savedAt >= capturedAt) continue;
    const restored = notes.find((note) => note.id === draft.noteId);
    if (!restored) continue;

    const draftDocument = draft.richTextDocument ?? blocksToVaultRichText(draft.blocks);
    const restoredDocument = restoredRichTextForNote(base.bundle, draft.noteId) ?? {
      text: typeof restored.bodyPlainText === "string" ? restored.bodyPlainText : "",
      styleMarks: [],
      noteLinks: [],
    };
    const isRedundant = draft.title === restored.title &&
      draft.isPinned === Boolean(restored.isPinned) &&
      stableRichText(draftDocument) === stableRichText(restoredDocument);

    if (isRedundant) {
      await clearPendingNoteOperations(draft.noteId);
      await clearLocalNoteDraft(draft.noteId);
      removedRedundant += 1;
      continue;
    }

    if (await forkLocalNoteDraftAsRecoveredCopy(draft.noteId, base)) recovered += 1;
  }

  return { recovered, removedRedundant };
}

function restoredNoteRows(bundle: MetadataRestoreBundle) {
  const notes = bundle.files.find((file) => file.fileName === "notes.json")?.json;
  return Array.isArray(notes)
    ? notes.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value))
    : [];
}

export async function reconcileLocalNoteDrafts(bundle: MetadataRestoreBundle) {
  const [drafts, createdNotes] = await Promise.all([loadLocalNoteDrafts(), loadLocalCreatedNotes()]);
  const createdNoteIds = new Set(createdNotes.map((note) => note.id));
  const restoredNotes = new Map(restoredNoteRows(bundle).map((note) => [typeof note.id === "string" ? note.id : "", note]));
  let rebased = 0;
  let removedDemoDrafts = 0;
  let conflicts = 0;

  for (const draft of drafts) {
    if (draft.noteId === LEGACY_DEMO_NOTE.id && draft.title === LEGACY_DEMO_NOTE.title) {
      await clearLocalNoteDraft(draft.noteId);
      removedDemoDrafts += 1;
      continue;
    }
    if (createdNoteIds.has(draft.noteId)) continue;

    const restoredNote = restoredNotes.get(draft.noteId);
    const restoredUpdatedAt = restoredNote?.updatedAt;
    const alreadyCurrent = draft.baseCloudVersion === bundle.cloudVersion && restoredUpdatedAt === draft.baseUpdatedAt;
    if (alreadyCurrent) continue;

    conflicts += 1;
  }

  return { rebased, removedDemoDrafts, conflicts };
}

export async function rebaseLocalNoteDraftsAfterSafePull(bundle: MetadataRestoreBundle, baseRevisionId: string) {
  const [drafts, createdNotes] = await Promise.all([loadLocalNoteDrafts(), loadLocalCreatedNotes()]);
  const createdNoteIds = new Set(createdNotes.map((note) => note.id));
  const restoredNotes = new Map(restoredNoteRows(bundle).map((note) => [typeof note.id === "string" ? note.id : "", note]));
  let rebased = 0;
  let conflicts = 0;

  for (const draft of drafts) {
    if (createdNoteIds.has(draft.noteId)) continue;
    const restoredUpdatedAt = restoredNotes.get(draft.noteId)?.updatedAt;
    if (typeof restoredUpdatedAt !== "number") {
      conflicts += 1;
      continue;
    }
    await putForAccount(NOTE_DRAFT_STORE, draft.noteId, {
      ...draft,
      baseCloudVersion: bundle.cloudVersion,
      baseUpdatedAt: restoredUpdatedAt,
      baseRevisionId,
    });
    rebased += 1;
  }

  return { rebased, conflicts };
}

export async function saveLocalCreatedFolder(folder: Folder) {
  await putForAccount(CREATED_FOLDER_STORE, folder.id, folder);
  await appendLocalSyncOperation("folder", folder.id, isLocallyDeleted(folder) ? "delete" : "upsert");
}

export function loadLocalCreatedFolders() {
  return getAllForAccount<Folder>(CREATED_FOLDER_STORE);
}

export async function deleteLocalCreatedFolder(folderId: string, source?: Folder) {
  const existing = source ?? await getForAccount<Folder>(CREATED_FOLDER_STORE, folderId);
  if (!existing) throw new Error("The folder could not be retained as a deletion tombstone.");
  await putForAccount(CREATED_FOLDER_STORE, folderId, { ...existing, updatedAt: Date.now(), deletedAt: Date.now() });
  await appendLocalSyncOperation("folder", folderId, "delete");
}

export async function saveLocalCreatedNote(note: Note) {
  await putForAccount(CREATED_NOTE_STORE, note.id, note);
  await appendLocalSyncOperation("note", note.id, isLocallyDeleted(note) ? "delete" : "upsert");
}

export function loadLocalCreatedNotes() {
  return getAllForAccount<Note>(CREATED_NOTE_STORE);
}

export async function deleteLocalCreatedNote(noteId: string, source?: Note) {
  const existing = source ?? await getForAccount<Note>(CREATED_NOTE_STORE, noteId);
  if (!existing) throw new Error("The note could not be retained as a deletion tombstone.");
  await putForAccount(CREATED_NOTE_STORE, noteId, { ...existing, updatedAt: Date.now(), deletedAt: Date.now() });
  await appendLocalSyncOperation("note", noteId, "delete");
}

export async function saveLocalCourse(course: LocalCourse) {
  await putForAccount(CREATED_COURSE_STORE, course.id, course);
  await appendLocalSyncOperation("course", course.id, isLocallyDeleted(course) ? "delete" : "upsert");
  notifyLocalCourseChange();
}

export function loadLocalCourses() {
  return getAllForAccount<LocalCourse>(CREATED_COURSE_STORE);
}

export async function deleteLocalCourse(courseId: string, source?: LocalCourse) {
  const existing = source ?? await getForAccount<LocalCourse>(CREATED_COURSE_STORE, courseId);
  if (!existing) throw new Error("The course could not be retained as a deletion record.");
  const now = Date.now();
  await putForAccount(CREATED_COURSE_STORE, courseId, { ...existing, updatedAt: now, deletedAt: now });
  await appendLocalSyncOperation("course", courseId, "delete");
  notifyLocalCourseChange();
}

export async function saveLocalCourseFolder(folder: LocalCourseFolder) {
  await putForAccount(CREATED_COURSE_FOLDER_STORE, folder.id, folder);
  await appendLocalSyncOperation("course-folder", folder.id, isLocallyDeleted(folder) ? "delete" : "upsert");
  notifyLocalCourseChange();
}

export function loadLocalCourseFolders() {
  return getAllForAccount<LocalCourseFolder>(CREATED_COURSE_FOLDER_STORE);
}

export async function deleteLocalCourseFolder(folderId: string, source?: LocalCourseFolder) {
  const existing = source ?? await getForAccount<LocalCourseFolder>(CREATED_COURSE_FOLDER_STORE, folderId);
  if (!existing) throw new Error("The course folder could not be retained as a deletion tombstone.");
  const now = Date.now();
  await putForAccount(CREATED_COURSE_FOLDER_STORE, folderId, { ...existing, updatedAt: now, deletedAt: now });
  await appendLocalSyncOperation("course-folder", folderId, "delete");
  notifyLocalCourseChange();
}

export async function saveLocalCourseStickyNote(stickyNote: LocalCourseStickyNote) {
  await putForAccount(CREATED_COURSE_STICKY_STORE, stickyNote.id, stickyNote);
  await appendLocalSyncOperation("course-sticky-note", stickyNote.id, isLocallyDeleted(stickyNote) ? "delete" : "upsert");
  notifyLocalCourseChange();
}

export function loadLocalCourseStickyNotes() {
  return getAllForAccount<LocalCourseStickyNote>(CREATED_COURSE_STICKY_STORE);
}

export async function deleteLocalCourseStickyNote(stickyNoteId: string, source?: LocalCourseStickyNote) {
  const existing = source ?? await getForAccount<LocalCourseStickyNote>(CREATED_COURSE_STICKY_STORE, stickyNoteId);
  if (!existing) throw new Error("The sticky note could not be retained as a deletion record.");
  const now = Date.now();
  await putForAccount(CREATED_COURSE_STICKY_STORE, stickyNoteId, { ...existing, updatedAt: now, deletedAt: now });
  await appendLocalSyncOperation("course-sticky-note", stickyNoteId, "delete");
  notifyLocalCourseChange();
}

export async function saveLocalCourseConcept(concept: LocalCourseConcept) {
  await putForAccount(CREATED_COURSE_CONCEPT_STORE, concept.id, concept);
  await appendLocalSyncOperation("course-concept", concept.id, isLocallyDeleted(concept) ? "delete" : "upsert");
  notifyLocalCourseChange();
}

export function loadLocalCourseConcepts() {
  return getAllForAccount<LocalCourseConcept>(CREATED_COURSE_CONCEPT_STORE);
}

export async function deleteLocalCourseConcept(conceptId: string, source?: LocalCourseConcept) {
  const existing = source ?? await getForAccount<LocalCourseConcept>(CREATED_COURSE_CONCEPT_STORE, conceptId);
  if (!existing) throw new Error("The concept card could not be retained as a deletion record.");
  const now = Date.now();
  await putForAccount(CREATED_COURSE_CONCEPT_STORE, conceptId, { ...existing, updatedAt: now, deletedAt: now });
  await appendLocalSyncOperation("course-concept", conceptId, "delete");
  notifyLocalCourseChange();
}

export async function saveLocalCreatedAttachment(attachment: Attachment) {
  await putForAccount(CREATED_ATTACHMENT_STORE, attachment.id, attachment);
  await appendLocalSyncOperation("attachment", attachment.id, isLocallyDeleted(attachment) ? "delete" : "upsert");
}

export function loadLocalCreatedAttachments() {
  return getAllForAccount<Attachment>(CREATED_ATTACHMENT_STORE);
}

export async function deleteLocalCreatedAttachment(attachmentId: string, source?: Attachment) {
  const existing = source ?? await getForAccount<Attachment>(CREATED_ATTACHMENT_STORE, attachmentId);
  if (!existing) throw new Error("The attachment could not be retained as a deletion tombstone.");
  await putForAccount(CREATED_ATTACHMENT_STORE, attachmentId, { ...existing, updatedAt: Date.now(), deletedAt: Date.now() });
  await appendLocalSyncOperation("attachment", attachmentId, "delete");
}

export function saveLocalAttachmentBlob(attachmentId: string, blob: Blob) {
  return putForAccount(ATTACHMENT_BLOB_STORE, attachmentId, blob);
}

export function loadLocalAttachmentBlob(attachmentId: string) {
  return getForAccount<Blob>(ATTACHMENT_BLOB_STORE, attachmentId);
}

export function deleteLocalAttachmentBlob(attachmentId: string) {
  return deleteForAccount(ATTACHMENT_BLOB_STORE, attachmentId);
}

export async function saveLocalPdfReaderState(state: LocalPdfReaderState) {
  await putForAccount(PDF_READER_STATE_STORE, state.attachmentId, state);
  await appendLocalSyncOperation("pdf-reading-progress", state.attachmentId, "update");
}

export function loadLocalPdfReaderState(attachmentId: string) {
  return getForAccount<LocalPdfReaderState>(PDF_READER_STATE_STORE, attachmentId);
}

export function loadLocalPdfReaderStates() {
  return getAllForAccount<LocalPdfReaderState>(PDF_READER_STATE_STORE);
}

export async function deleteLocalPdfReaderState(attachmentId: string) {
  const now = Date.now();
  const existing = await getForAccount<LocalPdfReaderState>(PDF_READER_STATE_STORE, attachmentId);
  const tombstone: LocalPdfReaderState = {
    schemaVersion: 1,
    attachmentId,
    pageIndex: existing?.pageIndex ?? 0,
    pageCount: existing?.pageCount ?? 0,
    progressPercent: existing?.progressPercent ?? 0,
    zoom: existing?.zoom ?? 1,
    lastOpenedAt: existing?.lastOpenedAt ?? now,
    updatedAt: now,
    pendingDriveSync: true,
    deletedAt: now,
  };
  await putForAccount(PDF_READER_STATE_STORE, attachmentId, tombstone);
  await appendLocalSyncOperation("pdf-reading-progress", attachmentId, "delete");
}

export async function saveLocalPdfAnnotation(annotation: RestoredPdfAnnotation) {
  const change: LocalPdfAnnotationChange = {
    schemaVersion: 1,
    id: annotation.id,
    attachmentId: annotation.attachmentId,
    operation: "upsert",
    annotation,
    savedAt: Date.now(),
    pendingDriveSync: true,
  };
  await putForAccount(PDF_ANNOTATION_CHANGE_STORE, change.id, change);
  await appendLocalSyncOperation("pdf-annotation", annotation.id, "upsert");
}

export async function deleteLocalPdfAnnotation(annotationId: string, attachmentId: string) {
  const change: LocalPdfAnnotationChange = {
    schemaVersion: 1,
    id: annotationId,
    attachmentId,
    operation: "delete",
    annotation: null,
    savedAt: Date.now(),
    pendingDriveSync: true,
  };
  await putForAccount(PDF_ANNOTATION_CHANGE_STORE, change.id, change);
  await appendLocalSyncOperation("pdf-annotation", annotationId, "delete");
}

export function loadLocalPdfAnnotationChanges(attachmentId?: string) {
  return getAllForAccount<LocalPdfAnnotationChange>(PDF_ANNOTATION_CHANGE_STORE)
    .then((changes) => attachmentId ? changes.filter((change) => change.attachmentId === attachmentId) : changes);
}

export async function deleteLocalPdfAnnotationChangesForAttachment(attachmentId: string) {
  const changes = await loadLocalPdfAnnotationChanges(attachmentId);
  await Promise.all(changes.map((change) => (
    deleteForAccount(PDF_ANNOTATION_CHANGE_STORE, change.id)
  )));
}

export async function clearLocalSyncPendingChanges(operationIds?: string[]) {
  const stores = [
    NOTE_DRAFT_STORE,
    CREATED_FOLDER_STORE,
    CREATED_NOTE_STORE,
    CREATED_ATTACHMENT_STORE,
    ATTACHMENT_BLOB_STORE,
    PDF_READER_STATE_STORE,
    PDF_ANNOTATION_CHANGE_STORE,
    CREATED_COURSE_STORE,
    CREATED_COURSE_FOLDER_STORE,
    CREATED_COURSE_STICKY_STORE,
    CREATED_COURSE_CONCEPT_STORE,
  ];
  const operations = await loadPendingLocalSyncOperations();
  const committedIds = new Set(operationIds ?? operations.map((operation) => operation.id));
  const remainingOperations = operations.filter((operation) => !committedIds.has(operation.id));

  await Promise.all(operations
    .filter((operation) => committedIds.has(operation.id))
    .map((operation) => deleteForAccount(SYNC_JOURNAL_STORE, operation.id)));

  // The overlay stores contain the latest value for each entity, not one value per
  // journal entry. If an edit arrived while Drive was committing, retaining every
  // overlay is safer than erasing that newer value. The next backup can coalesce it.
  if (remainingOperations.length === 0) {
    await Promise.all(stores.map((storeName) => clearAccountStore(storeName)));
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
  return {
    clearedOverlayStores: remainingOperations.length === 0,
    remainingOperationIds: remainingOperations.map((operation) => operation.id),
  };
}

export async function clearLocalWorkspaceData(accountId = getActiveAccountId()) {
  const stores = [
    METADATA_STORE,
    NOTE_DRAFT_STORE,
    CREATED_FOLDER_STORE,
    CREATED_NOTE_STORE,
    CREATED_ATTACHMENT_STORE,
    ATTACHMENT_BLOB_STORE,
    PDF_READER_STATE_STORE,
    PDF_ANNOTATION_CHANGE_STORE,
    CREATED_COURSE_STORE,
    CREATED_COURSE_FOLDER_STORE,
    CREATED_COURSE_STICKY_STORE,
    CREATED_COURSE_CONCEPT_STORE,
    SYNC_BASE_STORE,
    SYNC_JOURNAL_STORE,
    SYNC_CONFLICT_STORE,
    RECOVERY_SNAPSHOT_STORE,
    SYNC_LOG_STORE,
  ];

  await Promise.all(stores.map((storeName) => clearAccountStore(storeName, accountId)));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
  }
}
