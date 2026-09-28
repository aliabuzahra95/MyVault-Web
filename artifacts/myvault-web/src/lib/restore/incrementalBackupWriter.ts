import type { DriveSyncManifest } from "./driveManifestPreview";
import {
  INCREMENTAL_BACKUP_PUBLICATION_ENABLED, appendBackupDelta, backupBytesSha256, incrementalBackup, parseBackupDelta,
  type BackupDelta, type BackupRecordChange,
} from "./incrementalBackup";

export type CommittedBackup = { id: string; text: string };
export type IncrementalBackupTransport = {
  readCommitted(): Promise<CommittedBackup>;
  createDelta(deltaId: string, bytes: Uint8Array): Promise<string>;
  readObject(id: string): Promise<Uint8Array>;
  preserve(previous: CommittedBackup): Promise<void>;
  commit(previous: CommittedBackup, text: string): Promise<void>;
};
function same(first: CommittedBackup, second: CommittedBackup) { return first.id === second.id && first.text === second.text; }
function sameBytes(first: Uint8Array, second: Uint8Array) { return first.length === second.length && first.every((value, index) => value === second[index]); }
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function publishIncrementalBackup(transport: IncrementalBackupTransport, previous: CommittedBackup, delta: BackupDelta | null) {
  check(INCREMENTAL_BACKUP_PUBLICATION_ENABLED, "Incremental backup publication is disabled pending coordinated release acceptance.");
  return publishVerifiedBackupDelta(transport, previous, delta);
}

/** Transport protocol used by the acceptance fixtures, not connected to the Backup UI yet. */
export async function publishVerifiedBackupDelta(transport: IncrementalBackupTransport, previous: CommittedBackup, delta: BackupDelta | null): Promise<CommittedBackup> {
  if (!delta) return previous;
  parseBackupDelta(delta);
  const bytes = new TextEncoder().encode(JSON.stringify(delta));
  const observed = await transport.readCommitted();
  if (!same(observed, previous)) {
    const extension = incrementalBackup(JSON.parse(observed.text) as DriveSyncManifest);
    const head = extension?.deltas.at(-1);
    check(head?.deltaId === delta.deltaId && head.sha256 === await backupBytesSha256(bytes), "The selected backup changed. Nothing was published.");
    check(sameBytes(await transport.readObject(head.cloudFileId), bytes), "Committed delta verification failed.");
    return observed;
  }
  const parentManifest = JSON.parse(previous.text) as DriveSyncManifest;
  await appendBackupDelta(parentManifest, delta, "pending", parentManifest.cloudVersion + 1);
  const id = await transport.createDelta(delta.deltaId, bytes);
  check(sameBytes(await transport.readObject(id), bytes), "Uploaded delta verification failed. Previous backup remains committed.");
  await transport.preserve(previous);
  check(same(await transport.readCommitted(), previous), "The selected backup changed during upload. Nothing was published.");
  const candidate = JSON.stringify(await appendBackupDelta(parentManifest, delta, id, parentManifest.cloudVersion + 1));
  try { await transport.commit(previous, candidate); }
  catch (error) { if (!same(await transport.readCommitted(), { id: previous.id, text: candidate })) throw error; }
  const committed = await transport.readCommitted();
  check(same(committed, { id: previous.id, text: candidate }), "Backup publication could not be confirmed.");
  return committed;
}

export function coalescedBackupChanges(changes: BackupRecordChange[]) {
  const result = new Map<string, BackupRecordChange>();
  changes.forEach((change) => result.set(`${change.file}:${JSON.stringify(change.key)}`, structuredClone(change)));
  return [...result.values()];
}
