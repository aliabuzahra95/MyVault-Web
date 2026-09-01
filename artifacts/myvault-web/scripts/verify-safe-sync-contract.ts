import assert from "node:assert/strict";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup";
import { canonicalJson } from "../src/lib/sync/revision";
import {
  buildSyncPreflight,
  createInitialMetadataRestoreBundle,
  type SyncPendingChanges,
} from "../src/lib/sync/syncPreflight";
import { reconcileMetadataBundles } from "../src/lib/sync/threeWayMerge";
import { validateSyncCandidate } from "../src/lib/sync/validateSyncCandidate";
import { inspectVaultRichTextEnvelope, serializeVaultRichTextEnvelope } from "../src/lib/restore/vaultRichText";
import { tiptapToVaultRichText, vaultRichTextToTiptap } from "../src/lib/restore/vaultRichTextTiptap";
import type { MetadataRestoreBundle } from "../src/lib/restore/metadataRestore";

type JsonRow = Record<string, unknown>;

function rows(bundle: MetadataRestoreBundle, fileName: string) {
  const json = bundle.files.find((file) => file.fileName === fileName)?.json;
  assert.ok(Array.isArray(json), `${fileName} must be an array`);
  return json as JsonRow[];
}

function row(bundle: MetadataRestoreBundle, fileName: string, id: string) {
  const found = rows(bundle, fileName).find((item) => item.id === id);
  assert.ok(found, `${fileName} is missing ${id}`);
  return found;
}

function replaceRow(bundle: MetadataRestoreBundle, fileName: string, id: string, changes: JsonRow) {
  const target = rows(bundle, fileName);
  const index = target.findIndex((item) => item.id === id);
  assert.notEqual(index, -1, `${fileName} is missing ${id}`);
  target[index] = { ...target[index], ...changes };
}

function removeRow(bundle: MetadataRestoreBundle, fileName: string, id: string) {
  const target = rows(bundle, fileName);
  const index = target.findIndex((item) => item.id === id);
  assert.notEqual(index, -1, `${fileName} is missing ${id}`);
  target.splice(index, 1);
}

function withPreparedFiles(bundle: MetadataRestoreBundle, preparedFiles: Record<string, JsonRow[]>) {
  return {
    ...bundle,
    files: bundle.files.map((file) => preparedFiles[file.fileName]
      ? { ...file, json: preparedFiles[file.fileName], itemCount: preparedFiles[file.fileName].length }
      : file),
  };
}

function emptyPending(): SyncPendingChanges {
  return {
    noteDrafts: [],
    createdFolders: [],
    createdNotes: [],
    createdAttachments: [],
    attachmentBlobs: {},
    pdfReaderStates: [],
    pdfAnnotationChanges: [],
    courses: [],
    courseFolders: [],
    courseStickyNotes: [],
    courseConcepts: [],
  };
}

const base = representativeAndroidBackup();
assert.equal(base.files.length, 25, "The representative backup must cover the 22 current Android files and three legacy optional AI files.");
assert.deepEqual(validateSyncCandidate(base), { valid: true, issues: [] });

const initialBundle = createInitialMetadataRestoreBundle(1_780_000_000_100);
assert.equal(initialBundle.files.length, 22, "A web-first backup must create exactly the metadata files Android currently writes.");
assert.equal(initialBundle.files.some((file) => file.fileName === "ai_messages.json"), false, "A web-first backup must not invent legacy AI metadata.");
assert.deepEqual(validateSyncCandidate(initialBundle), { valid: true, issues: [] });

