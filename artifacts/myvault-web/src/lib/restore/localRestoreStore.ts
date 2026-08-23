import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { Attachment, Block, Folder, Note } from "@workspace/api-client-react";
import type { VaultRichTextDocument } from "@/lib/restore/vaultRichText";
import type { RestoredPdfAnnotation } from "@/lib/restore/restoredCorpus";

const DATABASE_NAME = "myvault-web-restore";
const DATABASE_VERSION = 8;
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
const CURRENT_METADATA_KEY = "current";
export const LOCAL_COURSE_CHANGE_EVENT = "myvault-local-course-changed";
export const LOCAL_CONTENT_CHANGE_EVENT = "myvault-local-content-changed";
const LEGACY_DEMO_NOTE = {
  id: "in1",
  title: "Tawakkul — Complete Reliance on Allah",
};

export type LocalNoteDraft = {
  schemaVersion: 1;
  noteId: string;
  baseCloudVersion: number;
  baseUpdatedAt: number;
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
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open local restore storage."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
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
  await runStoreTransaction(METADATA_STORE, "readwrite", (store) => store.put(bundle, CURRENT_METADATA_KEY));
  await reconcileLocalNoteDrafts(bundle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
}

export function loadMetadataRestoreBundle() {
  return runStoreTransaction<MetadataRestoreBundle | undefined>(METADATA_STORE, "readonly", (store) => store.get(CURRENT_METADATA_KEY)).then((bundle) => bundle ?? null);
}

export function clearMetadataRestoreBundle() {
  return runStoreTransaction(METADATA_STORE, "readwrite", (store) => store.delete(CURRENT_METADATA_KEY)).then(() => undefined);
}

export function saveLocalNoteDraft(draft: LocalNoteDraft) {
  return runStoreTransaction(NOTE_DRAFT_STORE, "readwrite", (store) => store.put(draft, draft.noteId)).then(() => undefined);
}

export function loadLocalNoteDraft(noteId: string) {
  return runStoreTransaction<LocalNoteDraft | undefined>(NOTE_DRAFT_STORE, "readonly", (store) => store.get(noteId)).then((draft) => draft ?? null);
}

export function loadLocalNoteDrafts() {
  return runStoreTransaction<LocalNoteDraft[]>(NOTE_DRAFT_STORE, "readonly", (store) => store.getAll());
}

export function clearLocalNoteDraft(noteId: string) {
  return runStoreTransaction(NOTE_DRAFT_STORE, "readwrite", (store) => store.delete(noteId)).then(() => undefined);
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
    if (createdNoteIds.has(draft.noteId) || draft.baseCloudVersion === bundle.cloudVersion) continue;

    const restoredNote = restoredNotes.get(draft.noteId);
    const restoredUpdatedAt = restoredNote?.updatedAt;
    if (typeof restoredUpdatedAt === "number" && restoredUpdatedAt === draft.baseUpdatedAt) {
      await saveLocalNoteDraft({ ...draft, baseCloudVersion: bundle.cloudVersion });
      rebased += 1;
    } else {
      conflicts += 1;
    }
  }

  return { rebased, removedDemoDrafts, conflicts };
}

export function saveLocalCreatedFolder(folder: Folder) {
  return runStoreTransaction(CREATED_FOLDER_STORE, "readwrite", (store) => store.put(folder, folder.id)).then(() => notifyLocalContentChange());
}

