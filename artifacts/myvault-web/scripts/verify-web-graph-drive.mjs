import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const authModule = process.env.MYVAULT_DISPOSABLE_AUTH_MODULE;
assert.ok(authModule, "Set the local disposable OAuth helper path; never pass tokens through command arguments.");
const token = await (await import(authModule)).disposableAccessToken();
const directory = process.env.MYVAULT_WEB_GRAPH_DRIVE_EVIDENCE ?? mkdtempSync(join(tmpdir(), "myvault-web-graph-drive-"));
await build({ configFile: false, logLevel: "silent", resolve: { alias: { "@": resolve("src") } }, build: { outDir: directory, emptyOutDir: false,
  lib: { entry: "scripts/fixtures/web-graph-drive.ts", name: "WebGraphDrive", formats: ["iife"], fileName: () => "web-graph-drive.js" } } });
const API = "https://www.googleapis.com/drive/v3";
const created = new Set(); const intended = new Set(); const logs = []; const scenarios = []; const contexts = [];
let layout; let server; let rootName; let origin;
async function request(path, method = "GET", body) {
  const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  logs.push({ source: "harness", method, path, status: response.status });
  if (!response.ok) throw new Error(`Disposable Drive request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}
async function folder(name, parent) {
  const file = await request("/files?fields=id", "POST", { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] });
  created.add(file.id); return file.id;
}
async function list(parent) {
  const files = []; let pageToken;
  do {
    const params = new URLSearchParams({ q: `'${parent}' in parents and trashed = false`, fields: "nextPageToken,files(id,name)", pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await request(`/files?${params}`); files.push(...(page.files ?? [])); pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}
async function client(profile) {
  const context = await chromium.launchPersistentContext(profile ?? mkdtempSync(join(tmpdir(), "myvault-disposable-drive-chrome-")), {
    headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  contexts.push(context);
  const parents = new Set(Object.values(layout).filter((v) => v !== layout.lineageId));
  await context.route("**/*", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== "https://www.googleapis.com") return route.abort();
    let allowed = false;
    if (req.method() === "GET" && url.pathname.endsWith("/about")) allowed = true;
    if (req.method() === "GET" && url.pathname.endsWith("/files/generateIds")) allowed = true;
    if (req.method() === "GET" && url.pathname.endsWith("/files")) {
      const q = url.searchParams.get("q") ?? "";
      allowed = [...parents].some((p) => q === `'${p}' in parents and trashed = false`);
    }
    const id = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
    if (req.method() === "GET" && id && (created.has(id) || intended.has(id))) allowed = true;
    if (req.method() === "POST" && url.pathname === "/upload/drive/v3/files") {
      const body = req.postData() ?? "";
      allowed = [...parents].some((p) => body.includes(`"parents":["${p}"]`)) && [...intended].some((i) => body.includes(`"id":"${i}"`));
    }
    if (!allowed) return route.abort();
    const response = await route.fetch();
    if (url.pathname.endsWith("/files/generateIds") && response.ok()) for (const id of (await response.json()).ids) intended.add(id);
    if (req.method() === "POST" && url.pathname === "/upload/drive/v3/files" && response.ok()) {
      const file = await response.json(); assert.ok(intended.has(file.id)); created.add(file.id);
    }
    logs.push({ source: "browser", method: req.method(), path: url.pathname, query: url.searchParams.toString(), status: response.status(),
      uploadedBytes: req.method() === "POST" ? (req.postDataBuffer()?.length ?? 0) : 0,
      readbackBytes: url.searchParams.get("alt") === "media" ? (await response.body()).length : 0 });
    await route.fulfill({ response });
  });
  const page = await context.newPage(); await page.goto(origin);
  await page.addScriptTag({ content: readFileSync(join(directory, "web-graph-drive.js"), "utf8") });
  const identity = await page.evaluate(({ token, layout }) => window.WebGraphDrive.connect(token, layout), { token, layout });
  return { page, context, identity };
}
async function run(name, work) {
  console.log(`START ${name}`);
  const before = logs.length; const start = performance.now(); const value = await work();
  const result = { name, milliseconds: Math.round(performance.now() - start), requests: logs.length - before, value };
  scenarios.push(result); console.log(`PASS ${name}: ${result.milliseconds} ms, ${result.requests} requests`); return value;
}
try {
  rootName = `MYVAULT-GRAPH-DISPOSABLE-WEB-${Date.now()}-${randomUUID()}`;
  const rootId = await folder(rootName, "root");
  layout = { rootId, lineageId: randomUUID() };
  for (const name of ["checkpoints", "commits", "deltas", "binaries"]) layout[name] = await folder(name, rootId);
  server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Disposable Web Graph Drive Test</title>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const profile = mkdtempSync(join(tmpdir(), "myvault-disposable-drive-primary-"));
  let first = await client(profile);
  if (process.env.MYVAULT_GRAPH_TRANSPORT_ONLY === "1") {
    await run("provider digest cache, exact duplicate-create and conflicting-ID rejection", () => first.page.evaluate(() => window.WebGraphDrive.providerContracts()));
  } else {
  await run("immutable synthetic root", () => first.page.evaluate(() => window.WebGraphDrive.root()));
  const zero = await run("zero changes", () => first.page.evaluate(() => window.WebGraphDrive.publish("zero")));
  assert.equal(zero.status, "ALREADY_CURRENT"); assert.equal(zero.metrics.payloadRows, 0);
  for (const kind of ["one-note", "three-notes", "replacement", "metadata-only", "new-attachment", "progress", "delete"]) {
    const result = await run(kind, () => first.page.evaluate((kind) => window.WebGraphDrive.publish(kind), kind));
    if (kind === "metadata-only" || kind === "one-note" || kind === "three-notes") assert.equal(result.metrics.binariesCreated, 0);
    if (kind === "replacement" || kind === "new-attachment") assert.equal(result.metrics.binariesCreated, 1);
    assert.equal(result.metrics.commitsCreated, 1); assert.equal(result.metrics.deltasCreated, 1);
  }
  const verified = await run("verified Web reconstruction", () => first.page.evaluate(() => window.WebGraphDrive.verify()));
  const objects = {};
  for (const role of ["checkpoints", "commits", "deltas", "binaries"]) for (const file of await list(layout[role])) {
    assert.ok(created.has(file.id), "Unknown object in disposable namespace");
    const response = await fetch(`${API}/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok); objects[file.id] = Buffer.from(await response.arrayBuffer()).toString("base64");
  }
  writeFileSync(join(directory, "web-writer.json"), JSON.stringify({ ...first.identity, ...verified, objects }, null, 2));
  const second = await client();
  await run("fresh browser full Restore", () => second.page.evaluate(() => window.WebGraphDrive.restore()));
  const current = await run("already-current Restore", () => second.page.evaluate(() => window.WebGraphDrive.restore()));
  assert.equal(current.status, "ALREADY_CURRENT"); assert.equal(current.metrics.payloadRows, 0);
  const interrupted = await run("commit-before-ack interruption", () => first.page.evaluate(() => window.WebGraphDrive.stageInterrupted("after-commit", "Captured N")));
  await first.page.evaluate(() => window.WebGraphDrive.editNewer());
  await first.context.close(); first = await client(profile);
  const recovered = await run("actual browser restart recovery", () => first.page.evaluate(() => window.WebGraphDrive.publish("zero")));
  assert.equal(recovered.commitId, interrupted.commitId); assert.equal(recovered.metrics.commitsCreated, 0);
  assert.equal(await first.page.evaluate(() => window.WebGraphDrive.pending()), 1);
  await run("N+1 retained and publishable", () => first.page.evaluate(() => window.WebGraphDrive.publish("zero")));
  await run("targeted missing descendants", () => second.page.evaluate(() => window.WebGraphDrive.restore()));
  await first.page.evaluate(() => window.WebGraphDrive.stageInterrupted("after-stage", "Sibling A"));
  await second.page.evaluate(() => window.WebGraphDrive.stageInterrupted("after-stage", "Sibling B"));
  await run("concurrent intent A", () => first.page.evaluate(() => window.WebGraphDrive.publish("zero")));
  await run("concurrent intent B", () => second.page.evaluate(() => window.WebGraphDrive.publish("zero")));
  await run("fork retains both siblings and blocks both routes", () => first.page.evaluate(() => window.WebGraphDrive.fork()));
  }
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  let cleanup = "no root created";
  if (layout?.rootId) {
    for (const role of ["checkpoints", "commits", "deltas", "binaries"]) if (layout[role]) {
      for (const file of await list(layout[role])) {
        assert.ok(created.has(file.id), "Cleanup refused untracked object");
        await request(`/files/${file.id}`, "DELETE");
      }
      await request(`/files/${layout[role]}`, "DELETE");
    }
    await request(`/files/${layout.rootId}`, "DELETE");
    const verify = await fetch(`${API}/files/${layout.rootId}?fields=id`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(verify.status, 404); cleanup = "all created objects removed; root verified 404";
  }
  writeFileSync(join(directory, "drive-results.json"), JSON.stringify({ rootName, rootId: layout?.rootId, scope: "drive.file", scenarios, logs, objectsCreated: created.size, cleanup }, null, 2));
  console.log(`Cleanup: ${cleanup}. Redacted evidence: ${directory}`);
}