const richBlock = row(base, "blocks.json", "block-rich");
const envelope = inspectVaultRichTextEnvelope(String(richBlock.content));
assert.ok(envelope, "Known Android rich text must be accepted.");
assert.deepEqual(envelope.preservedFields, {
  androidDocumentVersion: 7,
  futureEnvelopeField: { preserve: true },
});
assert.deepEqual(
  JSON.parse(serializeVaultRichTextEnvelope(envelope.document, envelope.preservedFields)),
  JSON.parse(String(richBlock.content)),
  "A no-op rich-text round trip must preserve the Android envelope.",
);
assert.equal(inspectVaultRichTextEnvelope(JSON.stringify({
  text: "unsafe",
  styleMarks: [{ start: 0, end: 6, style: "FutureAndroidStyle" }],
  noteLinks: [],
})), null, "Unknown Android style marks must block write-back.");
assert.equal(inspectVaultRichTextEnvelope(JSON.stringify({
  text: "unsafe",
  styleMarks: [{ start: 0, end: 6, style: "Bold", futureMember: true }],
  noteLinks: [],
})), null, "Unknown style-mark members must block write-back.");

const spacedText = "Heading\n\nFirst paragraph.\nSecond line.\n\nفقرة عربية\n\nFinal paragraph.";
const arabicStart = spacedText.indexOf("فقرة عربية");
const spacedDocument = {
  text: spacedText,
  styleMarks: [
    { start: 0, end: 7, style: "Heading2" as const },
    { start: 9, end: 14, style: "Bold" as const },
    { start: arabicStart, end: arabicStart + "فقرة عربية".length, style: "Italic" as const },
  ],
  noteLinks: [],
};
const spacedRoundTrip = tiptapToVaultRichText(vaultRichTextToTiptap(spacedDocument), spacedDocument);
assert.equal(spacedRoundTrip.text, spacedDocument.text, "Web editor conversion must preserve deliberate blank paragraphs exactly.");
const sortMarks = (marks: typeof spacedDocument.styleMarks) => marks.toSorted((first, second) => first.style.localeCompare(second.style) || first.start - second.start);
assert.deepEqual(sortMarks(spacedRoundTrip.styleMarks), sortMarks(spacedDocument.styleMarks), "Web editor conversion must preserve mixed-language formatting ranges.");

const existingRichTextDraft: SyncPendingChanges["noteDrafts"][number] = {
    schemaVersion: 1,
    noteId: "note-tawakkul",
    baseCloudVersion: base.cloudVersion,
    baseUpdatedAt: 100,
    title: "التوكل - Edited on Web",
    mode: "rich_text",
    richTextDocument: {
      text: "التوكل على الله\nEdited safely on Web.",
      styleMarks: [{ start: 0, end: 15, style: "Heading2" }],
      noteLinks: [],
    },
    blocks: [],
    isPinned: true,
    savedAt: 200,
    pendingDriveSync: true,
};
const editedExistingRichText = buildSyncPreflight(base, {
  ...emptyPending(),
  noteDrafts: [existingRichTextDraft],
});
assert.equal(editedExistingRichText.status, "ready", editedExistingRichText.blockers.join("\n"));
const editedRichTextCandidate = withPreparedFiles(base, editedExistingRichText.preparedFiles);
assert.equal(row(editedRichTextCandidate, "notes.json", "note-tawakkul").title, "التوكل - Edited on Web");
const editedRichTextBlock = row(editedRichTextCandidate, "blocks.json", "block-rich");
assert.deepEqual(editedRichTextBlock.androidBlockField, { preserve: true }, "An edited current rich-text block must preserve Android row fields.");
assert.deepEqual(JSON.parse(String(editedRichTextBlock.content)).futureEnvelopeField, { preserve: true }, "An edited current rich-text block must preserve Android envelope fields.");
assert.deepEqual(validateSyncCandidate(editedRichTextCandidate), { valid: true, issues: [] });

