import assert from "node:assert/strict";
import { addRecordSyncToBackup } from "../src/lib/recordSync/backupSnapshot";
import { createRecordSyncRevision } from "../src/lib/recordSync/protocol";
import { createInitialMetadataRestoreBundle } from "../src/lib/sync/syncPreflight";
import { validateSyncCandidate } from "../src/lib/sync/validateSyncCandidate";

async function main() {
  const base = createInitialMetadataRestoreBundle();
  const folder = {
    id: "folder-test", parentId: null, name: "Study", description: null, orderIndex: 0,
    isFavourite: false, mode: "study" as const, createdAt: 1, updatedAt: 2, deletedAt: null, colorKey: null,
  };
  const note = {
    id: "note-test", folderId: folder.id, parentNoteId: null, title: "English العربية",
    bodyPlainText: "Evidence قُلْ", isPinned: false, isFolderPinned: false, isFavourite: false,
    orderIndex: 0, createdAt: 1, updatedAt: 2, deletedAt: null,
    richText: { text: "Evidence قُلْ", styleMarks: [{ start: 0, end: 8, style: "Bold" }], noteLinks: [] },
    blocks: [{ id: "body-test", noteId: "note-test", type: "rich_text", content: "", orderIndex: 0 }],
  };
  const folderRevision = await createRecordSyncRevision({ entityType: "folder", entityId: folder.id, clientId: "phone", parents: [], payload: folder });
  const noteRevision = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone", parents: [], payload: note });
  const snapshot = addRecordSyncToBackup(base, [folderRevision, noteRevision]);
  const file = (name: string) => snapshot.bundle.files.find((item) => item.fileName === name)?.json as Array<Record<string, unknown>>;
  assert.equal(file("folders.json")[0]?.id, folder.id);
  assert.equal(file("notes.json")[0]?.title, note.title);
  assert.equal((JSON.parse(String(file("blocks.json")[0]?.content)) as { styleMarks: unknown[] }).styleMarks.length, 1);
  assert.equal(snapshot.bundle.files.find((item) => item.fileName === "manifest.json")?.json,
    base.files.find((item) => item.fileName === "manifest.json")?.json);
  assert.equal(validateSyncCandidate(snapshot.bundle).valid, true);
  const deletion = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone", parents: [noteRevision.revisionId], payload: null });
  const deleted = addRecordSyncToBackup(snapshot.bundle, [deletion]);
  assert.equal((deleted.bundle.files.find((item) => item.fileName === "notes.json")?.json as Array<{ deletedAt: number }>)[0]?.deletedAt, deletion.publishedAt);
  const unchanged = addRecordSyncToBackup(base, []);
  assert.equal(unchanged.bundle, base);
  assert.equal(unchanged.touchedFiles.size, 0);
  const withAttachment = {
    ...note, blocks: [...note.blocks, { id: "image", noteId: note.id, type: "image", content: "123", orderIndex: 1 }],
  };
  const excluded = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone", parents: [], payload: withAttachment });
  assert.throws(() => addRecordSyncToBackup(base, [excluded]), /attachment sync is not available/);
  console.log("Record-sync backup snapshot: note, folder, rich text, tombstone, unchanged format and attachment guard passed.");
}

void main();
