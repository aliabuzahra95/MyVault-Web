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
assert.equal(base.files.length, 24, "The representative backup must cover the 21 current Android files and three legacy optional AI files.");
assert.deepEqual(validateSyncCandidate(base), { valid: true, issues: [] });

const initialBundle = createInitialMetadataRestoreBundle(1_780_000_000_100);
assert.equal(initialBundle.files.length, 21, "A web-first backup must create exactly the metadata files Android currently writes.");
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
