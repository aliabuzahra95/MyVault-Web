import { backupBytesSha256, parseBackupDelta, reconstructIncrementalBackup, type BackupDeltaDescriptor, type IncrementalBackup } from "./incrementalBackup";
import { BACKUP_BINARY_READER_CAPABILITY, parseBackupBinaries, verifyBackupBinaryBlob, type BackupBinaryDescriptor } from "./backupBinaryDescriptors";
import { backupRecordKeys } from "./incrementalBackup";

export const BACKUP_GRAPH_CAPABILITY = "backup-commit-graph-v1";
export const BACKUP_GRAPH_NAMESPACE = "MyVault Backup Graph v1";
export const BACKUP_GRAPH_DIRECTORIES = ["checkpoints", "commits", "deltas", "binaries"] as const;
export const BACKUP_GRAPH_PUBLICATION_ENABLED = false;
export type GraphObjectRef = { cloudFileId: string; sha256: string; size: number };
export type GraphParent = GraphObjectRef & { commitId: string };
export type GraphCheckpoint = GraphObjectRef & { checkpointId: string };
export type GraphDelta = GraphObjectRef & { deltaId: string; parentId: string };
export type BackupGraphCommit = {
  format: "myvault-backup-commit"; version: 1; requiredReaders: string[];
  accountId: string; lineageId: string; commitId: string; kind: "checkpoint" | "delta";
  parents: GraphParent[]; checkpoint: GraphCheckpoint; delta: GraphDelta | null;
};
/** Caller supplies a verified namespace inventory; receipts bind original bytes, not reserialized JSON. */
export type GraphObject = { objectRef: GraphObjectRef; bytes: Uint8Array };
export type GraphStatus = "HISTORICAL" | "SINGLE_TIP" | "ALREADY_CURRENT" | "DESCENDANTS" | "FORK" | "UNSUPPORTED" | "CORRUPT" | "MISSING_ANCESTRY" | "DIVERGENT";
export type GraphIssue = { status: GraphStatus; cloudFileId: string; reason: string };
export type GraphPlan = {
  status: GraphStatus; commits: BackupGraphCommit[]; descendants: BackupGraphCommit[];
  checkpoint: GraphCheckpoint | null; deltas: GraphDelta[]; requiresCheckpoint: boolean;
};
class Unsupported extends Error {}
function valid(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function string(value: unknown): asserts value is string {
  valid(typeof value === "string", "Graph field must be a string.");
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); valid(next >= 0xdc00 && next <= 0xdfff, "Unpaired Unicode surrogate."); }
    else valid(c < 0xdc00 || c > 0xdfff, "Unpaired Unicode surrogate.");
  }
}
function id(value: unknown): asserts value is string {
  string(value); valid(value.length > 0 && value.length <= 256 && !/[\u0000-\u0020\u007f]/.test(value), "Invalid graph ID.");
}
function object(value: unknown): asserts value is Record<string, unknown> { valid(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid graph object."); }
function ref(value: unknown, limit = 16 * 1024 * 1024, allowEmpty = false): asserts value is GraphObjectRef & Record<string, unknown> {
  object(value); id(value.cloudFileId);
  valid(typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= (allowEmpty ? 0 : 1) && value.size <= limit, "Invalid graph byte reference.");
}
export async function verifyGraphObject(reference: GraphObjectRef, bytes: Uint8Array): Promise<void> {
  valid(bytes.length === reference.size && await backupBytesSha256(bytes) === reference.sha256, "Graph object byte verification failed.");
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validateCommit(value: unknown): asserts value is BackupGraphCommit {
  object(value);
  valid(value.format === "myvault-backup-commit", "Invalid graph format.");
  valid(typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version >= 0, "Invalid graph version type.");
  if (value.version !== 1) throw new Unsupported("Unsupported graph version.");
  id(value.accountId); id(value.lineageId);
  valid(typeof value.commitId === "string" && uuid.test(value.commitId), "Invalid commit UUID.");
  valid(Array.isArray(value.requiredReaders), "Invalid graph capabilities.");
  value.requiredReaders.forEach(string);
  valid(JSON.stringify(value.requiredReaders) === JSON.stringify([...new Set(value.requiredReaders)].sort())
    && value.requiredReaders.includes(BACKUP_GRAPH_CAPABILITY), "Invalid graph capabilities.");
  const known = new Set([BACKUP_GRAPH_CAPABILITY, "checkpoint-delta-v1", BACKUP_BINARY_READER_CAPABILITY]);
  if (value.requiredReaders.some((capability) => !known.has(capability))) throw new Unsupported("Unsupported graph reader capability.");
  valid(Array.isArray(value.parents) && value.parents.length <= 1 && (value.kind === "checkpoint" || value.kind === "delta"), "Unsupported graph structure.");
  for (const parent of value.parents) {
    ref(parent, 65536);
    valid(typeof parent.commitId === "string" && uuid.test(parent.commitId) && parent.commitId !== value.commitId, "Invalid graph parent UUID.");
  }
  ref(value.checkpoint);
  valid(value.checkpoint.checkpointId === `full-${value.checkpoint.sha256}`, "Checkpoint ID must bind exact full manifest bytes.");
  if (value.kind === "checkpoint") valid(value.delta === null, "Checkpoint cannot contain a delta.");
  else {
    valid(value.parents.length === 1 && value.delta !== null, "Delta requires exactly one parent.");
    ref(value.delta); id(value.delta.deltaId); id(value.delta.parentId);
    valid(value.delta.deltaId !== value.delta.parentId && value.delta.deltaId !== value.checkpoint.checkpointId, "Invalid delta identity.");
    valid(value.requiredReaders.includes("checkpoint-delta-v1") || value.requiredReaders.includes(BACKUP_BINARY_READER_CAPABILITY), "Missing delta capability.");
  }
}

/** Fixed schema order, UTF-8, no whitespace/BOM, shortest integer form, raw Unicode and JSON control escapes. */
export function encodeGraphCommit(commit: BackupGraphCommit): Uint8Array {
  validateCommit(commit);
  const fields = (r: GraphObjectRef) => ({ cloudFileId: r.cloudFileId, sha256: r.sha256, size: r.size });
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: commit.format, version: commit.version, requiredReaders: commit.requiredReaders,
    accountId: commit.accountId, lineageId: commit.lineageId, commitId: commit.commitId, kind: commit.kind,
    parents: commit.parents.map((p) => ({ commitId: p.commitId, ...fields(p) })),
    checkpoint: { checkpointId: commit.checkpoint.checkpointId, ...fields(commit.checkpoint) },
    delta: commit.delta ? { deltaId: commit.delta.deltaId, parentId: commit.delta.parentId, ...fields(commit.delta) } : null,
  }));
  valid(bytes.length <= 65536, "Graph commit too large.");
  return bytes;
}
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const equalRef = (a: GraphObjectRef, b: GraphObjectRef) => a.cloudFileId === b.cloudFileId && a.sha256 === b.sha256 && a.size === b.size;
export async function parseGraphCommit(source: GraphObject): Promise<BackupGraphCommit> {
  ref(source.objectRef, 65536); await verifyGraphObject(source.objectRef, source.bytes);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source.bytes));
  validateCommit(value);
  // Exact re-encoding rejects duplicate/unknown keys, coerced values, trailing JSON and alternate encodings.
  valid(equalBytes(encodeGraphCommit(value), source.bytes), "Non-canonical or ambiguous graph JSON.");
  return value;
}
const emptyPlan = (status: GraphStatus): GraphPlan => ({ status, commits: [], descendants: [], checkpoint: null, deltas: [], requiresCheckpoint: false });
export const historicalGraphPlan = (): GraphPlan => emptyPlan("HISTORICAL");

