export const RECORD_SYNC_SCHEMA_VERSION = 1;
export const RECORD_SYNC_DEBOUNCE_MS = 4_000;

export type RecordSyncEntityType = "note" | "folder";

export type RecordSyncRevision = {
  schemaVersion: 1;
  entityType: RecordSyncEntityType;
  entityId: string;
  revisionId: string;
  mutationId: string;
  clientId: string;
  parents: string[];
  deleted: boolean;
  payloadJson: string | null;
  contentHash: string;
  dependencies: string[];
  publishedAt: number;
};

export type RecordSyncNote = {
  id: string;
  folderId: string | null;
  parentNoteId: string | null;
  title: string;
  bodyPlainText: string;
  isPinned: boolean;
  isFolderPinned: boolean;
  isFavourite: boolean;
  orderIndex: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  richText: { text: string; styleMarks: unknown[]; noteLinks: unknown[] };
  blocks: Array<{ id: string; noteId: string; type: string; content: string; orderIndex: number }>;
};

export type RecordSyncFolder = {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  orderIndex: number;
  isFavourite: boolean;
  mode: "study";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  colorKey: string | null;
};

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseRecordSyncRevision(value: unknown): RecordSyncRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid sync revision.");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== RECORD_SYNC_SCHEMA_VERSION ||
    (item.entityType !== "note" && item.entityType !== "folder") ||
    !nonemptyString(item.entityId) || !nonemptyString(item.revisionId) ||
    !nonemptyString(item.mutationId) || !nonemptyString(item.clientId) ||
    !Array.isArray(item.parents) || !item.parents.every(nonemptyString) ||
    typeof item.deleted !== "boolean" ||
    (item.deleted ? item.payloadJson !== null : typeof item.payloadJson !== "string") ||
    !nonemptyString(item.contentHash) ||
    !Array.isArray(item.dependencies) || !item.dependencies.every(nonemptyString) ||
    typeof item.publishedAt !== "number") {
    throw new Error("Unsupported or incomplete sync revision.");
  }
  if (!item.deleted) {
    const payload = JSON.parse(item.payloadJson as string) as { id?: unknown };
    if (!payload || payload.id !== item.entityId) throw new Error("Sync revision identity mismatch.");
  }
  return item as RecordSyncRevision;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export async function verifyRecordSyncRevision(revision: RecordSyncRevision): Promise<void> {
  const actual = await sha256Hex(revision.payloadJson ?? "null");
  if (actual !== revision.contentHash) throw new Error("Sync revision content hash mismatch.");
}

export async function createRecordSyncRevision(args: {
  entityType: RecordSyncEntityType;
  entityId: string;
  clientId: string;
  parents: string[];
  payload: RecordSyncNote | RecordSyncFolder | null;
  dependencies?: string[];
}): Promise<RecordSyncRevision> {
  if (args.payload && args.payload.id !== args.entityId) throw new Error("Sync revision identity mismatch.");
  const payloadJson = args.payload === null ? null : canonicalJson(JSON.parse(JSON.stringify(args.payload)));
  const revisionId = crypto.randomUUID();
  return {
    schemaVersion: RECORD_SYNC_SCHEMA_VERSION,
    entityType: args.entityType,
    entityId: args.entityId,
    revisionId,
    mutationId: revisionId,
    clientId: args.clientId,
    parents: [...new Set(args.parents)],
    deleted: args.payload === null,
    payloadJson,
    contentHash: await sha256Hex(payloadJson ?? "null"),
    dependencies: [...new Set(args.dependencies ?? [])],
    publishedAt: Date.now(),
  };
}

export function revisionDecision(localHead: string | null, incoming: RecordSyncRevision): "apply" | "conflict" | "already-applied" {
  if (localHead === incoming.revisionId) return "already-applied";
  if (localHead === null && incoming.parents.length === 0) return "apply";
  if (localHead !== null && incoming.parents.includes(localHead)) return "apply";
  return "conflict";
}
