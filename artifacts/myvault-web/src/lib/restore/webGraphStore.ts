import { backupGraphStorageTransaction, type LocalSyncOperation, type LocalNoteDraft } from "./localRestoreStore";
import type { MetadataRestoreBundle } from "./metadataRestore";
import type { BackupGraphCommit, GraphObjectRef } from "./backupGraph";
import { accountStorageKey, accountStorageRange, getActiveAccountId } from "../sync/accountContext";
import { canonicalJson } from "../sync/revision";

const STATES = "backup-graph-states";
const OPERATIONS = "backup-graph-operations";
const OBJECTS = "backup-graph-staged-objects";
const META = "account-meta";
const JOURNAL = "sync-journal";
const BUNDLE = "metadata-bundles";
export const graphOverlayStores = ["note-drafts", "created-folders", "created-notes", "created-attachments",
  "pdf-reader-state", "pdf-annotation-changes", "created-courses", "created-course-folders",
  "created-course-sticky-notes", "created-course-concepts"] as const;
export type WebGraphPosition = { commit: BackupGraphCommit; objectRef: GraphObjectRef };
export type WebGraphState = {
  accountId: string; lineageId: string; originEpoch: number;
  trust: "VERIFIED" | "INVALIDATED";
  published: WebGraphPosition | null; applied: WebGraphPosition | null;
};
export type GraphOverlay = { store: string; key: IDBValidKey; value: unknown };
export type WebGraphSnapshot = {
  accountId: string; generation: number; state: WebGraphState | null;
  bundle: MetadataRestoreBundle | null; operations: LocalSyncOperation[]; overlays: GraphOverlay[];
  blobs: Record<string, Blob>; payloadRowsRead: number;
  fingerprints: Record<string, { sha256: string; size: number }>;
};
export type StagedGraphObject = {
  operationId: string; accountId: string; role: "binary" | "metadata" | "delta" | "checkpoint" | "commit";
  objectRef: GraphObjectRef; bytes: Blob; verified: boolean;
};
export type WebGraphOperation = {
  operationId: string; accountId: string; lineageId: string; kind: "publish" | "restore";
  generation: number; originalState: WebGraphState | null; next: WebGraphPosition;
  bundle: MetadataRestoreBundle; capturedOperations: LocalSyncOperation[]; overlays: GraphOverlay[];
  objectIds: string[]; binaryDestinations: Record<string, string>;
  status: "STAGED" | "COMPLETE";
  overwriteLocalChanges?: boolean;
};
function current(accountId: string) {
  if (getActiveAccountId() !== accountId) throw new Error("The Google account changed. Local data was preserved.");
}
function matches(a: unknown, b: unknown) { return canonicalJson(a) === canonicalJson(b); }
function reads(requests: IDBRequest[], apply: () => void) {
  let left = requests.length;
  if (!left) { apply(); return; }
  for (const request of requests) request.onsuccess = () => { if (--left === 0) apply(); };
}
function safely(transaction: IDBTransaction, apply: () => void) {
  try { apply(); } catch { transaction.abort(); }
}
export function graphStateKey(accountId: string, lineageId: string): IDBValidKey {
  // IndexedDB array keys preserve structural identity, without delimiter collisions.
  return [accountId, lineageId];
}

export async function loadWebGraphState(accountId: string, lineageId: string) {
  current(accountId);
  return backupGraphStorageTransaction<WebGraphState | null>("readonly", (tx, finish) => {
    const request = tx.objectStore(STATES).get(graphStateKey(accountId, lineageId));
    request.onsuccess = () => safely(tx, () => { current(accountId); finish(request.result ?? null); });
  });
}

/** Lightweight notice snapshot: graph position plus dirty indicators, never Vault payloads. */
export async function readWebGraphNoticeState(accountId: string, lineageId: string) {
  current(accountId);
  return backupGraphStorageTransaction<{ state: WebGraphState | null; pending: boolean }>("readonly", (tx, finish) => {
    const state = tx.objectStore(STATES).get(graphStateKey(accountId, lineageId));
    const journal = tx.objectStore(JOURNAL).getAll(accountStorageRange(accountId));
    const counts = graphOverlayStores.map((name) => tx.objectStore(name).count(accountStorageRange(accountId)));
    reads([state, journal, ...counts], () => safely(tx, () => {
      current(accountId);
      finish({ state: state.result ?? null,
        pending: journal.result.some((op: LocalSyncOperation) => op.status === "pending") || counts.some((count) => count.result > 0) });
    }));
  });
}