export function loadLocalCreatedFolders() {
  return runStoreTransaction<Folder[]>(CREATED_FOLDER_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCreatedFolder(folderId: string) {
  return runStoreTransaction(CREATED_FOLDER_STORE, "readwrite", (store) => store.delete(folderId)).then(() => undefined);
}

export function saveLocalCreatedNote(note: Note) {
  return runStoreTransaction(CREATED_NOTE_STORE, "readwrite", (store) => store.put(note, note.id)).then(() => notifyLocalContentChange());
}

export function loadLocalCreatedNotes() {
  return runStoreTransaction<Note[]>(CREATED_NOTE_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCreatedNote(noteId: string) {
  return runStoreTransaction(CREATED_NOTE_STORE, "readwrite", (store) => store.delete(noteId)).then(() => undefined);
}

export function saveLocalCourse(course: LocalCourse) {
  return runStoreTransaction(CREATED_COURSE_STORE, "readwrite", (store) => store.put(course, course.id)).then(() => notifyLocalCourseChange());
}

export function loadLocalCourses() {
  return runStoreTransaction<LocalCourse[]>(CREATED_COURSE_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCourse(courseId: string) {
  return runStoreTransaction(CREATED_COURSE_STORE, "readwrite", (store) => store.delete(courseId)).then(() => notifyLocalCourseChange());
}

export function saveLocalCourseFolder(folder: LocalCourseFolder) {
  return runStoreTransaction(CREATED_COURSE_FOLDER_STORE, "readwrite", (store) => store.put(folder, folder.id)).then(() => notifyLocalCourseChange());
}

export function loadLocalCourseFolders() {
  return runStoreTransaction<LocalCourseFolder[]>(CREATED_COURSE_FOLDER_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCourseFolder(folderId: string) {
  return runStoreTransaction(CREATED_COURSE_FOLDER_STORE, "readwrite", (store) => store.delete(folderId)).then(() => notifyLocalCourseChange());
}

export function saveLocalCourseStickyNote(stickyNote: LocalCourseStickyNote) {
  return runStoreTransaction(CREATED_COURSE_STICKY_STORE, "readwrite", (store) => store.put(stickyNote, stickyNote.id)).then(() => notifyLocalCourseChange());
}

export function loadLocalCourseStickyNotes() {
  return runStoreTransaction<LocalCourseStickyNote[]>(CREATED_COURSE_STICKY_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCourseStickyNote(stickyNoteId: string) {
  return runStoreTransaction(CREATED_COURSE_STICKY_STORE, "readwrite", (store) => store.delete(stickyNoteId)).then(() => notifyLocalCourseChange());
}

export function saveLocalCourseConcept(concept: LocalCourseConcept) {
  return runStoreTransaction(CREATED_COURSE_CONCEPT_STORE, "readwrite", (store) => store.put(concept, concept.id)).then(() => notifyLocalCourseChange());
}

export function loadLocalCourseConcepts() {
  return runStoreTransaction<LocalCourseConcept[]>(CREATED_COURSE_CONCEPT_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCourseConcept(conceptId: string) {
  return runStoreTransaction(CREATED_COURSE_CONCEPT_STORE, "readwrite", (store) => store.delete(conceptId)).then(() => notifyLocalCourseChange());
}

export function saveLocalCreatedAttachment(attachment: Attachment) {
  return runStoreTransaction(CREATED_ATTACHMENT_STORE, "readwrite", (store) => store.put(attachment, attachment.id)).then(() => notifyLocalContentChange());
}

export function loadLocalCreatedAttachments() {
  return runStoreTransaction<Attachment[]>(CREATED_ATTACHMENT_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalCreatedAttachment(attachmentId: string) {
  return runStoreTransaction(CREATED_ATTACHMENT_STORE, "readwrite", (store) => store.delete(attachmentId)).then(() => undefined);
}

export function saveLocalAttachmentBlob(attachmentId: string, blob: Blob) {
  return runStoreTransaction(ATTACHMENT_BLOB_STORE, "readwrite", (store) => store.put(blob, attachmentId)).then(() => undefined);
}

export function loadLocalAttachmentBlob(attachmentId: string) {
  return runStoreTransaction<Blob | undefined>(ATTACHMENT_BLOB_STORE, "readonly", (store) => store.get(attachmentId)).then((blob) => blob ?? null);
}

export function deleteLocalAttachmentBlob(attachmentId: string) {
  return runStoreTransaction(ATTACHMENT_BLOB_STORE, "readwrite", (store) => store.delete(attachmentId)).then(() => undefined);
}

export function saveLocalPdfReaderState(state: LocalPdfReaderState) {
  return runStoreTransaction(PDF_READER_STATE_STORE, "readwrite", (store) => store.put(state, state.attachmentId)).then(() => undefined);
}

export function loadLocalPdfReaderState(attachmentId: string) {
  return runStoreTransaction<LocalPdfReaderState | undefined>(PDF_READER_STATE_STORE, "readonly", (store) => store.get(attachmentId)).then((state) => state ?? null);
}

export function loadLocalPdfReaderStates() {
  return runStoreTransaction<LocalPdfReaderState[]>(PDF_READER_STATE_STORE, "readonly", (store) => store.getAll());
}

export function deleteLocalPdfReaderState(attachmentId: string) {
  return runStoreTransaction(PDF_READER_STATE_STORE, "readwrite", (store) => store.delete(attachmentId)).then(() => undefined);
}

export function saveLocalPdfAnnotation(annotation: RestoredPdfAnnotation) {
  const change: LocalPdfAnnotationChange = {
    schemaVersion: 1,
    id: annotation.id,
    attachmentId: annotation.attachmentId,
    operation: "upsert",
    annotation,
    savedAt: Date.now(),
    pendingDriveSync: true,
  };
  return runStoreTransaction(PDF_ANNOTATION_CHANGE_STORE, "readwrite", (store) => store.put(change, change.id)).then(() => undefined);
}

export function deleteLocalPdfAnnotation(annotationId: string, attachmentId: string) {
  const change: LocalPdfAnnotationChange = {
    schemaVersion: 1,
    id: annotationId,
    attachmentId,
    operation: "delete",
    annotation: null,
    savedAt: Date.now(),
    pendingDriveSync: true,
  };
  return runStoreTransaction(PDF_ANNOTATION_CHANGE_STORE, "readwrite", (store) => store.put(change, change.id)).then(() => undefined);
}

export function loadLocalPdfAnnotationChanges(attachmentId?: string) {
  return runStoreTransaction<LocalPdfAnnotationChange[]>(PDF_ANNOTATION_CHANGE_STORE, "readonly", (store) => store.getAll())
    .then((changes) => attachmentId ? changes.filter((change) => change.attachmentId === attachmentId) : changes);
}

export async function deleteLocalPdfAnnotationChangesForAttachment(attachmentId: string) {
  const changes = await loadLocalPdfAnnotationChanges(attachmentId);
  await Promise.all(changes.map((change) => (
    runStoreTransaction(PDF_ANNOTATION_CHANGE_STORE, "readwrite", (store) => store.delete(change.id)).then(() => undefined)
  )));
}

export async function clearLocalSyncPendingChanges() {
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
  await Promise.all(stores.map((storeName) => (
    runStoreTransaction(storeName, "readwrite", (store) => store.clear()).then(() => undefined)
  )));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
}

export async function clearLocalWorkspaceData() {
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
  ];

  await Promise.all(stores.map((storeName) => (
    runStoreTransaction(storeName, "readwrite", (store) => store.clear()).then(() => undefined)
  )));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
  }
}
