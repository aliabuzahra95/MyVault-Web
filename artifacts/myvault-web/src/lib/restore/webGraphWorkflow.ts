import { BackupGraph, BACKUP_GRAPH_CAPABILITY, encodeGraphCommit, parseGraphCommit, verifyGraphObject, readBackupGraphCheckpoint,
  type BackupGraphCommit, type GraphObject, type GraphObjectRef } from "./backupGraph";
import { backupBytesSha256, backupRecordKey, backupRecordKeys, createBackupDelta, parseBackupDelta,
  type BackupRecordChange, type BackupDelta } from "./incrementalBackup";
import { BACKUP_BINARY_READER_CAPABILITY, BackupBinaryResolution, binaryManifestEntry,
  checkpointBinaryDescriptors, verifyBackupBinaryBlob, type BackupBinaryDescriptor } from "./backupBinaryDescriptors";
import { buildMetadataRestoreBundle, type MetadataRestoreBundle } from "./metadataRestore";
import { type DriveSyncManifest } from "./driveManifestPreview";
import { captureWebGraphSnapshot, completeWebGraphOperation, loadStagedGraphObjects, loadWebGraphOperation,
  markGraphObjectVerified, pendingWebGraphOperations, stageWebGraphOperation,
  type StagedGraphObject, type WebGraphOperation, type WebGraphPosition, type WebGraphSnapshot } from "./webGraphStore";
import { ANDROID_BODY_BLOCK_TYPES, buildSyncPreflight, type SyncPendingChanges } from "../sync/syncPreflight";
import { canonicalJson } from "../sync/revision";
import { getActiveAccountId, withAccountSyncLock } from "../sync/accountContext";
import { withLocalVaultUpdate } from "../sync/editorLease";
import { validateSyncCandidate } from "../sync/validateSyncCandidate";