const existingLegacyDraft: SyncPendingChanges["noteDrafts"][number] = {
    schemaVersion: 1,
    noteId: "note-hadith",
    baseCloudVersion: base.cloudVersion,
    baseUpdatedAt: 100,
    title: "Hadith edited safely on Web",
    mode: "rich_text",
    richTextDocument: {
      text: "Tie it, trust Allah, and preserve the edit.",
      styleMarks: [{ start: 0, end: 6, style: "Bold" }],
      noteLinks: [],
    },
    blocks: [],
    isPinned: false,
    savedAt: 210,
    pendingDriveSync: true,
};
const editedExistingLegacyNote = buildSyncPreflight(base, {
  ...emptyPending(),
  noteDrafts: [existingLegacyDraft],
});
assert.equal(editedExistingLegacyNote.status, "ready", editedExistingLegacyNote.blockers.join("\n"));
assert.ok(editedExistingLegacyNote.warnings.some((message) => message.includes("legacy Android body blocks")));
const editedLegacyCandidate = withPreparedFiles(base, editedExistingLegacyNote.preparedFiles);
assert.equal(rows(editedLegacyCandidate, "blocks.json").some((item) => item.id === "block-hadith"), false, "The legacy paragraph must be replaced after an intentional edit.");
const migratedLegacyBlock = row(editedLegacyCandidate, "blocks.json", "note-hadith-rich-text");
assert.equal(migratedLegacyBlock.type, "rich_text");
assert.equal(JSON.parse(String(migratedLegacyBlock.content)).text, "Tie it, trust Allah, and preserve the edit.");
assert.deepEqual(validateSyncCandidate(editedLegacyCandidate), { valid: true, issues: [] });

const unknownFutureRichText = structuredClone(base);
replaceRow(unknownFutureRichText, "blocks.json", "block-rich", {
  content: JSON.stringify({
    text: "Future formatting",
    styleMarks: [{ start: 0, end: 6, style: "FutureAndroidStyle" }],
    noteLinks: [],
  }),
});
const unsafeExistingEdit = buildSyncPreflight(unknownFutureRichText, {
  ...emptyPending(),
  noteDrafts: [existingRichTextDraft],
});
assert.equal(unsafeExistingEdit.status, "blocked");
assert.ok(unsafeExistingEdit.blockers.some((message) => message.includes("cannot safely round-trip")));

const remotelyChangedExistingNote = structuredClone(base);
replaceRow(remotelyChangedExistingNote, "notes.json", "note-tawakkul", { updatedAt: 999 });
const staleExistingEdit = buildSyncPreflight(remotelyChangedExistingNote, {
  ...emptyPending(),
  noteDrafts: [existingRichTextDraft],
});
assert.equal(staleExistingEdit.status, "blocked");
assert.ok(staleExistingEdit.blockers.some((message) => message.includes("changed in the restored backup")));

const web = structuredClone(base);
const remote = structuredClone(base);
replaceRow(web, "notes.json", "note-tawakkul", { title: "التوكل - Edited on Web", updatedAt: 200 });
replaceRow(remote, "notes.json", "note-hadith", { title: "Hadith edited on Android", updatedAt: 300 });
replaceRow(remote, "folders.json", "folder-aqidah", { name: "العقيدة والتوحيد", updatedAt: 300 });
const untouchedBefore = new Map(
  base.files
    .filter((file) => !new Set(["notes.json", "folders.json"]).has(file.fileName))
    .map((file) => [file.fileName, canonicalJson(file.json)]),
);
const independent = reconcileMetadataBundles({
  base,
  web,
  remote,
  touchedFiles: new Set(["notes.json"]),
});
assert.equal(independent.conflicts.length, 0);
assert.equal(row(independent.bundle, "notes.json", "note-tawakkul").title, "التوكل - Edited on Web");
assert.equal(row(independent.bundle, "notes.json", "note-hadith").title, "Hadith edited on Android");
assert.equal(row(independent.bundle, "folders.json", "folder-aqidah").name, "العقيدة والتوحيد");
for (const [fileName, before] of untouchedBefore) {
  assert.equal(canonicalJson(independent.bundle.files.find((file) => file.fileName === fileName)?.json), before, `${fileName} changed without permission.`);
}
assert.deepEqual(row(independent.bundle, "notes.json", "note-personal").personalOnlyPayload, { private: true });
assert.deepEqual(row(independent.bundle, "pdf_annotations.json", "annotation-highlight").futureGeometry, { quadPoints: [1.1, 2.2, 3.3, 4.4] });
assert.deepEqual(validateSyncCandidate(independent.bundle), { valid: true, issues: [] });