/** One consistent IDB snapshot. Empty work reads no metadata bundle or payload rows. */
export async function captureWebGraphSnapshot(accountId: string, lineageId: string, includeBundle = false): Promise<WebGraphSnapshot> {
  current(accountId);
  return backupGraphStorageTransaction("readonly", (tx, finish) => {
    const generation = tx.objectStore(META).get(accountStorageKey("vault-generation", accountId));
    const state = tx.objectStore(STATES).get(graphStateKey(accountId, lineageId));
    const journal = tx.objectStore(JOURNAL).getAll(accountStorageRange(accountId));
    const counts = graphOverlayStores.map((name) => tx.objectStore(name).count(accountStorageRange(accountId)));
    reads([generation, state, journal, ...counts], () => safely(tx, () => {
      current(accountId);
      const operations: LocalSyncOperation[] = journal.result.filter((op: LocalSyncOperation) => op.status === "pending");
      const pending = operations.length > 0 || counts.some((r) => r.result > 0);
      const result: WebGraphSnapshot = { accountId, generation: generation.result ?? 0, state: state.result ?? null,
        bundle: null, operations, overlays: [], blobs: {}, fingerprints: {}, payloadRowsRead: 0 };
      if (!pending && !includeBundle) { finish(result); return; }
      const bundle = tx.objectStore(BUNDLE).get(accountStorageKey("current", accountId));
      const next: IDBRequest[] = [bundle];
      counts.forEach((count, index) => {
        if (!count.result) return;
        const name = graphOverlayStores[index]; const store = tx.objectStore(name);
        const keys = store.getAllKeys(accountStorageRange(accountId));
        const values = store.getAll(accountStorageRange(accountId));
        next.push(keys, values);
        reads([keys, values], () => {
          values.result.forEach((value: unknown, i: number) => result.overlays.push({ store: name, key: keys.result[i], value }));
          result.payloadRowsRead += values.result.length;
        });
      });
      // Keep all requests in this live transaction; hashing/serialization follows it.
      let remaining = next.length;
      for (const r of next) {
        const previous = r.onsuccess;
        r.onsuccess = (event) => {
          previous?.call(r, event);
          if (--remaining !== 0) return;
          result.bundle = bundle.result ?? null;
          const attachments = result.overlays.filter((v) => v.store === "created-attachments");
          if (!attachments.length) { finish(result); return; }
          const blobReads = attachments.flatMap((v) => {
            const id = (v.value as { id: string }).id;
            const request = tx.objectStore("attachment-blobs").get(accountStorageKey(id, accountId));
            request.onsuccess = () => { if (request.result) result.blobs[id] = request.result; };
            const fingerprint = tx.objectStore("backup-graph-binary-fingerprints").get([accountId, id]);
            fingerprint.onsuccess = () => { if (fingerprint.result) result.fingerprints[id] = fingerprint.result; };
            return [request, fingerprint];
          });
          let pendingBlobs = blobReads.length;
          for (const request of blobReads) {
            const handler = request.onsuccess;
            request.onsuccess = (e) => { handler?.call(request, e); if (--pendingBlobs === 0) finish(result); };
          }
        };
      }
    }));
  });
}

