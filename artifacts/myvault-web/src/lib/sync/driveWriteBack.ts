import {
  createDriveFile,
  createDriveFolder,
  deleteDriveFile,
  downloadDriveFileBlob,
  downloadDriveFileJson,
  findMyVaultDriveMap,
  listDriveChildren,
  updateDriveFileContent,
  type DriveFileRecord,
  type MyVaultDriveScan,
} from "@/lib/googleDrive/driveClient";
import { buildMetadataRestoreBundle, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  clearLocalSyncPendingChanges,
  createLocalRecoverySnapshot,
  loadLocalAttachmentBlob,
  loadLocalSyncBase,
  loadPendingLocalSyncOperations,
  loadMetadataRestoreBundle,
  reconcileLocalNoteDrafts,
  saveLocalSyncBase,
  saveLocalSyncConflict,
  saveMetadataRestoreBundle,
} from "@/lib/restore/localRestoreStore";
import {
  parseDriveSyncManifest,
  type DriveSyncManifest,
  type DriveSyncManifestEntry,
} from "@/lib/restore/driveManifestPreview";
import { assertGoogleDriveSession, verifyAndActivateGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import { withAccountSyncLock } from "@/lib/sync/accountContext";
import { getCachedGoogleDriveToken } from "@/lib/googleDrive/identity";
import { canonicalJson, computeBundleRevision, computeManifestRevision } from "@/lib/sync/revision";
import {
  buildSyncPreflight,
  createInitialMetadataRestoreBundle,
  loadSyncPendingChanges,
} from "@/lib/sync/syncPreflight";
import { reconcileMetadataBundles } from "@/lib/sync/threeWayMerge";
import { validateSyncCandidate } from "@/lib/sync/validateSyncCandidate";

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

type LatestDriveGeneration = {
  scan: MyVaultDriveScan;
  manifest: DriveSyncManifest;
  manifestRevisionId: string;
};

function hexadecimal(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(blob: Blob) {
  return hexadecimal(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

function jsonBlob(value: unknown, pretty = false) {
  return new Blob([JSON.stringify(value, null, pretty ? 2 : undefined)], { type: "application/json" });
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

function repairManifestEntries(entries: DriveSyncManifestEntry[], metadataChildren: DriveFileRecord[], fileChildren: DriveFileRecord[]) {
  const metadataById = new Map(metadataChildren.map((file) => [file.id, file]));
  const filesById = new Map(fileChildren.map((file) => [file.id, file]));
  const childrenFor = (entry: DriveSyncManifestEntry) => entry.kind === "metadata" ? metadataChildren : fileChildren;
  const byIdFor = (entry: DriveSyncManifestEntry) => entry.kind === "metadata" ? metadataById : filesById;
  let repaired = 0;
  const repairedEntries = entries.map((entry) => {
    if (byIdFor(entry).has(entry.cloudFileId)) return { ...entry };
    const replacement = childrenFor(entry)
      .filter((file) => file.name === entry.fileName)
      .filter((file) => {
        const size = fileSize(file);
        return entry.size <= 0 || size === null || size === entry.size;
      })
      .toSorted(newestFirst)[0];
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
    entry.path === nextEntry.path || (entry.kind === nextEntry.kind && entry.backupEntry === nextEntry.backupEntry)
  ));
  if (index === -1) return [...entries, nextEntry];
  return entries.map((entry, entryIndex) => entryIndex === index ? nextEntry : entry);
}

async function loadLatestManifest(accessToken: string): Promise<LatestDriveGeneration> {
  const scan = await findMyVaultDriveMap(accessToken);
  if (!scan.rootFolder || !scan.folders.metadata || !scan.folders.files || !scan.folders.manifests || !scan.folders.backups || !scan.manifestFile) {
    throw new Error(`MyVault Drive is incomplete: ${scan.missingPaths.join(", ") || "required folders are missing"}. Run an Android backup first.`);
  }
  const raw = await downloadDriveFileJson<unknown>(accessToken, scan.manifestFile.id);
  const parsed = parseDriveSyncManifest(raw);
  if (!parsed.manifest || parsed.issues.length) throw new Error(parsed.issues[0] ?? "The latest MyVault Drive manifest could not be read.");
  const revision = await computeManifestRevision(parsed.manifest);
  return { scan, manifest: parsed.manifest, manifestRevisionId: revision.revisionId };
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
  return { ...existing, rootFolder, folders, manifestFile: null } as MyVaultDriveScan;
}

async function verifiedDriveUpload(accessToken: string, parentId: string, fileName: string, blob: Blob, mimeType: string) {
  const expectedHash = await sha256(blob);
  const uploaded = await createDriveFile(accessToken, parentId, fileName, blob, mimeType);
  const downloaded = await downloadDriveFileBlob(accessToken, uploaded.id, mimeType);
  if (downloaded.size !== blob.size || await sha256(downloaded) !== expectedHash) {
    await deleteDriveFile(accessToken, uploaded.id).catch(() => undefined);
    throw new Error(`Google Drive did not return the same bytes after uploading “${fileName}”. Nothing was committed.`);
  }
  return { uploaded, sha256: expectedHash };
}

async function downloadMetadataBundle(accessToken: string, manifest: DriveSyncManifest) {
  const downloadedFiles = await Promise.all(manifest.entries.filter((entry) => entry.kind === "metadata").map(async (entry) => {
    const blob = await downloadDriveFileBlob(accessToken, entry.cloudFileId, "application/json");
    if (entry.size > 0 && blob.size !== entry.size) throw new Error(`Metadata size verification failed for ${entry.fileName}.`);
    if (entry.sha256 && await sha256(blob) !== entry.sha256) throw new Error(`Metadata integrity verification failed for ${entry.fileName}.`);
    let json: unknown;
    try {
      json = JSON.parse(await blob.text());
    } catch {
      throw new Error(`Google Drive metadata ${entry.fileName} is not valid JSON.`);
    }
    return { entry, json };
  }));
  const bundle = buildMetadataRestoreBundle(manifest, downloadedFiles);
  if (bundle.issues.length) throw new Error(bundle.issues[0]);
  return bundle;
}

function withPreparedFiles(bundle: MetadataRestoreBundle, preparedFiles: Record<string, Record<string, unknown>[]>) {
  const prepared = new Map(Object.entries(preparedFiles));
  const files = bundle.files.map((file) => prepared.has(file.fileName)
    ? { ...file, json: prepared.get(file.fileName), itemCount: prepared.get(file.fileName)?.length ?? file.itemCount }
    : file);
  const existing = new Set(files.map((file) => file.fileName));
  prepared.forEach((json, fileName) => {
    if (existing.has(fileName)) return;
    files.push({ fileName, entryPath: `metadata/${fileName}`, backupEntry: fileName, cloudFileId: "", size: 0, updatedAt: null, itemCount: json.length, json });
  });
  return { ...bundle, files };
}

function changedMetadataFiles(candidate: MetadataRestoreBundle, remote: MetadataRestoreBundle | null) {
  const remoteJson = new Map(remote?.files.map((file) => [file.fileName, canonicalJson(file.json)]) ?? []);
  return candidate.files
    .filter((file) => remoteJson.get(file.fileName) !== canonicalJson(file.json))
    .toSorted((first, second) => first.fileName.localeCompare(second.fileName));
}

function downloadedMetadataForManifest(candidate: MetadataRestoreBundle, manifest: DriveSyncManifest) {
  const jsonByName = new Map(candidate.files.map((file) => [file.fileName, file.json]));
  return manifest.entries.filter((entry) => entry.kind === "metadata").map((entry) => {
    const json = jsonByName.get(entry.fileName);
    if (json === undefined) throw new Error(`The verified candidate is missing metadata ${entry.fileName}.`);
    return { entry, json };
  });
}

async function cleanupStagedFiles(accessToken: string, fileIds: string[]) {
  await Promise.allSettled(fileIds.map((fileId) => deleteDriveFile(accessToken, fileId)));
}

export async function writeWebsiteChangesToDrive({ accessToken, onProgress }: {
  accessToken: string;
  onProgress?: (progress: DriveWriteBackProgress) => void;
}): Promise<DriveWriteBackResult> {
  const token = getCachedGoogleDriveToken();
  if (!token || token.accessToken !== accessToken) {
    throw new Error("The Google account changed before backup began. Nothing was uploaded.");
  }
  const { accountId } = await verifyAndActivateGoogleDriveSession(token);
  return withAccountSyncLock(accountId, async () => {
    onProgress?.({ phase: "checking", completedFiles: 0, totalFiles: 0, currentFileName: null });
    assertGoogleDriveSession(token, accountId);

    const restoredBundle = await loadMetadataRestoreBundle();
    const isInitialBackup = !restoredBundle;
    if (restoredBundle) await reconcileLocalNoteDrafts(restoredBundle);
    const [pending, capturedOperations, base] = await Promise.all([
      loadSyncPendingChanges(),
      loadPendingLocalSyncOperations(),
      loadLocalSyncBase(),
    ]);
    const operationIds = capturedOperations.map((operation) => operation.id);
    const sourceBundle = isInitialBackup ? createInitialMetadataRestoreBundle() : restoredBundle;
    if (!sourceBundle || (!isInitialBackup && (!base || base.accountId !== accountId))) {
      throw new Error("The immutable restore base is missing for this Google account. Restore the latest Android metadata before backing up website changes.");
    }
    const preflight = buildSyncPreflight(sourceBundle, pending);
    if (preflight.status === "blocked") throw new Error(preflight.blockers[0] ?? "Website changes are not ready for Google Drive.");
    if (preflight.status === "no_changes" || preflight.status === "local_only") {
      return { status: "no_changes", cloudVersion: sourceBundle.cloudVersion, uploadedMetadataFiles: 0, uploadedAttachmentFiles: 0, repairedManifestEntries: 0, localStateUpdated: true };
    }

    const webCandidate = withPreparedFiles(sourceBundle, preflight.preparedFiles);
    let scan: MyVaultDriveScan;
    let currentManifest: DriveSyncManifest;
    let currentManifestRevisionId: string | null = null;
    let currentBundle: MetadataRestoreBundle | null = null;
    let repairedManifestEntries = 0;

    if (isInitialBackup) {
      scan = await ensureInitialDriveLayout(accessToken);
      currentManifest = { schemaVersion: 1, cloudVersion: 0, storage: "google-drive-api", layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups", entries: [] };
    } else {
      const latest = await loadLatestManifest(accessToken);
      scan = latest.scan;
      currentManifestRevisionId = latest.manifestRevisionId;
      const repaired = repairManifestEntries(latest.manifest.entries, await listDriveChildren(accessToken, latest.scan.folders.metadata!.id), await listDriveChildren(accessToken, latest.scan.folders.files!.id));
      repairedManifestEntries = repaired.repaired;
      currentManifest = { ...latest.manifest, entries: repaired.entries };
      currentBundle = await downloadMetadataBundle(accessToken, currentManifest);
    }

    const touchedFiles = new Set(preflight.touchedFiles.map((file) => file.fileName));
    let candidate = webCandidate;
    if (currentBundle && base) {
      const mergeBase = restoredBundle ?? base.bundle;
      const merge = reconcileMetadataBundles({ base: mergeBase, web: webCandidate, remote: currentBundle, touchedFiles });
      if (merge.conflicts.length) {
        const remoteRevision = await computeBundleRevision(currentBundle);
        await Promise.all(merge.conflicts.map((conflict) => saveLocalSyncConflict({
          schemaVersion: 1,
          id: crypto.randomUUID(),
          accountId,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          kind: conflict.kind,
          baseRevisionId: base.revision.revisionId,
          remoteRevisionId: remoteRevision.revisionId,
          operationIds,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          resolution: null,
        })));
        throw new DriveWriteConflictError(`Android and MyVault Web both changed ${merge.conflicts[0].entityType} ${merge.conflicts[0].entityId}. Nothing was uploaded; choose which version to keep before trying again.`);
      }
      candidate = merge.bundle;
    }

    const validation = validateSyncCandidate(candidate);
    if (!validation.valid) throw new Error(`The candidate backup failed validation: ${validation.issues[0]}`);
    await createLocalRecoverySnapshot("before-drive-write-back");

    const metadataToUpload = changedMetadataFiles(candidate, currentBundle);
    const uploadAttachmentIds = new Set(preflight.fileUploads.map((file) => file.attachmentId));
    const attachmentsToUpload = pending.createdAttachments.filter((attachment) => uploadAttachmentIds.has(attachment.id));
    const totalFiles = metadataToUpload.length + attachmentsToUpload.length + (isInitialBackup ? 0 : 1);
    const stagedFileIds: string[] = [];
    let completedFiles = 0;
    let committed = false;
    let nextEntries = [...currentManifest.entries];

    onProgress?.({ phase: "preparing", completedFiles, totalFiles, currentFileName: null });
    try {
      if (!isInitialBackup) {
        const historyName = `web-generation-${currentManifest.cloudVersion}-${Date.now()}.json`;
        const historyBlob = jsonBlob({ format: "myvault-web-recovery-generation", version: 1, createdAt: new Date().toISOString(), previousManifest: currentManifest, candidateRevision: await computeBundleRevision(candidate) }, true);
        onProgress?.({ phase: "uploading", completedFiles, totalFiles, currentFileName: historyName });
        const history = await verifiedDriveUpload(accessToken, scan.folders.backups!.id, historyName, historyBlob, "application/json");
        stagedFileIds.push(history.uploaded.id);
        completedFiles += 1;
      }

      for (const file of metadataToUpload) {
        onProgress?.({ phase: "uploading", completedFiles, totalFiles, currentFileName: file.fileName });
        const blob = jsonBlob(file.json);
        const upload = await verifiedDriveUpload(accessToken, scan.folders.metadata!.id, file.fileName, blob, "application/json");
        stagedFileIds.push(upload.uploaded.id);
        const previous = currentManifest.entries.find((entry) => entry.kind === "metadata" && entry.fileName === file.fileName);
        nextEntries = replaceEntry(nextEntries, { ...previous, path: previous?.path || `metadata/${file.fileName}`, fileName: file.fileName, backupEntry: previous?.backupEntry || file.fileName, kind: "metadata", sha256: upload.sha256, size: blob.size, cloudFileId: upload.uploaded.id, updatedAt: null });
        completedFiles += 1;
      }

      for (const attachment of attachmentsToUpload) {
        onProgress?.({ phase: "uploading", completedFiles, totalFiles, currentFileName: attachment.name });
        const blob = await loadLocalAttachmentBlob(attachment.id);
        if (!blob) throw new Error(`The browser no longer has the file for “${attachment.name}”. Add the PDF again before backing up.`);
        const fileName = `${attachment.id}.${safeExtension(attachment.name)}`;
        const upload = await verifiedDriveUpload(accessToken, scan.folders.files!.id, fileName, blob, attachment.mimeType || blob.type || "application/octet-stream");
        stagedFileIds.push(upload.uploaded.id);
        nextEntries = replaceEntry(nextEntries, { path: `files/${fileName}`, fileName, backupEntry: `files/${attachment.id}`, kind: "file", sha256: upload.sha256, size: blob.size, cloudFileId: upload.uploaded.id, updatedAt: null });
        completedFiles += 1;
      }

      assertGoogleDriveSession(token, accountId);
      if (isInitialBackup) {
        if ((await findMyVaultDriveMap(accessToken)).manifestFile) throw new DriveWriteConflictError("A MyVault backup appeared while the first website backup was being prepared. Nothing was committed.");
      } else {
        const beforeCommit = await loadLatestManifest(accessToken);
        if (beforeCommit.manifestRevisionId !== currentManifestRevisionId) throw new DriveWriteConflictError("The Android backup changed while MyVault Web was preparing its upload. Nothing was committed; check the latest backup and try again.");
      }

      onProgress?.({ phase: "committing", completedFiles, totalFiles, currentFileName: "sync_manifest.json" });
      const cloudVersion = Math.max(Date.now(), currentManifest.cloudVersion + 1);
      const stagedEntryIds = new Set(stagedFileIds);
      nextEntries = nextEntries.map((entry) => stagedEntryIds.has(entry.cloudFileId) ? { ...entry, updatedAt: cloudVersion } : entry).toSorted((first, second) => first.path.localeCompare(second.path));
      const nextManifest: DriveSyncManifest = { ...currentManifest, schemaVersion: 1, cloudVersion, storage: "google-drive-api", layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups", entries: nextEntries };
      const manifestBlob = jsonBlob(nextManifest, true);
      let manifestFileId: string;
      if (isInitialBackup) {
        manifestFileId = (await createDriveFile(accessToken, scan.folders.manifests!.id, "sync_manifest.json", manifestBlob, "application/json")).id;
      } else {
        await updateDriveFileContent(accessToken, scan.manifestFile!.id, manifestBlob, "application/json");
        manifestFileId = scan.manifestFile!.id;
      }
      committed = true;

      const committedRaw = await downloadDriveFileJson<unknown>(accessToken, manifestFileId);
      if (canonicalJson(committedRaw) !== canonicalJson(nextManifest)) throw new Error("Google Drive committed a manifest that does not match the verified candidate. Local changes were retained for recovery.");
      const committedParsed = parseDriveSyncManifest(committedRaw);
      if (!committedParsed.manifest || committedParsed.issues.length) throw new Error(committedParsed.issues[0] ?? "The committed Google Drive manifest failed validation.");
      for (const entry of nextManifest.entries.filter((entry) => stagedEntryIds.has(entry.cloudFileId))) {
        const blob = await downloadDriveFileBlob(accessToken, entry.cloudFileId);
        if (blob.size !== entry.size || await sha256(blob) !== entry.sha256) throw new Error(`Post-commit verification failed for ${entry.fileName}. Local changes were retained for recovery.`);
      }

      const nextBundle = buildMetadataRestoreBundle(nextManifest, downloadedMetadataForManifest(candidate, nextManifest));
      const finalValidation = validateSyncCandidate(nextBundle);
      if (nextBundle.issues.length || !finalValidation.valid) throw new Error(nextBundle.issues[0] ?? finalValidation.issues[0] ?? "The committed backup failed final validation.");

      let localStateUpdated = true;
      try {
        assertGoogleDriveSession(token, accountId);
        await saveMetadataRestoreBundle(nextBundle);
        await saveLocalSyncBase({ schemaVersion: 1, accountId, revision: await computeBundleRevision(nextBundle), bundle: structuredClone(nextBundle) });
        await clearLocalSyncPendingChanges(operationIds);
      } catch {
        localStateUpdated = false;
      }

      onProgress?.({ phase: "complete", completedFiles, totalFiles, currentFileName: null });
      return { status: "uploaded" as const, cloudVersion, uploadedMetadataFiles: metadataToUpload.length, uploadedAttachmentFiles: attachmentsToUpload.length, repairedManifestEntries, localStateUpdated };
    } catch (error) {
      if (!committed) await cleanupStagedFiles(accessToken, stagedFileIds);
      throw error;
    }
  });
}
