import { driveManifest, metadataFiles, restoreDataGroups } from "@/lib/restore/driveRestoreMap";

export type DriveSyncManifestEntryKind = "metadata" | "file";

export type DriveSyncManifestEntry = {
  path: string;
  fileName: string;
  backupEntry: string;
  kind: DriveSyncManifestEntryKind;
  sha256: string;
  size: number;
  cloudFileId: string;
  updatedAt: number | null;
};

export type DriveSyncManifest = {
  schemaVersion: number;
  cloudVersion: number;
  storage: string;
  layout: string;
  entries: DriveSyncManifestEntry[];
};

export type ManifestGroupPreview = {
  label: string;
  total: number;
  present: number;
  missing: string[];
};

export type DriveManifestPreview = {
  manifest: DriveSyncManifest;
  issues: string[];
  counts: {
    totalEntries: number;
    metadataEntries: number;
    fileEntries: number;
    requiredMetadataPresent: number;
    requiredMetadataTotal: number;
  };
  totalBytes: number;
  metadataBytes: number;
  fileBytes: number;
  missingRequiredMetadata: string[];
  groups: ManifestGroupPreview[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, issues: string[], label: string) {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }

  issues.push(`${label} is missing ${key}.`);
  return "";
}

function readNumber(record: Record<string, unknown>, key: string, issues: string[], label: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  issues.push(`${label} is missing ${key}.`);
  return 0;
}

function readOptionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readEntryKind(value: string, issues: string[], label: string): DriveSyncManifestEntryKind {
  if (value === "metadata" || value === "file") {
    return value;
  }

  issues.push(`${label} has unsupported kind "${value}".`);
  return value.startsWith("file") ? "file" : "metadata";
}

function normalizeEntry(value: unknown, index: number, issues: string[]): DriveSyncManifestEntry | null {
  const label = `entries[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${label} is not an object.`);
    return null;
  }

  const path = readString(value, "path", issues, label);
  const kindValue = readString(value, "kind", issues, label);
  const kind = readEntryKind(kindValue, issues, label);
  const fileName = readString(value, "fileName", issues, label) || path.substring(path.lastIndexOf("/") + 1);
  const backupEntry = readString(value, "backupEntry", issues, label) || (kind === "metadata" ? fileName : path);
  const sha256 = readString(value, "sha256", issues, label);
  const size = readNumber(value, "size", issues, label);
  const cloudFileId = readString(value, "cloudFileId", issues, label);
  const updatedAt = readOptionalNumber(value, "updatedAt");

  if (kind === "metadata" && !path.startsWith("metadata/")) {
    issues.push(`${label} is metadata but path does not start with metadata/.`);
  }

  if (kind === "file" && !path.startsWith("files/")) {
    issues.push(`${label} is a file but path does not start with files/.`);
  }

  return {
    path,
    fileName,
    backupEntry,
    kind,
    sha256,
    size,
    cloudFileId,
    updatedAt,
  };
}

export function parseDriveSyncManifest(value: unknown) {
  const issues: string[] = [];

  if (!isRecord(value)) {
    return { manifest: null, issues: ["The Drive manifest is not a JSON object."] };
  }

  driveManifest.requiredFields.forEach((field) => {
    if (!(field in value)) {
      issues.push(`Manifest is missing ${field}.`);
    }
  });

  const schemaVersion = readNumber(value, "schemaVersion", issues, "Manifest");
  const cloudVersion = readNumber(value, "cloudVersion", issues, "Manifest");
  const storage = readString(value, "storage", issues, "Manifest");
  const layout = readString(value, "layout", issues, "Manifest");
  const rawEntries = Array.isArray(value.entries) ? value.entries : [];

  if (!Array.isArray(value.entries)) {
    issues.push("Manifest entries is missing or is not an array.");
  }

  if (schemaVersion !== driveManifest.schemaVersion) {
    issues.push(`Manifest schemaVersion should be ${driveManifest.schemaVersion}.`);
  }

  if (storage !== driveManifest.storage) {
    issues.push(`Manifest storage should be ${driveManifest.storage}.`);
  }

  const entries = rawEntries.flatMap((entry, index) => {
    const normalized = normalizeEntry(entry, index, issues);
    return normalized ? [normalized] : [];
  });

  if (entries.length === 0) {
    issues.push("Manifest does not contain any restore entries.");
  }

  return {
    manifest: {
      schemaVersion,
      cloudVersion,
      storage,
      layout,
      entries,
    },
    issues,
  };
}

function sumEntryBytes(entries: DriveSyncManifestEntry[]) {
  return entries.reduce((total, entry) => total + Math.max(entry.size, 0), 0);
}

function buildMetadataNameSet(entries: DriveSyncManifestEntry[]) {
  return new Set(
    entries
      .filter((entry) => entry.kind === "metadata")
      .flatMap((entry) => [entry.fileName, entry.backupEntry, entry.path.replace(/^metadata\//, "")])
      .filter(Boolean),
  );
}

export function buildDriveManifestPreview(manifest: DriveSyncManifest, issues: string[] = []): DriveManifestPreview {
  const metadataEntries = manifest.entries.filter((entry) => entry.kind === "metadata");
  const fileEntries = manifest.entries.filter((entry) => entry.kind === "file");
  const metadataNameSet = buildMetadataNameSet(metadataEntries);
  const requiredMetadata = metadataFiles.filter((file) => file.required);
  const missingRequiredMetadata = requiredMetadata.filter((file) => !metadataNameSet.has(file.fileName)).map((file) => file.fileName);

  return {
    manifest,
    issues,
    counts: {
      totalEntries: manifest.entries.length,
      metadataEntries: metadataEntries.length,
      fileEntries: fileEntries.length,
      requiredMetadataPresent: requiredMetadata.length - missingRequiredMetadata.length,
      requiredMetadataTotal: requiredMetadata.length,
    },
    totalBytes: sumEntryBytes(manifest.entries),
    metadataBytes: sumEntryBytes(metadataEntries),
    fileBytes: sumEntryBytes(fileEntries),
    missingRequiredMetadata,
    groups: restoreDataGroups.map((group) => {
      const missing = group.files.filter((fileName) => !metadataNameSet.has(fileName));
      return {
        label: group.label,
        total: group.files.length,
        present: group.files.length - missing.length,
        missing,
      };
    }),
  };
}

export function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
