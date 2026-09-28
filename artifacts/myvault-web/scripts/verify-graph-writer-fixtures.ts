import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BackupGraph, reconstructBackupGraph } from "../src/lib/restore/backupGraph";

const directory = process.env.MYVAULT_GRAPH_WRITER_FIXTURES;
assert.ok(directory, "Set MYVAULT_GRAPH_WRITER_FIXTURES to Android disposable runtime output.");
for (const name of ["linear", "binary", "fork"]) {
  const bundle = JSON.parse(readFileSync(join(directory, `${name}.json`), "utf8"));
  const bytes = (id: string) => {
    assert.ok(id in bundle.objects, `Missing immutable object ${id}`);
    return new Uint8Array(Buffer.from(bundle.objects[id], "base64"));
  };
  const graph = await BackupGraph.discover(bundle.refs.map((objectRef: any) => ({ objectRef, bytes: bytes(objectRef.cloudFileId) })), bundle.accountId, bundle.lineageId);
  if (name === "fork") {
    assert.equal(graph.status, "FORK"); assert.equal(graph.tips.length, 2);
    await assert.rejects(() => reconstructBackupGraph(graph, async (id) => bytes(id)));
  } else {
    assert.equal(graph.status, "SINGLE_TIP");
    const result = await reconstructBackupGraph(graph, async (id) => bytes(id));
    const notes = result.files["notes.json"] as {id: string; bodyPlainText: string}[];
    assert.equal(notes.length, bundle.expectedNoteCount);
    assert.equal(notes.find((n) => n.id === "n")?.bodyPlainText, bundle.expectedBody);
    if (name === "binary") assert.equal(result.binaries!.find((b) => b.attachmentId === "pdf")?.size, 8192);
    else assert.ok(!notes.some((n) => n.id === "two"));
    assert.equal(graph.plan(graph.tips[0]).status, "ALREADY_CURRENT");
  }
  console.log(`PASS Android Room writer → Web reader: ${name}; ${graph.commits.size} immutable commits`);
}