const webConflict = structuredClone(base);
const remoteConflict = structuredClone(base);
replaceRow(webConflict, "notes.json", "note-tawakkul", { title: "Web title" });
replaceRow(remoteConflict, "notes.json", "note-tawakkul", { title: "Android title" });
const sameEntityConflict = reconcileMetadataBundles({ base, web: webConflict, remote: remoteConflict, touchedFiles: new Set(["notes.json"]) });
assert.deepEqual(sameEntityConflict.conflicts.map((item) => [item.fileName, item.entityId, item.kind]), [
  ["notes.json", "note-tawakkul", "same-entity-changed"],
]);

const webFieldEdit = structuredClone(base);
const remoteFieldEdit = structuredClone(base);
replaceRow(webFieldEdit, "notes.json", "note-tawakkul", { title: "Web title only", updatedAt: 200 });
replaceRow(remoteFieldEdit, "notes.json", "note-tawakkul", { isFavourite: true, updatedAt: 300 });
const fieldMerge = reconcileMetadataBundles({ base, web: webFieldEdit, remote: remoteFieldEdit, touchedFiles: new Set(["notes.json"]) });
assert.equal(fieldMerge.conflicts.length, 0, "Different fields on the same entity should merge automatically.");
assert.equal(row(fieldMerge.bundle, "notes.json", "note-tawakkul").title, "Web title only");
assert.equal(row(fieldMerge.bundle, "notes.json", "note-tawakkul").isFavourite, true);
assert.equal(row(fieldMerge.bundle, "notes.json", "note-tawakkul").updatedAt, 300);

const folderWeb = structuredClone(base);
const folderRemote = structuredClone(base);
replaceRow(folderWeb, "folders.json", "folder-aqidah", { name: "Web folder name", updatedAt: 220 });
replaceRow(folderRemote, "folders.json", "folder-aqidah", { description: "Android folder description", updatedAt: 320 });
const folderFieldMerge = reconcileMetadataBundles({ base, web: folderWeb, remote: folderRemote, touchedFiles: new Set(["folders.json"]) });
assert.equal(folderFieldMerge.conflicts.length, 0, "Different folder fields should merge without losing either change.");
assert.equal(row(folderFieldMerge.bundle, "folders.json", "folder-aqidah").name, "Web folder name");
assert.equal(row(folderFieldMerge.bundle, "folders.json", "folder-aqidah").description, "Android folder description");

const attachmentWeb = structuredClone(base);
const attachmentRemote = structuredClone(base);
rows(attachmentWeb, "attachments.json").push({
  id: "pdf-created-on-web",
  noteId: null,
  libraryFolderId: "folder-library",
  fileName: "Web upload.pdf",
  mimeType: "application/pdf",
  sizeBytes: 123,
  localPath: "",
  remoteUrl: null,
  isPinned: false,
  createdAt: 220,
  deletedAt: null,
  fileEntry: "files/pdf-created-on-web",
});
rows(attachmentRemote, "attachments.json").push({
  id: "pdf-created-on-android",
  noteId: null,
  libraryFolderId: "folder-library",
  fileName: "Android upload.pdf",
  mimeType: "application/pdf",
  sizeBytes: 456,
  localPath: "/android/path.pdf",
  remoteUrl: null,
  isPinned: false,
  createdAt: 320,
  deletedAt: null,
  fileEntry: "files/pdf-created-on-android",
});
const attachmentMerge = reconcileMetadataBundles({ base, web: attachmentWeb, remote: attachmentRemote, touchedFiles: new Set(["attachments.json"]) });
assert.equal(attachmentMerge.conflicts.length, 0, "New PDFs with distinct stable IDs must merge.");
assert.ok(rows(attachmentMerge.bundle, "attachments.json").some((item) => item.id === "pdf-created-on-web"));
assert.ok(rows(attachmentMerge.bundle, "attachments.json").some((item) => item.id === "pdf-created-on-android"));

