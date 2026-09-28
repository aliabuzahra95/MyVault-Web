import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { build } from "vite";

const directory = process.env.MYVAULT_GRAPH_COMPAT_DIR;
assert.ok(directory, "Set MYVAULT_GRAPH_COMPAT_DIR to the disposable cross-client fixtures.");
const output = join(directory, "graph-browser.js");
await build({ configFile: false, logLevel: "silent", build: { emptyOutDir: false, outDir: directory,
  lib: { entry: "src/lib/restore/backupGraph.ts", name: "MyVaultGraph", formats: ["iife"], fileName: () => "graph-browser.js" } } });
// A loopback-only blank harness provides WebCrypto's secure context; no application/account storage is opened.
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Disposable Backup Graph Codec Test</title><p>Backup Graph codec fixture test</p>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext();
try {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(baseUrl);
  await page.addScriptTag({ content: readFileSync(output, "utf8") });
  for (const origin of ["web", "android"]) {
    const bundle = JSON.parse(readFileSync(join(directory, `${origin}.json`), "utf8"));
    const results = await page.evaluate(async (bundle) => {
      const api = window.MyVaultGraph;
      window.fetch = async () => { throw new Error("Network forbidden"); };
      if (!window.isSecureContext || !crypto.subtle) throw new Error("Browser WebCrypto missing");
      const bytes = (id) => {
        if (!(id in bundle.objects)) throw new Error(`Missing fixture ${id}`);
        return Uint8Array.from(atob(bundle.objects[id]), (c) => c.charCodeAt(0));
      };
      const summaries = [];
      for (const fixture of bundle.cases) {
        const graph = await api.BackupGraph.discover(fixture.refs.map((objectRef) => ({ objectRef, bytes: bytes(objectRef.cloudFileId) })), bundle.accountId, bundle.lineageId);
        const plan = fixture.name === "historical" ? api.historicalGraphPlan() : graph.plan(fixture.applied);
        if (fixture.restore) {
          const result = await api.reconstructBackupGraph(graph, async (id) => bytes(id));
          if (result.binaries.find((b) => b.attachmentId === "pdf").size !== fixture.restore.pdfSize) throw new Error("Wrong binary");
          if (result.files["notes.json"].find((n) => n.id === "n").bodyPlainText !== fixture.restore.body) throw new Error("Wrong bilingual note");
        }
        summaries.push({ name: fixture.name, status: plan.status, roots: graph.roots, tips: graph.tips, valid: [...graph.commits.keys()].sort(),
          ordered: plan.commits.map((c) => c.commitId), descendants: plan.descendants.map((c) => c.commitId), deltas: plan.deltas.map((d) => d.deltaId),
          capabilities: plan.commits.map((c) => c.requiredReaders), checkpoint: plan.checkpoint?.checkpointId ?? null });
      }
      const vector = api.encodeGraphCommit(bundle.vector.intent);
      const original = bytes(bundle.vector.ref.cloudFileId);
      if (vector.length !== original.length || !vector.every((b, i) => b === original[i])) throw new Error("Canonical bytes differ in Chrome");
      return summaries;
    }, bundle);
    assert.deepEqual(results, JSON.parse(readFileSync(join(directory, `web-read-${origin}.json`), "utf8")));
  }
  if (process.env.MYVAULT_GRAPH_WRITER_FIXTURES) {
    for (const name of ["linear", "binary", "fork"]) {
      const bundle = JSON.parse(readFileSync(join(process.env.MYVAULT_GRAPH_WRITER_FIXTURES, `${name}.json`), "utf8"));
      await page.evaluate(async ({ bundle, name }) => {
        const api = window.MyVaultGraph;
        const bytes = (id) => Uint8Array.from(atob(bundle.objects[id]), (c) => c.charCodeAt(0));
        const graph = await api.BackupGraph.discover(bundle.refs.map((objectRef) => ({ objectRef, bytes: bytes(objectRef.cloudFileId) })), bundle.accountId, bundle.lineageId);
        if (name === "fork") {
          if (graph.status !== "FORK" || graph.tips.length !== 2) throw new Error("Writer siblings lost");
        } else {
          const result = await api.reconstructBackupGraph(graph, async (id) => bytes(id));
          const notes = result.files["notes.json"];
          if (notes.length !== bundle.expectedNoteCount || notes.find((n) => n.id === "n").bodyPlainText !== bundle.expectedBody) throw new Error("Writer note/deletion mismatch");
          if (name === "binary" && result.binaries.find((b) => b.attachmentId === "pdf").size !== 8192) throw new Error("Writer replacement mismatch");
        }
      }, { bundle, name });
    }
    console.log("PASS Android disposable Room writer objects in fresh Chrome: linear, binary replacement and fork.");
  }
  assert.deepEqual(errors, []);
  console.log("PASS fresh Chrome WebCrypto/UTF-8 codec: all Android and Web cases agree with host readers, including 8192-byte replacement. No application storage, Drive, sign-in or user data.");
} finally {
  await context.close(); await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
