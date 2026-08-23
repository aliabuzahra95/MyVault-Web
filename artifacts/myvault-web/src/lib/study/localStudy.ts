import type { Folder, Note } from "@workspace/api-client-react";
import {
  clearLocalNoteDraft,
  saveLocalCreatedFolder,
  saveLocalCreatedNote,
} from "@/lib/restore/localRestoreStore";

export function isWebCreatedStudyFolder(folder: Folder) {
  return folder.id.startsWith("web-");
}

export function isWebCreatedStudyNote(note: Note) {
  return note.id.startsWith("web-");
}

export async function updateLocalStudyFolder(folder: Folder, title: string, parentId: string | null) {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("Enter a folder name.");
  const updated = { ...folder, title: nextTitle, parentId, updatedAt: Date.now(), deletedAt: null };
  await saveLocalCreatedFolder(updated);
  return updated;
}

export async function updateLocalStudyNote(note: Note, title: string, folderId: string | null) {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("Enter a note title.");
  const updated = { ...note, title: nextTitle, folderId, updatedAt: Date.now(), deletedAt: null };
  await saveLocalCreatedNote(updated);
  return updated;
}

export async function removeLocalStudyFolder(folder: Folder) {
  await saveLocalCreatedFolder({ ...folder, updatedAt: Date.now(), deletedAt: Date.now() } as Folder);
}

export async function removeLocalStudyNote(note: Note) {
  await saveLocalCreatedNote({ ...note, updatedAt: Date.now(), deletedAt: Date.now() } as Note);
  await clearLocalNoteDraft(note.id);
}
