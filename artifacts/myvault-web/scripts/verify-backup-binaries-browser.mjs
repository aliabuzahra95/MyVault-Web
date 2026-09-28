import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const directory = process.env.MYVAULT_BINARY_COMPAT_DIR;
assert.ok(directory);
const fixture = JSON.parse(readFileSync(join(directory, "web.json"), "utf8"));
const baseUrl = process.env.MYVAULT_URL ?? "http://127.0.0.1:19977";
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext();
await context.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseUrl).origin ? route.continue() : route.abort());
const page = await context.newPage();
try {
  await page.goto(baseUrl);
  assert.ok(await page.locator("body").innerText(), "Development page should not be blank");
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  const result = await page.evaluate(async (fixture) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const reader = await import("/src/lib/restore/verifiedDriveRestore.ts");
    const claims = await import("/src/lib/restore/attachmentFileRestore.ts");
    const bytes = (id) => {
      if (!(id in fixture.objects)) throw new Error("Missing fixture object");
      return Uint8Array.from(atob(fixture.objects[id]), (character) => character.charCodeAt(0));
    };
    const bundle = await reader.stageVerifiedMetadataRestore({ accessToken: "no-network", manifest: fixture.manifest,
      download: async (_token, entry) => new Blob([bytes(entry.cloudFileId)]),
      downloadDelta: async (_token, id) => new Blob([bytes(id)]),
      downloadBinary: async (_token, entry) => new Blob([bytes(entry.cloudFileId)]),
    });
    account.setActiveGoogleAccount("disposable-binary-account");
    await store.prepareAccountStorage("disposable-binary-account");
    await store.saveMetadataRestoreBundle(bundle);
    const checkpointEntry = fixture.manifest.entries.find((entry) => entry.backupEntry === "files/pdf-aqidah");
    await store.saveLocalAttachmentBlob("pdf-aqidah", new Blob([bytes(checkpointEntry.cloudFileId)]));
    const stale = await store.loadLocalAttachmentBlob("pdf-aqidah");
    const claim = await claims.getAttachmentFileClaim("pdf-aqidah");
    const replacement = new Blob([bytes(claim.manifestEntry.cloudFileId)]);
    await claims.verifyAttachmentFileClaim(claim, replacement);
    await store.saveLocalAttachmentBlob("pdf-aqidah", replacement);
    const correct = await store.loadLocalAttachmentBlob("pdf-aqidah");
    let corruptRejected = false; let checkpointCacheRejected = false; let missingMappingRejected = false;
    try { await claims.verifyAttachmentFileClaim(claim, new Blob([new Uint8Array(8192)])); } catch { corruptRejected = true; }
    try { await claims.cacheAttachmentManifestEntries(fixture.manifest.entries); } catch { checkpointCacheRejected = true; }
    const missing = { ...bundle, fileEntries: bundle.fileEntries.filter((entry) => entry.backupEntry !== "files/pdf-aqidah") };
    await store.saveMetadataRestoreBundle(missing);
    try { await claims.getAttachmentFileClaim("pdf-aqidah"); } catch { missingMappingRejected = true; }
    await store.saveMetadataRestoreBundle(bundle);
    // Legacy restored bundles retain their existing cache behavior.
    account.setActiveGoogleAccount("disposable-legacy-account");
    await store.prepareAccountStorage("disposable-legacy-account");
    const legacy = { ...bundle }; delete legacy.binaryDescriptorsVerified;
    await store.saveMetadataRestoreBundle(legacy);
    await store.saveLocalAttachmentBlob("pdf-aqidah", new Blob([bytes(checkpointEntry.cloudFileId)]));
    const historicalCache = await store.loadLocalAttachmentBlob("pdf-aqidah");
    account.setActiveGoogleAccount("disposable-binary-account");
    return { stale: stale === null, size: correct.size, cloudFileId: claim.manifestEntry.cloudFileId,
      corruptRejected, checkpointCacheRejected, missingMappingRejected, historicalSize: historicalCache.size };
  }, fixture);
  assert.deepEqual(result, { stale: true, size: 8192, cloudFileId: "web-replacement-8192", corruptRejected: true,
    checkpointCacheRejected: true, missingMappingRejected: true, historicalSize: 4096 });
  await page.reload();
  const persisted = await page.evaluate(async () => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const claims = await import("/src/lib/restore/attachmentFileRestore.ts");
    account.setActiveGoogleAccount("disposable-binary-account");
    return { size: (await store.loadLocalAttachmentBlob("pdf-aqidah")).size,
      objectId: (await claims.getAttachmentFileClaim("pdf-aqidah")).manifestEntry.cloudFileId };
  });
  assert.deepEqual(persisted, { size: 8192, objectId: "web-replacement-8192" });
  console.log("PASS actual Web IndexedDB/cache: stale 4096-byte cache rejected; verified 8192-byte replacement retained across reload; corrupt/missing replacements and checkpoint fallback rejected; legacy cache unchanged. Fresh isolated browser, external requests blocked.");
} finally { await context.close(); await browser.close(); }
