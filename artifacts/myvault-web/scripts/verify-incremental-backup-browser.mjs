import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const directory = process.env.MYVAULT_BACKUP_COMPAT_DIR;
assert.ok(directory);
const fixture = JSON.parse(readFileSync(join(directory, "web.json"), "utf8"));
const baseUrl = process.env.MYVAULT_URL ?? "http://127.0.0.1:19977";
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext(); // Never use the user's browser profile or account.
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return url.origin === new URL(baseUrl).origin ? route.continue() : route.abort();
});
const page = await context.newPage();
try {
  await page.goto(baseUrl);
  const result = await page.evaluate(async (fixture) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const reader = await import("/src/lib/restore/verifiedDriveRestore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const bundle = await reader.stageVerifiedMetadataRestore({
      accessToken: "disposable-no-network", manifest: fixture.manifest,
      download: async (_token, entry) => new Blob([fixture.objects[entry.cloudFileId]]),
      downloadDelta: async (_token, fileId) => new Blob([fixture.objects[fileId]]),
    });
    const makeDraft = (noteId) => ({ schemaVersion: 1, noteId, baseCloudVersion: 100, baseUpdatedAt: 100,
      title: `Local ${noteId}`, mode: "rich_text", richTextDocument: { text: "Keep me", styleMarks: [] },
      blocks: [], isPinned: false, savedAt: 100, pendingDriveSync: true });
    account.setActiveGoogleAccount("backup-fixture-account-B");
    await store.prepareAccountStorage("backup-fixture-account-B");
    await store.saveLocalNoteDraft(makeDraft("explicitly-deleted-note"));
    account.setActiveGoogleAccount("backup-fixture-account-A");
    await store.prepareAccountStorage("backup-fixture-account-A");
    await store.saveLocalNoteDraft(makeDraft("explicitly-deleted-note"));
    await store.saveLocalNoteDraft(makeDraft("unrelated-local-note"));
    const nextBase = { schemaVersion: 1, accountId: account.getActiveAccountId(), revision: await revision.computeBundleRevision(bundle), bundle: structuredClone(bundle) };
    await store.applyMetadataRestorePreservingLocalChangesAtomically(bundle, nextBase, await store.loadLocalVaultGeneration());
    const deleted = await store.loadLocalNoteDraft("explicitly-deleted-note");
    const retained = await store.loadLocalNoteDraft("unrelated-local-note");
    const operations = await store.loadPendingLocalSyncOperations();
    const persisted = await store.loadMetadataRestoreBundle();
    account.setActiveGoogleAccount("backup-fixture-account-B");
    const otherAccount = await store.loadLocalNoteDraft("explicitly-deleted-note");
    account.setActiveGoogleAccount("backup-fixture-account-A");
    // Repeating the same manual restore must be idempotent.
    await store.applyMetadataRestorePreservingLocalChangesAtomically(bundle, nextBase, await store.loadLocalVaultGeneration());
    return { deleted: deleted ?? null, retained: retained?.title, otherAccount: otherAccount?.title,
      pendingIds: operations.map((operation) => operation.entityId), head: persisted?.incrementalBackupState?.headId,
      persistedNoteIds: persisted?.files.find((file) => file.fileName === "notes.json")?.json.map((note) => note.id) };
  }, fixture);
  assert.equal(result.deleted, null);
  assert.equal(result.retained, "Local unrelated-local-note");
  assert.equal(result.otherAccount, "Local explicitly-deleted-note");
  assert.deepEqual(result.pendingIds, ["unrelated-local-note"]);
  assert.equal(result.head, "web-delta-3");
  assert.ok(!result.persistedNoteIds.includes("explicitly-deleted-note"));
  assert.ok(result.persistedNoteIds.includes("note-hadith"));
  await page.screenshot({ path: join(directory, "web-browser-smoke.png"), fullPage: true });
  console.log("PASS production Web reader + IndexedDB apply: exact-ID deletion, unrelated local work, account isolation, persisted head and idempotent repeat. Fresh browser profile; no real Drive requests.");
} finally { await context.close(); await browser.close(); }