export async function loadWebGraphOperation(accountId: string, operationId: string) {
  current(accountId);
  return backupGraphStorageTransaction<WebGraphOperation | null>("readonly", (tx, finish) => {
    const r = tx.objectStore(OPERATIONS).get([accountId, operationId]);
    r.onsuccess = () => safely(tx, () => { current(accountId); finish(r.result ?? null); });
  });
}
export async function pendingWebGraphOperations(accountId: string): Promise<WebGraphOperation[]> {
  current(accountId);
  return backupGraphStorageTransaction("readonly", (tx, finish) => {
    const r = tx.objectStore(OPERATIONS).getAll(IDBKeyRange.bound([accountId], [accountId, []]));
    r.onsuccess = () => safely(tx, () => { current(accountId); finish(r.result.filter((op: WebGraphOperation) => op.status !== "COMPLETE")); });
  });
}
export async function loadStagedGraphObjects(accountId: string, operation: WebGraphOperation) {
  current(accountId);
  if (operation.accountId !== accountId) throw new Error("Foreign publication operation.");
  return backupGraphStorageTransaction<StagedGraphObject[]>("readonly", (tx, finish) => {
    const requests = operation.objectIds.map((id) => tx.objectStore(OBJECTS).get([accountId, operation.operationId, id]));
    reads(requests, () => safely(tx, () => {
      current(accountId);
      if (requests.some((r) => !r.result)) throw new Error("Staged graph bytes are missing. Nothing was acknowledged.");
      finish(requests.map((r) => r.result));
    }));
  });
}

export async function stageWebGraphOperation(operation: WebGraphOperation, objects: StagedGraphObject[]) {
  current(operation.accountId);
  if (objects.length !== operation.objectIds.length || new Set(operation.objectIds).size !== operation.objectIds.length || objects.some((o, i) => o.operationId !== operation.operationId
    || o.accountId !== operation.accountId || o.objectRef.cloudFileId !== operation.objectIds[i] || o.verified)) throw new Error("Invalid graph staging intent.");
  await backupGraphStorageTransaction("readwrite", (tx, finish) => {
    const existing = tx.objectStore(OPERATIONS).get([operation.accountId, operation.operationId]);
    const state = tx.objectStore(STATES).get(graphStateKey(operation.accountId, operation.lineageId));
    const generation = tx.objectStore(META).get(accountStorageKey("vault-generation", operation.accountId));
    const other = tx.objectStore(OPERATIONS).getAll(IDBKeyRange.bound([operation.accountId], [operation.accountId, []]));
    reads([existing, state, generation, other], () => safely(tx, () => {
      current(operation.accountId);
      if (existing.result || !matches(state.result ?? null, operation.originalState)
        || (generation.result ?? 0) !== operation.generation
        || other.result.some((op: WebGraphOperation) => op.status !== "COMPLETE")) throw new Error("Local state changed or unfinished work requires recovery before staging.");
      tx.objectStore(OPERATIONS).put(operation, [operation.accountId, operation.operationId]);
      for (const object of objects) tx.objectStore(OBJECTS).put(object, [operation.accountId, operation.operationId, object.objectRef.cloudFileId]);
      finish(undefined);
    }));
  });
}
export async function markGraphObjectVerified(accountId: string, operationId: string, ref: GraphObjectRef) {
  current(accountId);
  await backupGraphStorageTransaction("readwrite", (tx, finish) => {
    const key = [accountId, operationId, ref.cloudFileId]; const request = tx.objectStore(OBJECTS).get(key);
    request.onsuccess = () => safely(tx, () => {
      current(accountId);
      const object: StagedGraphObject = request.result;
      if (!object || !matches(object.objectRef, ref)) throw new Error("Immutable object receipt conflict.");
      tx.objectStore(OBJECTS).put({ ...object, verified: true }, key); finish(undefined);
    });
  });
}

