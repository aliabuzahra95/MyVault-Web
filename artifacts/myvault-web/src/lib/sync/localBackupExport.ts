import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import {
  downloadDriveFileBlob,
  downloadDriveFileJson,
  findDriveFile,
  findMyVaultDriveMap,
  type DriveFileRecord,
} from "@/lib/googleDrive/driveClient";
import { parseDriveSyncManifest, type DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";
import { cacheAttachmentManifestEntries } from "@/lib/restore/attachmentFileRestore";
import { loadLocalAttachmentBlob, loadMetadataRestoreBundle, reconcileLocalNoteDrafts } from "@/lib/restore/localRestoreStore";
import { metadataFiles } from "@/lib/restore/driveRestoreMap";
import { loadSyncPendingChanges, buildSyncPreflight, type SyncPreflight } from "@/lib/sync/syncPreflight";

type JsonRow = Record<string, unknown>;

export type LocalBackupExportProgress = {
  phase: "preparing" | "downloading" | "verifying" | "packing" | "complete";
  completedFiles: number;
  totalFiles: number;
  currentFileName: string | null;
};

export type LocalBackupExportResult = {
  blob: Blob;
  fileName: string;
  createdAt: number;
  summary: {
    folders: number;
    notes: number;
    attachments: number;
    includedAttachmentFiles: number;
    unavailableAttachmentFiles: number;
    metadataFiles: number;
    archiveBytes: number;
    sourceCloudVersion: number;
  };
};

type DriveBlobDownloader = (entry: DriveSyncManifestEntry) => Promise<Blob>;
type DriveFileRecovery = (entry: DriveSyncManifestEntry) => Promise<DriveFileRecord | null>;

function isRow(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activeRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter(isRow).filter((row) => row.deletedAt === null || row.deletedAt === undefined)
    : [];
}

function hexadecimal(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(blob: Blob) {
  return hexadecimal(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

function safeArchiveEntry(entryName: string) {
  return entryName.length > 0 && !entryName.startsWith("/") && !entryName.includes("..") && !entryName.includes("\\");
}

function createArchiveWriter() {
  const chunks: ArrayBuffer[] = [];
  let resolveArchive: ((value: Blob) => void) | null = null;
  let rejectArchive: ((reason?: unknown) => void) | null = null;
  const archivePromise = new Promise<Blob>((resolve, reject) => {
    resolveArchive = resolve;
    rejectArchive = reject;
  });
  const zip = new Zip((error, data, final) => {
    if (error) {
      rejectArchive?.(error);
      return;
    }
    chunks.push(new Uint8Array(data).buffer);
    if (final) resolveArchive?.(new Blob(chunks, { type: "application/octet-stream" }));
  });

  return {
    addJson(name: string, value: unknown) {
      if (!safeArchiveEntry(name)) throw new Error(`Unsafe backup entry: ${name}`);
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      file.push(strToU8(JSON.stringify(value)), true);
    },
    async addBlob(name: string, blob: Blob) {
      if (!safeArchiveEntry(name)) throw new Error(`Unsafe backup entry: ${name}`);
      const file = new ZipPassThrough(name);
      zip.add(file);
      const reader = blob.stream().getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) file.push(value, false);
      }
      file.push(new Uint8Array(), true);
    },
    finish() {
      zip.end();
      return archivePromise;
    },
  };
}

function buildMetadataPayloads(bundle: NonNullable<Awaited<ReturnType<typeof loadMetadataRestoreBundle>>>, preflight: SyncPreflight, createdAt: number) {
  const payloads = new Map<string, unknown>(bundle.files.map((file) => [file.fileName, file.json]));
  Object.entries(preflight.preparedFiles).forEach(([fileName, rows]) => payloads.set(fileName, rows));
  payloads.set("manifest.json", { format: "myvault-backup", version: 1, createdAt });

  const missingRequired = metadataFiles
    .filter((file) => file.required && !payloads.has(file.fileName))
    .map((file) => file.fileName);
  if (missingRequired.length) throw new Error(`The restored backup is missing required metadata: ${missingRequired.join(", ")}.`);
  return payloads;
}

async function refreshFileEntries(accessToken: string, expectedCloudVersion: number) {
  const scan = await findMyVaultDriveMap(accessToken);
  if (!scan.manifestFile) throw new Error("The MyVault sync manifest could not be found in Google Drive.");
  const rawManifest = await downloadDriveFileJson<unknown>(accessToken, scan.manifestFile.id);
  const parsed = parseDriveSyncManifest(rawManifest);
  if (!parsed.manifest) throw new Error(parsed.issues[0] ?? "The MyVault sync manifest could not be read.");
  if (parsed.issues.length) throw new Error(parsed.issues[0]);
  if (parsed.manifest.cloudVersion !== expectedCloudVersion) {
    throw new Error(`Google Drive is now at cloud version ${parsed.manifest.cloudVersion}, but the website restored version ${expectedCloudVersion}. Restore the latest metadata before exporting.`);
  }
  const entries = parsed.manifest.entries.filter((entry) => entry.kind === "file");
  await cacheAttachmentManifestEntries(entries);
  return { entries, filesFolderId: scan.folders.files?.id ?? null };
}

function claimedAttachmentEntries(attachments: JsonRow[]) {
  const claims: Array<{ attachmentId: string; fileName: string; backupEntry: string; expectedSize: number | null }> = [];
  let unavailable = 0;
  attachments.forEach((attachment) => {
    const attachmentId = typeof attachment.id === "string" ? attachment.id : "";
    const hasFileEntry = Object.prototype.hasOwnProperty.call(attachment, "fileEntry");
    const fileEntry = typeof attachment.fileEntry === "string" ? attachment.fileEntry : "";
    if (!attachmentId || attachmentId.includes("/") || attachmentId.includes("..")) throw new Error("Backup contains an invalid attachment ID.");
    if (hasFileEntry && !fileEntry) {
      unavailable += 1;
      return;
    }
    const backupEntry = fileEntry || `files/${attachmentId}`;
    if (backupEntry !== `files/${attachmentId}`) throw new Error(`Attachment ${attachmentId} has an unsupported backup file path.`);
    claims.push({
      attachmentId,
      fileName: typeof attachment.fileName === "string" ? attachment.fileName : attachmentId,
      backupEntry,
      expectedSize: typeof attachment.sizeBytes === "number" && attachment.sizeBytes >= 0 ? attachment.sizeBytes : null,
    });
  });
  return { claims, unavailable };
}

async function resolveDriveEntries(
  accessToken: string,
  cachedEntries: DriveSyncManifestEntry[],
  requiredEntries: string[],
  expectedCloudVersion: number,
  refreshDriveManifest: boolean,
) {
  if (refreshDriveManifest) return refreshFileEntries(accessToken, expectedCloudVersion);
  const cachedByBackupEntry = new Map(cachedEntries.map((entry) => [entry.backupEntry, entry]));
  if (requiredEntries.every((entry) => cachedByBackupEntry.has(entry))) return { entries: cachedEntries, filesFolderId: null };
  return refreshFileEntries(accessToken, expectedCloudVersion);
}

function missingDriveFileError(fileName: string) {
  return new Error(`Google Drive could not find the source file for “${fileName}”. The Android backup manifest still refers to it, but the file is no longer available in MyVault/files. Open MyVault Android, confirm this document still opens, and run its Google Drive backup again.`);
}

function isDriveNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

export async function createLocalBackupArchive({
  accessToken,
  onProgress,
  downloadDriveBlob,
  recoverDriveFile,
  createdAt = Date.now(),
  refreshDriveManifest = true,
}: {
  accessToken: string;
  onProgress?: (progress: LocalBackupExportProgress) => void;
  downloadDriveBlob?: DriveBlobDownloader;
  recoverDriveFile?: DriveFileRecovery;
  createdAt?: number;
  refreshDriveManifest?: boolean;
}): Promise<LocalBackupExportResult> {
  onProgress?.({ phase: "preparing", completedFiles: 0, totalFiles: 0, currentFileName: null });
  const bundle = await loadMetadataRestoreBundle();
  if (bundle) await reconcileLocalNoteDrafts(bundle);
  const pending = await loadSyncPendingChanges();
  const preflight = buildSyncPreflight(bundle, pending);
  if (!bundle) throw new Error("Restore the latest Android metadata before creating a backup.");
  if (preflight.status === "blocked") throw new Error(preflight.blockers[0] ?? "Local changes are not ready for export.");

  const metadata = buildMetadataPayloads(bundle, preflight, createdAt);
  const attachments = activeRows(metadata.get("attachments.json"));
  const { claims, unavailable } = claimedAttachmentEntries(attachments);
  const localAttachmentIds = new Set(pending.createdAttachments.map((attachment) => attachment.id));
  const driveClaims = claims.filter((claim) => !localAttachmentIds.has(claim.attachmentId));
  const resolvedDriveEntries = await resolveDriveEntries(
    accessToken,
    bundle.fileEntries ?? [],
    driveClaims.map((claim) => claim.backupEntry),
    bundle.cloudVersion,
    refreshDriveManifest,
  );
  const driveEntries = resolvedDriveEntries.entries;
  const driveEntriesByBackupEntry = new Map(driveEntries.map((entry) => [entry.backupEntry, entry]));
  driveClaims.forEach((claim) => {
    const entry = driveEntriesByBackupEntry.get(claim.backupEntry);
    if (!entry?.cloudFileId) throw new Error(`Google Drive is missing the file for “${claim.fileName}”.`);
    if (!entry.sha256) throw new Error(`Google Drive has no integrity hash for “${claim.fileName}”.`);
  });

  const totalFiles = claims.length;
  const writer = createArchiveWriter();
  [...metadata.entries()]
    .toSorted(([first], [second]) => first.localeCompare(second))
    .forEach(([fileName, json]) => writer.addJson(fileName, json));

  let completedFiles = 0;
  let recoveredDriveEntry = false;
  const fetchDriveBlob = downloadDriveBlob ?? ((entry: DriveSyncManifestEntry) => downloadDriveFileBlob(accessToken, entry.cloudFileId));
  const recoverMissingDriveFile = recoverDriveFile ?? (resolvedDriveEntries.filesFolderId
    ? (entry: DriveSyncManifestEntry) => findDriveFile(accessToken, entry.fileName, resolvedDriveEntries.filesFolderId!)
    : null);
  for (const claim of claims) {
    onProgress?.({ phase: "downloading", completedFiles, totalFiles, currentFileName: claim.fileName });
    let blob: Blob;
    if (localAttachmentIds.has(claim.attachmentId)) {
      const localBlob = await loadLocalAttachmentBlob(claim.attachmentId);
      if (!localBlob) throw new Error(`The local file for “${claim.fileName}” is missing.`);
      if (claim.expectedSize !== null && localBlob.size !== claim.expectedSize) {
        throw new Error(`The local file for “${claim.fileName}” has changed size and cannot be exported safely.`);
      }
      blob = localBlob;
    } else {
      let entry = driveEntriesByBackupEntry.get(claim.backupEntry)!;
      try {
        blob = await fetchDriveBlob(entry);
      } catch (error) {
        if (!isDriveNotFound(error)) {
          throw new Error(`MyVault could not download “${claim.fileName}” from Google Drive. ${error instanceof Error ? error.message : String(error)}`);
        }
        const replacement = recoverMissingDriveFile ? await recoverMissingDriveFile(entry) : null;
        if (!replacement?.id || replacement.id === entry.cloudFileId) throw missingDriveFileError(claim.fileName);
        entry = { ...entry, cloudFileId: replacement.id };
        driveEntriesByBackupEntry.set(claim.backupEntry, entry);
        recoveredDriveEntry = true;
        try {
          blob = await fetchDriveBlob(entry);
        } catch (retryError) {
          if (isDriveNotFound(retryError)) throw missingDriveFileError(claim.fileName);
          throw new Error(`MyVault found “${claim.fileName}” again, but could not download it. ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }
      if (entry.size > 0 && blob.size !== entry.size) throw new Error(`“${claim.fileName}” downloaded with the wrong file size.`);
      onProgress?.({ phase: "verifying", completedFiles, totalFiles, currentFileName: claim.fileName });
      const digest = await sha256(blob);
      if (digest.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`“${claim.fileName}” failed its Google Drive integrity check.`);
    }
    onProgress?.({ phase: "packing", completedFiles, totalFiles, currentFileName: claim.fileName });
    await writer.addBlob(claim.backupEntry, blob);
    completedFiles += 1;
  }

  if (recoveredDriveEntry) {
    await cacheAttachmentManifestEntries([...driveEntriesByBackupEntry.values()]);
  }

  const blob = await writer.finish();
  onProgress?.({ phase: "complete", completedFiles, totalFiles, currentFileName: null });
  const date = new Date(createdAt);
  const timestamp = Number.isNaN(date.getTime()) ? String(createdAt) : date.toISOString().replace(/[:.]/g, "-");
  return {
    blob,
    fileName: `MyVault-Web-${timestamp}.vaultbackup`,
    createdAt,
    summary: {
      folders: activeRows(metadata.get("folders.json")).length,
      notes: activeRows(metadata.get("notes.json")).length,
      attachments: attachments.length,
      includedAttachmentFiles: claims.length,
      unavailableAttachmentFiles: unavailable,
      metadataFiles: metadata.size,
      archiveBytes: blob.size,
      sourceCloudVersion: bundle.cloudVersion,
    },
  };
}

export function downloadLocalBackup(result: LocalBackupExportResult) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
