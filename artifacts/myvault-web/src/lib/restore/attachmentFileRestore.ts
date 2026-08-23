import type { DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import { loadMetadataRestoreBundle, saveMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AttachmentFileClaim = {
  backupEntry: string;
  manifestEntry: DriveSyncManifestEntry | null;
};

export async function getAttachmentFileClaim(attachmentId: string): Promise<AttachmentFileClaim | null> {
  const bundle = await loadMetadataRestoreBundle();
  if (!bundle) return null;
  const attachmentsFile = bundle.files.find((file) => file.fileName === "attachments.json");
  const rows = Array.isArray(attachmentsFile?.json) ? attachmentsFile.json.filter(isRecord) : [];
  const attachment = rows.find((row) => row.id === attachmentId);
  if (!attachment) return null;

  const hasFileEntry = Object.prototype.hasOwnProperty.call(attachment, "fileEntry");
  const fileEntry = typeof attachment.fileEntry === "string" ? attachment.fileEntry : "";
  if (hasFileEntry && !fileEntry) return null;
  const backupEntry = fileEntry || `files/${attachmentId}`;
  const manifestEntry = bundle.fileEntries?.find((entry) => entry.kind === "file" && entry.backupEntry === backupEntry) ?? null;
  return { backupEntry, manifestEntry };
}

export async function cacheAttachmentManifestEntries(entries: DriveSyncManifestEntry[]) {
  const bundle = await loadMetadataRestoreBundle();
  if (!bundle) return;
  await saveMetadataRestoreBundle({ ...bundle, fileEntries: entries.filter((entry) => entry.kind === "file") });
}
