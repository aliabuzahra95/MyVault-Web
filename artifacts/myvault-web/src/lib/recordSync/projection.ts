import type { Block, Folder, Note, NoteDetail } from "@workspace/api-client-react";
import { isLocallyDeleted } from "@/lib/restore/localRestoreStore";
import type { RecordSyncPending } from "./store";
import type { RecordSyncFolder, RecordSyncNote, RecordSyncRevision } from "./protocol";

function noteFromRecord(record: RecordSyncNote): Note {
  const text = record.richText.text || record.bodyPlainText;
  return {
    id: record.id,
    folderId: record.folderId,
    parentNoteId: record.parentNoteId,
    title: record.title,
    bodyPreview: text.slice(0, 260),
    wordCount: text.trim() ? text.trim().split(/\s+/u).length : 0,
    characterCount: text.length,
    isPinned: record.isPinned,
    isFolderPinned: record.isFolderPinned,
    orderIndex: record.orderIndex,
    tagNames: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function folderFromRecord(record: RecordSyncFolder): Folder {
  return {
    id: record.id,
    parentId: record.parentId,
    title: record.name,
    description: record.description,
    mode: "study",
    workspace: "islamic",
    orderIndex: record.orderIndex,
    noteCount: 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const supportedBlockTypes = new Set<Block["type"]>(["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered", "quote", "divider", "code"]);

function detailFromRecord(record: RecordSyncNote): NoteDetail {
  const blocks: Block[] = record.blocks.flatMap((block) =>
    supportedBlockTypes.has(block.type as Block["type"])
      ? [{ ...block, type: block.type as Block["type"] }]
      : [],
  );
  return { ...noteFromRecord(record), blocks, richTextJson: JSON.stringify(record.richText) };
}

export function projectRecordSyncRevisions(args: {
  folders: Folder[];
  notes: Note[];
  noteDetails: Record<string, NoteDetail>;
  localFolders: Folder[];
  localNotes: Note[];
  revisions: RecordSyncRevision[];
  pending: RecordSyncPending[];
}) {
  const pendingIds = new Set(args.pending.map((item) => `${item.entityType}:${item.entityId}`));
  const folders = new Map<string, Folder>(args.folders.map((item) => [item.id, item]));
  const notes = new Map<string, Note>(args.notes.map((item) => [item.id, item]));
  const details = { ...args.noteDetails };
  for (const item of args.localFolders) {
    if (isLocallyDeleted(item)) folders.delete(item.id);
    else folders.set(item.id, item);
  }
  for (const item of args.localNotes) {
    if (isLocallyDeleted(item)) { notes.delete(item.id); delete details[item.id]; }
    else notes.set(item.id, item);
  }

  for (const revision of args.revisions) {
    if (pendingIds.has(`${revision.entityType}:${revision.entityId}`)) continue;
    if (revision.entityType === "folder") {
      if (revision.deleted) folders.delete(revision.entityId);
      else folders.set(revision.entityId, folderFromRecord(JSON.parse(revision.payloadJson!) as RecordSyncFolder));
    } else if (revision.deleted) {
      notes.delete(revision.entityId);
      delete details[revision.entityId];
    } else {
      const record = JSON.parse(revision.payloadJson!) as RecordSyncNote;
      notes.set(revision.entityId, noteFromRecord(record));
      details[revision.entityId] = detailFromRecord(record);
    }
  }
  return { folders: [...folders.values()], notes: [...notes.values()], noteDetails: details };
}
