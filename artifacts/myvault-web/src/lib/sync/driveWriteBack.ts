import {
  createDriveFile,
  createDriveFolder,
  deleteDriveFile,
  downloadDriveFileJson,
  findMyVaultDriveMap,
  listDriveChildren,
  updateDriveFileContent,
  type DriveFileRecord,
} from "@/lib/googleDrive/driveClient";
import { buildMetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  clearLocalSyncPendingChanges,
  loadLocalAttachmentBlob,
  loadMetadataRestoreBundle,
  reconcileLocalNoteDrafts,
  saveMetadataRestoreBundle,
} from "@/lib/restore/localRestoreStore";
import {
  parseDriveSyncManifest,
  type DriveSyncManifest,
  type DriveSyncManifestEntry,
} from "@/lib/restore/driveManifestPreview";
import { buildSyncPreflight, createInitialMetadataRestoreBundle, loadSyncPendingChanges } from "@/lib/sync/syncPreflight";

export type DriveWriteBackProgress = {
  phase: "checking" | "preparing" | "uploading" | "committing" | "complete";
  completedFiles: number;
  totalFiles: number;
  currentFileName: string | null;
};

export type DriveWriteBackResult = {
  status: "no_changes" | "uploaded";
  cloudVersion: number;
  uploadedMetadataFiles: number;
  uploadedAttachmentFiles: number;
  repairedManifestEntries: number;
  localStateUpdated: boolean;
};

export class DriveWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveWriteConflictError";
  }
}

