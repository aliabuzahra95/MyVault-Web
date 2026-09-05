import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  applyMetadataRestorePreservingLocalChangesAtomically,
  forkLocalNoteDraftAsRecoveredCopy,
  loadLocalSyncBase,
  loadPendingLocalSyncOperations,
  recoverUnsafelyRebasedLegacyNoteDrafts,
  loadLocalVaultGeneration,
  loadVerifiedWebPublication,
  saveLocalSyncConflict,
  type LocalSyncBase,
} from "@/lib/restore/localRestoreStore";
import {
  applyPreparedFiles,
  buildSyncPreflight,
  loadSyncPendingChanges,
  type SyncPendingChanges,
  type SyncPreflight,
} from "@/lib/sync/syncPreflight";
import { computeBundleRevision } from "@/lib/sync/revision";
import { reconcileMetadataBundles, type ThreeWayConflict } from "@/lib/sync/threeWayMerge";

export class SafePullConflictError extends Error {
  constructor(readonly conflicts: ThreeWayConflict[]) {
    super("Android and MyVault Web changed the same item. Both versions were preserved and the Drive backup was not applied over the website edit.");
    this.name = "SafePullConflictError";
  }
}

export class SafePullBlockedError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? "Website changes could not be reconciled safely with the latest Drive backup.");
    this.name = "SafePullBlockedError";
  }
}

export type SafePullResult = {
  preservedLocalChanges: boolean;
  preservedExistingBase: boolean;
  mergedRemoteChanges: number;
  mergedWebsiteChanges: number;
  recoveredConflictCopies: number;
  reconciledBundle: MetadataRestoreBundle;
  reconciledOperationIds: string[];
  reconciledPendingChanges: SyncPendingChanges;
  reconciledPreflight: SyncPreflight | null;
  localGeneration: number;
};

function recordNoteId(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const noteId = (value as Record<string, unknown>).noteId;
  return typeof noteId === "string" ? noteId : null;
}

function noteIdForConflict(conflict: ThreeWayConflict) {
  if (conflict.fileName === "notes.json") return conflict.entityId;
  if (conflict.fileName !== "blocks.json") return null;
  return recordNoteId(conflict.webValue) ?? recordNoteId(conflict.baseValue) ?? recordNoteId(conflict.remoteValue);
}

async function saveConflictRecords({
  conflicts,
  existingBase,
  incoming,
  nextBase,
  operations,
  resolution,
}: {
  conflicts: ThreeWayConflict[];
  existingBase: LocalSyncBase;
  incoming: MetadataRestoreBundle;
  nextBase: LocalSyncBase;
  operations: Awaited<ReturnType<typeof loadPendingLocalSyncOperations>>;
  resolution: "keep-both" | null;
}) {
  const remoteRevision = await computeBundleRevision(incoming);
  const operationIds = operations.map((operation) => operation.id);
  const now = new Date().toISOString();
  await Promise.all(conflicts.map((conflict) => saveLocalSyncConflict({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    accountId: nextBase.accountId,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    kind: conflict.kind,
    baseRevisionId: existingBase.revision.revisionId,
    remoteRevisionId: remoteRevision.revisionId,
    operationIds,
    createdAt: now,
    resolvedAt: resolution ? now : null,
    resolution,
    fileName: conflict.fileName,
    fieldNames: conflict.fieldNames,
    baseValue: conflict.baseValue,
    webValue: conflict.webValue,
    remoteValue: conflict.remoteValue,
  })));
}