export const WEB_GRAPH_RESTORE_ENABLED = false;
export type WebGraphTransport = {
  accountId: string; lineageId: string;
  assertAccount(): void;
  commits(): Promise<GraphObject[]>;
  reserveIds(count: number): Promise<string[]>;
  read(id: string): Promise<Uint8Array | null>;
  create(id: string, role: StagedGraphObject["role"], bytes: Uint8Array): Promise<void>;
};
export type WebGraphMetrics = { pendingRows: number; payloadRows: number; binariesCreated: number; deltasCreated: number; commitsCreated: number };
export type WebGraphResult = { status: "ALREADY_CURRENT" | "COMPLETE"; commitId: string; metrics: WebGraphMetrics };
const emptyMetrics = (): WebGraphMetrics => ({ pendingRows: 0, payloadRows: 0, binariesCreated: 0, deltasCreated: 0, commitsCreated: 0 });
function requireSafe(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function checkAccount(store: WebGraphTransport) {
  store.assertAccount(); requireSafe(getActiveAccountId() === store.accountId, "The active Google account changed.");
}
function filesOf(bundle: MetadataRestoreBundle): Record<string, unknown> {
  return Object.fromEntries(bundle.files.map((f) => [f.fileName, f.json]));
}
function applyDelta(bundle: MetadataRestoreBundle, delta: BackupDelta, expectedParent: BackupGraphCommit) {
  requireSafe(delta.checkpointId === expectedParent.checkpoint.checkpointId
    && delta.parentId === (expectedParent.delta?.deltaId ?? expectedParent.checkpoint.checkpointId), "Delta does not extend the materialized local graph state.");
  const files = filesOf(bundle); const byFile = new Map<string, BackupRecordChange[]>();
  for (const change of delta.changes) byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]);
  for (const [file, changes] of byFile) {
    if (file === "settings.json") { files[file] = changes[0].value; continue; }
    const rows = files[file] ?? []; requireSafe(Array.isArray(rows), "Invalid local metadata array.");
    const indexed = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = JSON.stringify(backupRecordKey(file, row)); requireSafe(!indexed.has(key), "Duplicate local stable record key."); indexed.set(key, row);
    }
    for (const change of changes) {
      const key = JSON.stringify(change.key);
      if (change.operation === "delete") indexed.delete(key); else indexed.set(key, change.value!);
    }
    files[file] = [...indexed.values()];
  }
  const resolution = new BackupBinaryResolution(checkpointBinaryDescriptors(bundle.fileEntries ?? []));
  resolution.apply(delta.changes, delta.binaries ?? []);
  return { files, binaries: resolution.finish(files), permanentDeletions: delta.changes.filter((c) => c.operation === "delete") };
}
function bundleOf(files: Record<string, unknown>, binaries: BackupBinaryDescriptor[], cloudVersion: number, permanentDeletions: BackupRecordChange[], headId: string): MetadataRestoreBundle {
  const entries = [...Object.keys(files).map((fileName) => ({ path: `metadata/${fileName}`, fileName, backupEntry: fileName,
    kind: "metadata" as const, cloudFileId: "graph-logical-metadata", sha256: "", size: 0, updatedAt: null })), ...binaries.map(binaryManifestEntry)];
  const manifest = { schemaVersion: 1, storage: "google-drive-api", cloudVersion, entries } as DriveSyncManifest;
  const bundle = buildMetadataRestoreBundle(manifest, entries.filter((e) => e.kind === "metadata").map((entry) => ({ entry, json: files[entry.fileName] })));
  requireSafe(!bundle.issues.length, bundle.issues[0] ?? "Invalid graph metadata bundle.");
  const result: MetadataRestoreBundle = { ...bundle, fileEntries: binaries.map(binaryManifestEntry), binaryDescriptorsVerified: true,
    incrementalBackupState: { headId, permanentDeletions } };
  const validation = validateSyncCandidate(result);
  requireSafe(validation.valid, validation.issues[0] ?? "The graph candidate contains invalid record relationships.");
  return result;
}
function exactPosition(graph: BackupGraph, inventory: GraphObject[], position: WebGraphPosition) {
  requireSafe(canonicalJson(graph.commits.get(position.commit.commitId)) === canonicalJson(position.commit), "Local graph position is not in the verified graph.");
  requireSafe(inventory.some((o) => canonicalJson(o.objectRef) === canonicalJson(position.objectRef)), "Local immutable commit receipt differs.");
}
async function discovery(store: WebGraphTransport) {
  checkAccount(store); const inventory = await store.commits(); checkAccount(store);
  const graph = await BackupGraph.discover(inventory, store.accountId, store.lineageId);
  requireSafe(graph.status === "SINGLE_TIP", `Graph operation blocked: ${graph.status}`);
  return { graph, inventory };
}
async function object(store: WebGraphTransport, operationId: string, id: string, role: StagedGraphObject["role"], bytes: Uint8Array): Promise<StagedGraphObject> {
  return { operationId, accountId: store.accountId, role, objectRef: { cloudFileId: id, size: bytes.length, sha256: await backupBytesSha256(bytes) },
    bytes: new Blob([new Uint8Array(bytes)]), verified: false };
}
async function reserved(store: WebGraphTransport, count: number) {
  checkAccount(store); const ids = await store.reserveIds(count); checkAccount(store);
  requireSafe(ids.length === count && new Set(ids).size === count && ids.every((id) => id.trim() && id.length <= 256), "Invalid reserved immutable object IDs.");
  return ids;
}
async function requiredBytes(store: WebGraphTransport, ref: GraphObjectRef) {
  checkAccount(store); const bytes = await store.read(ref.cloudFileId); checkAccount(store);
  requireSafe(bytes, "A required immutable graph object is missing."); await verifyGraphObject(ref, bytes); return bytes;
}

