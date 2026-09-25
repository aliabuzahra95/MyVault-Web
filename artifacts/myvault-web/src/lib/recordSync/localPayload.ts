import type { Folder, Note } from "@workspace/api-client-react";
import {
  loadLocalCreatedAttachments,
  loadLocalCreatedFolders,
  loadLocalCreatedNotes,
  loadLocalNoteDrafts,
  loadMetadataRestoreBundle,
  type LocalNoteDraft,
} from "@/lib/restore/localRestoreStore";
import { loadRecordSyncRecords } from "./store";
import type { RecordSyncEntityType, RecordSyncFolder, RecordSyncNote, RecordSyncRevision } from "./protocol";

type Row = Record<string, unknown>;
type LocalSource = { payload: RecordSyncNote | RecordSyncFolder | null; excludedReason: string | null; exists: boolean; deleted: boolean };

function rows(bundle: Awaited<ReturnType<typeof loadMetadataRestoreBundle>>, fileName: string): Row[] {
  const json = bundle?.files.find((file) => file.fileName === fileName)?.json;
  return Array.isArray(json) ? json.filter((value): value is Row => !!value && typeof value === "object" && !Array.isArray(value)) : [];
}

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function number(value: unknown, fallback = 0) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function flag(value: unknown, fallback = false) { return typeof value === "boolean" ? value : fallback; }
function nullableText(value: unknown) { return typeof value === "string" ? value : null; }
function rowById(list: Row[], id: string) { return list.find((row) => row.id === id) ?? null; }
function parsedRecord<T>(records: RecordSyncRevision[], type: RecordSyncEntityType, id: string): T | null {
  const revision = records.find((item) => item.entityType === type && item.entityId === id);
  return revision?.payloadJson ? JSON.parse(revision.payloadJson) as T : null;
}

function richTextFromDraft(draft: LocalNoteDraft | undefined) {
  const document = draft?.richTextDocument;
  return document ? { text: document.text, styleMarks: document.styleMarks, noteLinks: document.noteLinks } : null;
}

