import { backupBytesSha256, createBackupDelta, type BackupRecordChange } from "../../src/lib/restore/incrementalBackup";
import { BACKUP_BINARY_READER_CAPABILITY } from "../../src/lib/restore/backupBinaryDescriptors";
import { BACKUP_GRAPH_CAPABILITY, encodeGraphCommit, type BackupGraphCommit, type GraphObjectRef, type GraphStatus } from "../../src/lib/restore/backupGraph";

export const graphFixtureAccount = 'account-العربية-"\\/😀';
export const graphFixtureLineage = "lineage-العربية";
export const graphFixtureUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export type GraphFixtureCase = {
  name: string; refs: GraphObjectRef[]; applied: string | null;
  expected: { status: GraphStatus; roots?: string[]; tips?: string[]; ordered?: string[]; descendants?: string[]; deltas?: string[] };
  restore?: { body: string; pdfSize: number; notes: string[]; clipPresent: boolean };
};
export type GraphFixtureBundle = {
  origin: string; accountId: string; lineageId: string; objects: Record<string, string>; cases: GraphFixtureCase[];
  vector: { ref: GraphObjectRef; intent: BackupGraphCommit };
};

/** Independent Web fixture generator. The shared wire files contain exact base64 bytes and receipts, never Drive credentials. */
export async function generateGraphFixtures(origin: string): Promise<GraphFixtureBundle> {
  const objects: Record<string, string> = {}; const cases: GraphFixtureCase[] = [];
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const put = async (name: string, raw: Uint8Array): Promise<GraphObjectRef> => {
    const cloudFileId = `${origin}-${name}`; objects[cloudFileId] = Buffer.from(raw).toString("base64");
    return { cloudFileId, sha256: await backupBytesSha256(raw), size: raw.length };
  };
  const old = await put("pdf-4096", new Uint8Array(4096).fill(79));
  const replacement = await put("pdf-8192", new Uint8Array(8192).fill(82));
  const clip = await put("clip-512", new Uint8Array(512).fill(67));
  const row = (size: number, id = "pdf") => ({ id, sizeBytes: size, fileEntry: `files/${id}`, displayName: "English العربية" });
  const entries = [
    { ...old, kind: "file", backupEntry: "files/pdf" }, { ...clip, kind: "file", backupEntry: "files/clip" },
    { ...await put("notes", bytes([{ id: "n", bodyPlainText: "Original العربية", styleMarks: [{ start: 0, end: 8, bold: true }] }, { id: "keep", bodyPlainText: "Never deleted" }, { id: "delete-note", bodyPlainText: "Explicit ID only" }])), kind: "metadata", fileName: "notes.json" },
    { ...await put("attachments", bytes([row(4096), row(512, "clip")])), kind: "metadata", fileName: "attachments.json" },
    { ...await put("metadata-manifest", bytes({ version: 1 })), kind: "metadata", fileName: "manifest.json" },
  ];
  const cpRef = await put("checkpoint", bytes({ schemaVersion: 1, storage: "google-drive-api", cloudVersion: 100, entries }));
  const checkpoint = { checkpointId: `full-${cpRef.sha256}`, ...cpRef };
  const root: BackupGraphCommit = { format: "myvault-backup-commit", version: 1, requiredReaders: [BACKUP_GRAPH_CAPABILITY],
    accountId: graphFixtureAccount, lineageId: graphFixtureLineage, commitId: graphFixtureUuid(1), kind: "checkpoint", parents: [], checkpoint, delta: null };
  const save = (name: string, c: BackupGraphCommit) => put(name, encodeGraphCommit(c));
  const r = await save("R", root);
  const upsert = (file: string, value: Record<string, unknown>): BackupRecordChange => ({ file, key: [String(value.id)], operation: "upsert", value });
  const body = 'Al-Kulliyat: الكليات • concepts. "عربية" / English';
  const make = async (name: string, n: number, parent: BackupGraphCommit, parentRef: GraphObjectRef, changes: BackupRecordChange[], binary = false) => {
    const delta = createBackupDelta(checkpoint.checkpointId, parent.delta?.deltaId ?? checkpoint.checkpointId, `${origin}-delta-${name}`, changes,
      binary ? [{ attachmentId: "pdf", ...replacement }] : undefined);
    const deltaRef = await put(`delta-${name}`, bytes(delta));
    const c: BackupGraphCommit = { ...root, commitId: graphFixtureUuid(n), kind: "delta", parents: [{ commitId: parent.commitId, ...parentRef }],
      requiredReaders: [...new Set([...parent.requiredReaders, "checkpoint-delta-v1", ...(binary ? [BACKUP_BINARY_READER_CAPABILITY] : [])])].sort(),
      delta: { deltaId: delta.deltaId, parentId: delta.parentId, ...deltaRef } };
    return { c, ref: await save(name, c) };
  };
  const a = await make("A", 2, root, r, [upsert("notes.json", { id: "n", bodyPlainText: body, styleMarks: [{ start: 0, end: 8, bold: true }] })]);
  const b = await make("B", 3, a.c, a.ref, [upsert("attachments.json", row(8192))], true);
  const c = await make("C", 4, b.c, b.ref, [upsert("attachments.json", { ...row(8192), displayName: "Metadata only العربية" }),
    { file: "notes.json", key: ["delete-note"], operation: "delete" }, { file: "attachments.json", key: ["clip"], operation: "delete" }]);
  const expect = (status: GraphStatus, tips: number[], ordered?: number[], applied?: number) => ({ status, roots: [root.commitId], tips: tips.map(graphFixtureUuid).sort(),
    ...(ordered ? { ordered: ordered.map(graphFixtureUuid), descendants: (applied ? ordered.slice(ordered.indexOf(applied) + 1) : ordered).map(graphFixtureUuid) } : {}) });
  const add = (name: string, refs: GraphObjectRef[], expected: GraphFixtureCase["expected"], applied: string | null = null, restore?: GraphFixtureCase["restore"]) => cases.push({ name, refs, expected, applied, ...(restore ? { restore } : {}) });
  add("historical", [], { status: "HISTORICAL" });
  add("root", [r], expect("SINGLE_TIP", [1], [1]), null, { body: "Original العربية", pdfSize: 4096, notes: ["delete-note", "keep", "n"], clipPresent: true });
  add("linear", [c.ref, r, b.ref, a.ref], expect("SINGLE_TIP", [4], [1, 2, 3, 4]));
  add("local-A", [r, a.ref, b.ref, c.ref], { ...expect("DESCENDANTS", [4], [1, 2, 3, 4], 2), deltas: [b.c.delta!.deltaId, c.c.delta!.deltaId] }, a.c.commitId);
  add("current", [r, a.ref, b.ref, c.ref], { ...expect("ALREADY_CURRENT", [4], [1, 2, 3, 4], 4), deltas: [] }, c.c.commitId);
  const sibling = await make("sibling", 5, root, r, [upsert("notes.json", { id: "n", bodyPlainText: "Other branch" })]);
  add("fork", [r, a.ref, sibling.ref], expect("FORK", [2, 5]));
  const other = await make("other", 6, a.c, a.ref, [upsert("notes.json", { id: "n", bodyPlainText: "Deeper branch" })]);
  const deep = await make("deep", 7, other.c, other.ref, [upsert("notes.json", { id: "n", bodyPlainText: "Other tip" })]);
  add("deeper-fork", [r, a.ref, b.ref, other.ref, deep.ref], expect("FORK", [3, 7]));
  add("missing-parent", [r, b.ref], { status: "MISSING_ANCESTRY" });
  const fakeRef = { cloudFileId: `${origin}-cycle`, sha256: "a".repeat(64), size: 100 };
  const x = { ...a.c, commitId: graphFixtureUuid(8), parents: [{ commitId: graphFixtureUuid(9), ...fakeRef }] };
  const y = { ...a.c, commitId: graphFixtureUuid(9), parents: [{ commitId: graphFixtureUuid(8), ...fakeRef }] };
  add("cycle", [r, await save("cycle-X", x), await save("cycle-Y", y)], { status: "CORRUPT" });
  const wrong = { ...a.c, checkpoint: { ...checkpoint, cloudFileId: "other-checkpoint-object" } };
  add("wrong-checkpoint", [r, await save("wrong-checkpoint", wrong)], { status: "CORRUPT" });
  const corrupted = await put("corrupt-A", new Uint8Array([1, 2, 3]));
  add("corrupt-bytes", [r, { ...corrupted, sha256: a.ref.sha256, size: a.ref.size }], { status: "CORRUPT" });
  const unsupported = { ...a.c, requiredReaders: [...a.c.requiredReaders, "future-reader"].sort() };
  add("unsupported", [r, await put("unsupported", bytes(unsupported))], { status: "UNSUPPORTED" });
  add("metadata", [r, a.ref], expect("SINGLE_TIP", [2], [1, 2]), null, { body, pdfSize: 4096, notes: ["delete-note", "keep", "n"], clipPresent: true });
  add("binary-replacement", [r, a.ref, b.ref], expect("SINGLE_TIP", [3], [1, 2, 3]), null, { body, pdfSize: 8192, notes: ["delete-note", "keep", "n"], clipPresent: true });
  add("explicit-delete", [r, a.ref, b.ref, c.ref], expect("SINGLE_TIP", [4], [1, 2, 3, 4]), null, { body, pdfSize: 8192, notes: ["keep", "n"], clipPresent: false });
  add("divergent-local", [r, a.ref], { status: "DIVERGENT" }, graphFixtureUuid(90));
  add("duplicate-intent", [r, r, a.ref, a.ref], expect("SINGLE_TIP", [2], [1, 2]));
  add("conflicting-UUID", [r, a.ref, await save("conflicting-A", { ...a.c, delta: { ...a.c.delta!, cloudFileId: "different-delta" } })], { status: "CORRUPT" });
  add("foreign-account", [r, await save("foreign", { ...a.c, accountId: "other-account" })], { status: "CORRUPT" });
  add("foreign-lineage", [r, await save("foreign-lineage", { ...a.c, lineageId: "other-lineage" })], { status: "CORRUPT" });
  add("multiple-roots", [r, await save("other-root", { ...root, commitId: graphFixtureUuid(99) })], { status: "FORK" });
  add("capability-downgrade", [r, a.ref, b.ref, await save("downgrade", { ...c.c, requiredReaders: a.c.requiredReaders })], { status: "CORRUPT" });
  add("parent-hash-mismatch", [r, await save("wrong-parent", { ...a.c, parents: [{ ...a.c.parents[0], sha256: "b".repeat(64) }] })], { status: "CORRUPT" });
  const rootText = new TextDecoder().decode(encodeGraphCommit(root));
  for (const [name, text, status] of [
    ["duplicate-key", rootText.replace('"version":1', '"version":1,"version":1'), "CORRUPT"],
    ["decimal-version", rootText.replace('"version":1', '"version":1.0'), "CORRUPT"],
    ["string-version", rootText.replace('"version":1', '"version":"1"'), "CORRUPT"],
    ["future-version", rootText.replace('"version":1', '"version":2'), "UNSUPPORTED"],
    ["reordered-fields", JSON.stringify(Object.fromEntries(Object.entries(root).reverse())), "CORRUPT"],
  ] as const) add(name, [await put(name, new TextEncoder().encode(text))], { status });
  const vector: BackupGraphCommit = { ...root, accountId: 'عربية-"\\/😀', lineageId: "العلم-\u2028-\u2029" };
  return { origin, accountId: graphFixtureAccount, lineageId: graphFixtureLineage, objects, cases, vector: { ref: await save("unicode-vector", vector), intent: vector } };
}