export class BackupGraph {
  private constructor(
    readonly commits: ReadonlyMap<string, BackupGraphCommit>, readonly roots: readonly string[],
    readonly tips: readonly string[], readonly issues: readonly GraphIssue[],
  ) {}
  get status(): GraphStatus {
    if (this.issues.some((i) => i.status === "UNSUPPORTED")) return "UNSUPPORTED";
    if (this.issues.some((i) => i.status === "MISSING_ANCESTRY")) return "MISSING_ANCESTRY";
    if (this.issues.length) return "CORRUPT";
    if (this.tips.length > 1 || this.roots.length > 1) return "FORK";
    return this.tips.length === 1 ? "SINGLE_TIP" : "MISSING_ANCESTRY";
  }
  plan(appliedCommitId: string | null = null): GraphPlan {
    if (this.status !== "SINGLE_TIP") return emptyPlan(this.status);
    const reverse: BackupGraphCommit[] = []; const seen = new Set<string>();
    let current: string | undefined = this.tips[0];
    while (current) {
      valid(!seen.has(current), "Graph cycle."); seen.add(current);
      const commit: BackupGraphCommit = this.commits.get(current)!;
      reverse.push(commit); current = commit.parents[0]?.commitId;
    }
    const commits = reverse.reverse();
    const local = appliedCommitId === null ? -1 : commits.findIndex((c) => c.commitId === appliedCommitId);
    if (appliedCommitId !== null && local < 0) return emptyPlan("DIVERGENT");
    const descendants = commits.slice(local + 1);
    let checkpointIndex = 0;
    commits.forEach((c, i) => { if (c.kind === "checkpoint") checkpointIndex = i; });
    const requiresCheckpoint = appliedCommitId === null || descendants.some((c) => c.kind === "checkpoint");
    return {
      status: appliedCommitId === null ? "SINGLE_TIP" : descendants.length ? "DESCENDANTS" : "ALREADY_CURRENT",
      commits, descendants, checkpoint: commits[checkpointIndex].checkpoint,
      deltas: (requiresCheckpoint ? commits.slice(checkpointIndex + 1) : descendants).map((c) => c.delta!),
      requiresCheckpoint,
    };
  }
  /** O(objects + links); does not read any checkpoint, delta or binary object. */
  static async discover(objects: GraphObject[], accountId: string, lineageId: string): Promise<BackupGraph> {
    id(accountId); id(lineageId); valid(objects.length <= 100_000, "Graph inventory exceeds v1 limit.");
    const issues: GraphIssue[] = []; const parsed = new Map<string, BackupGraphCommit>();
    const receipts = new Map<string, GraphObject>(); const bytesByCommit = new Map<string, Uint8Array>();
    const physicalCommits = new Map<string, string>();
    for (const source of objects) {
      try {
        const commit = await parseGraphCommit(source);
        valid(commit.accountId === accountId && commit.lineageId === lineageId, "Foreign graph account or lineage.");
        const previous = bytesByCommit.get(commit.commitId);
        valid(!previous || equalBytes(previous, source.bytes), "Commit UUID resolves to conflicting bytes.");
        const physical = receipts.get(source.objectRef.cloudFileId);
        valid(!physical || equalBytes(physical.bytes, source.bytes), "Physical object has conflicting bytes.");
        bytesByCommit.set(commit.commitId, source.bytes); receipts.set(source.objectRef.cloudFileId, source);
        physicalCommits.set(source.objectRef.cloudFileId, commit.commitId); parsed.set(commit.commitId, commit);
      } catch (error) {
        issues.push({ status: error instanceof Unsupported ? "UNSUPPORTED" : "CORRUPT", cloudFileId: source.objectRef.cloudFileId, reason: String(error) });
      }
    }
    const children = new Map<string, string[]>();
    for (const c of parsed.values()) {
      const p = c.parents[0];
      if (p) { const list = children.get(p.commitId) ?? []; list.push(c.commitId); children.set(p.commitId, list); }
    }
    const queue = [...parsed.values()].filter((c) => c.parents.length === 0).map((c) => c.commitId);
    const validated = new Map<string, BackupGraphCommit>(); const visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const key = queue[index]; const c = parsed.get(key)!; visited.add(key);
      try {
        const p = c.parents[0];
        if (p) {
          const parent = validated.get(p.commitId); valid(parent, "Unusable graph parent.");
          const receipt = receipts.get(p.cloudFileId); valid(receipt, "Missing parent physical object.");
          valid(equalRef(receipt.objectRef, p) && physicalCommits.get(p.cloudFileId) === p.commitId, "Parent byte reference differs.");
          valid(parent.requiredReaders.every((capability) => c.requiredReaders.includes(capability)), "Reader capability cannot be downgraded along ancestry.");
          if (c.kind === "delta") valid(equalRef(c.checkpoint, parent.checkpoint)
            && c.checkpoint.checkpointId === parent.checkpoint.checkpointId && c.delta!.parentId === (parent.delta?.deltaId ?? parent.checkpoint.checkpointId), "Wrong checkpoint or delta parent.");
          else valid(!equalRef(c.checkpoint, parent.checkpoint) || c.checkpoint.checkpointId !== parent.checkpoint.checkpointId, "Checkpoint replacement must be new.");
        }
        validated.set(key, c);
      } catch (error) { issues.push({ status: "CORRUPT", cloudFileId: key, reason: String(error) }); }
      queue.push(...(children.get(key) ?? []));
    }
    for (const c of parsed.values()) if (!visited.has(c.commitId)) {
      issues.push({ status: parsed.has(c.parents[0].commitId) ? "CORRUPT" : "MISSING_ANCESTRY", cloudFileId: c.commitId, reason: "Missing or cyclic ancestry." });
    }
    const parentIds = new Set([...validated.values()].map((c) => c.parents[0]?.commitId));
    return new BackupGraph(validated, [...validated.values()].filter((c) => !c.parents.length).map((c) => c.commitId).sort(),
      [...validated.keys()].filter((key) => !parentIds.has(key)).sort(), issues);
  }
}

