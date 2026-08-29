import { downloadDriveFileBlob, listDriveChildren, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import { buildMetadataRestoreBundle, getMetadataManifestEntries, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { DriveSyncManifest, DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import { validateSyncCandidate } from "@/lib/sync/validateSyncCandidate";

export type RestoreBlobDownloader = (accessToken: string, entry: DriveSyncManifestEntry) => Promise<Blob>;

function hexadecimal(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Blob(blob: Blob) {
  return hexadecimal(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

function validateManifestStructure(manifest: DriveSyncManifest) {
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1) issues.push("The Drive manifest schema version is not supported.");
  if (!Number.isFinite(manifest.cloudVersion) || manifest.cloudVersion <= 0) issues.push("The Drive manifest has an invalid backup timestamp/version.");
  if (manifest.storage !== "google-drive-api") issues.push("The Drive manifest storage type is not supported.");

  const paths = new Set<string>();
  const cloudIds = new Set<string>();
  manifest.entries.forEach((entry) => {
    if (paths.has(entry.path)) issues.push(`The Drive manifest contains duplicate path ${entry.path}.`);
    paths.add(entry.path);
    if (!entry.cloudFileId) issues.push(`The Drive manifest entry ${entry.fileName} has no Drive file ID.`);
    if (cloudIds.has(entry.cloudFileId)) issues.push(`The Drive manifest reuses a Drive file ID for ${entry.fileName}.`);
    cloudIds.add(entry.cloudFileId);
    if (!Number.isFinite(entry.size) || entry.size < 0) issues.push(`The Drive manifest has an invalid size for ${entry.fileName}.`);
    if (entry.sha256 && !/^[a-f0-9]{64}$/i.test(entry.sha256)) issues.push(`The Drive manifest has an invalid checksum for ${entry.fileName}.`);
  });
  return issues;
}

function validateAttachmentReferences(bundle: MetadataRestoreBundle) {
  const attachments = bundle.files.find((file) => file.fileName === "attachments.json")?.json;
  if (!Array.isArray(attachments)) return [];
  const backupEntries = new Set((bundle.fileEntries ?? []).flatMap((entry) => [entry.backupEntry, entry.path]));
  return attachments.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const fileEntry = (value as Record<string, unknown>).fileEntry;
    return typeof fileEntry === "string" && fileEntry && !backupEntries.has(fileEntry)
      ? [`attachments.json row ${index + 1} refers to missing backup file ${fileEntry}.`]
      : [];
  });
}

export async function verifyDriveManifestFiles(accessToken: string, manifest: DriveSyncManifest, scan: MyVaultDriveScan) {
  if (!scan.folders.metadata || !scan.folders.files) {
    throw new Error("The MyVault Drive backup is missing its metadata or files folder.");
  }
  const [metadataChildren, fileChildren] = await Promise.all([
    listDriveChildren(accessToken, scan.folders.metadata.id),
    listDriveChildren(accessToken, scan.folders.files.id),
  ]);
  const metadataIds = new Map(metadataChildren.map((file) => [file.id, file]));
  const fileIds = new Map(fileChildren.map((file) => [file.id, file]));
  for (const entry of manifest.entries) {
    const record = (entry.kind === "metadata" ? metadataIds : fileIds).get(entry.cloudFileId);
    if (!record) throw new Error(`Google Drive no longer contains ${entry.fileName}. Restore was not started.`);
    const remoteSize = Number(record.size);
    if (Number.isFinite(remoteSize) && remoteSize !== entry.size) {
      throw new Error(`Google Drive reports a different size for ${entry.fileName}. Restore was not started.`);
    }
  }
}

export async function stageVerifiedMetadataRestore({
  accessToken,
  manifest,
  download = (token, entry) => downloadDriveFileBlob(token, entry.cloudFileId, "application/json"),
}: {
  accessToken: string;
  manifest: DriveSyncManifest;
  download?: RestoreBlobDownloader;
}) {
  const manifestIssues = validateManifestStructure(manifest);
  if (manifestIssues.length) throw new Error(manifestIssues[0]);

  const downloadedFiles = await Promise.all(getMetadataManifestEntries(manifest).map(async (entry) => {
    const blob = await download(accessToken, entry);
    if (blob.size !== entry.size) throw new Error(`Metadata size verification failed for ${entry.fileName}. Restore was not started.`);
    if (entry.sha256 && await sha256Blob(blob) !== entry.sha256.toLowerCase()) {
      throw new Error(`Metadata checksum verification failed for ${entry.fileName}. Restore was not started.`);
    }
    try {
      return { entry, json: JSON.parse(await blob.text()) as unknown };
    } catch {
      throw new Error(`Google Drive metadata ${entry.fileName} is not valid JSON. Restore was not started.`);
    }
  }));

  const bundle = buildMetadataRestoreBundle(manifest, downloadedFiles);
  const candidate = validateSyncCandidate(bundle);
  const issues = [...bundle.issues, ...candidate.issues, ...validateAttachmentReferences(bundle)];
  if (issues.length) throw new Error(issues[0]);
  return bundle;
}
