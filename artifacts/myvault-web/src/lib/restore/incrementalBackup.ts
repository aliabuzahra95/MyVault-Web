import type { DriveSyncManifest } from "./driveManifestPreview";

// Reader support ships first. Publication must stay off until the coordinated release is accepted.
export const INCREMENTAL_BACKUP_PUBLICATION_ENABLED = false;
export const backupRecordKeys: Record<string, string[]> = {
  "folders.json": ["id"], "notes.json": ["id"], "blocks.json": ["id"], "tags.json": ["name"],
  "note_tags.json": ["noteId", "tagName"], "note_tables.json": ["id"], "note_versions.json": ["id"],
  "attachments.json": ["id"], "folder_sticky_notes.json": ["id"], "courses.json": ["id"],
  "course_concept_cards.json": ["id"], "course_folders.json": ["id"], "course_notes.json": ["id"],
  "course_sticky_notes.json": ["id"], "pdf_reading_progress.json": ["attachmentId"],
  "pdf_annotations.json": ["id"], "pdf_annotation_geometry.json": ["annotationId", "orderIndex"],
  "source_backlinks.json": ["id"], "knowledge_tags.json": ["id"],
  "knowledge_tag_links.json": ["tagId", "targetType", "targetId"],
};
export type BackupRecordChange = {
  file: string; key: string[]; operation: "upsert" | "delete"; value?: Record<string, unknown>;
};
export type BackupDelta = {
  format: "myvault-backup-delta"; version: 1; checkpointId: string; parentId: string; deltaId: string;
  changes: BackupRecordChange[];
};
export type BackupDeltaDescriptor = { deltaId: string; parentId: string; cloudFileId: string; size: number; sha256: string };
export type IncrementalBackup = {
  version: 1; requiredReader: "checkpoint-delta-v1"; checkpointId: string; headId: string; deltas: BackupDeltaDescriptor[];
};

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid backup object.");
}
function id(value: unknown): asserts value is string {
  requireValid(typeof value === "string" && value.trim().length > 0 && value.length <= 256, "Invalid backup state ID.");
}

export function incrementalBackup(manifest: DriveSyncManifest): IncrementalBackup | null {
  if (!("incrementalBackup" in manifest)) return null;
  const extension = manifest.incrementalBackup;
  object(extension);
  requireValid(extension.version === 1 && extension.requiredReader === "checkpoint-delta-v1", "Unsupported incremental backup capability.");
  id(extension.checkpointId); id(extension.headId);
  requireValid(Array.isArray(extension.deltas) && extension.deltas.length <= 4096, "Invalid backup delta chain length.");
  let parent: string = extension.checkpointId;
  const seen = new Set([parent]);
  extension.deltas.forEach((descriptor: unknown) => {
    object(descriptor); id(descriptor.deltaId);
    requireValid(!seen.has(descriptor.deltaId) && descriptor.parentId === parent, "Broken or duplicate backup delta ancestry.");
    requireValid(typeof descriptor.cloudFileId === "string" && descriptor.cloudFileId.trim(), "Backup delta has no Drive object ID.");
    requireValid(typeof descriptor.size === "number" && Number.isSafeInteger(descriptor.size)
      && descriptor.size > 0 && descriptor.size <= 16 * 1024 * 1024, "Invalid backup delta size.");
    requireValid(typeof descriptor.sha256 === "string" && /^[a-f0-9]{64}$/.test(descriptor.sha256), "Invalid backup delta checksum.");
    seen.add(descriptor.deltaId); parent = descriptor.deltaId;
  });
  requireValid(parent === extension.headId, "Backup head does not match its delta chain.");
  return extension as IncrementalBackup;
}

export function backupRecordKey(file: string, row: Record<string, unknown>): string[] {
  if (file === "settings.json") return ["settings"];
  const fields = backupRecordKeys[file];
  requireValid(fields, `Unsupported backup record type: ${file}`);
  return fields.map((field) => {
    const value = row[field];
    requireValid((typeof value === "string" && value.trim().length > 0)
      || (field === "orderIndex" && typeof value === "number" && Number.isSafeInteger(value)), "Invalid stable backup record ID.");
    return String(value);
  });
}

export function parseBackupDelta(value: unknown): BackupDelta {
  object(value);
  requireValid(value.format === "myvault-backup-delta" && value.version === 1, "Unsupported backup delta.");
  id(value.checkpointId); id(value.parentId); id(value.deltaId);
  requireValid(value.deltaId !== value.parentId && value.deltaId !== value.checkpointId, "Delta ID must be new.");
  requireValid(Array.isArray(value.changes) && value.changes.length > 0 && value.changes.length <= 100_000, "Invalid backup change count.");
  const seen = new Set<string>();
  for (const change of value.changes) {
    object(change);
    requireValid(typeof change.file === "string", "Invalid backup record file.");
    const fields = change.file === "settings.json" ? ["settings"] : backupRecordKeys[change.file];
    requireValid(fields && Array.isArray(change.key) && change.key.length === fields.length
      && change.key.every((part: unknown) => typeof part === "string" && part.trim()), "Invalid backup record key.");
    const token = `${change.file}:${JSON.stringify(change.key)}`;
    requireValid(!seen.has(token), "Duplicate changes for the same backup record.");
    seen.add(token);
    if (change.operation === "delete") {
      requireValid(change.file !== "settings.json" && !("value" in change), "Invalid permanent deletion.");
    } else {
      requireValid(change.operation === "upsert", "Unsupported backup change operation.");
      object(change.value);
      requireValid(JSON.stringify(change.key) === JSON.stringify(backupRecordKey(change.file, change.value)), "Backup payload ID differs from its change ID.");
    }
  }
  return value as BackupDelta;
}