/** Pure reconstruction adapter; never applies to local storage or falls back to stale checkpoint bytes. */
export async function reconstructBackupGraph(graph: BackupGraph, load: (id: string) => Promise<Uint8Array>) {
  const plan = graph.plan(); valid(plan.status === "SINGLE_TIP", `Graph restore blocked: ${plan.status}`);
  const cp = plan.checkpoint!; const raw = await load(cp.cloudFileId); await verifyGraphObject(cp, raw);
  const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); object(manifest);
  valid(manifest.schemaVersion === 1 && manifest.storage === "google-drive-api" && !("incrementalBackup" in manifest), "Graph checkpoint must be a full historical manifest.");
  valid(Array.isArray(manifest.entries) && manifest.entries.length > 0 && manifest.entries.length <= 100_000, "Invalid checkpoint entries.");
  const files: Record<string, unknown> = {}; const binaries: BackupBinaryDescriptor[] = [];
  const identities = new Map<string, string>();
  const remember = (r: GraphObjectRef) => {
    const identity = JSON.stringify([r.sha256, r.size]);
    valid(!identities.has(r.cloudFileId) || identities.get(r.cloudFileId) === identity, "Immutable object identity conflict.");
    identities.set(r.cloudFileId, identity);
  };
  remember(cp);
  for (const entry of manifest.entries) {
    object(entry); ref(entry, Number.MAX_SAFE_INTEGER, entry.kind === "file"); remember(entry);
    if (entry.kind === "metadata") {
      const name = entry.fileName;
      valid(typeof name === "string" && (Object.hasOwn(backupRecordKeys, name) || name === "settings.json" || name === "manifest.json"), "Unknown checkpoint metadata group.");
      const bytes = await load(entry.cloudFileId); await verifyGraphObject(entry, bytes);
      valid(!Object.hasOwn(files, name), "Duplicate checkpoint metadata.");
      files[name] = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } else {
      valid(entry.kind === "file" && typeof entry.backupEntry === "string" && entry.backupEntry.startsWith("files/"), "Invalid checkpoint binary path.");
      binaries.push({ attachmentId: entry.backupEntry.slice(6), cloudFileId: entry.cloudFileId, sha256: entry.sha256, size: entry.size });
    }
  }
  const deltaCommits = new Map(plan.commits.filter((c) => c.delta).map((c) => [c.delta!.cloudFileId, c]));
  const descriptors: BackupDeltaDescriptor[] = [];
  for (const d of plan.deltas) {
    remember(d);
    const bytes = await load(d.cloudFileId); await verifyGraphObject(d, bytes);
    const value = parseBackupDelta(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    valid(value.version !== 2 || deltaCommits.get(d.cloudFileId)!.requiredReaders.includes(BACKUP_BINARY_READER_CAPABILITY), "Hidden binary capability.");
    parseBackupBinaries(value.version, value.binaries, value.changes).forEach(remember);
    descriptors.push(d);
  }
  const extension: IncrementalBackup = { version: 2, requiredReader: BACKUP_BINARY_READER_CAPABILITY, checkpointId: cp.checkpointId,
    headId: plan.commits.at(-1)!.delta?.deltaId ?? cp.checkpointId, deltas: descriptors };
  const result = await reconstructIncrementalBackup(files, extension, (d) => load(d.cloudFileId), binaries);
  for (const b of result.binaries!) await verifyBackupBinaryBlob(new Blob([new Uint8Array(await load(b.cloudFileId))]), b);
  return result;
}