function hexadecimal(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(blob: Blob) {
  return hexadecimal(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

function safeExtension(fileName: string) {
  const extension = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
  const safe = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return safe || "bin";
}

function fileSize(file: DriveFileRecord) {
  const size = Number(file.size);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function newestFirst(first: DriveFileRecord, second: DriveFileRecord) {
  return Date.parse(second.modifiedTime ?? "") - Date.parse(first.modifiedTime ?? "");
}

function repairManifestEntries(
  entries: DriveSyncManifestEntry[],
  metadataChildren: DriveFileRecord[],
  fileChildren: DriveFileRecord[],
) {
  const metadataById = new Map(metadataChildren.map((file) => [file.id, file]));
  const filesById = new Map(fileChildren.map((file) => [file.id, file]));
  const childrenFor = (entry: DriveSyncManifestEntry) => entry.kind === "metadata" ? metadataChildren : fileChildren;
  const byIdFor = (entry: DriveSyncManifestEntry) => entry.kind === "metadata" ? metadataById : filesById;
  let repaired = 0;

  const repairedEntries = entries.map((entry) => {
    if (byIdFor(entry).has(entry.cloudFileId)) return { ...entry };
    const candidates = childrenFor(entry)
      .filter((file) => file.name === entry.fileName)
      .filter((file) => {
        const size = fileSize(file);
        return entry.size <= 0 || size === null || size === entry.size;
      })
      .toSorted(newestFirst);
    const replacement = candidates[0];
    if (!replacement) {
      throw new Error(`Google Drive cannot find ${entry.kind === "metadata" ? "metadata" : "file"} “${entry.fileName}”. Run a fresh Android backup before uploading website changes.`);
    }
    repaired += 1;
    return { ...entry, cloudFileId: replacement.id };
  });

  return { entries: repairedEntries, repaired };
}

function replaceEntry(entries: DriveSyncManifestEntry[], nextEntry: DriveSyncManifestEntry) {
  const index = entries.findIndex((entry) => (
    entry.path === nextEntry.path ||
    (entry.kind === nextEntry.kind && entry.backupEntry === nextEntry.backupEntry)
  ));
  if (index === -1) return [...entries, nextEntry];
  return entries.map((entry, entryIndex) => entryIndex === index ? nextEntry : entry);
}

async function loadLatestManifest(accessToken: string) {
  const scan = await findMyVaultDriveMap(accessToken);
  if (!scan.rootFolder || !scan.folders.metadata || !scan.folders.files || !scan.folders.manifests || !scan.manifestFile) {
    throw new Error(`MyVault Drive is incomplete: ${scan.missingPaths.join(", ") || "required folders are missing"}. Run an Android backup first.`);
  }
  const raw = await downloadDriveFileJson<unknown>(accessToken, scan.manifestFile.id);
  const parsed = parseDriveSyncManifest(raw);
  if (!parsed.manifest || parsed.issues.length) {
    throw new Error(parsed.issues[0] ?? "The latest MyVault Drive manifest could not be read.");
  }
  return { scan, manifest: parsed.manifest };
}

async function ensureInitialDriveLayout(accessToken: string) {
  const existing = await findMyVaultDriveMap(accessToken);
  if (existing.manifestFile) {
    throw new DriveWriteConflictError("A MyVault backup appeared in this Google Drive. Restore it before backing up website changes so no cloud data is replaced.");
  }
  const rootFolder = existing.rootFolder ?? await createDriveFolder(accessToken, "root", "MyVault");
  const folders = { ...existing.folders };
  for (const folderName of ["metadata", "files", "manifests", "backups"] as const) {
    folders[folderName] = folders[folderName] ?? await createDriveFolder(accessToken, rootFolder.id, folderName);
  }
  return { ...existing, rootFolder, folders, manifestFile: null };
}

function assertMatchingCloudVersion(latest: DriveSyncManifest, expected: number) {
  if (latest.cloudVersion !== expected) {
    throw new DriveWriteConflictError(
      `Android has created a newer Google Drive backup (version ${latest.cloudVersion}). Restore the latest metadata first; MyVault Web will preserve compatible website edits and identify any same-note conflicts.`,
    );
  }
}

async function cleanupStagedFiles(accessToken: string, fileIds: string[]) {
  await Promise.allSettled(fileIds.map((fileId) => deleteDriveFile(accessToken, fileId)));
}

export async function writeWebsiteChangesToDrive({
  accessToken,
  onProgress,
}: {
  accessToken: string;
  onProgress?: (progress: DriveWriteBackProgress) => void;
}): Promise<DriveWriteBackResult> {
  onProgress?.({ phase: "checking", completedFiles: 0, totalFiles: 0, currentFileName: null });
  const restoredBundle = await loadMetadataRestoreBundle();
  const isInitialBackup = !restoredBundle;
  const bundle = restoredBundle ?? createInitialMetadataRestoreBundle();
  if (restoredBundle) await reconcileLocalNoteDrafts(restoredBundle);
  const pending = await loadSyncPendingChanges();
  const preflight = buildSyncPreflight(bundle, pending);
  if (preflight.status === "blocked") throw new Error(preflight.blockers[0] ?? "Website changes are not ready for Google Drive.");
  if (preflight.status === "no_changes" || preflight.status === "local_only") {
    return {
      status: "no_changes",
      cloudVersion: bundle.cloudVersion,
      uploadedMetadataFiles: 0,
      uploadedAttachmentFiles: 0,
      repairedManifestEntries: 0,
      localStateUpdated: true,
    };
  }

  const initialManifest: DriveSyncManifest = {
    schemaVersion: 1,
    cloudVersion: 0,
    storage: "google-drive-api",
    layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups",
    entries: [],
  };
  const latest = isInitialBackup
    ? { scan: await ensureInitialDriveLayout(accessToken), manifest: initialManifest }
    : await loadLatestManifest(accessToken);
  const { scan, manifest: latestManifest } = latest;
  if (!isInitialBackup) assertMatchingCloudVersion(latestManifest, bundle.cloudVersion);
  const repaired = isInitialBackup
    ? { entries: [] as DriveSyncManifestEntry[], repaired: 0 }
    : repairManifestEntries(
        latestManifest.entries,
        await listDriveChildren(accessToken, scan.folders.metadata!.id),
        await listDriveChildren(accessToken, scan.folders.files!.id),
      );
  let nextEntries = repaired.entries;
  const preparedJson = new Map<string, unknown>(Object.entries(preflight.preparedFiles));
  const touchedMetadata: Array<[string, unknown]> = (isInitialBackup
    ? bundle.files.map((file) => [file.fileName, preparedJson.get(file.fileName) ?? file.json] as [string, unknown])
    : Object.entries(preflight.preparedFiles)
  ).toSorted(([first], [second]) => first.localeCompare(second));
  const uploadAttachmentIds = new Set(preflight.fileUploads.map((file) => file.attachmentId));
  const attachmentsToUpload = pending.createdAttachments.filter((attachment) => uploadAttachmentIds.has(attachment.id));
  const totalFiles = touchedMetadata.length + attachmentsToUpload.length;
  const stagedFileIds: string[] = [];
  let completedFiles = 0;
  let committed = false;

  onProgress?.({ phase: "preparing", completedFiles, totalFiles, currentFileName: null });
  try {
    for (const [fileName, json] of touchedMetadata) {
      onProgress?.({ phase: "uploading", completedFiles, totalFiles, currentFileName: fileName });
      const blob = new Blob([JSON.stringify(json)], { type: "application/json" });
      const uploaded = await createDriveFile(accessToken, scan.folders.metadata!.id, fileName, blob, "application/json");
      stagedFileIds.push(uploaded.id);
      const previous = latestManifest.entries.find((entry) => entry.kind === "metadata" && entry.fileName === fileName);
      const entry: DriveSyncManifestEntry = {
        path: previous?.path || `metadata/${fileName}`,
        fileName,
        backupEntry: previous?.backupEntry || fileName,
        kind: "metadata",
        sha256: await sha256(blob),
        size: blob.size,
        cloudFileId: uploaded.id,
        updatedAt: null,
      };
      nextEntries = replaceEntry(nextEntries, entry);
      completedFiles += 1;
    }

    for (const attachment of attachmentsToUpload) {
      onProgress?.({ phase: "uploading", completedFiles, totalFiles, currentFileName: attachment.name });
      const blob = await loadLocalAttachmentBlob(attachment.id);
      if (!blob) throw new Error(`The browser no longer has the file for “${attachment.name}”. Add the PDF again before backing up.`);
      const fileName = `${attachment.id}.${safeExtension(attachment.name)}`;
      const uploaded = await createDriveFile(
        accessToken,
        scan.folders.files!.id,
        fileName,
        blob,
        attachment.mimeType || blob.type || "application/octet-stream",
      );
      stagedFileIds.push(uploaded.id);
      nextEntries = replaceEntry(nextEntries, {
        path: `files/${fileName}`,
        fileName,
        backupEntry: `files/${attachment.id}`,
        kind: "file",
        sha256: await sha256(blob),
        size: blob.size,
        cloudFileId: uploaded.id,
        updatedAt: null,
      });
      completedFiles += 1;
    }

    onProgress?.({ phase: "committing", completedFiles, totalFiles, currentFileName: "sync_manifest.json" });
    const beforeCommit = isInitialBackup ? await findMyVaultDriveMap(accessToken) : (await loadLatestManifest(accessToken)).scan;
    if (isInitialBackup) {
      if (beforeCommit.manifestFile) {
        throw new DriveWriteConflictError("A MyVault backup appeared while the first website backup was being prepared. Nothing was committed; restore the cloud backup before trying again.");
      }
    } else {
      const current = await loadLatestManifest(accessToken);
      assertMatchingCloudVersion(current.manifest, bundle.cloudVersion);
      if (current.scan.manifestFile?.id !== scan.manifestFile!.id) {
        throw new DriveWriteConflictError("The Google Drive manifest changed while the website backup was being prepared. Nothing was committed; check the latest Android backup and try again.");
      }
    }

    const cloudVersion = Math.max(Date.now(), bundle.cloudVersion + 1);
    nextEntries = nextEntries
      .map((entry) => stagedFileIds.includes(entry.cloudFileId) ? { ...entry, updatedAt: cloudVersion } : entry)
      .toSorted((first, second) => first.path.localeCompare(second.path));
    const nextManifest: DriveSyncManifest = {
      schemaVersion: 1,
      cloudVersion,
      storage: "google-drive-api",
      layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups",
      entries: nextEntries,
    };
    const manifestBlob = new Blob([JSON.stringify(nextManifest, null, 2)], { type: "application/json" });
    if (isInitialBackup) {
      await createDriveFile(accessToken, scan.folders.manifests!.id, "sync_manifest.json", manifestBlob, "application/json");
    } else {
      await updateDriveFileContent(accessToken, scan.manifestFile!.id, manifestBlob, "application/json");
    }
    committed = true;

    let localStateUpdated = true;
    try {
      const jsonByName = new Map(bundle.files.map((file) => [file.fileName, file.json]));
      touchedMetadata.forEach(([fileName, json]) => jsonByName.set(fileName, json));
      const downloadedFiles = nextManifest.entries
        .filter((entry) => entry.kind === "metadata")
        .map((entry) => {
          const json = jsonByName.get(entry.fileName);
          if (json === undefined) throw new Error(`The browser is missing restored metadata ${entry.fileName}.`);
          return { entry, json };
        });
      const nextBundle = buildMetadataRestoreBundle(nextManifest, downloadedFiles);
      await saveMetadataRestoreBundle(nextBundle);
      await clearLocalSyncPendingChanges();
    } catch {
      localStateUpdated = false;
    }

    onProgress?.({ phase: "complete", completedFiles, totalFiles, currentFileName: null });
    return {
      status: "uploaded",
      cloudVersion,
      uploadedMetadataFiles: touchedMetadata.length,
      uploadedAttachmentFiles: attachmentsToUpload.length,
      repairedManifestEntries: repaired.repaired,
      localStateUpdated,
    };
  } catch (error) {
    if (!committed) await cleanupStagedFiles(accessToken, stagedFileIds);
    throw error;
  }
}
