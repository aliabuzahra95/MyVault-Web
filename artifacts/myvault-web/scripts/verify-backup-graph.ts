import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BackupGraph, BACKUP_GRAPH_CAPABILITY, BACKUP_GRAPH_PUBLICATION_ENABLED, encodeGraphCommit, historicalGraphPlan, parseGraphCommit, reconstructBackupGraph, type BackupGraphCommit, type GraphObject } from "../src/lib/restore/backupGraph";
import { backupBytesSha256, INCREMENTAL_BACKUP_PUBLICATION_ENABLED, parseBackupDelta } from "../src/lib/restore/incrementalBackup";
import { parseDriveSyncManifest } from "../src/lib/restore/driveManifestPreview";
import { generateGraphFixtures, graphFixtureUuid, type GraphFixtureBundle } from "./fixtures/backup-graph-v1";

globalThis.fetch = async () => { throw new Error("Network forbidden in graph reader tests."); };
const directory = process.env.MYVAULT_GRAPH_COMPAT_DIR;
assert.ok(directory, "Set MYVAULT_GRAPH_COMPAT_DIR to a disposable directory.");
mkdirSync(directory, { recursive: true });
const load = (bundle: GraphFixtureBundle, key: string) => {
  assert.ok(Object.hasOwn(bundle.objects, key), `Missing object ${key}; no stale-byte fallback`);
  return new Uint8Array(Buffer.from(bundle.objects[key], "base64"));
};
async function verify(bundle: GraphFixtureBundle) {
  const summaries: unknown[] = [];
  for (const fixture of bundle.cases) {
    const objects = fixture.refs.map((objectRef) => ({ objectRef, bytes: load(bundle, objectRef.cloudFileId) }));
    const graph = await BackupGraph.discover(objects, bundle.accountId, bundle.lineageId);
    const plan = fixture.name === "historical" ? historicalGraphPlan() : graph.plan(fixture.applied);
    assert.equal(plan.status, fixture.expected.status, `${bundle.origin}/${fixture.name}: ${JSON.stringify(graph.issues)}`);
    if (fixture.expected.roots) assert.deepEqual(graph.roots, fixture.expected.roots);
    if (fixture.expected.tips) assert.deepEqual(graph.tips, fixture.expected.tips);
    if (fixture.expected.ordered) assert.deepEqual(plan.commits.map((c) => c.commitId), fixture.expected.ordered);
    if (fixture.expected.descendants) assert.deepEqual(plan.descendants.map((c) => c.commitId), fixture.expected.descendants);
    if (fixture.expected.deltas) assert.deepEqual(plan.deltas.map((d) => d.deltaId), fixture.expected.deltas);
    if (fixture.restore) {
      const requested: string[] = [];
      const result = await reconstructBackupGraph(graph, async (key) => { requested.push(key); return load(bundle, key); });
      const notes = result.files["notes.json"] as Record<string, unknown>[];
      assert.equal(notes.find((n) => n.id === "n")!.bodyPlainText, fixture.restore.body);
      assert.deepEqual(notes.map((n) => String(n.id)).sort(), fixture.restore.notes);
      assert.equal(result.binaries!.find((b) => b.attachmentId === "pdf")!.size, fixture.restore.pdfSize);
      assert.equal(result.binaries!.some((b) => b.attachmentId === "clip"), fixture.restore.clipPresent);
      if (fixture.restore.pdfSize === 8192) {
        assert.ok(!requested.includes(`${bundle.origin}-pdf-4096`));
        const broken = structuredClone(bundle); delete broken.objects[`${bundle.origin}-pdf-8192`];
        await assert.rejects(reconstructBackupGraph(graph, async (key) => load(broken, key)), /Missing object/);
        broken.objects[`${bundle.origin}-pdf-8192`] = Buffer.alloc(4096, 79).toString("base64");
        await assert.rejects(reconstructBackupGraph(graph, async (key) => load(broken, key)), /verification failed/);
        broken.objects[`${bundle.origin}-pdf-8192`] = Buffer.alloc(8192, 88).toString("base64");
        await assert.rejects(reconstructBackupGraph(graph, async (key) => load(broken, key)), /verification failed/);
      }
      if (fixture.name === "explicit-delete") assert.deepEqual(result.permanentDeletions.map((c) => [c.file, c.key]).sort(), [["attachments.json", ["clip"]], ["notes.json", ["delete-note"]]]);
    }
    summaries.push({ name: fixture.name, status: plan.status, roots: graph.roots, tips: graph.tips, valid: [...graph.commits.keys()].sort(),
      ordered: plan.commits.map((c) => c.commitId), descendants: plan.descendants.map((c) => c.commitId), deltas: plan.deltas.map((d) => d.deltaId),
      capabilities: plan.commits.map((c) => c.requiredReaders), checkpoint: plan.checkpoint?.checkpointId ?? null });
  }
  const vectorBytes = encodeGraphCommit(bundle.vector.intent);
  assert.deepEqual(vectorBytes, load(bundle, bundle.vector.ref.cloudFileId), "Kotlin/JS Unicode canonical bytes differ");
  assert.equal(await backupBytesSha256(vectorBytes), bundle.vector.ref.sha256);
  assert.deepEqual(encodeGraphCommit({ ...bundle.vector.intent }), vectorBytes, "Retry must freeze intent bytes and UUID");
  await parseGraphCommit({ objectRef: bundle.vector.ref, bytes: vectorBytes });
  return summaries;
}
const web = await generateGraphFixtures("web");
writeFileSync(join(directory, "web.json"), JSON.stringify(web));
writeFileSync(join(directory, "web-read-web.json"), JSON.stringify(await verify(web), null, 2));
const android = join(directory, "android.json");
if (existsSync(android)) {
  writeFileSync(join(directory, "web-read-android.json"), JSON.stringify(await verify(JSON.parse(readFileSync(android, "utf8"))), null, 2));
  for (const origin of ["web", "android"]) {
    const other = join(directory, `android-read-${origin}.json`);
    if (existsSync(other)) assert.deepEqual(JSON.parse(readFileSync(join(directory, `web-read-${origin}.json`), "utf8")), JSON.parse(readFileSync(other, "utf8")), `${origin} fixture reader summaries differ`);
  }
  console.log("PASS bidirectional Android/Web fixtures and identical reader summaries.");
} else console.log("Web fixtures generated; Android round-trip gate pending.");