/** Changes come from actual local overlay intents, never an inventory absence scan. */
export function pendingGraphChanges(snapshot: WebGraphSnapshot): { changes: BackupRecordChange[] } {
  requireSafe(snapshot.bundle, "A verified graph baseline is required before incremental capture.");
  const values = (store: string) => snapshot.overlays.filter((v) => v.store === store).map((v) => v.value);
  const pending = { noteDrafts: values("note-drafts"), createdFolders: values("created-folders"), createdNotes: values("created-notes"),
    createdAttachments: values("created-attachments"), pdfReaderStates: values("pdf-reader-state"), pdfAnnotationChanges: values("pdf-annotation-changes"),
    courses: values("created-courses"), courseFolders: values("created-course-folders"), courseStickyNotes: values("created-course-sticky-notes"),
    courseConcepts: values("created-course-concepts"), attachmentBlobs: Object.fromEntries(Object.keys(snapshot.blobs).map((id) => [id, true])),
  } as SyncPendingChanges;
  const preflight = buildSyncPreflight(snapshot.bundle, pending);
  requireSafe(preflight.status !== "blocked", preflight.blockers[0] ?? "Local changes require reconciliation.");
  const before = filesOf(snapshot.bundle); const changes: BackupRecordChange[] = [];
  const explicitDeletes: BackupRecordChange[] = [
    ...pending.pdfAnnotationChanges.filter((c) => c.operation === "delete").map((c) => ({ file: "pdf_annotations.json", key: [c.id], operation: "delete" as const })),
    ...pending.pdfReaderStates.filter((c) => c.deletedAt).map((c) => ({ file: "pdf_reading_progress.json", key: [c.attachmentId], operation: "delete" as const })),
  ];
  // Body replacement explicitly retires the old body block IDs, not arbitrary
  // absent rows. Every other unexplained removal is blocked rather than inferred.
  const editedNotes = new Set(pending.noteDrafts.map((d) => d.noteId));
  const oldBlocks = before["blocks.json"];
  const nextBlocks = preflight.preparedFiles["blocks.json"];
  if (Array.isArray(oldBlocks) && nextBlocks) {
    const kept = new Set(nextBlocks.map((row) => row.id));
    for (const row of oldBlocks) if (editedNotes.has(row.noteId) && ANDROID_BODY_BLOCK_TYPES.has(row.type) && !kept.has(row.id)) {
      explicitDeletes.push({ file: "blocks.json", key: [row.id], operation: "delete" });
    }
  }
  for (const [file, rows] of Object.entries(preflight.preparedFiles)) {
    const original = before[file] ?? []; requireSafe(Array.isArray(original), "Invalid graph record group.");
    const indexed = new Map(original.map((row) => [JSON.stringify(backupRecordKey(file, row)), row]));
    const keys = new Set<string>();
    for (const row of rows) {
      const key = backupRecordKey(file, row); const token = JSON.stringify(key); keys.add(token);
      if (canonicalJson(indexed.get(token)) !== canonicalJson(row)) changes.push({ file, key, operation: "upsert", value: row });
    }
    for (const token of indexed.keys()) requireSafe(keys.has(token)
      || explicitDeletes.some((d) => d.file === file && JSON.stringify(d.key) === token), "An unexplained missing row cannot become a deletion.");
  }
  changes.push(...explicitDeletes);
  return { changes };
}

export class InternalWebGraphWorkflow {
  constructor(private readonly store: WebGraphTransport, private readonly boundary: (phase: string) => Promise<void> = async () => {}) {}

