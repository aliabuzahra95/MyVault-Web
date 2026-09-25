import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { SyncPendingChanges } from "@/lib/sync/syncPreflight";
import { canonicalJson, parseRecordSyncRevision, type RecordSyncFolder, type RecordSyncNote, type RecordSyncRevision } from "./protocol";
import { loadRecordSyncConflicts, loadRecordSyncControl, loadRecordSyncPending, loadRecordSyncRecords } from "./store";

type Row = Record<string, unknown>;
const BODY_TYPES = new Set(["rich_text", "rich_html", "rich_body", "paragraph", "heading", "quote", "checklist", "checklist_checked", "bullet", "numbered", "link", "divider"]);

function rows(bundle: MetadataRestoreBundle, name: string): Row[] {
  const json = bundle.files.find((file) => file.fileName === name)?.json;
  if (!Array.isArray(json) || json.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Cannot include synced data in backup: ${name} is not a row list.`);
  }
  return json as Row[];
}

function upsert(list: Row[], id: string, patch: Row) {
  const index = list.findIndex((row) => row.id === id);
  if (index < 0) list.push(patch);
  else list[index] = { ...list[index], ...patch };
}

export function addRecordSyncToBackup(bundle: MetadataRestoreBundle, revisions: RecordSyncRevision[]) {
  if (!revisions.length) return { bundle, touchedFiles: new Set<string>() };
  const folders = [...rows(bundle, "folders.json")];
  const notes = [...rows(bundle, "notes.json")];
  const blocks = [...rows(bundle, "blocks.json")];

  for (const raw of revisions) {
    const revision = parseRecordSyncRevision(raw);
    const id = revision.entityId;
    if (revision.entityType === "folder") {
      if (revision.deleted) {
        const existing = folders.find((row) => row.id === id);
        if (existing) upsert(folders, id, { deletedAt: revision.publishedAt });
      } else {
        const folder = JSON.parse(revision.payloadJson!) as RecordSyncFolder;
        upsert(folders, id, {
          id, parentId: folder.parentId, name: folder.name, description: folder.description,
          orderIndex: folder.orderIndex, isFavourite: folder.isFavourite, mode: "study",
          createdAt: folder.createdAt, updatedAt: folder.updatedAt, deletedAt: null,
          colorKey: folder.colorKey,
        });
      }
      continue;
    }

    if (revision.deleted) {
      const existing = notes.find((row) => row.id === id);
      if (existing) upsert(notes, id, { deletedAt: revision.publishedAt });
      continue;
    }

    const note = JSON.parse(revision.payloadJson!) as RecordSyncNote;
    if (!note.richText || typeof note.richText.text !== "string" || !Array.isArray(note.richText.styleMarks) || !Array.isArray(note.richText.noteLinks)) {
      throw new Error(`Cannot back up synced note ${id}: rich text is invalid.`);
    }
    if (note.blocks.some((block) => block.type === "attachment" || block.type === "image")) {
      throw new Error(`Cannot back up synced note ${id}: attachment sync is not available.`);
    }
    if (note.blocks.some((block) => !BODY_TYPES.has(block.type))) {
      throw new Error(`Cannot back up synced note ${id}: an unsupported block must be preserved separately.`);
    }
    const attachments = rows(bundle, "attachments.json");
    if (attachments.some((attachment) => attachment.noteId === id && !attachment.deletedAt)) {
      throw new Error(`Cannot back up synced note ${id}: it has an attachment outside Phase 1.`);
    }
    if (rows(bundle, "note_tables.json").some((table) => table.noteId === id && !table.deletedAt)) {
      throw new Error(`Cannot back up synced note ${id}: note tables are outside Phase 1.`);
    }
    upsert(notes, id, {
      id, folderId: note.folderId, parentNoteId: note.parentNoteId, title: note.title,
      bodyPlainText: note.richText.text, isPinned: note.isPinned,
      isFolderPinned: note.isFolderPinned, isFavourite: note.isFavourite,
      orderIndex: note.orderIndex, createdAt: note.createdAt, updatedAt: note.updatedAt,
      deletedAt: null,
    });
    const original = blocks.find((row) => row.noteId === id && row.type === "rich_text");
    const source = note.blocks.find((block) => block.type === "rich_text");
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index].noteId === id && BODY_TYPES.has(String(blocks[index].type))) blocks.splice(index, 1);
    }
    blocks.push({
      ...original, ...source, id: source?.id ?? original?.id ?? `${id}-rich-text`,
      noteId: id, type: "rich_text", content: JSON.stringify(note.richText),
      orderIndex: source?.orderIndex ?? original?.orderIndex ?? 0,
    });
  }

  const candidates = { "folders.json": folders, "notes.json": notes, "blocks.json": blocks };
  const touchedFiles = new Set(Object.entries(candidates)
    .filter(([name, value]) => canonicalJson(rows(bundle, name)) !== canonicalJson(value))
    .map(([name]) => name));
  const files = bundle.files.map((file) => {
    if (!touchedFiles.has(file.fileName)) return file;
    const json = candidates[file.fileName as keyof typeof candidates];
    return { ...file, json, itemCount: json.length };
  });
  return { bundle: touchedFiles.size ? { ...bundle, files } : bundle, touchedFiles };
}

export async function prepareRecordSyncBackup(
  bundle: MetadataRestoreBundle,
  pending: SyncPendingChanges,
  baseRevisionId: string | undefined,
  accountId: string,
) {
  const control = await loadRecordSyncControl(accountId);
  if (control?.enabled && (control.paused || !control.cursor)) {
    throw new Error("Automatic Sync enrolment is not finished. Complete or disable it before making a manual backup.");
  }
  const active = Boolean(control?.enabled && !control.paused && control.cursor);
  if (!active) return { active, bundle, pending, touchedFiles: new Set<string>() };
  if ((await loadRecordSyncConflicts(accountId)).some((item) => item.resolvedAt === null)) {
    throw new Error("Resolve Automatic Sync conflicts before creating a backup, so neither note version is lost.");
  }
  const [records, syncPending] = await Promise.all([loadRecordSyncRecords(accountId), loadRecordSyncPending(accountId)]);
  const snapshot = addRecordSyncToBackup(bundle, records);
  const recordByNote = new Map(records.filter((item) => item.entityType === "note").map((item) => [item.entityId, item]));
  const pendingByNote = new Map(syncPending.filter((item) => item.entityType === "note").map((item) => [item.entityId, item]));
  const noteRows = rows(snapshot.bundle, "notes.json");
  const adjusted = {
    ...pending,
    noteDrafts: pending.noteDrafts.map((draft) => {
      const localChange = pendingByNote.get(draft.noteId);
      const record = recordByNote.get(draft.noteId);
      if (!localChange || !record) return draft;
      if (localChange.baseRevisionId !== record.revisionId) {
        throw new Error(`Synced note ${draft.noteId} changed on another device. Resolve its conflict before backing up.`);
      }
      const row = noteRows.find((item) => item.id === draft.noteId);
      return row && typeof row.updatedAt === "number"
        ? { ...draft, baseUpdatedAt: row.updatedAt, baseRevisionId }
        : draft;
    }),
  };
  return { active, bundle: snapshot.bundle, pending: adjusted, touchedFiles: snapshot.touchedFiles };
}