export async function localRecordSyncPayload(entityType: RecordSyncEntityType, entityId: string): Promise<LocalSource> {
  const [bundle, createdFolders, createdNotes, drafts, createdAttachments, records] = await Promise.all([
    loadMetadataRestoreBundle(), loadLocalCreatedFolders(), loadLocalCreatedNotes(),
    loadLocalNoteDrafts(), loadLocalCreatedAttachments(), loadRecordSyncRecords(),
  ]);
  const rawFolders = rows(bundle, "folders.json");
  const rawNotes = rows(bundle, "notes.json");
  const rawBlocks = rows(bundle, "blocks.json");
  const rawAttachments = rows(bundle, "attachments.json");
  const rawTables = rows(bundle, "note_tables.json");

  if (entityType === "folder") {
    const created = createdFolders.find((folder) => folder.id === entityId) as (Folder & { deletedAt?: number | null }) | undefined;
    const raw = rowById(rawFolders, entityId);
    const remote = parsedRecord<RecordSyncFolder>(records, "folder", entityId);
    if (!created && !raw && !remote) return { payload: null, excludedReason: null, exists: false, deleted: false };
    if (created?.deletedAt || (!created && raw?.deletedAt) || (created?.mode ?? raw?.mode ?? remote?.mode) !== "study")
      return { payload: null, excludedReason: null, exists: true, deleted: Boolean(created?.deletedAt || (!created && raw?.deletedAt)) };
    return { excludedReason: null, exists: true, deleted: false, payload: {
      id: entityId,
      parentId: nullableText(created?.parentId ?? raw?.parentId ?? remote?.parentId),
      name: text(created?.title ?? raw?.name ?? remote?.name, "Untitled folder"),
      description: nullableText(created?.description ?? raw?.description ?? remote?.description),
      orderIndex: number(created?.orderIndex ?? raw?.orderIndex ?? remote?.orderIndex),
      isFavourite: flag(raw?.isFavourite ?? remote?.isFavourite),
      mode: "study",
      createdAt: number(created?.createdAt ?? raw?.createdAt ?? remote?.createdAt),
      updatedAt: number(created?.updatedAt ?? raw?.updatedAt ?? remote?.updatedAt),
      deletedAt: null,
      colorKey: nullableText(raw?.colorKey ?? remote?.colorKey),
    } };
  }

  const created = createdNotes.find((note) => note.id === entityId) as (Note & { deletedAt?: number | null }) | undefined;
  const raw = rowById(rawNotes, entityId);
  const remote = parsedRecord<RecordSyncNote>(records, "note", entityId);
  const draft = drafts.find((item) => item.noteId === entityId);
  if (!created && !raw && !remote) return { payload: null, excludedReason: null, exists: false, deleted: false };
  if (created?.deletedAt || (!created && raw?.deletedAt)) return { payload: null, excludedReason: null, exists: true, deleted: true };
  const folderId = nullableText(created?.folderId ?? raw?.folderId ?? remote?.folderId);
  if (folderId) {
    const folder = createdFolders.find((item) => item.id === folderId);
    const rawFolder = rowById(rawFolders, folderId);
    const remoteFolder = parsedRecord<RecordSyncFolder>(records, "folder", folderId);
    if ((folder?.mode ?? rawFolder?.mode ?? remoteFolder?.mode) !== "study")
      return { payload: null, excludedReason: "Note is outside Study or its folder is not available.", exists: true, deleted: false };
  }
  const attachment = [...rawAttachments, ...createdAttachments as unknown as Row[]].some((item) => item.noteId === entityId && !item.deletedAt);
  const table = rawTables.some((item) => item.noteId === entityId && !item.deletedAt);
  const sourceBlocks = rawBlocks.filter((item) => item.noteId === entityId);
  const blocks = draft?.richTextDocument
    ? [{ id: `${entityId}-rich-text`, noteId: entityId, type: "rich_text", content: JSON.stringify(draft.richTextDocument), orderIndex: 0 }]
    : remote?.blocks ?? sourceBlocks.map((item) => ({
      id: text(item.id), noteId: entityId, type: text(item.type),
      content: text(item.content), orderIndex: number(item.orderIndex),
    }));
  if (attachment || blocks.some((block) => block.type === "attachment" || block.type === "image"))
    return { payload: null, excludedReason: "Contains an attachment or image; binary sync is not in Phase 1.", exists: true, deleted: false };
  if (table) return { payload: null, excludedReason: "Contains a note table; table sync is not in Phase 1.", exists: true, deleted: false };
  const richBlock = blocks.find((block) => block.type === "rich_text");
  const rawRich = richBlock ? JSON.parse(richBlock.content) as RecordSyncNote["richText"] : null;
  const richText = richTextFromDraft(draft) ?? remote?.richText ?? rawRich ?? {
    text: text(raw?.bodyPlainText ?? remote?.bodyPlainText), styleMarks: [], noteLinks: [],
  };
  if (typeof richText.text !== "string" || !Array.isArray(richText.styleMarks) || !Array.isArray(richText.noteLinks))
    return { payload: null, excludedReason: "Note rich text is malformed; sync preserved the local note.", exists: true, deleted: false };
  const bodyPlainText = draft?.richTextDocument?.text ?? text(raw?.bodyPlainText ?? remote?.bodyPlainText);
  return { excludedReason: null, exists: true, deleted: false, payload: {
    id: entityId,
    folderId,
    parentNoteId: nullableText(created?.parentNoteId ?? raw?.parentNoteId ?? remote?.parentNoteId),
    title: text(draft?.title ?? created?.title ?? raw?.title ?? remote?.title, "Untitled note"),
    bodyPlainText,
    isPinned: flag(draft?.isPinned ?? created?.isPinned ?? raw?.isPinned ?? remote?.isPinned),
    isFolderPinned: flag(created?.isFolderPinned ?? raw?.isFolderPinned ?? remote?.isFolderPinned),
    isFavourite: flag(raw?.isFavourite ?? remote?.isFavourite),
    orderIndex: number(created?.orderIndex ?? raw?.orderIndex ?? remote?.orderIndex),
    createdAt: number(created?.createdAt ?? raw?.createdAt ?? remote?.createdAt),
    updatedAt: number(draft?.savedAt ?? created?.updatedAt ?? raw?.updatedAt ?? remote?.updatedAt),
    deletedAt: null,
    richText,
    blocks,
  } };
}

export async function listLocalRecordSyncIds(): Promise<Array<{ entityType: RecordSyncEntityType; entityId: string }>> {
  const [bundle, folders, notes, drafts] = await Promise.all([
    loadMetadataRestoreBundle(), loadLocalCreatedFolders(), loadLocalCreatedNotes(), loadLocalNoteDrafts(),
  ]);
  const folderIds = new Set<string>();
  const noteIds = new Set<string>();
  rows(bundle, "folders.json").forEach((row) => { if (row.mode === "study" && typeof row.id === "string") folderIds.add(row.id); });
  folders.forEach((folder) => { if (folder.mode === "study") folderIds.add(folder.id); });
  rows(bundle, "notes.json").forEach((row) => {
    if (typeof row.id === "string" && (row.folderId == null || folderIds.has(String(row.folderId)))) noteIds.add(row.id);
  });
  notes.forEach((note) => { if (note.folderId == null || folderIds.has(note.folderId)) noteIds.add(note.id); });
  drafts.forEach((draft) => { if (noteIds.has(draft.noteId)) noteIds.add(draft.noteId); });
  return [
    ...[...folderIds].map((entityId) => ({ entityType: "folder" as const, entityId })),
    ...[...noteIds].map((entityId) => ({ entityType: "note" as const, entityId })),
  ];
}