const annotationWeb = structuredClone(base);
const annotationRemote = structuredClone(base);
rows(annotationWeb, "pdf_annotations.json").push({
  ...row(base, "pdf_annotations.json", "annotation-highlight"),
  id: "annotation-created-on-web",
  noteText: "Web annotation",
  updatedAt: 220,
});
rows(annotationRemote, "pdf_annotations.json").push({
  ...row(base, "pdf_annotations.json", "annotation-highlight"),
  id: "annotation-created-on-android",
  noteText: "Android annotation",
  updatedAt: 320,
});
const annotationMerge = reconcileMetadataBundles({ base, web: annotationWeb, remote: annotationRemote, touchedFiles: new Set(["pdf_annotations.json"]) });
assert.equal(annotationMerge.conflicts.length, 0, "Independent PDF annotations must merge.");
assert.ok(rows(annotationMerge.bundle, "pdf_annotations.json").some((item) => item.id === "annotation-created-on-web"));
assert.ok(rows(annotationMerge.bundle, "pdf_annotations.json").some((item) => item.id === "annotation-created-on-android"));

const progressWeb = structuredClone(base);
const progressRemote = structuredClone(base);
const progressId = String(rows(base, "pdf_reading_progress.json")[0]?.attachmentId);
const webProgress = rows(progressWeb, "pdf_reading_progress.json").find((item) => item.attachmentId === progressId)!;
const remoteProgress = rows(progressRemote, "pdf_reading_progress.json").find((item) => item.attachmentId === progressId)!;
Object.assign(webProgress, { pageIndex: 20, progressPercent: 0.7, lastOpenedAt: 500, updatedAt: 500 });
Object.assign(remoteProgress, { pageIndex: 15, progressPercent: 0.5, lastOpenedAt: 400, updatedAt: 400 });
const progressMerge = reconcileMetadataBundles({ base, web: progressWeb, remote: progressRemote, touchedFiles: new Set(["pdf_reading_progress.json"]) });
assert.equal(progressMerge.conflicts.length, 0, "Reading position is last-writer state and should choose the latest timestamp.");
assert.equal(rows(progressMerge.bundle, "pdf_reading_progress.json").find((item) => item.attachmentId === progressId)?.pageIndex, 20);

const webDelete = structuredClone(base);
const remoteEdit = structuredClone(base);
removeRow(webDelete, "notes.json", "note-hadith");
replaceRow(remoteEdit, "notes.json", "note-hadith", { title: "Android retained note" });
const deleteEditConflict = reconcileMetadataBundles({ base, web: webDelete, remote: remoteEdit, touchedFiles: new Set(["notes.json"]) });
assert.deepEqual(deleteEditConflict.conflicts.map((item) => [item.entityId, item.kind]), [["note-hadith", "delete-edit"]]);

const unsupportedWeb = structuredClone(base);
const unsupportedRemote = structuredClone(base);
unsupportedWeb.files.find((file) => file.fileName === "ai_messages.json")!.json = [{ role: "user", content: "No stable identity" }];
const unsupported = reconcileMetadataBundles({ base, web: unsupportedWeb, remote: unsupportedRemote, touchedFiles: new Set(["ai_messages.json"]) });
assert.equal(unsupported.conflicts[0]?.kind, "unsupported-file-shape");

const newOptionalWeb = structuredClone(base);
newOptionalWeb.files.push({
  fileName: "future_optional.json",
  entryPath: "metadata/future_optional.json",
  backupEntry: "future_optional.json",
  cloudFileId: "",
  size: 10,
  updatedAt: null,
  itemCount: 1,
  json: [{ id: "future-1", value: "web" }],
});
const optional = reconcileMetadataBundles({ base, web: newOptionalWeb, remote: structuredClone(base), touchedFiles: new Set(["future_optional.json"]) });
assert.equal(optional.conflicts.length, 0);
assert.deepEqual(optional.bundle.files.find((file) => file.fileName === "future_optional.json")?.json, [{ id: "future-1", value: "web" }]);