  async publish(): Promise<WebGraphResult> {
    return withAccountSyncLock(this.store.accountId, async () => {
      checkAccount(this.store);
      const unfinished = await pendingWebGraphOperations(this.store.accountId);
      if (unfinished.length) {
        requireSafe(unfinished.length === 1 && unfinished[0].kind === "publish", "Recover the unfinished Restore before Backup.");
        return this.resume(unfinished[0].operationId);
      }
      const { graph, inventory } = await discovery(this.store);
      const snapshot = await captureWebGraphSnapshot(this.store.accountId, this.store.lineageId);
      requireSafe(snapshot.state?.trust === "VERIFIED", "Graph baseline trust was invalidated. Reconciliation is required.");
      const parent = snapshot.state?.applied ?? snapshot.state?.published;
      requireSafe(parent, "A verified first graph backup/Restore is required.");
      exactPosition(graph, inventory, parent);
      requireSafe(graph.tips[0] === parent.commit.commitId, "A newer backup exists. Restore or reconcile before Backup.");
      const metrics = emptyMetrics(); metrics.pendingRows = snapshot.operations.length; metrics.payloadRows = snapshot.payloadRowsRead;
      if (!snapshot.overlays.length && !snapshot.operations.length) return { status: "ALREADY_CURRENT", commitId: parent.commit.commitId, metrics };
      const { changes } = pendingGraphChanges(snapshot);
      // A journal intent that cannot be represented must not be silently acknowledged.
      requireSafe(changes.length > 0, "Pending local intents need reconciliation before they can be acknowledged.");
      const binaries = checkpointBinaryDescriptors(snapshot.bundle!.fileEntries ?? []);
      const descriptors: BackupBinaryDescriptor[] = [];
      const binaryBytes: Array<{ attachmentId: string; bytes: Uint8Array }> = [];
      for (const change of changes.filter((c) => c.file === "attachments.json" && c.operation === "upsert")) {
        const id = change.key[0]; const blob = snapshot.blobs[id]; const old = binaries.find((b) => b.attachmentId === id);
        if (!blob) { requireSafe(old || change.value!.fileEntry === "", "New/unknown attachment bytes require verification."); continue; }
        const fingerprint = snapshot.fingerprints[id];
        if (fingerprint && old && fingerprint.sha256 === old.sha256 && fingerprint.size === old.size) {
          requireSafe(change.value!.sizeBytes === old.size, "Metadata byte count differs from verified binary."); continue;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer()); const hash = await backupBytesSha256(bytes);
        requireSafe(change.value!.sizeBytes === bytes.length, "Attachment metadata and bytes disagree.");
        if (!old || old.sha256 !== hash || old.size !== bytes.length) binaryBytes.push({ attachmentId: id, bytes });
      }
      const operationId = crypto.randomUUID(); const ids = await reserved(this.store, binaryBytes.length + 2);
      const objects: StagedGraphObject[] = [];
      for (const binary of binaryBytes) {
        const staged = await object(this.store, operationId, ids[objects.length], "binary", binary.bytes); objects.push(staged);
        descriptors.push({ attachmentId: binary.attachmentId, ...staged.objectRef });
      }
      const binaryCapable = parent.commit.requiredReaders.includes(BACKUP_BINARY_READER_CAPABILITY) || changes.some((c) => c.file === "attachments.json");
      const parentId = parent.commit.delta?.deltaId ?? parent.commit.checkpoint.checkpointId;
      const delta = createBackupDelta(parent.commit.checkpoint.checkpointId, parentId, crypto.randomUUID(), changes, binaryCapable ? descriptors : undefined);
      const deltaObject = await object(this.store, operationId, ids[objects.length], "delta", jsonBytes(delta)); objects.push(deltaObject);
      const commit: BackupGraphCommit = { ...parent.commit, commitId: operationId, kind: "delta", parents: [{ commitId: parent.commit.commitId, ...parent.objectRef }],
        requiredReaders: [...new Set([...parent.commit.requiredReaders, "checkpoint-delta-v1", ...(binaryCapable ? [BACKUP_BINARY_READER_CAPABILITY] : [])])].sort(),
        delta: { deltaId: delta.deltaId, parentId, ...deltaObject.objectRef } };
      const commitObject = await object(this.store, operationId, ids[objects.length], "commit", encodeGraphCommit(commit)); objects.push(commitObject);
      const rebuilt = applyDelta(snapshot.bundle!, delta, parent.commit);
      const operation: WebGraphOperation = { operationId, accountId: this.store.accountId, lineageId: this.store.lineageId, kind: "publish",
        generation: snapshot.generation, originalState: snapshot.state, next: { commit, objectRef: commitObject.objectRef },
        bundle: bundleOf(rebuilt.files, rebuilt.binaries!, snapshot.bundle!.cloudVersion + 1, rebuilt.permanentDeletions, delta.deltaId),
        capturedOperations: snapshot.operations, overlays: snapshot.overlays, objectIds: objects.map((o) => o.objectRef.cloudFileId),
        binaryDestinations: Object.fromEntries(descriptors.map((d) => [d.attachmentId, d.cloudFileId])), status: "STAGED" };
      await stageWebGraphOperation(operation, objects);
      await this.boundary("after-stage"); return this.resume(operationId, metrics);
    });
  }