/** Verification receipts, Vault state, exact acknowledgements and position commit atomically. */
export async function completeWebGraphOperation(accountId: string, operationId: string): Promise<boolean> {
  current(accountId);
  return backupGraphStorageTransaction("readwrite", (tx, finish) => {
    const opRequest = tx.objectStore(OPERATIONS).get([accountId, operationId]);
    opRequest.onsuccess = () => safely(tx, () => {
      const op: WebGraphOperation = opRequest.result;
      current(accountId);
      if (!op || op.accountId !== accountId) throw new Error("Restore/publication belongs to another account.");
      if (op.status === "COMPLETE") { finish(false); return; }
      const state = tx.objectStore(STATES).get(graphStateKey(accountId, op.lineageId));
      const gen = tx.objectStore(META).get(accountStorageKey("vault-generation", accountId));
      const journal = tx.objectStore(JOURNAL).getAll(accountStorageRange(accountId));
      const counts = graphOverlayStores.map((s) => tx.objectStore(s).count(accountStorageRange(accountId)));
      const overlayKeyRequests = graphOverlayStores.map((s) => tx.objectStore(s).getAllKeys(accountStorageRange(accountId)));
      const objects = op.objectIds.map((id) => tx.objectStore(OBJECTS).get([accountId, operationId, id]));
      const overlays = op.overlays.map((v) => tx.objectStore(v.store).get(v.key));
      reads([state, gen, journal, ...counts, ...overlayKeyRequests, ...objects, ...overlays], () => safely(tx, () => {
        current(accountId);
        if (!matches(state.result ?? null, op.originalState) || objects.some((r) => !r.result?.verified)) throw new Error("Completion proof changed or verification is incomplete.");
        if (op.kind === "restore") {
          if (!op.overwriteLocalChanges && ((gen.result ?? 0) !== op.generation
            || journal.result.some((r: LocalSyncOperation) => r.status === "pending") || counts.some((r) => r.result > 0))) {
            throw new Error("Local edits need attention before Restore.");
          }
          if (op.overwriteLocalChanges) {
            for (const entry of (journal.result ?? []) as LocalSyncOperation[]) {
              tx.objectStore(JOURNAL).delete(accountStorageKey(entry.id, accountId));
            }
            graphOverlayStores.forEach((name, index) => {
              const store = tx.objectStore(name);
              const keys: IDBValidKey[] = overlayKeyRequests[index].result ?? [];
              keys.forEach((k) => store.delete(k));
            });
          }
        }
        for (const [attachmentId, objectId] of Object.entries(op.kind === "restore" ? op.binaryDestinations : {})) {
          const binary: StagedGraphObject | undefined = objects.map((r) => r.result).find((o) => o.objectRef.cloudFileId === objectId);
          if (!binary || binary.role !== "binary") throw new Error("Missing verified replacement bytes.");
          tx.objectStore("attachment-blobs").put(binary.bytes, accountStorageKey(attachmentId, accountId));
          tx.objectStore("backup-graph-binary-fingerprints").put({ sha256: binary.objectRef.sha256, size: binary.objectRef.size }, [accountId, attachmentId]);
        }
        tx.objectStore(BUNDLE).put(op.bundle, accountStorageKey("current", accountId));
        // The graph-specific base is the verified canonical bundle. Legacy merge
        // bases remain separate and cannot authorize graph publication.
        tx.objectStore(STATES).put({ accountId, lineageId: op.lineageId,
          trust: "VERIFIED",
          originEpoch: (op.originalState?.originEpoch ?? 0) + (op.kind === "restore" ? 1 : 0),
          published: op.kind === "publish" ? op.next : op.originalState?.published ?? null,
          applied: op.kind === "restore" ? op.next : op.originalState?.applied ?? null,
        } satisfies WebGraphState, graphStateKey(accountId, op.lineageId));
        if (op.kind === "publish") {
          const captured = new Map(op.capturedOperations.map((r) => [r.id, r]));
          for (const entry of journal.result as LocalSyncOperation[]) {
            if (captured.has(entry.id) && matches(captured.get(entry.id), entry)) tx.objectStore(JOURNAL).delete(accountStorageKey(entry.id, accountId));
          }
          op.overlays.forEach((captured, i) => {
            if (matches(captured.value, overlays[i].result)) tx.objectStore(captured.store).delete(captured.key);
            else if (captured.store === "note-drafts" && overlays[i].result) {
              const draft: LocalNoteDraft = overlays[i].result;
              const notes = op.bundle.files.find((f) => f.fileName === "notes.json")?.json;
              const row = Array.isArray(notes) ? notes.find((n) => n.id === draft.noteId) : null;
              if (row) tx.objectStore(captured.store).put({ ...draft, baseUpdatedAt: row.updatedAt,
                baseCloudVersion: op.bundle.cloudVersion, baseRevisionId: undefined }, captured.key);
            }
          });
        }
        tx.objectStore(META).put((gen.result ?? 0) + 1, accountStorageKey("vault-generation", accountId));
        tx.objectStore(OPERATIONS).put({ ...op, status: "COMPLETE" }, [accountId, operationId]);
        finish(true);
      }));
    });
  });
}
