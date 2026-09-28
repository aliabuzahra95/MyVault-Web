import type { BackupRecordChange } from "./incrementalBackup";
import type { DriveSyncManifestEntry } from "./driveManifestPreview";

export const BACKUP_BINARY_READER_CAPABILITY = "checkpoint-delta-binaries-v1";
export type BackupBinaryDescriptor = { attachmentId: string; cloudFileId: string; sha256: string; size: number };

export function parseBackupBinary(value: unknown): BackupBinaryDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid binary descriptor.");
  const binary = value as BackupBinaryDescriptor;
  if (typeof binary.attachmentId !== "string" || !binary.attachmentId.trim() || binary.attachmentId.length > 256
    || binary.attachmentId === "." || binary.attachmentId === ".." || /[/\\\u0000-\u001f]/.test(binary.attachmentId)
    || typeof binary.cloudFileId !== "string" || !binary.cloudFileId.trim() || binary.cloudFileId.length > 256
    || typeof binary.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(binary.sha256)
    || !Number.isSafeInteger(binary.size) || binary.size < 0) throw new Error("Invalid binary descriptor identity, checksum or byte count.");
  return { attachmentId: binary.attachmentId, cloudFileId: binary.cloudFileId, sha256: binary.sha256, size: binary.size };
}

function validateReference(row: Record<string, unknown>, binary?: BackupBinaryDescriptor) {
  const entry = "fileEntry" in row ? row.fileEntry : `files/${row.id}`;
  if (entry === "") {
    if (binary) throw new Error("A retained binary cannot silently become a missing file.");
    return;
  }
  if (entry !== `files/${row.id}` || !binary || binary.attachmentId !== row.id)
    throw new Error("Attachment has no valid binary descriptor.");
  if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes !== binary.size)
    throw new Error("Attachment metadata and binary byte count differ.");
}

export function parseBackupBinaries(version: number, value: unknown, changes: BackupRecordChange[]): BackupBinaryDescriptor[] {
  if (version === 1) {
    if (value !== undefined) throw new Error("Binary descriptors require the new reader capability.");
    return [];
  }
  if (!Array.isArray(value) || value.length > changes.length) throw new Error("Invalid or unbound binary descriptors.");
  const seen = new Set<string>();
  return value.map((item) => {
    const binary = parseBackupBinary(item);
    if (seen.has(binary.attachmentId)) throw new Error("Duplicate binary descriptor.");
    seen.add(binary.attachmentId);
    const change = changes.find((item) => item.file === "attachments.json" && item.key[0] === binary.attachmentId);
    if (!change || change.operation !== "upsert") throw new Error("Binary descriptor requires its attachment upsert.");
    validateReference(change.value!, binary);
    return binary;
  });
}

export function checkpointBinaryDescriptors(entries: DriveSyncManifestEntry[]): BackupBinaryDescriptor[] {
  return entries.filter((entry) => entry.kind === "file").map((entry) => {
    if (!entry.backupEntry.startsWith("files/")) throw new Error("Invalid checkpoint binary path.");
    return parseBackupBinary({ attachmentId: entry.backupEntry.slice(6), cloudFileId: entry.cloudFileId, sha256: entry.sha256, size: entry.size });
  });
}

export function binaryManifestEntry(binary: BackupBinaryDescriptor): DriveSyncManifestEntry {
  return { path: `files/${binary.attachmentId}`, backupEntry: `files/${binary.attachmentId}`, fileName: binary.attachmentId,
    kind: "file", cloudFileId: binary.cloudFileId, sha256: binary.sha256, size: binary.size, updatedAt: null };
}

export async function verifyBackupBinaryBlob(blob: Blob, descriptor: Pick<BackupBinaryDescriptor, "size" | "sha256">) {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (blob.size !== descriptor.size || sha256 !== descriptor.sha256)
    throw new Error("Attachment binary verification failed. Checkpoint fallback is forbidden.");
}

export class BackupBinaryResolution {
  private mappings = new Map<string, BackupBinaryDescriptor>();
  private objects = new Map<string, string>();

  constructor(checkpoint: BackupBinaryDescriptor[]) {
    checkpoint.forEach((value) => {
      const binary = parseBackupBinary(value);
      if (this.mappings.has(binary.attachmentId)) throw new Error("Duplicate checkpoint attachment binary.");
      this.mappings.set(binary.attachmentId, binary);
      this.remember(binary);
    });
  }

  private remember(binary: BackupBinaryDescriptor) {
    const identity = `${binary.sha256}:${binary.size}`;
    const previous = this.objects.get(binary.cloudFileId);
    if (previous && previous !== identity) throw new Error("Immutable Drive object has conflicting byte identities.");
    this.objects.set(binary.cloudFileId, identity);
  }

  apply(changes: BackupRecordChange[], binaries: BackupBinaryDescriptor[]) {
    const replacements = new Map(binaries.map((binary) => [binary.attachmentId, binary]));
    binaries.forEach((binary) => this.remember(binary));
    changes.filter((change) => change.file === "attachments.json").forEach((change) => {
      const id = change.key[0];
      if (change.operation === "delete") this.mappings.delete(id);
      else {
        const resolved = replacements.get(id) ?? this.mappings.get(id);
        validateReference(change.value!, resolved);
        if (resolved) this.mappings.set(id, resolved);
      }
    });
  }

  finish(files: Record<string, unknown>): BackupBinaryDescriptor[] {
    const rows = files["attachments.json"] ?? [];
    if (!Array.isArray(rows)) throw new Error("Invalid attachment metadata.");
    rows.forEach((row) => validateReference(row, this.mappings.get(row.id)));
    return [...this.mappings.values()];
  }
}
