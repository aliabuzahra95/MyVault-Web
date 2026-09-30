import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BackupGraph, reconstructBackupGraph } from "../src/lib/restore/backupGraph";

const source = process.env.MYVAULT_ANDROID_TRANSITION_FIXTURE;
assert.ok(source, "Set MYVAULT_ANDROID_TRANSITION_FIXTURE to a disposable Android fixture.");
const fixture = JSON.parse(readFileSync(source, "utf8"));
const objects = new Map<string, Uint8Array>(Object.entries(fixture.objects).map(([id, encoded]) =>
  [id, new Uint8Array(Buffer.from(encoded as string, "base64"))]));
const graph = await BackupGraph.discover(fixture.refs.map((objectRef: { cloudFileId: string; sha256: string; size: number }) =>
  ({ objectRef, bytes: objects.get(objectRef.cloudFileId)! })), fixture.accountId, fixture.lineageId);
assert.equal(graph.status, "SINGLE_TIP");
const plan = graph.plan(fixture.previousTip);
assert.deepEqual(plan.descendants.map((commit) => commit.commitId), [fixture.transitionTip]);
assert.equal(plan.requiresCheckpoint, false);
const deltaRef = plan.descendants[0].delta!;
const delta = JSON.parse(new TextDecoder().decode(objects.get(deltaRef.cloudFileId)!));
const changes = delta.changes as Array<{ file: string; key: string[]; operation: string }>;
assert.deepEqual(changes.filter((c) => c.file === "notes.json").map((c) => `${c.operation}:${c.key[0]}`).sort(),
  ["delete:b", "upsert:a", "upsert:d"]);
assert.equal(changes.some((c) => c.file === "notes.json" && c.key[0] === "c"), false);
assert.equal(changes.filter((c) => c.file === "attachments.json").length, 1);
const restored = await reconstructBackupGraph(graph, async (id) => objects.get(id)!);
const notes = new Map((restored.files["notes.json"] as Array<{ id: string; bodyPlainText: string }>).map((n) => [n.id, n]));
assert.deepEqual([...notes.keys()].sort(), ["a", "c", "d", "n"]);
assert.equal(notes.get("a")?.bodyPlainText, "Current العربية");
assert.equal(restored.binaries?.find((binary) => binary.attachmentId === "pdf")?.size, 8192);
console.log("PASS Web read Android's explicit authoritative transition, including exact deletion and binary replacement.");