export async function applyIncomingDriveBundleSafely(
  incoming: MetadataRestoreBundle,
  nextBase: LocalSyncBase,
  allowRecoveredCopy = true,
): Promise<SafePullResult> {
  let existingBase = await loadLocalSyncBase();
  const publication = await loadVerifiedWebPublication();
  if (publication?.base.accountId === nextBase.accountId && publication.previousBaseRevisionId === (existingBase?.revision.revisionId ?? null)) {
    // This is our own read-back-verified publication, not an inferred remote
    // ancestor. Later browser edits descend from that uploaded local snapshot.
    const generation = await loadLocalVaultGeneration();
    await applyMetadataRestorePreservingLocalChangesAtomically(publication.base.bundle, publication.base, generation);
    existingBase = publication.base;
  }
  if (existingBase?.accountId === nextBase.accountId) {
    await recoverUnsafelyRebasedLegacyNoteDrafts(existingBase);
  }
  const generation = await loadLocalVaultGeneration();
  const [pending, operations] = await Promise.all([
    loadSyncPendingChanges(),
    loadPendingLocalSyncOperations(),
  ]);
  if (await loadLocalVaultGeneration() !== generation) throw new SafePullBlockedError(["Website changes arrived during reconciliation. The incoming backup is staged; try again after saving."]);
  const pendingCount = Object.entries(pending)
    .filter(([key]) => key !== "attachmentBlobs")
    .reduce((total, [, value]) => total + (Array.isArray(value) ? value.length : 0), 0);

  if (pendingCount === 0 && operations.length === 0) {
    const result = await applyMetadataRestorePreservingLocalChangesAtomically(incoming, nextBase, generation);
    return {
      ...result,
      mergedRemoteChanges: 0,
      mergedWebsiteChanges: 0,
      recoveredConflictCopies: 0,
      reconciledBundle: incoming,
      reconciledOperationIds: [],
      reconciledPendingChanges: pending,
      reconciledPreflight: null,
    };
  }

  if (!existingBase || existingBase.accountId !== nextBase.accountId) {
    throw new SafePullBlockedError([
      "The website has local changes but their immutable synchronization base is unavailable. Nothing was replaced.",
    ]);
  }

  const preflight = buildSyncPreflight(existingBase.bundle, pending, existingBase.revision.revisionId);
  if (preflight.status === "blocked") throw new SafePullBlockedError(preflight.blockers);
  const website = applyPreparedFiles(existingBase.bundle, preflight.preparedFiles);
  const touchedFiles = new Set(preflight.touchedFiles.map((file) => file.fileName));
  const merge = reconcileMetadataBundles({
    base: existingBase.bundle,
    web: website,
    remote: incoming,
    touchedFiles,
  });

  if (merge.conflicts.length) {
    const conflictingNoteIds = new Set(merge.conflicts.map(noteIdForConflict).filter((noteId): noteId is string => Boolean(noteId)));
    const canKeepBothAsNotes = allowRecoveredCopy && conflictingNoteIds.size > 0 &&
      merge.conflicts.every((conflict) => noteIdForConflict(conflict) !== null);
    if (canKeepBothAsNotes) {
      const recoveredIds = (await Promise.all(
        [...conflictingNoteIds].map((noteId) => forkLocalNoteDraftAsRecoveredCopy(noteId, nextBase, "Website conflict copy")),
      )).filter((id): id is string => Boolean(id));
      if (recoveredIds.length === conflictingNoteIds.size) {
        await saveConflictRecords({ conflicts: merge.conflicts, existingBase, incoming, nextBase, operations, resolution: "keep-both" });
        const retried = await applyIncomingDriveBundleSafely(incoming, nextBase, false);
        return { ...retried, recoveredConflictCopies: retried.recoveredConflictCopies + recoveredIds.length };
      }
    }
    await saveConflictRecords({ conflicts: merge.conflicts, existingBase, incoming, nextBase, operations, resolution: null });
    throw new SafePullConflictError(merge.conflicts);
  }

  const result = await applyMetadataRestorePreservingLocalChangesAtomically(incoming, nextBase, generation);
  return {
    ...result,
    mergedRemoteChanges: merge.remoteEntityCount + merge.mergedEntityCount,
    mergedWebsiteChanges: merge.webEntityCount + merge.mergedEntityCount,
    recoveredConflictCopies: 0,
    reconciledBundle: merge.bundle,
    reconciledOperationIds: operations.map((operation) => operation.id),
    reconciledPendingChanges: pending,
    reconciledPreflight: preflight,
  };
}
