import { GoogleDriveRequestError } from "@/lib/googleDrive/driveClient";
import { assertGoogleDriveSession, type VerifiedGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import { withAccountSyncLock } from "@/lib/sync/accountContext";
import type { DriveFileRecord } from "@/lib/googleDrive/driveClient";
import {
  downloadRecordSyncRevision, ensureRecordSyncFolder, findRecordSyncFolder,
  getRecordSyncChanges, getRecordSyncStartToken, listRecordSyncFiles, uploadRecordSyncRevision,
} from "./drive";
import { listLocalRecordSyncIds, localRecordSyncPayload } from "./localPayload";
import { canonicalJson, createRecordSyncRevision, RECORD_SYNC_DEBOUNCE_MS, sha256Hex,
  type RecordSyncNote, type RecordSyncRevision } from "./protocol";
import {
  acknowledgeRecordSyncPending, applyRecordSyncRevision, excludeRecordSyncPending,
  loadRecordSyncConflicts, loadRecordSyncControl, loadRecordSyncFile, loadRecordSyncHead,
  loadRecordSyncPending, loadRecordSyncPendingEntity, loadRecordSyncRecords,
  prepareRecordSyncPending, rememberRecordSyncFile, saveRecordSyncConflict,
  saveRecordSyncControl, seedRecordSyncPending, type RecordSyncControl,
} from "./store";

export type RecordSyncRunResult = { uploaded: number; incoming: number; excluded: number; conflicts: number };

function check(session: VerifiedGoogleDriveSession) {
  assertGoogleDriveSession(session.token, session.accountId);
}

async function applyOne(session: VerifiedGoogleDriveSession, file: DriveFileRecord, revision: RecordSyncRevision) {
  const accountId = session.accountId;
  if (await loadRecordSyncFile(file.id, accountId)) return false;
  const head = await loadRecordSyncHead(accountId, revision.entityType, revision.entityId);
  if (head?.revisionId === revision.revisionId) {
    await rememberRecordSyncFile(accountId, file.id, revision);
    return false;
  }
  const pending = await loadRecordSyncPendingEntity(accountId, revision.entityType, revision.entityId);
  const local = await localRecordSyncPayload(revision.entityType, revision.entityId);
  if (!revision.deleted && revision.entityType === "note") {
    const payload = JSON.parse(revision.payloadJson!) as { blocks?: Array<{ type?: string }> };
    if (!Array.isArray(payload.blocks) || payload.blocks.some((block) => block.type === "image" || block.type === "attachment")) {
      throw new Error("An incoming note references unsupported binary blocks; no local data was changed.");
    }
  }
  const sameLocal = local.payload !== null && await sha256Hex(canonicalJson(local.payload)) === revision.contentHash;
  const sameDeletion = local.exists && local.deleted && revision.deleted;
  const safeForward = head !== null && revision.parents.includes(head.revisionId) && !pending;
  const fresh = head === null && !local.exists && !pending;
  const adoption = head === null && (sameLocal || sameDeletion) && !pending;
  if (local.excludedReason || (!safeForward && !fresh && !adoption)) {
    check(session);
    await saveRecordSyncConflict({
      accountId, entityType: revision.entityType, entityId: revision.entityId,
      remoteRevisionId: revision.revisionId, localRevisionId: head?.revisionId ?? null,
      remotePayloadJson: revision.payloadJson, remoteDeleted: revision.deleted,
      createdAt: Date.now(), resolvedAt: null,
    });
    await rememberRecordSyncFile(accountId, file.id, revision);
    return true;
  }
  check(session);
  await applyRecordSyncRevision(accountId, file.id, revision);
  return true;
}

async function applyBatch(session: VerifiedGoogleDriveSession, files: DriveFileRecord[]) {
  const downloaded = await Promise.all(files.map(async (file) => ({ file, revision: await downloadRecordSyncRevision(session.token.accessToken, file) })));
  const remaining = downloaded.filter(({ file }) => Boolean(file.id));
  let applied = 0;
  while (remaining.length) {
    const index = remaining.findIndex(({ revision }) => revision.parents.every((parent) =>
      !remaining.some((candidate) => candidate.revision.revisionId === parent)));
    if (index < 0) throw new Error("Sync revisions contain an ancestry cycle. Local data was preserved.");
    const [{ file, revision }] = remaining.splice(index, 1);
    if (await applyOne(session, file, revision)) applied += 1;
  }
  return applied;
}

async function pull(session: VerifiedGoogleDriveSession, folderId: string, startToken: string) {
  let token = startToken;
  const files = new Map<string, DriveFileRecord>();
  while (true) {
    check(session);
    const page = await getRecordSyncChanges(session.token.accessToken, token);
    for (const change of page.changes) {
      if (change.removed) {
        if (await loadRecordSyncFile(change.fileId, session.accountId))
          throw new Error("A sync revision disappeared from Drive. This is not treated as a note deletion.");
      } else if (change.file?.parents?.includes(folderId)) files.set(change.fileId, change.file);
      else if (await loadRecordSyncFile(change.fileId, session.accountId))
        throw new Error("A known sync revision moved out of its folder. Local data was preserved.");
    }
    if (page.nextPageToken) { token = page.nextPageToken; continue; }
    const incoming = await applyBatch(session, [...files.values()]);
    check(session);
    const control = await loadRecordSyncControl(session.accountId);
    if (!control || !control.enabled) throw new Error("Automatic Sync was disabled during the Drive check.");
    await saveRecordSyncControl({ ...control, cursor: page.newStartPageToken ?? token });
    return incoming;
  }
}

async function relistAfterExpiredCursor(session: VerifiedGoogleDriveSession, folderId: string) {
  const start = await getRecordSyncStartToken(session.token.accessToken);
  const files = await listRecordSyncFiles(session.token.accessToken, folderId);
  const incoming = await applyBatch(session, files);
  return incoming + await pull(session, folderId, start);
}

async function publish(session: VerifiedGoogleDriveSession, folderId: string, force: boolean) {
  const control = await loadRecordSyncControl(session.accountId);
  if (!control?.enabled || control.paused) return 0;
  const conflicts = await loadRecordSyncConflicts(session.accountId);
  const conflicted = new Set(conflicts.filter((item) => item.resolvedAt === null).map((item) => `${item.entityType}:${item.entityId}`));
  const pending = (await loadRecordSyncPending(session.accountId))
    .sort((a, b) => Number(a.entityType === "note") - Number(b.entityType === "note") || a.changedAt - b.changedAt);
  let uploaded = 0;
  for (const item of pending) {
    if (item.excludedReason || conflicted.has(`${item.entityType}:${item.entityId}`)) continue;
    if (!force && Date.now() - item.changedAt < RECORD_SYNC_DEBOUNCE_MS) continue;
    const local = await localRecordSyncPayload(item.entityType, item.entityId);
    if (local.excludedReason) { await excludeRecordSyncPending(item, local.excludedReason); continue; }
    const notePayload = item.entityType === "note" ? local.payload as RecordSyncNote | null : null;
    const revision = item.prepared ?? await createRecordSyncRevision({
      entityType: item.entityType, entityId: item.entityId, clientId: control.clientId,
      parents: item.baseRevisionId ? [item.baseRevisionId] : [], payload: local.payload,
      dependencies: notePayload
        ? [notePayload.folderId && `folder:${notePayload.folderId}`,
          notePayload.parentNoteId && `note:${notePayload.parentNoteId}`].filter((value): value is string => Boolean(value))
        : [],
    });
    if (!item.prepared && !(await prepareRecordSyncPending(item, revision))) continue;
    check(session);
    const file = await uploadRecordSyncRevision(session.token.accessToken, folderId, revision);
    check(session);
    await acknowledgeRecordSyncPending(session.accountId, file.id, revision, item.generation);
    uploaded += 1;
  }
  return uploaded;
}

export async function enrolRecordSync(session: VerifiedGoogleDriveSession): Promise<RecordSyncRunResult> {
  return withAccountSyncLock(session.accountId, async () => {
    check(session);
    const previous = await loadRecordSyncControl(session.accountId);
    if (previous?.restoreReconciliationRequired) {
      throw new Error("Automatic Sync remains paused after Restore. Review and reconcile the restored notes before enabling outbound sync.");
    }
    const control: RecordSyncControl = {
      accountId: session.accountId, clientId: previous?.clientId ?? crypto.randomUUID(),
      enabled: true, paused: true, cursor: previous?.cursor ?? null,
    };
    await saveRecordSyncControl(control);
    const start = await getRecordSyncStartToken(session.token.accessToken);
    const folderId = await ensureRecordSyncFolder(session.token.accessToken);
    const listed = await listRecordSyncFiles(session.token.accessToken, folderId);
    let incoming = await applyBatch(session, listed);
    for (const entity of await listLocalRecordSyncIds()) {
      if (!(await loadRecordSyncHead(session.accountId, entity.entityType, entity.entityId)))
        await seedRecordSyncPending(session.accountId, entity.entityType, entity.entityId);
    }
    incoming += await pull(session, folderId, start);
    const latest = await loadRecordSyncControl(session.accountId);
    await saveRecordSyncControl({ ...latest!, paused: false });
    const pending = await loadRecordSyncPending(session.accountId);
    return { uploaded: 0, incoming, excluded: pending.filter((item) => item.excludedReason).length,
      conflicts: (await loadRecordSyncConflicts(session.accountId)).filter((item) => item.resolvedAt === null).length };
  });
}

export async function runRecordSync(session: VerifiedGoogleDriveSession, force = false): Promise<RecordSyncRunResult> {
  return withAccountSyncLock(session.accountId, async () => {
    check(session);
    const control = await loadRecordSyncControl(session.accountId);
    if (!control?.enabled || control.paused) return { uploaded: 0, incoming: 0, excluded: 0, conflicts: 0 };
    if (!control.cursor) throw new Error("Automatic Sync has no Drive cursor. Re-enrol before publishing.");
    const folderId = await findRecordSyncFolder(session.token.accessToken);
    if (!folderId) throw new Error("The Automatic Sync folder is missing. Local data was preserved.");
    let incoming: number;
    try { incoming = await pull(session, folderId, control.cursor); }
    catch (error) {
      if (!(error instanceof GoogleDriveRequestError) || error.status !== 410) throw error;
      incoming = await relistAfterExpiredCursor(session, folderId);
    }
    const uploaded = await publish(session, folderId, force);
    const pending = await loadRecordSyncPending(session.accountId);
    return { uploaded, incoming, excluded: pending.filter((item) => item.excludedReason).length,
      conflicts: (await loadRecordSyncConflicts(session.accountId)).filter((item) => item.resolvedAt === null).length };
  });
}

export async function pauseRecordSyncForRestore(accountId: string) {
  const control = await loadRecordSyncControl(accountId);
  if (control?.enabled) await saveRecordSyncControl({ ...control, enabled: false, paused: true, restoreReconciliationRequired: true });
}

export async function disableRecordSync(accountId: string) {
  const control = await loadRecordSyncControl(accountId);
  if (control) await saveRecordSyncControl({ ...control, enabled: false, paused: false });
}

export function currentRecordSyncRevisions(accountId: string) {
  return loadRecordSyncRecords(accountId);
}
