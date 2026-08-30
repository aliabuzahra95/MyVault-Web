import { downloadDriveFileBlob, listDriveChildren, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import { buildMetadataRestoreBundle, getMetadataManifestEntries, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { DriveSyncManifest, DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import { validateSyncCandidate } from "@/lib/sync/validateSyncCandidate";

export type RestoreBlobDownloader = (accessToken: string, entry: DriveSyncManifestEntry) => Promise<Blob>;
export type DriveChildrenLister = typeof listDriveChildren;

export class RestoreCompatibilityError extends Error {
  constructor(readonly issues: string[]) {
    super(`Restore compatibility check found:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "RestoreCompatibilityError";
  }
}

function uniqueIssues(issues: string[]) {
  return [...new Set(issues.filter(Boolean))];
}

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

export async function verifyDriveManifestFiles(
  accessToken: string,
  manifest: DriveSyncManifest,
  scan: MyVaultDriveScan,
  listChildren: DriveChildrenLister = listDriveChildren,
) {
  const issues: string[] = [];
  const advisories: string[] = [];
  if (!scan.folders.metadata || !scan.folders.files) {
    return { issues: ["The MyVault Drive backup is missing its metadata or files folder."], advisories };
  }
  const [metadataChildren, fileChildren] = await Promise.all([
    listChildren(accessToken, scan.folders.metadata.id),
    listChildren(accessToken, scan.folders.files.id),
  ]);
  const metadataIds = new Map(metadataChildren.map((file) => [file.id, file]));
  const fileIds = new Map(fileChildren.map((file) => [file.id, file]));
  for (const entry of manifest.entries) {
    const record = (entry.kind === "metadata" ? metadataIds : fileIds).get(entry.cloudFileId);
    if (!record) {
      issues.push(`Google Drive no longer contains ${entry.fileName}.`);
      continue;
    }
    const remoteSize = Number(record.size);
    if (Number.isFinite(remoteSize) && remoteSize !== entry.size) {
      // Drive listing metadata can be stale. Downloaded bytes and SHA-256 remain
      // authoritative and are checked before any local restore is applied.
      advisories.push(`Google Drive listing size differs for ${entry.fileName}; downloaded bytes will be verified.`);
    }
  }
  return { issues, advisories };
}

export async function stageVerifiedMetadataRestore({
  accessToken,
  manifest,
  download = (token, entry) => downloadDriveFileBlob(token, entry.cloudFileId, "application/json"),
  compatibilityIssues = [],
}: {
  accessToken: string;
  manifest: DriveSyncManifest;
  download?: RestoreBlobDownloader;
  compatibilityIssues?: string[];
}) {
  const issues = [...compatibilityIssues, ...validateManifestStructure(manifest)];
  const outcomes = await Promise.all(getMetadataManifestEntries(manifest).map(async (entry) => {
    try {
      const blob = await download(accessToken, entry);
      const entryIssues: string[] = [];
      if (blob.size !== entry.size) entryIssues.push(`${entry.fileName}: downloaded byte size ${blob.size} does not match manifest size ${entry.size}.`);
      if (entry.sha256 && await sha256Blob(blob) !== entry.sha256.toLowerCase()) {
        entryIssues.push(`${entry.fileName}: downloaded SHA-256 checksum does not match the manifest.`);
      }
      if (entryIssues.length) return { file: null, issues: entryIssues };
      try {
        return { file: { entry, json: JSON.parse(await blob.text()) as unknown }, issues: [] };
      } catch {
        return { file: null, issues: [`${entry.fileName}: downloaded metadata is not valid JSON.`] };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "download failed";
      return { file: null, issues: [`${entry.fileName}: ${detail}`] };
    }
  }));

  issues.push(...outcomes.flatMap((outcome) => outcome.issues));
  const downloadedFiles = outcomes.flatMap((outcome) => outcome.file ? [outcome.file] : []);
  const bundle = buildMetadataRestoreBundle(manifest, downloadedFiles);
  const candidate = validateSyncCandidate(bundle);
  issues.push(...bundle.issues, ...candidate.issues, ...validateAttachmentReferences(bundle));
  const allIssues = uniqueIssues(issues);
  if (allIssues.length) throw new RestoreCompatibilityError(allIssues);
  return bundle;
}