  /** Full snapshot path is only for first baseline, never an incremental fallback. */
  async createRoot(snapshot: WebGraphSnapshot, fullBundle: MetadataRestoreBundle, binaryBlobs: Record<string, Blob>): Promise<WebGraphResult> {
    checkAccount(this.store);
    requireSafe(snapshot.accountId === this.store.accountId && snapshot.state === null, "Root requires an unbound local account.");
    requireSafe((await this.store.commits()).length === 0, "Existing graph requires reconciliation, not another root.");
    const files = filesOf(fullBundle);
    const expected = [...Object.keys(backupRecordKeys), "manifest.json", "settings.json"].sort();
    requireSafe(canonicalJson(Object.keys(files).sort()) === canonicalJson(expected), "First baseline requires all known groups without dropping unknown historical data.");
    const attachmentRows = files["attachments.json"]; requireSafe(Array.isArray(attachmentRows), "Invalid baseline attachments.");
    const binaryIds = attachmentRows.filter((r) => r.fileEntry !== "").map((r) => String(r.id));
    requireSafe(new Set(binaryIds).size === binaryIds.length && binaryIds.every((id) => binaryBlobs[id]), "Baseline attachment bytes are missing.");
    const operationId = crypto.randomUUID(); const ids = await reserved(this.store, expected.length + binaryIds.length + 2);
    const objects: StagedGraphObject[] = []; const entries = []; const descriptors: BackupBinaryDescriptor[] = [];
    for (const attachmentId of binaryIds) {
      const bytes = new Uint8Array(await binaryBlobs[attachmentId].arrayBuffer());
      const staged = await object(this.store, operationId, ids[objects.length], "binary", bytes); objects.push(staged);
      const descriptor = { attachmentId, ...staged.objectRef }; descriptors.push(descriptor); entries.push(binaryManifestEntry(descriptor));
    }
    for (const fileName of expected) {
      const staged = await object(this.store, operationId, ids[objects.length], "metadata", jsonBytes(files[fileName])); objects.push(staged);
      entries.push({ ...staged.objectRef, path: `metadata/${fileName}`, fileName, backupEntry: fileName, kind: "metadata" });
    }
    new BackupBinaryResolution(descriptors).finish(files);
    const checkpointObject = await object(this.store, operationId, ids[objects.length], "checkpoint",
      jsonBytes({ schemaVersion: 1, storage: "google-drive-api", cloudVersion: 1, entries })); objects.push(checkpointObject);
    const commit: BackupGraphCommit = { format: "myvault-backup-commit", version: 1, requiredReaders: [BACKUP_GRAPH_CAPABILITY],
      accountId: this.store.accountId, lineageId: this.store.lineageId, commitId: operationId, kind: "checkpoint", parents: [],
      checkpoint: { checkpointId: `full-${checkpointObject.objectRef.sha256}`, ...checkpointObject.objectRef }, delta: null };
    const commitObject = await object(this.store, operationId, ids[objects.length], "commit", encodeGraphCommit(commit)); objects.push(commitObject);
    const op: WebGraphOperation = { operationId, accountId: this.store.accountId, lineageId: this.store.lineageId, kind: "publish",
      generation: snapshot.generation, originalState: null, next: { commit, objectRef: commitObject.objectRef },
      bundle: bundleOf(files, descriptors, 1, [], commit.checkpoint.checkpointId), capturedOperations: snapshot.operations, overlays: snapshot.overlays,
      objectIds: objects.map((o) => o.objectRef.cloudFileId), binaryDestinations: Object.fromEntries(descriptors.map((b) => [b.attachmentId, b.cloudFileId])), status: "STAGED" };
    await stageWebGraphOperation(op, objects); await this.boundary("after-stage"); return this.resume(operationId);
  }

  async resume(operationId: string, metrics = emptyMetrics()): Promise<WebGraphResult> {
    checkAccount(this.store);
    const operation = await loadWebGraphOperation(this.store.accountId, operationId);
    requireSafe(operation && operation.lineageId === this.store.lineageId, "Publication belongs to another account/lineage.");
    if (operation.status === "COMPLETE") return { status: "COMPLETE", commitId: operation.next.commit.commitId, metrics };
    requireSafe(operation.kind === "publish", "Restore recovery requires the Restore path.");
    const objects = await loadStagedGraphObjects(this.store.accountId, operation);
    requireSafe(objects.at(-1)?.role === "commit" && objects.filter((o) => o.role === "commit").length === 1, "Commit must be last.");
    const inventory = await this.store.commits(); const graph = inventory.length ? await BackupGraph.discover(inventory, this.store.accountId, this.store.lineageId) : null;
    const remoteCommit = inventory.find((o) => o.objectRef.cloudFileId === operation.next.objectRef.cloudFileId);
    if (!remoteCommit) {
      requireSafe(!graph || graph.status === "SINGLE_TIP", `Publication recovery blocked: ${graph?.status}`);
      const parent = operation.next.commit.parents[0];
      if (parent) requireSafe(graph && graph.commits.has(parent.commitId), "Publication parent is missing.");
      else requireSafe(!graph, "A different root appeared; reconcile before publishing.");
    } else {
      await verifyGraphObject(operation.next.objectRef, remoteCommit.bytes);
      requireSafe(graph?.commits.has(operation.next.commit.commitId), "Published operation has invalid ancestry.");
    }
    for (const staged of objects) {
      checkAccount(this.store); const bytes = new Uint8Array(await staged.bytes.arrayBuffer());
      await verifyGraphObject(staged.objectRef, bytes);
      const existing = await this.store.read(staged.objectRef.cloudFileId);
      if (existing) await verifyGraphObject(staged.objectRef, existing);
      else {
        requireSafe(!staged.verified, "A previously verified immutable object disappeared.");
        await this.store.create(staged.objectRef.cloudFileId, staged.role, bytes);
        const verified = await requiredBytes(this.store, staged.objectRef);
        requireSafe(verified.length === bytes.length, "Immutable create readback failed.");
        if (staged.role === "binary") metrics.binariesCreated++;
        if (staged.role === "delta") metrics.deltasCreated++;
        if (staged.role === "commit") metrics.commitsCreated++;
      }
      if (staged.role === "commit") {
        const commit = await parseGraphCommit({ objectRef: staged.objectRef, bytes });
        requireSafe(canonicalJson(commit) === canonicalJson(operation.next.commit), "Staged commit intent differs.");
      }
      await markGraphObjectVerified(this.store.accountId, operationId, staged.objectRef);
      await this.boundary(`after-${staged.role}`);
    }
    await this.boundary("before-local-completion");
    await withLocalVaultUpdate(this.store.accountId, () => completeWebGraphOperation(this.store.accountId, operationId));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
    return { status: "COMPLETE", commitId: operation.next.commit.commitId, metrics };
  }