const knowledgeWeb = structuredClone(base);
const knowledgeRemote = structuredClone(base);
rows(knowledgeWeb, "knowledge_tag_links.json")[0] = {
  ...rows(knowledgeWeb, "knowledge_tag_links.json")[0],
  createdAt: 200,
};
const knowledgeMerge = reconcileMetadataBundles({
  base,
  web: knowledgeWeb,
  remote: knowledgeRemote,
  touchedFiles: new Set(["knowledge_tag_links.json"]),
});
assert.equal(knowledgeMerge.conflicts.length, 0, "Current Android knowledge-tag links must have a stable composite identity.");
assert.equal(rows(knowledgeMerge.bundle, "knowledge_tag_links.json")[0]?.createdAt, 200);

const courseDelete = buildSyncPreflight(base, {
  ...emptyPending(),
  courses: [{
    schemaVersion: 1,
    id: "course-fiqh",
    title: "فقه الصلاة",
    rootFolderId: "folder-course",
    lastOpenedNoteId: "note-tawakkul",
    noteCount: 1,
    conceptCount: 1,
    stickyNoteCount: 1,
    createdAt: 50,
    updatedAt: 200,
    pendingDriveSync: true,
    deletedAt: 200,
  }],
});
assert.equal(courseDelete.status, "blocked");
assert.ok(courseDelete.blockers.some((message) => message.includes("no course deletion marker")));

const stickyDelete = buildSyncPreflight(base, {
  ...emptyPending(),
  courseStickyNotes: [{
    schemaVersion: 1,
    id: "folder-sticky",
    courseId: "course-fiqh",
    folderId: "folder-aqidah",
    text: "Pinned reminder",
    createdAt: 50,
    updatedAt: 200,
    pendingDriveSync: true,
    deletedAt: 200,
  }],
});
assert.equal(stickyDelete.status, "blocked");
assert.ok(stickyDelete.blockers.some((message) => message.includes("no sticky-note deletion marker")));

const conceptDelete = buildSyncPreflight(base, {
  ...emptyPending(),
  courseConcepts: [{
    schemaVersion: 1,
    id: "concept-niyyah",
    courseId: "course-fiqh",
    term: "Niyyah",
    arabicTerm: "النية",
    definition: "Intention",
    details: null,
    sortOrder: 0,
    createdAt: 50,
    updatedAt: 200,
    pendingDriveSync: true,
    deletedAt: 200,
  }],
});
assert.equal(conceptDelete.status, "blocked");
assert.ok(conceptDelete.blockers.some((message) => message.includes("no concept-card deletion marker")));

const progressDelete = buildSyncPreflight(base, {
  ...emptyPending(),
  pdfReaderStates: [{
    schemaVersion: 1,
    attachmentId: "pdf-aqidah",
    pageIndex: 12,
    pageCount: 30,
    progressPercent: 42,
    zoom: 1,
    lastOpenedAt: 100,
    updatedAt: 200,
    pendingDriveSync: true,
    deletedAt: 200,
  }],
});
assert.equal(progressDelete.status, "ready");
assert.equal(progressDelete.preparedFiles["pdf_reading_progress.json"]?.some((item) => item.attachmentId === "pdf-aqidah"), false);
assert.equal(progressDelete.touchedFiles.find((item) => item.fileName === "pdf_reading_progress.json")?.removedRows, 1);

const invalidReference = structuredClone(base);
replaceRow(invalidReference, "attachments.json", "pdf-aqidah", { libraryFolderId: "missing-folder" });
const invalidResult = validateSyncCandidate(invalidReference);
assert.equal(invalidResult.valid, false);
assert.ok(invalidResult.issues.some((issue) => issue.includes("missing-folder")));

const invalidAndroidShape = structuredClone(base);
delete row(invalidAndroidShape, "notes.json", "note-hadith").isPinned;
const invalidShapeResult = validateSyncCandidate(invalidAndroidShape);
assert.equal(invalidShapeResult.valid, false);
assert.ok(invalidShapeResult.issues.some((issue) => issue.includes("invalid or missing isPinned")));

console.log("Safe sync contract verified: Android-only data is preserved, independent edits merge, and unsafe conflicts fail closed.");
