import assert from "node:assert/strict";
import { buildRestoredCorpus, projectIslamicCorpusBundle } from "../src/lib/restore/restoredCorpus";
import type { MetadataRestoreBundle, RestoredMetadataFile } from "../src/lib/restore/metadataRestore";

const file = (fileName: string, json: unknown): RestoredMetadataFile => ({
  fileName,
  entryPath: `metadata/${fileName}`,
  backupEntry: fileName,
  cloudFileId: `cloud-${fileName}`,
  size: JSON.stringify(json).length,
  updatedAt: 1,
  itemCount: Array.isArray(json) ? json.length : null,
  json,
});

const files = [
  file("folders.json", [
    { id: "study", parentId: null, name: "Islamic Study", mode: "study", deletedAt: null },
    { id: "library", parentId: null, name: "Islamic Library", mode: "library", deletedAt: null },
    { id: "personal", parentId: null, name: "Personal Inbox", mode: "personal", deletedAt: null },
    { id: "personal-library", parentId: null, name: ".personal-library-root", mode: "personal_library", deletedAt: null },
  ]),
  file("notes.json", [
    { id: "root-note", folderId: null, title: "Islamic root note", bodyPlainText: "root", deletedAt: null },
    { id: "study-note", folderId: "study", title: "Islamic study note", bodyPlainText: "study", deletedAt: null },
    { id: "personal-note", folderId: "personal", title: "Private note", bodyPlainText: "private", deletedAt: null },
  ]),
  file("blocks.json", [
    { id: "block-study", noteId: "study-note", type: "paragraph", content: "study", orderIndex: 0 },
    { id: "block-personal", noteId: "personal-note", type: "paragraph", content: "private", orderIndex: 0 },
  ]),
  file("note_tables.json", []),
  file("note_versions.json", []),
  file("note_tags.json", [
    { noteId: "study-note", tagName: "fiqh" },
    { noteId: "personal-note", tagName: "private" },
  ]),
  file("tags.json", [{ name: "fiqh" }, { name: "private" }]),
  file("folder_sticky_notes.json", []),
  file("attachments.json", [
    { id: "root-pdf", noteId: "", libraryFolderId: null, fileName: "Root.pdf", deletedAt: null },
    { id: "library-pdf", noteId: "", libraryFolderId: "library", fileName: "Islamic.pdf", deletedAt: null },
    { id: "personal-pdf", noteId: "", libraryFolderId: "personal-library", fileName: "Private.pdf", deletedAt: null },
    { id: "personal-note-file", noteId: "personal-note", libraryFolderId: null, fileName: "Private note file.pdf", deletedAt: null },
  ]),
  file("pdf_reading_progress.json", [
    { attachmentId: "library-pdf", progressPercent: 0.5 },
    { attachmentId: "personal-pdf", progressPercent: 0.5 },
  ]),
  file("pdf_annotations.json", [
    { id: "islamic-highlight", attachmentId: "library-pdf", annotationType: "highlight", left: 0, top: 0, right: 1, bottom: 1 },
    { id: "personal-highlight", attachmentId: "personal-pdf", annotationType: "highlight", left: 0, top: 0, right: 1, bottom: 1 },
  ]),
  file("source_backlinks.json", []),
  file("knowledge_tag_links.json", [
    { tagId: "kt-islamic", targetType: "note", targetId: "study-note" },
    { tagId: "kt-personal", targetType: "note", targetId: "personal-note" },
  ]),
  file("knowledge_tags.json", [
    { id: "kt-islamic", name: "Islamic" },
    { id: "kt-personal", name: "Personal" },
  ]),
  file("courses.json", [
    { id: "course-islamic", title: "Islamic course", rootFolderId: "study", deletedAt: null },
    { id: "course-personal", title: "Private course", rootFolderId: "personal", deletedAt: null },
  ]),
  file("course_concept_cards.json", []),
  file("course_folders.json", []),
  file("course_notes.json", []),
  file("course_sticky_notes.json", []),
];

const bundle: MetadataRestoreBundle = {
  schemaVersion: 1,
  restoredAt: new Date(0).toISOString(),
  cloudVersion: 1,
  driveEntryCount: files.length,
  metadataFileCount: files.length,
  metadataBytes: files.reduce((total, item) => total + item.size, 0),
  files,
  counts: { courses: 2, folders: 4, notes: 3, blocks: 2, attachments: 4, tags: 2, stickyNotes: 0, pdfAnnotations: 2 },
  groupSummaries: [],
  issues: [],
};

const original = JSON.stringify(bundle);
const projected = projectIslamicCorpusBundle(bundle);
const corpus = buildRestoredCorpus(bundle);
const ids = (fileName: string) => (projected.files.find((item) => item.fileName === fileName)?.json as Array<{ id?: string }>).map((row) => row.id);

assert.deepEqual(ids("folders.json"), ["study", "library"]);
assert.deepEqual(ids("notes.json"), ["root-note", "study-note"]);
assert.deepEqual(ids("attachments.json"), ["root-pdf", "library-pdf"]);
assert.deepEqual(ids("pdf_annotations.json"), ["islamic-highlight"]);
assert.deepEqual(ids("knowledge_tags.json"), ["kt-islamic"]);
assert.deepEqual(ids("courses.json"), ["course-islamic"]);
assert.equal(corpus.homeSnapshot.recentNotes.some((note) => note.id === "personal-note"), false);
assert.equal(corpus.searchResults.items.some((item) => item.id === "personal-note" || item.id === "personal-pdf"), false);
assert.equal(JSON.stringify(bundle), original, "The complete backup bundle must remain unchanged");

console.log("Islamic Corpus projection verified: Personal workspace data is hidden and the source backup is unchanged.");