export function createBackupDelta(checkpointId: string, parentId: string, deltaId: string, changes: BackupRecordChange[]): BackupDelta {
  const delta = parseBackupDelta({ format: "myvault-backup-delta", version: 1, checkpointId, parentId, deltaId, changes: structuredClone(changes) });
  requireValid(new TextEncoder().encode(JSON.stringify(delta)).byteLength <= 16 * 1024 * 1024, "Backup delta is too large.");
  return delta;
}

export async function backupBytesSha256(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function appendBackupDelta(manifest: DriveSyncManifest, delta: BackupDelta, cloudFileId: string, cloudVersion: number): Promise<DriveSyncManifest> {
  parseBackupDelta(delta);
  const previous = incrementalBackup(manifest);
  const checkpointId = previous?.checkpointId ?? delta.checkpointId;
  const parentId = previous?.headId ?? checkpointId;
  requireValid(delta.checkpointId === checkpointId && delta.parentId === parentId, "Delta does not extend this backup.");
  requireValid(Number.isSafeInteger(cloudVersion) && cloudVersion > manifest.cloudVersion, "Backup version must advance.");
  const bytes = new TextEncoder().encode(JSON.stringify(delta));
  const result: DriveSyncManifest = { ...structuredClone(manifest), cloudVersion, incrementalBackup: {
    version: 1, requiredReader: "checkpoint-delta-v1", checkpointId, headId: delta.deltaId,
    deltas: [...(previous?.deltas ?? []), { deltaId: delta.deltaId, parentId, cloudFileId, size: bytes.byteLength, sha256: await backupBytesSha256(bytes) }],
  } satisfies IncrementalBackup };
  incrementalBackup(result);
  return result;
}

export function backupDeltasAfter(extension: IncrementalBackup, appliedHead: string): BackupDeltaDescriptor[] | null {
  incrementalBackup({ incrementalBackup: extension } as unknown as DriveSyncManifest);
  if (appliedHead === extension.checkpointId) return extension.deltas;
  const index = extension.deltas.findIndex((delta) => delta.deltaId === appliedHead);
  return index < 0 ? null : extension.deltas.slice(index + 1);
}

export async function reconstructIncrementalBackup(
  checkpoint: Record<string, unknown>, extension: IncrementalBackup | null,
  load: (descriptor: BackupDeltaDescriptor) => Promise<Uint8Array>,
): Promise<{ files: Record<string, unknown>; permanentDeletions: BackupRecordChange[]; headId: string | null }> {
  if (!extension) return { files: structuredClone(checkpoint), permanentDeletions: [], headId: null };
  incrementalBackup({ incrementalBackup: extension } as unknown as DriveSyncManifest);
  const files = structuredClone(checkpoint);
  const deletions = new Map<string, BackupRecordChange>();
  for (const descriptor of extension.deltas) {
    const bytes = await load(descriptor);
    requireValid(bytes.byteLength === descriptor.size && await backupBytesSha256(bytes) === descriptor.sha256, "Backup delta byte verification failed. Nothing may be restored.");
    const delta = parseBackupDelta(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    requireValid(delta.checkpointId === extension.checkpointId && delta.deltaId === descriptor.deltaId
      && delta.parentId === descriptor.parentId, "Delta content does not match its committed ancestry.");
    const byFile = new Map<string, BackupRecordChange[]>();
    delta.changes.forEach((change) => byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]));
    for (const [file, changes] of byFile) {
      if (file === "settings.json") {
        files[file] = changes[0].value;
        continue;
      }
      const rows = files[file] ?? [];
      requireValid(Array.isArray(rows), "Checkpoint metadata is not an array.");
      const indexed = new Map<string, Record<string, unknown>>();
      rows.forEach((row: unknown) => {
        object(row);
        const key = JSON.stringify(backupRecordKey(file, row));
        requireValid(!indexed.has(key), "Duplicate checkpoint record ID.");
        indexed.set(key, row);
      });
      for (const change of changes) {
        const key = JSON.stringify(change.key);
        const token = `${file}:${key}`;
        if (change.operation === "delete") { indexed.delete(key); deletions.set(token, change); }
        else { indexed.set(key, change.value!); deletions.delete(token); }
      }
      files[file] = [...indexed.values()];
    }
  }
  return { files, permanentDeletions: [...deletions.values()], headId: extension.headId };
}