const root = web.vector.intent;
async function source(c: BackupGraphCommit, key: string): Promise<GraphObject> {
  const bytes = encodeGraphCommit(c);
  return { bytes, objectRef: { cloudFileId: key, sha256: await backupBytesSha256(bytes), size: bytes.length } };
}
const rootObject = await source(root, "root");
assert.throws(() => parseBackupDelta(root), /Unsupported backup delta/);
assert.ok(parseDriveSyncManifest(root).issues.length > 0, "Graph commits cannot masquerade as full legacy manifests");
const emptyCheckpoint = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, storage: "google-drive-api", entries: [] }));
const emptyHash = await backupBytesSha256(emptyCheckpoint);
const emptyRoot = await source({ ...root, checkpoint: { checkpointId: `full-${emptyHash}`, cloudFileId: "empty-checkpoint", sha256: emptyHash, size: emptyCheckpoint.length } }, "empty-root");
const emptyGraph = await BackupGraph.discover([emptyRoot], root.accountId, root.lineageId);
await assert.rejects(reconstructBackupGraph(emptyGraph, async () => emptyCheckpoint), /Invalid checkpoint entries/);
async function malformed(text: string) {
  const bytes = new TextEncoder().encode(text);
  await assert.rejects(parseGraphCommit({ bytes, objectRef: { cloudFileId: "malformed", sha256: await backupBytesSha256(bytes), size: bytes.length } }));
}
const json = new TextDecoder().decode(rootObject.bytes);
await malformed(json.replace('"version":1', '"version":1,"version":1'));
await malformed(json.replace('"version":1', '"version":1.0'));
await malformed(json + " {}");
await malformed(JSON.stringify({ ...root, checkpoint: { ...root.checkpoint, size: 9007199254740992 } }));
assert.throws(() => encodeGraphCommit({ ...root, accountId: "\ud800" }));
assert.throws(() => encodeGraphCommit({ ...root, parents: [{ commitId: root.commitId, ...rootObject.objectRef }] }));
await malformed(JSON.stringify({ ...root, unknown: true }));
assert.equal((await BackupGraph.discover([], web.accountId, web.lineageId)).status, "MISSING_ANCESTRY", "Missing namespace is not historical/empty authorization");

const performanceResults = [];
for (const count of [10, 100, 1000, 10000]) {
  const objects: GraphObject[] = []; let parent = { ...root, accountId: web.accountId, lineageId: web.lineageId, commitId: graphFixtureUuid(100) };
  objects.push(await source(parent, "benchmark-0"));
  for (let n = 1; n < count; n++) {
    const previous = objects.at(-1)!.objectRef;
    parent = n % 1000 === 0
      ? { ...parent, commitId: graphFixtureUuid(100 + n), parents: [{ commitId: parent.commitId, ...previous }], kind: "checkpoint", delta: null,
        checkpoint: { ...parent.checkpoint, cloudFileId: `cp-${n}`, sha256: n.toString(16).padStart(64, "0"), checkpointId: `full-${n.toString(16).padStart(64, "0")}` } }
      : { ...parent, commitId: graphFixtureUuid(100 + n), parents: [{ commitId: parent.commitId, ...previous }], kind: "delta", requiredReaders: [BACKUP_GRAPH_CAPABILITY, "checkpoint-delta-v1"].sort(),
        delta: { deltaId: `d-${n}`, parentId: parent.delta?.deltaId ?? parent.checkpoint.checkpointId, cloudFileId: `delta-${n}`, sha256: "a".repeat(64), size: 100 } };
    objects.push(await source(parent, `benchmark-${n}`));
  }
  const memory = process.memoryUsage().heapUsed; const start = performance.now();
  const graph = await BackupGraph.discover(objects, web.accountId, web.lineageId);
  const discovered = performance.now(); const plan = graph.plan(); const finished = performance.now();
  assert.equal(plan.status, "SINGLE_TIP"); assert.equal(plan.commits.length, count);
  performanceResults.push({ count, commitBytes: objects.reduce((n, o) => n + o.bytes.length, 0), discoveryMs: +(discovered - start).toFixed(2), ancestryMs: +(finished - discovered).toFixed(2), heapDeltaBytes: process.memoryUsage().heapUsed - memory });
}
writeFileSync(join(directory, "web-performance.json"), JSON.stringify(performanceResults, null, 2));
assert.equal(BACKUP_GRAPH_PUBLICATION_ENABLED, false); assert.equal(INCREMENTAL_BACKUP_PUBLICATION_ENABLED, false);
console.log(`PASS ${web.cases.length} graph cases, Unicode/escape/retry vectors, strict wire validation, 10/100/1000/10000 commit benchmarks. No network/data writes outside disposable fixtures.`);
console.table(performanceResults);
