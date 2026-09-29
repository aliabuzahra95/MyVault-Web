import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const directory = process.env.MYVAULT_WEB_GRAPH_EVIDENCE ?? mkdtempSync(join(tmpdir(), "myvault-web-graph-"));
await build({ configFile: false, logLevel: "silent", resolve: { alias: { "@": resolve("src") } }, build: { outDir: directory, emptyOutDir: false,
  lib: { entry: "scripts/fixtures/web-graph-runtime.ts", name: "WebGraphTests", formats: ["iife"], fileName: () => "web-graph-runtime.js" } } });
const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Disposable Web Graph Recovery Tests</title>"); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launch = { headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" };
const profile = mkdtempSync(join(tmpdir(), "myvault-disposable-chrome-"));
let context = await chromium.launchPersistentContext(profile, launch);
try {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(origin);
  const sentinel = { title: "Existing العربية", richText: "<b>Never rewrite</b>", ids: ["stable-note", "stable-pdf"] };
  await page.evaluate(async (sentinel) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("myvault-web-restore", 9);
      request.onupgradeneeded = () => request.result.createObjectStore("metadata-bundles");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction("metadata-bundles", "readwrite");
        tx.objectStore("metadata-bundles").put(sentinel, "migration-sentinel");
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }, sentinel);
  await page.addScriptTag({ content: readFileSync(join(directory, "web-graph-runtime.js"), "utf8") });
  const result = await page.evaluate(() => window.WebGraphTests.runWebGraphRuntime());
  assert.deepEqual(errors, []); assert.equal(result.gateDisabled, true);
  writeFileSync(join(directory, "web-writer.json"), JSON.stringify(result.writerFixture, null, 2));
  writeFileSync(join(directory, "runtime-results.json"), JSON.stringify({ passed: result.tests }, null, 2));
  const preserved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore");
    request.onsuccess = () => { const db = request.result; const tx = db.transaction("metadata-bundles"); const r = tx.objectStore("metadata-bundles").get("migration-sentinel");
      r.onsuccess = () => { resolve({ version: db.version, sentinel: r.result }); db.close(); }; };
    request.onerror = () => reject(request.error);
  }));
  assert.equal(preserved.version, 10); assert.deepEqual(preserved.sentinel, sentinel);
  await context.close();
  context = await chromium.launchPersistentContext(profile, launch);
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const restarted = await context.newPage(); await restarted.goto(origin);
  await restarted.addScriptTag({ content: readFileSync(join(directory, "web-graph-runtime.js"), "utf8") });
  const recovery = await restarted.evaluate((fixture) => window.WebGraphTests.resumeAfterBrowserRestart(fixture), result.restartFixture);
  assert.equal(recovery.createdObjects, 0); assert.equal(recovery.retainedNewerEdit, true);
  const coldProfile = mkdtempSync(join(tmpdir(), "myvault-disposable-cold-chrome-"));
  const coldContext = await chromium.launchPersistentContext(coldProfile, launch);
  let cold;
  try {
    await coldContext.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const coldPage = await coldContext.newPage(); await coldPage.goto(origin);
    await coldPage.addScriptTag({ content: readFileSync(join(directory, "web-graph-runtime.js"), "utf8") });
    cold = await coldPage.evaluate((fixture) => window.WebGraphTests.coldRestoreWebWriter(fixture), result.writerFixture);
  } finally { await coldContext.close(); }
  writeFileSync(join(directory, "runtime-results.json"), JSON.stringify({ passed: [...result.tests, "IndexedDB 9 to 10 preserves existing data", "actual Chrome process restart retains exact intent and N+1", "fresh client cold Restore then already current"], recovery, cold }, null, 2));
  console.log(`PASS ${result.tests.length} real Chromium/IndexedDB graph runtime cases.`);
  for (const name of result.tests) console.log(`PASS ${name}`);
  console.log(`Evidence: ${directory}`);
} finally {
  await context.close(); await new Promise((resolve) => server.close(resolve));
}
