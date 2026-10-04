import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "vite";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const directory = mkdtempSync(join(tmpdir(), "myvault-drive-ui-race-"));
const mocks = resolve("scripts/fixtures/drive-connection-mocks.ts");
await build({ configFile: false, logLevel: "silent", esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": '"production"' },
  plugins: process.env.MYVAULT_VERIFY_HOOK_REF ? [{ name: "verify-previous-hook", enforce: "pre",
    load(id) {
      if (id === resolve("src/hooks/useGoogleDriveConnection.ts")) {
        return execFileSync("git", ["show", `${process.env.MYVAULT_VERIFY_HOOK_REF}:artifacts/myvault-web/src/hooks/useGoogleDriveConnection.ts`], { encoding: "utf8" });
      }
    },
  }] : [],
  resolve: { alias: [
    ...["googleDrive/identity", "googleDrive/accountSession", "restore/localRestoreStore", "sync/accountContext", "sync/driveRefresh"]
      .map((name) => ({ find: `@/lib/${name}`, replacement: mocks })),
    { find: "@", replacement: resolve("src") },
  ] },
  build: { outDir: directory, lib: { entry: "scripts/fixtures/drive-connection-race.tsx", name: "DriveConnectionRace", formats: ["iife"], fileName: () => "race.js" } },
});
const server = createServer((_request, response) => response.end("<!doctype html><title>Disposable Restore UI tests</title>"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.addScriptTag({ content: readFileSync(join(directory, "race.js"), "utf8") });
  const tests = await page.evaluate(() => window.DriveConnectionRace.runConnectionRaceTests());
  assert.equal(tests.length, 4);
  for (const test of tests) console.log(`PASS ${test}`);
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
