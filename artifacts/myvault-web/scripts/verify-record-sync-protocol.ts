import assert from "node:assert/strict";
import {
  canonicalJson,
  createRecordSyncRevision,
  parseRecordSyncRevision,
  revisionDecision,
  verifyRecordSyncRevision,
} from "../src/lib/recordSync/protocol";
import { projectRecordSyncRevisions } from "../src/lib/recordSync/projection";

async function main() {
  assert.equal(
    canonicalJson({ title: "English العربية", richText: { text: "قُلْ: One", styleMarks: [], noteLinks: [] }, id: "note-381" }),
    '{"id":"note-381","richText":{"noteLinks":[],"styleMarks":[],"text":"قُلْ: One"},"title":"English العربية"}',
  );
  const note = {
    id: "note-381", folderId: null, parentNoteId: null, title: "Hello",
    bodyPlainText: "Hello world", isPinned: false, isFolderPinned: false,
    isFavourite: false, orderIndex: 0, createdAt: 1, updatedAt: 2,
    deletedAt: null, richText: { text: "Hello world", styleMarks: [], noteLinks: [] }, blocks: [],
  };
  const first = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone-a", parents: [], payload: note });
  const second = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone-a", parents: [first.revisionId], payload: { ...note, bodyPlainText: "Changed" } });
  const branch = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone-b", parents: [first.revisionId], payload: { ...note, bodyPlainText: "Other edit" } });
  const deletion = await createRecordSyncRevision({ entityType: "note", entityId: note.id, clientId: "phone-a", parents: [second.revisionId], payload: null });
  for (const item of [first, second, branch, deletion]) await verifyRecordSyncRevision(parseRecordSyncRevision(JSON.parse(JSON.stringify(item))));
  assert.equal(revisionDecision(null, first), "apply");
  assert.equal(revisionDecision(first.revisionId, second), "apply");
  assert.equal(revisionDecision(second.revisionId, branch), "conflict");
  assert.equal(revisionDecision(second.revisionId, deletion), "apply");
  await assert.rejects(verifyRecordSyncRevision({ ...first, contentHash: "bad" }));
  const project = (revisions: typeof first[], pending: Array<{ entityType: "note"; entityId: string }>) =>
    projectRecordSyncRevisions({ folders: [], notes: [], noteDetails: {}, localFolders: [], localNotes: [],
      revisions, pending: pending as Parameters<typeof projectRecordSyncRevisions>[0]["pending"] });
  const visible = project([first], []);
  assert.equal(visible.notes[0]?.id, "note-381");
  assert.deepEqual(JSON.parse(visible.noteDetails["note-381"]?.richTextJson ?? "null"), note.richText);
  assert.equal(project([deletion], []).notes.length, 0);
  assert.equal(project([first], [{ entityType: "note", entityId: "note-381" }]).notes.length, 0);
  console.log("Record-sync protocol: revision, conflict, tombstone and hash checks passed.");
}

void main();
