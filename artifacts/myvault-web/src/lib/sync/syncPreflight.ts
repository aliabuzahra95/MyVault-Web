import type { Attachment, Folder, Note } from "@workspace/api-client-react";
import { buildMetadataRestoreBundle, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { androidMetadataFiles } from "@/lib/restore/driveRestoreMap";
import type { DriveSyncManifest, DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import {
  loadLocalAttachmentBlob,
  loadLocalCourseConcepts,
  loadLocalCourseFolders,
  loadLocalCourseStickyNotes,
  loadLocalCourses,
  loadLocalCreatedAttachments,
  loadLocalCreatedFolders,
  loadLocalCreatedNotes,
  loadLocalNoteDrafts,
  loadLocalPdfAnnotationChanges,
  loadLocalPdfReaderStates,
  loadMetadataRestoreBundle,
  reconcileLocalNoteDrafts,
  type LocalCourseConcept,
  type LocalCourse,
  type LocalCourseFolder,
  type LocalCourseStickyNote,
  type LocalNoteDraft,
  type LocalPdfAnnotationChange,
  type LocalPdfReaderState,
} from "@/lib/restore/localRestoreStore";
import {
  blocksToVaultRichText,
  inspectVaultRichTextEnvelope,
  serializeVaultRichTextEnvelope,
  type VaultRichTextEnvelope,
} from "@/lib/restore/vaultRichText";

type JsonRow = Record<string, unknown>;

export type SyncPendingChanges = {
  noteDrafts: LocalNoteDraft[];
  createdFolders: Folder[];
  createdNotes: Note[];
  createdAttachments: Attachment[];
  attachmentBlobs: Record<string, boolean>;
  pdfReaderStates: LocalPdfReaderState[];
  pdfAnnotationChanges: LocalPdfAnnotationChange[];
  courses: LocalCourse[];
  courseFolders: LocalCourseFolder[];
  courseStickyNotes: LocalCourseStickyNote[];
  courseConcepts: LocalCourseConcept[];
};

export type SyncChangeCounts = Omit<SyncPendingChanges, "attachmentBlobs"> extends infer Changes
  ? { [Key in keyof Changes]: number }
  : never;

export type SyncTouchedFile = {
  fileName: string;
  originalCount: number;
  mergedCount: number;
  changedRows: number;
  addedRows: number;
  removedRows: number;
};

export type SyncFileUpload = {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
  blobAvailable: boolean;
};

export type SyncPreflight = {
  status: "no_changes" | "local_only" | "initial_backup" | "ready" | "blocked";
  generatedAt: string;
  sourceCloudVersion: number | null;
  totalPendingChanges: number;
  counts: SyncChangeCounts;
  touchedFiles: SyncTouchedFile[];
  preservedMetadataFiles: number;
  sourceMetadataFiles: number;
  fileUploads: SyncFileUpload[];
  blockers: string[];
  warnings: string[];
  preparedFiles: Record<string, JsonRow[]>;
};

export function createInitialMetadataRestoreBundle(now = Date.now()): MetadataRestoreBundle {
  const jsonByName = new Map<string, unknown>([
    ["manifest.json", { format: "myvault-backup", version: 1, createdAt: now }],
    ["settings.json", {
      schemaVersion: 1,
      theme: "auto",
      workspace: "islamic_corpus",
      accentColor: "#5B8DEF",
    }],
  ]);
  const entries: DriveSyncManifestEntry[] = androidMetadataFiles.map(({ fileName }) => ({
    path: `metadata/${fileName}`,
    fileName,
    backupEntry: fileName,
    kind: "metadata",
    sha256: "",
    size: 0,
    cloudFileId: "",
    updatedAt: null,
  }));
  const manifest: DriveSyncManifest = {
    schemaVersion: 1,
    cloudVersion: 0,
    storage: "google-drive-api",
    layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups",
    entries,
  };
  return buildMetadataRestoreBundle(manifest, entries.map((entry) => ({
    entry,
    json: jsonByName.get(entry.fileName) ?? [],
  })));
}

function isRow(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFor(bundle: MetadataRestoreBundle, fileName: string) {
  const json = bundle.files.find((file) => file.fileName === fileName)?.json;
  return Array.isArray(json) ? json.filter(isRow).map((row) => ({ ...row })) : [];
}

function stringValue(row: JsonRow, key: string) {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function localDeletedAt(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const deletedAt = (value as { deletedAt?: unknown }).deletedAt;
  return typeof deletedAt === "number" ? deletedAt : null;
}

function rowIsDeleted(row: JsonRow) {
  return typeof row.deletedAt === "number";
}

function mergeRows(original: JsonRow[], patches: JsonRow[]) {
  const patchesById = new Map(patches.map((row) => [stringValue(row, "id"), row]));
  const seen = new Set<string>();
  const rows = original.map((row) => {
    const id = stringValue(row, "id");
    const patch = patchesById.get(id);
    if (!patch) return { ...row };
    seen.add(id);
    return { ...row, ...patch };
  });
  patches.forEach((patch) => {
    const id = stringValue(patch, "id");
    if (!seen.has(id)) rows.push({ ...patch });
  });
  return rows;
}

function touchedFile(fileName: string, original: JsonRow[], merged: JsonRow[], patches: JsonRow[], removedRows = 0, idKey = "id"): SyncTouchedFile {
  const originalIds = new Set(original.map((row) => stringValue(row, idKey)));
  const addedRows = patches.filter((row) => !originalIds.has(stringValue(row, idKey))).length;
  return {
    fileName,
    originalCount: original.length,
    mergedCount: merged.length,
    changedRows: patches.length - addedRows,
    addedRows,
    removedRows,
  };
}

const ANDROID_BODY_BLOCK_TYPES = new Set([
  "rich_text",
  "rich_html",
  "rich_body",
  "paragraph",
  "heading",
  "quote",
  "checklist",
  "checklist_checked",
  "bullet",
  "numbered",
  "link",
  "divider",
]);
const ANDROID_NON_BODY_BLOCK_TYPES = new Set(["attachment", "image"]);

function richTextDocument(draft: LocalNoteDraft) {
  return draft.richTextDocument ?? blocksToVaultRichText(draft.blocks);
}

function richTextBlockRow(
  noteId: string,
  document: ReturnType<typeof richTextDocument>,
  original?: JsonRow,
  envelope?: VaultRichTextEnvelope,
): JsonRow {
  return {
    ...original,
    id: stringValue(original ?? {}, "id") || `${noteId}-rich-text`,
    noteId,
    type: "rich_text",
    content: serializeVaultRichTextEnvelope(document, envelope?.preservedFields),
    orderIndex: typeof original?.orderIndex === "number" ? original.orderIndex : 0,
  };
}

function folderRow(folder: Folder): JsonRow {
  return {
    id: folder.id,
    parentId: folder.parentId ?? null,
    name: folder.title,
    description: folder.description ?? null,
    orderIndex: folder.orderIndex ?? 0,
    isFavourite: false,
    mode: folder.mode,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    deletedAt: localDeletedAt(folder),
  };
}

function courseFolderRow(folder: LocalCourseFolder): JsonRow {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.title,
    description: folder.description,
    orderIndex: folder.orderIndex,
    isFavourite: false,
    mode: folder.mode,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    deletedAt: folder.deletedAt ?? null,
  };
}

function courseRow(course: LocalCourse): JsonRow {
  return {
    id: course.id,
    title: course.title,
    rootFolderId: course.rootFolderId,
    lastOpenedNoteId: course.lastOpenedNoteId,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

function noteRow(note: Note): JsonRow {
  return {
    id: note.id,
    folderId: note.folderId ?? null,
    parentNoteId: note.parentNoteId ?? null,
    title: note.title,
    bodyPlainText: note.bodyPreview ?? "",
    isPinned: Boolean(note.isPinned),
    isFolderPinned: Boolean(note.isFolderPinned),
    isFavourite: false,
    orderIndex: note.orderIndex ?? 0,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: localDeletedAt(note),
  };
}

function attachmentRow(attachment: Attachment): JsonRow {
  return {
    id: attachment.id,
    noteId: attachment.noteId ?? null,
    libraryFolderId: attachment.libraryFolderId ?? null,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes ?? 0,
    localPath: "",
    remoteUrl: null,
    isPinned: Boolean(attachment.isPinned),
    createdAt: attachment.createdAt,
    deletedAt: localDeletedAt(attachment),
    fileEntry: `files/${attachment.id}`,
  };
}

function annotationRow(change: LocalPdfAnnotationChange): JsonRow | null {
  if (!change.annotation) return null;
  const annotation = change.annotation;
  return {
    id: annotation.id,
    attachmentId: annotation.attachmentId,
    libraryFolderId: annotation.libraryFolderId,
    pageIndex: annotation.pageIndex,
    left: annotation.left,
    top: annotation.top,
    right: annotation.right,
    bottom: annotation.bottom,
    color: annotation.color,
    noteText: annotation.noteText,
    annotationType: annotation.annotationType,
    textSize: annotation.textSize,
    backgroundColor: annotation.backgroundColor,
    displayTitle: annotation.displayTitle,
    displayFolderId: annotation.displayFolderId,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

export async function loadSyncPendingChanges(): Promise<SyncPendingChanges> {
  const [
    noteDrafts,
    createdFolders,
    createdNotes,
    createdAttachments,
    pdfReaderStates,
    pdfAnnotationChanges,
    courses,
    courseFolders,
    courseStickyNotes,
    courseConcepts,
  ] = await Promise.all([
    loadLocalNoteDrafts(),
    loadLocalCreatedFolders(),
    loadLocalCreatedNotes(),
    loadLocalCreatedAttachments(),
    loadLocalPdfReaderStates(),
    loadLocalPdfAnnotationChanges(),
    loadLocalCourses(),
    loadLocalCourseFolders(),
    loadLocalCourseStickyNotes(),
    loadLocalCourseConcepts(),
  ]);
  const blobChecks = await Promise.all(createdAttachments.map(async (attachment) => [
    attachment.id,
    Boolean(await loadLocalAttachmentBlob(attachment.id)),
  ] as const));
  return {
    noteDrafts,
    createdFolders,
    createdNotes,
    createdAttachments,
    attachmentBlobs: Object.fromEntries(blobChecks),
    pdfReaderStates,
    pdfAnnotationChanges,
    courses,
    courseFolders,
    courseStickyNotes,
    courseConcepts,
  };
}

export function buildSyncPreflight(bundle: MetadataRestoreBundle | null, pending: SyncPendingChanges): SyncPreflight {
  const counts = {
    noteDrafts: pending.noteDrafts.length,
    createdFolders: pending.createdFolders.length,
    createdNotes: pending.createdNotes.length,
    createdAttachments: pending.createdAttachments.length,
    pdfReaderStates: pending.pdfReaderStates.length,
    pdfAnnotationChanges: pending.pdfAnnotationChanges.length,
    courses: pending.courses.length,
    courseFolders: pending.courseFolders.length,
    courseStickyNotes: pending.courseStickyNotes.length,
    courseConcepts: pending.courseConcepts.length,
  } satisfies SyncChangeCounts;
  const totalPendingChanges = Object.values(counts).reduce((total, count) => total + count, 0);
  const base: Omit<SyncPreflight, "status"> = {
    generatedAt: new Date().toISOString(),
    sourceCloudVersion: bundle?.cloudVersion ?? null,
    totalPendingChanges,
    counts,
    touchedFiles: [],
    preservedMetadataFiles: bundle?.files.length ?? 0,
    sourceMetadataFiles: bundle?.files.length ?? 0,
    fileUploads: pending.createdAttachments.filter((attachment) => !localDeletedAt(attachment) && pending.attachmentBlobs[attachment.id]).map((attachment) => ({
      attachmentId: attachment.id,
      fileName: attachment.name,
      sizeBytes: attachment.sizeBytes ?? 0,
      blobAvailable: Boolean(pending.attachmentBlobs[attachment.id]),
    })),
    blockers: [],
    warnings: [],
    preparedFiles: {},
  };

  if (!bundle) {
    if (totalPendingChanges === 0) return { ...base, status: "local_only", blockers: [] };
    const initial = buildSyncPreflight(createInitialMetadataRestoreBundle(), pending);
    return {
      ...initial,
      status: initial.status === "blocked" ? "blocked" : "initial_backup",
      sourceCloudVersion: null,
    };
  }
  if (totalPendingChanges === 0) return { ...base, status: "no_changes" };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const preparedFiles: Record<string, JsonRow[]> = {};
  const touchedFiles: SyncTouchedFile[] = [];
  const sourceFileNames = new Set(bundle.files.map((file) => file.fileName));
  const touch = (fileName: string, original: JsonRow[], merged: JsonRow[], patches: JsonRow[], removedRows = 0, idKey = "id") => {
    preparedFiles[fileName] = merged;
    touchedFiles.push(touchedFile(fileName, original, merged, patches, removedRows, idKey));
  };

  const originalFolders = rowsFor(bundle, "folders.json");
  const folderPatches = [
    ...pending.createdFolders.map(folderRow),
    ...pending.courseFolders.map(courseFolderRow),
  ];
  const mergedFolders = mergeRows(originalFolders, folderPatches);
  if (folderPatches.length) touch("folders.json", originalFolders, mergedFolders, folderPatches);
  const folderById = new Map(mergedFolders.filter((row) => !rowIsDeleted(row)).map((row) => [stringValue(row, "id"), row]));
  folderPatches.forEach((folder) => {
    if (rowIsDeleted(folder)) return;
    const parentId = typeof folder.parentId === "string" ? folder.parentId : null;
    if (parentId && !folderById.has(parentId)) blockers.push(`Folder “${String(folder.name)}” has a missing parent folder.`);
    const parent = parentId ? folderById.get(parentId) : null;
    if (parent && stringValue(parent, "mode") !== stringValue(folder, "mode")) blockers.push(`Folder “${String(folder.name)}” is attached to a different workspace.`);
    if (!String(folder.name).trim()) blockers.push("A locally created folder has no name.");
  });

  const originalCourses = rowsFor(bundle, "courses.json");
  const originalCourseIds = new Set(originalCourses.map((row) => stringValue(row, "id")));
  const coursePatches = pending.courses.flatMap<JsonRow>((course) => {
    if (!course.deletedAt) return [courseRow(course)];
    if (originalCourseIds.has(course.id)) {
      blockers.push(`Course “${course.title}” cannot be deleted safely because the current Android backup format has no course deletion marker.`);
    }
    return [];
  });
  const courseRows = mergeRows(originalCourses, coursePatches);
  if (coursePatches.length) touch("courses.json", originalCourses, courseRows, coursePatches);
  const courseIds = new Set(courseRows.filter((row) => !rowIsDeleted(row)).map((row) => stringValue(row, "id")));
  pending.courseFolders.forEach((folder) => {
    if (folder.deletedAt) return;
    if (!courseIds.has(folder.courseId)) blockers.push(`Course folder “${folder.title}” has no matching restored course.`);
  });

  const originalNotes = rowsFor(bundle, "notes.json");
  const createdNoteRows = pending.createdNotes.map(noteRow);
  let mergedNotes = mergeRows(originalNotes, createdNoteRows);
  const activeCreatedNotes = pending.createdNotes.filter((note) => !localDeletedAt(note));
  const createdNoteIds = new Set(activeCreatedNotes.map((note) => note.id));
  const noteIdsBeforeDrafts = new Set(mergedNotes.filter((row) => !rowIsDeleted(row)).map((row) => stringValue(row, "id")));
  const validDrafts: LocalNoteDraft[] = [];
  const originalBlocks = rowsFor(bundle, "blocks.json");
  const restoredRichTextByNoteId = new Map<string, { row: JsonRow; envelope: VaultRichTextEnvelope }>();
  const draftPatches = pending.noteDrafts.flatMap<JsonRow>((draft) => {
    if (!noteIdsBeforeDrafts.has(draft.noteId)) {
      blockers.push(`Edited note “${draft.title}” is missing from the restored metadata.`);
      return [];
    }
    const restoredRow = originalNotes.find((row) => stringValue(row, "id") === draft.noteId);
    if (!createdNoteIds.has(draft.noteId) && restoredRow && typeof restoredRow.updatedAt === "number" && restoredRow.updatedAt !== draft.baseUpdatedAt) {
      blockers.push(`“${draft.title}” changed in the restored backup after the website edit began.`);
    }
    if (!createdNoteIds.has(draft.noteId)) {
      const bodyRows = originalBlocks.filter((row) => (
        stringValue(row, "noteId") === draft.noteId && ANDROID_BODY_BLOCK_TYPES.has(stringValue(row, "type"))
      ));
      const richTextRows = bodyRows.filter((row) => stringValue(row, "type") === "rich_text");
      const originalBody = richTextRows.length === 1 ? richTextRows[0] : null;
      const envelope = originalBody && typeof originalBody.content === "string"
        ? inspectVaultRichTextEnvelope(originalBody.content)
        : null;
      if (richTextRows.length > 0 && (!originalBody || !envelope)) {
        blockers.push(`“${draft.title}” uses Android formatting that MyVault Web cannot safely round-trip yet. Its original content has been preserved.`);
        return [];
      }
      if (originalBody && envelope) {
        restoredRichTextByNoteId.set(draft.noteId, { row: originalBody, envelope });
      } else if (bodyRows.length > 0) {
        warnings.push(`“${draft.title}” will be upgraded from legacy Android body blocks to the current rich-text format, matching an edit made in the Android app.`);
      } else {
        const noteBlocks = originalBlocks.filter((row) => stringValue(row, "noteId") === draft.noteId);
        const unrecognisedBlocks = noteBlocks.filter((row) => !ANDROID_NON_BODY_BLOCK_TYPES.has(stringValue(row, "type")));
        if (unrecognisedBlocks.length > 0) {
          blockers.push(`“${draft.title}” contains an unrecognised Android body format. Its original content has been preserved.`);
          return [];
        }
      }
    }
    validDrafts.push(draft);
    const document = richTextDocument(draft);
    return [{
      id: draft.noteId,
      title: draft.title,
      bodyPlainText: document.text,
      isPinned: draft.isPinned,
      updatedAt: draft.savedAt,
    }];
  });
  mergedNotes = mergeRows(mergedNotes, draftPatches);
  const notePatches = mergeRows(createdNoteRows, draftPatches);
  if (notePatches.length) touch("notes.json", originalNotes, mergedNotes, notePatches);
  const noteIds = new Set(mergedNotes.filter((row) => !rowIsDeleted(row)).map((row) => stringValue(row, "id")));
  notePatches.forEach((note) => {
    if (rowIsDeleted(note)) return;
    const folderId = typeof note.folderId === "string" ? note.folderId : mergedNotes.find((row) => stringValue(row, "id") === stringValue(note, "id"))?.folderId;
    if (typeof folderId === "string" && folderId && !folderById.has(folderId)) blockers.push(`Note “${String(note.title)}” has a missing folder.`);
    if (!String(note.title).trim()) blockers.push("A local note has no title.");
  });

  const draftByNoteId = new Map(validDrafts.map((draft) => [draft.noteId, draft]));
  const richTextBlockPatches = [
    ...activeCreatedNotes.map((note) => {
      const draft = draftByNoteId.get(note.id);
      const document = draft
        ? richTextDocument(draft)
        : { text: note.bodyPreview ?? "", styleMarks: [], noteLinks: [] };
      return richTextBlockRow(note.id, document);
    }),
    ...validDrafts
      .filter((draft) => !createdNoteIds.has(draft.noteId))
      .map((draft) => {
        const restored = restoredRichTextByNoteId.get(draft.noteId);
        return richTextBlockRow(draft.noteId, richTextDocument(draft), restored?.row, restored?.envelope);
      }),
  ];
  if (richTextBlockPatches.length) {
    const editedNoteIds = new Set(richTextBlockPatches.map((row) => stringValue(row, "noteId")));
    const blocksWithoutReplacedBodies = originalBlocks.filter((row) => {
      const noteId = stringValue(row, "noteId");
      return !editedNoteIds.has(noteId) || !ANDROID_BODY_BLOCK_TYPES.has(stringValue(row, "type"));
    });
    const mergedBlocks = mergeRows(blocksWithoutReplacedBodies, richTextBlockPatches);
    touch(
      "blocks.json",
      originalBlocks,
      mergedBlocks,
      richTextBlockPatches,
      originalBlocks.length - blocksWithoutReplacedBodies.length,
    );
  }

  const originalAttachments = rowsFor(bundle, "attachments.json");
  const originalAttachmentIds = new Set(originalAttachments.map((row) => stringValue(row, "id")));
  const attachmentPatches = pending.createdAttachments.flatMap<JsonRow>((attachment) => (
    localDeletedAt(attachment) && !originalAttachmentIds.has(attachment.id) ? [] : [attachmentRow(attachment)]
  ));
  const mergedAttachments = mergeRows(originalAttachments, attachmentPatches);
  if (attachmentPatches.length) touch("attachments.json", originalAttachments, mergedAttachments, attachmentPatches);
  const attachmentIds = new Set(mergedAttachments.filter((row) => !rowIsDeleted(row)).map((row) => stringValue(row, "id")));
  pending.createdAttachments.forEach((attachment) => {
    if (localDeletedAt(attachment)) return;
    if (attachment.libraryFolderId && !folderById.has(attachment.libraryFolderId)) blockers.push(`PDF “${attachment.name}” has a missing Library folder.`);
    if (attachment.libraryFolderId && stringValue(folderById.get(attachment.libraryFolderId) ?? {}, "mode") !== "library") blockers.push(`PDF “${attachment.name}” is attached outside the Library workspace.`);
    if (attachment.noteId && !noteIds.has(attachment.noteId)) blockers.push(`PDF “${attachment.name}” has a missing note.`);
    if (!originalAttachmentIds.has(attachment.id) && !pending.attachmentBlobs[attachment.id]) blockers.push(`The local file for “${attachment.name}” is missing.`);
  });
  if (base.fileUploads.length) warnings.push(`${base.fileUploads.length} local PDF file${base.fileUploads.length === 1 ? "" : "s"} will be uploaded with its Android-compatible metadata.`);

  const originalProgress = rowsFor(bundle, "pdf_reading_progress.json");
  const deletedProgressIds = new Set(pending.pdfReaderStates.filter((state) => localDeletedAt(state)).map((state) => state.attachmentId));
  const progressPatches = pending.pdfReaderStates.flatMap<JsonRow>((state) => {
    if (localDeletedAt(state)) return [];
    if (!attachmentIds.has(state.attachmentId)) {
      blockers.push(`PDF reading progress refers to missing attachment ${state.attachmentId}.`);
      return [];
    }
    if (state.pageCount <= 0 || state.pageIndex < 0 || state.pageIndex >= state.pageCount) {
      blockers.push(`PDF reading progress for ${state.attachmentId} has an invalid page position.`);
      return [];
    }
    return [{
      attachmentId: state.attachmentId,
      pageIndex: state.pageIndex,
      pageCount: state.pageCount,
      progressPercent: Math.max(0, Math.min(1, state.progressPercent / 100)),
      lastOpenedAt: state.lastOpenedAt,
      updatedAt: state.updatedAt,
    }];
  });
  if (progressPatches.length || deletedProgressIds.size) {
    const progressWithoutDeletes = originalProgress.filter((row) => !deletedProgressIds.has(stringValue(row, "attachmentId")));
    const progressWithIds = progressWithoutDeletes.map((row) => ({ ...row, id: stringValue(row, "attachmentId") }));
    const patchesWithIds = progressPatches.map((row) => ({ ...row, id: stringValue(row, "attachmentId") }));
    const merged = mergeRows(progressWithIds, patchesWithIds).map(({ id: _id, ...row }) => row);
    touch(
      "pdf_reading_progress.json",
      originalProgress,
      merged,
      progressPatches,
      originalProgress.length - progressWithoutDeletes.length,
      "attachmentId",
    );
  }

  const originalAnnotations = rowsFor(bundle, "pdf_annotations.json");
  const annotationUpserts = pending.pdfAnnotationChanges.flatMap<JsonRow>((change) => {
    if (!attachmentIds.has(change.attachmentId)) {
      blockers.push(`A PDF annotation refers to missing attachment ${change.attachmentId}.`);
      return [];
    }
    const row = annotationRow(change);
    if (row && row.annotationType !== "page_note" && (!(Number(row.right) > Number(row.left)) || !(Number(row.bottom) > Number(row.top)))) {
      blockers.push(`PDF annotation ${change.id} has invalid bounds.`);
      return [];
    }
    if (row && row.annotationType === "page_note" && !String(row.noteText ?? "").trim()) {
      blockers.push(`PDF page note ${change.id} has no text.`);
      return [];
    }
    return row ? [row] : [];
  });
  const deletedAnnotationIds = new Set(pending.pdfAnnotationChanges.filter((change) => change.operation === "delete").map((change) => change.id));
  if (annotationUpserts.length || deletedAnnotationIds.size) {
    const withoutDeletes = originalAnnotations.filter((row) => !deletedAnnotationIds.has(stringValue(row, "id")));
    const merged = mergeRows(withoutDeletes, annotationUpserts);
    const removedRows = originalAnnotations.length - withoutDeletes.length;
    touch("pdf_annotations.json", originalAnnotations, merged, annotationUpserts, removedRows);
  }

  const originalStickyNotes = rowsFor(bundle, "folder_sticky_notes.json");
  const originalStickyNoteIds = new Set(originalStickyNotes.map((row) => stringValue(row, "id")));
  const stickyPatches = pending.courseStickyNotes.flatMap<JsonRow>((stickyNote) => {
    if (stickyNote.deletedAt) {
      if (originalStickyNoteIds.has(stickyNote.id)) {
        blockers.push("A restored Course sticky note cannot be deleted safely because the current Android backup format has no sticky-note deletion marker.");
      }
      return [];
    }
    if (!folderById.has(stickyNote.folderId)) {
      blockers.push(`Course sticky note has a missing folder (${stickyNote.folderId}).`);
      return [];
    }
    if (!courseIds.has(stickyNote.courseId) || stringValue(folderById.get(stickyNote.folderId) ?? {}, "mode") !== `course:${stickyNote.courseId}`) {
      blockers.push(`Course sticky note is attached to a different course workspace.`);
      return [];
    }
    if (!stickyNote.text.trim()) {
      blockers.push("A Course sticky note has no text.");
      return [];
    }
    return [{
      id: stickyNote.id,
      folderId: stickyNote.folderId,
      text: stickyNote.text,
      createdAt: stickyNote.createdAt,
      updatedAt: stickyNote.updatedAt,
    }];
  });
  if (stickyPatches.length) touch("folder_sticky_notes.json", originalStickyNotes, mergeRows(originalStickyNotes, stickyPatches), stickyPatches);

  const originalConcepts = rowsFor(bundle, "course_concept_cards.json");
  const originalConceptIds = new Set(originalConcepts.map((row) => stringValue(row, "id")));
  const conceptPatches = pending.courseConcepts.flatMap<JsonRow>((concept) => {
    if (concept.deletedAt) {
      if (originalConceptIds.has(concept.id)) {
        blockers.push(`Course concept “${concept.term}” cannot be deleted safely because the current Android backup format has no concept-card deletion marker.`);
      }
      return [];
    }
    if (!courseIds.has(concept.courseId)) {
      blockers.push(`Course concept “${concept.term}” has no matching restored course.`);
      return [];
    }
    if (!concept.term.trim()) {
      blockers.push("A Course concept has no term.");
      return [];
    }
    return [{
      id: concept.id,
      courseId: concept.courseId,
      term: concept.term,
      arabicTerm: concept.arabicTerm,
      definition: concept.definition,
      details: concept.details,
      sortOrder: concept.sortOrder,
      createdAt: concept.createdAt,
      updatedAt: concept.updatedAt,
    }];
  });
  if (conceptPatches.length) touch("course_concept_cards.json", originalConcepts, mergeRows(originalConcepts, conceptPatches), conceptPatches);

  const touchedExistingFiles = touchedFiles.filter((file) => sourceFileNames.has(file.fileName)).length;
  return {
    ...base,
    status: blockers.length ? "blocked" : "ready",
    touchedFiles,
    preservedMetadataFiles: Math.max(0, bundle.files.length - touchedExistingFiles),
    blockers,
    warnings,
    preparedFiles,
  };
}

export async function runSyncPreflight() {
  const bundle = await loadMetadataRestoreBundle();
  if (bundle) await reconcileLocalNoteDrafts(bundle);
  const pending = await loadSyncPendingChanges();
  return buildSyncPreflight(bundle, pending);
}
