import type { DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import { loadMetadataRestoreBundle, saveMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";
import { verifyBackupBinaryBlob } from "./backupBinaryDescriptors";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AttachmentFileClaim = {
  backupEntry: string;
  manifestEntry: DriveSyncManifestEntry | null;
  requiresBinaryVerification?: true;
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
  if (bundle.binaryDescriptorsVerified && !manifestEntry) throw new Error("Resolved attachment binary is missing. Checkpoint fallback is forbidden.");
  return { backupEntry, manifestEntry, ...(bundle.binaryDescriptorsVerified ? { requiresBinaryVerification: true as const } : {}) };
}

export async function verifyAttachmentFileClaim(claim: AttachmentFileClaim, blob: Blob) {
  if (!claim.requiresBinaryVerification) return;
  if (!claim.manifestEntry) throw new Error("Resolved attachment binary is missing.");
  await verifyBackupBinaryBlob(blob, claim.manifestEntry);
}

export async function cacheAttachmentManifestEntries(entries: DriveSyncManifestEntry[]) {
  const bundle = await loadMetadataRestoreBundle();
  if (!bundle) return;
  if (bundle.binaryDescriptorsVerified) throw new Error("A checkpoint listing cannot replace resolved binary descriptors.");
  await saveMetadataRestoreBundle({ ...bundle, fileEntries: entries.filter((entry) => entry.kind === "file") });
}
