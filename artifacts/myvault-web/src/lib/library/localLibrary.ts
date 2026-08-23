import type { Attachment, Folder } from "@workspace/api-client-react";
import {
  deleteLocalAttachmentBlob,
  deleteLocalPdfReaderState,
  deleteLocalPdfAnnotationChangesForAttachment,
  saveLocalAttachmentBlob,
  saveLocalCreatedAttachment,
  saveLocalCreatedFolder,
} from "@/lib/restore/localRestoreStore";

function localAttachmentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `web-file-${crypto.randomUUID()}`;
  }
  return `web-file-${Date.now()}`;
}

export async function createLocalLibraryPdf(file: File, libraryFolderId: string | null) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Please choose a PDF document.");

  const now = Date.now();
  const attachment: Attachment = {
    id: localAttachmentId(),
    noteId: null,
    libraryFolderId,
    name: file.name,
    mimeType: "application/pdf",
    sizeBytes: file.size,
    isPinned: false,
    readingProgressPercent: 0,
    createdAt: now,
    updatedAt: now,
  };

  await saveLocalAttachmentBlob(attachment.id, file);
  try {
    await saveLocalCreatedAttachment(attachment);
  } catch (error) {
    await deleteLocalAttachmentBlob(attachment.id).catch(() => undefined);
    throw new Error(error instanceof Error ? `The PDF could not be added: ${error.message}` : "The PDF could not be added.");
  }

  return attachment;
}

export function isWebCreatedLibraryFolder(folder: Folder) {
  return folder.id.startsWith("web-");
}

export function isWebCreatedLibraryAttachment(attachment: Attachment) {
  return attachment.id.startsWith("web-file-");
}

export async function updateLocalLibraryFolder(folder: Folder, title: string, parentId: string | null) {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("Enter a folder name.");

  const updatedFolder = {
    ...folder,
    title: nextTitle,
    parentId,
    updatedAt: Date.now(),
    deletedAt: null,
  } as Folder;
  await saveLocalCreatedFolder(updatedFolder);
  return updatedFolder;
}

export async function removeLocalLibraryFolder(folder: Folder) {
  await saveLocalCreatedFolder({ ...folder, updatedAt: Date.now(), deletedAt: Date.now() } as Folder);
}

export async function updateLocalLibraryAttachment(attachment: Attachment, name: string, libraryFolderId: string | null) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a document name.");

  const updatedAttachment = {
    ...attachment,
    name: trimmedName.toLowerCase().endsWith(".pdf") ? trimmedName : `${trimmedName}.pdf`,
    libraryFolderId,
    updatedAt: Date.now(),
    deletedAt: null,
  } as Attachment;
  await saveLocalCreatedAttachment(updatedAttachment);
  return updatedAttachment;
}

export async function removeLocalLibraryAttachment(attachment: Attachment) {
  await saveLocalCreatedAttachment({ ...attachment, updatedAt: Date.now(), deletedAt: Date.now() } as Attachment);
  await deleteLocalAttachmentBlob(attachment.id);
  await deleteLocalPdfReaderState(attachment.id);
  await deleteLocalPdfAnnotationChangesForAttachment(attachment.id);
}
