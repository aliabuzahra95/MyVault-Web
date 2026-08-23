import { metadataFiles, restoreDataGroups } from "@/lib/restore/driveRestoreMap";
import type { DriveSyncManifest, DriveSyncManifestEntry } from "@/lib/restore/driveManifestPreview";

export type RestoredMetadataFile = {
  fileName: string;
  entryPath: string;
  backupEntry: string;
  cloudFileId: string;
  size: number;
  updatedAt: number | null;
  itemCount: number | null;
  json: unknown;
};

export type MetadataRestoreBundle = {
  schemaVersion: 1;
  restoredAt: string;
  cloudVersion: number;
  driveEntryCount: number;
  metadataFileCount: number;
  metadataBytes: number;
  files: RestoredMetadataFile[];
  fileEntries?: DriveSyncManifestEntry[];
  counts: {
    courses: number;
    folders: number;
    notes: number;
    blocks: number;
    attachments: number;
    tags: number;
    stickyNotes: number;
    pdfAnnotations: number;
  };
  groupSummaries: Array<{
    label: string;
    filesRestored: number;
    itemCount: number;
  }>;
  issues: string[];
};

type DownloadedMetadataFile = {
  entry: DriveSyncManifestEntry;
  json: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataKey(entry: Pick<DriveSyncManifestEntry, "fileName" | "backupEntry" | "path">) {
  return entry.fileName || entry.backupEntry || entry.path.replace(/^metadata\//, "");
}

export function getMetadataManifestEntries(manifest: DriveSyncManifest) {
  return manifest.entries
    .filter((entry) => entry.kind === "metadata")
    .toSorted((first, second) => metadataKey(first).localeCompare(metadataKey(second)));
}

function countJsonItems(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isRecord(value)) {
    const items = value.items;
    if (Array.isArray(items)) {
      return items.length;
    }

    return Object.keys(value).length;
  }

  return null;
}

function validateInternalBackupManifest(value: unknown) {
  const issues: string[] = [];

  if (!isRecord(value)) {
    return ["manifest.json is not a JSON object."];
  }

  if (value.format !== "myvault-backup") {
    issues.push("manifest.json is not a MyVault backup manifest.");
  }

  if (value.version !== 1) {
    issues.push("manifest.json is not backup version 1.");
  }

  return issues;
}

function getFileByName(files: RestoredMetadataFile[], fileName: string) {
  return files.find((file) => file.fileName === fileName);
}

function itemCount(files: RestoredMetadataFile[], fileName: string) {
  return getFileByName(files, fileName)?.itemCount ?? 0;
}

export function buildMetadataRestoreBundle(manifest: DriveSyncManifest, downloadedFiles: DownloadedMetadataFile[]): MetadataRestoreBundle {
  const files = downloadedFiles.map(({ entry, json }) => ({
    fileName: metadataKey(entry),
    entryPath: entry.path,
    backupEntry: entry.backupEntry,
    cloudFileId: entry.cloudFileId,
    size: entry.size,
    updatedAt: entry.updatedAt,
    itemCount: countJsonItems(json),
    json,
  }));

  const restoredFileNames = new Set(files.map((file) => file.fileName));
  const issues = metadataFiles
    .filter((file) => file.required && !restoredFileNames.has(file.fileName))
    .map((file) => `Required metadata was not restored: ${file.fileName}`);

  const manifestFile = getFileByName(files, "manifest.json");
  if (!manifestFile) {
    issues.push("manifest.json was not restored.");
  } else {
    issues.push(...validateInternalBackupManifest(manifestFile.json));
  }

  const groupSummaries = restoreDataGroups.map((group) => {
    const groupFileNames = new Set<string>(group.files);
    const groupFiles = files.filter((file) => groupFileNames.has(file.fileName));
    return {
      label: group.label,
      filesRestored: groupFiles.length,
      itemCount: groupFiles.reduce((total, file) => total + (file.itemCount ?? 0), 0),
    };
  });

  return {
    schemaVersion: 1,
    restoredAt: new Date().toISOString(),
    cloudVersion: manifest.cloudVersion,
    driveEntryCount: manifest.entries.length,
    metadataFileCount: files.length,
    metadataBytes: files.reduce((total, file) => total + Math.max(file.size, 0), 0),
    files,
    fileEntries: manifest.entries.filter((entry) => entry.kind === "file"),
    counts: {
      courses: itemCount(files, "courses.json"),
      folders: itemCount(files, "folders.json"),
      notes: itemCount(files, "notes.json"),
      blocks: itemCount(files, "blocks.json"),
      attachments: itemCount(files, "attachments.json"),
      tags: itemCount(files, "tags.json") + itemCount(files, "knowledge_tags.json"),
      stickyNotes: itemCount(files, "folder_sticky_notes.json") + itemCount(files, "course_sticky_notes.json"),
      pdfAnnotations: itemCount(files, "pdf_annotations.json"),
    },
    groupSummaries,
    issues,
  };
}