  async restore(): Promise<WebGraphResult> {
    return withAccountSyncLock(this.store.accountId, async () => {
      checkAccount(this.store);
      const pending = await pendingWebGraphOperations(this.store.accountId);
      if (pending.length) {
        requireSafe(pending.length === 1 && pending[0].kind === "restore", "Finish the pending Backup before Restore.");
        await this.recoverRestore(pending[0]);
      }
      const { graph, inventory } = await discovery(this.store);
      let snapshot = await captureWebGraphSnapshot(this.store.accountId, this.store.lineageId);
      requireSafe(!snapshot.state || snapshot.state.trust === "VERIFIED", "Graph applied state was invalidated. Reconciliation is required.");
      const applied = snapshot.state?.applied;
      if (applied) exactPosition(graph, inventory, applied);
      const plan = graph.plan(applied?.commit.commitId ?? null);
      requireSafe(["ALREADY_CURRENT", "DESCENDANTS", "SINGLE_TIP"].includes(plan.status), `Restore blocked: ${plan.status}`);
      if (plan.status === "ALREADY_CURRENT") return { status: "ALREADY_CURRENT", commitId: applied!.commit.commitId, metrics: emptyMetrics() };
      requireSafe(!snapshot.operations.length && !snapshot.overlays.length, "Local changes need attention before Restore.");
      snapshot = await captureWebGraphSnapshot(this.store.accountId, this.store.lineageId, true);
      requireSafe(snapshot.state || !snapshot.bundle, "Existing local Vault requires reconciliation before a first graph Restore.");
      for (const commit of plan.descendants) {
        checkAccount(this.store);
        requireSafe(!snapshot.operations.length && !snapshot.overlays.length, "A newer local edit blocks Restore.");
        const opId = crypto.randomUUID(); const staged: StagedGraphObject[] = []; let nextBundle: MetadataRestoreBundle;
        let commitSource: GraphObject | undefined;
        for (const candidate of inventory) {
          if ((await parseGraphCommit(candidate)).commitId === commit.commitId) { commitSource = candidate; break; }
        }
        requireSafe(commitSource, "Commit object receipt missing.");
        // Commit receipt is resolved by canonical parsing, never by listing order.
        requireSafe((await parseGraphCommit(commitSource)).commitId === commit.commitId, "Wrong commit receipt.");
        let replacementBinaries: BackupBinaryDescriptor[];
        if (commit.kind === "checkpoint") {
          requireSafe(!snapshot.state?.applied, "A replacement full checkpoint requires reconciliation; absence cannot delete local records.");
          const checkpoint = await readBackupGraphCheckpoint(commit.checkpoint, async (id) => {
            const raw = await this.store.read(id); checkAccount(this.store); requireSafe(raw, "Checkpoint object missing."); return raw;
          });
          for (const source of checkpoint.objects) staged.push(await object(this.store, opId, source.objectRef.cloudFileId,
            source.objectRef.cloudFileId === commit.checkpoint.cloudFileId ? "checkpoint" : "metadata", source.bytes));
          replacementBinaries = checkpoint.binaries;
          new BackupBinaryResolution(replacementBinaries).finish(checkpoint.files);
          nextBundle = bundleOf(checkpoint.files, replacementBinaries, checkpoint.cloudVersion, [], commit.checkpoint.checkpointId);
        } else {
          requireSafe(snapshot.bundle && snapshot.state?.applied, "Missing applied checkpoint state.");
          const raw = await requiredBytes(this.store, commit.delta!);
          staged.push(await object(this.store, opId, commit.delta!.cloudFileId, "delta", raw));
          const delta = parseBackupDelta(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
          requireSafe(delta.deltaId === commit.delta!.deltaId && delta.parentId === commit.delta!.parentId
            && delta.checkpointId === commit.checkpoint.checkpointId && (delta.version !== 2 || commit.requiredReaders.includes(BACKUP_BINARY_READER_CAPABILITY)), "Delta ancestry/capability mismatch.");
          const rebuilt = applyDelta(snapshot.bundle, delta, snapshot.state.applied.commit);
          replacementBinaries = (delta.binaries ?? []).filter((b) => {
            const previous = snapshot.bundle!.fileEntries?.find((e) => e.backupEntry === `files/${b.attachmentId}`);
            return previous?.sha256 !== b.sha256 || previous.size !== b.size;
          });
          nextBundle = bundleOf(rebuilt.files, rebuilt.binaries!, snapshot.bundle.cloudVersion + 1, rebuilt.permanentDeletions, delta.deltaId);
        }
        const destinations: Record<string, string> = {};
        for (const binary of replacementBinaries) {
          const bytes = await requiredBytes(this.store, binary); await verifyBackupBinaryBlob(new Blob([new Uint8Array(bytes)]), binary);
          const previous = staged.find((o) => o.objectRef.cloudFileId === binary.cloudFileId);
          if (previous) requireSafe(previous.objectRef.sha256 === binary.sha256 && previous.objectRef.size === binary.size, "Conflicting shared binary identity.");
          else staged.push(await object(this.store, opId, binary.cloudFileId, "binary", bytes));
          destinations[binary.attachmentId] = binary.cloudFileId;
          await this.boundary("during-restore-binary-staging");
        }
        staged.push(await object(this.store, opId, commitSource.objectRef.cloudFileId, "commit", commitSource.bytes));
        const op: WebGraphOperation = { operationId: opId, accountId: this.store.accountId, lineageId: this.store.lineageId, kind: "restore",
          generation: snapshot.generation, originalState: snapshot.state, next: { commit, objectRef: commitSource.objectRef }, bundle: nextBundle,
          capturedOperations: [], overlays: [], objectIds: staged.map((o) => o.objectRef.cloudFileId), binaryDestinations: destinations, status: "STAGED" };
        await stageWebGraphOperation(op, staged); await this.boundary("after-restore-stage");
        await this.recoverRestore(op);
        snapshot = await captureWebGraphSnapshot(this.store.accountId, this.store.lineageId, true);
      }
      return { status: "COMPLETE", commitId: graph.tips[0], metrics: emptyMetrics() };
    });
  }

  private async recoverRestore(op: WebGraphOperation) {
    checkAccount(this.store); requireSafe(op.lineageId === this.store.lineageId, "Foreign Restore lineage.");
    const { graph, inventory } = await discovery(this.store);
    const original = op.originalState?.applied;
    if (original) exactPosition(graph, inventory, original);
    const plan = graph.plan(original?.commit.commitId ?? null);
    requireSafe(plan.descendants.some((c) => c.commitId === op.next.commit.commitId), "Frozen Restore commit is no longer in a safe linear plan.");
    exactPosition(graph, inventory, op.next);
    const objects = await loadStagedGraphObjects(this.store.accountId, op);
    for (const staged of objects) {
      await verifyGraphObject(staged.objectRef, new Uint8Array(await staged.bytes.arrayBuffer()));
      await markGraphObjectVerified(this.store.accountId, op.operationId, staged.objectRef);
    }
    await this.boundary("before-restore-completion");
    await withLocalVaultUpdate(this.store.accountId, () => completeWebGraphOperation(this.store.accountId, op.operationId));
    await this.boundary("after-restore-completion");
    if (typeof window !== "undefined") window.dispatchEvent(new Event("myvault-restored-corpus-changed"));
  }
}
