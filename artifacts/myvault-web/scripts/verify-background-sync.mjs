import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup.ts";

const url = process.env.MYVAULT_URL ?? "http://localhost:18899";
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const accountId = "background-disposable-account";
const fixture = representativeAndroidBackup();
// Exercise the actual Course-note editor, using the same production note model.
fixture.files.find((file) => file.fileName === "notes.json").json.find((note) => note.id === "note-tawakkul").folderId = "folder-course";
const remote = structuredClone(fixture);
remote.cloudVersion += 10;
remote.files.find((file) => file.fileName === "notes.json").json.find((note) => note.id === "note-hadith").title = "Incoming Android title";
const folderMime = "application/vnd.google-apps.folder";
const objects = new Map();
for (const name of ["MyVault", "metadata", "files", "manifests", "backups"]) {
  objects.set(name, { id: name, name, parents: [name === "MyVault" ? "root" : "MyVault"], mimeType: folderMime, bytes: Buffer.alloc(0) });
}
const entries = remote.files.map((file) => {
  const bytes = Buffer.from(JSON.stringify(file.json));
  const id = `new-${file.fileName}`;
  objects.set(id, { id, name: file.fileName, parents: ["metadata"], mimeType: "application/json", bytes });
  return { path: `metadata/${file.fileName}`, fileName: file.fileName, backupEntry: file.backupEntry, kind: "metadata", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), cloudFileId: id, updatedAt: remote.cloudVersion };
});
for (const entry of remote.fileEntries) {
  objects.set(entry.cloudFileId, { id: entry.cloudFileId, name: entry.fileName, parents: ["files"], mimeType: "application/pdf", bytes: Buffer.alloc(entry.size) });
  entries.push(entry);
}
const manifest = { schemaVersion: 1, storage: "google-drive-api", cloudVersion: remote.cloudVersion, layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups", entries };
objects.set("active", { id: "active", name: "sync_manifest.json", parents: ["manifests"], mimeType: "application/json", bytes: Buffer.from(JSON.stringify(manifest)) });
let releaseDownloads;
let barrier = new Promise((resolve) => { releaseDownloads = resolve; });
let metadataGets = 0;
let firstMetadataStarted;
const firstMetadata = new Promise((resolve) => { firstMetadataStarted = resolve; });
let manifestGets = 0;
let offline = false;
let changeManifestDuringDownload = false;
await context.route("**/api/google-drive-auth", (route) => route.fulfill({ json: { accessToken: "background-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" } }));
const record = ({ bytes, ...file }) => ({ ...file, size: String(bytes.length) });
await context.route("https://www.googleapis.com/**", async (route) => {
  const request = route.request();
  const parsed = new URL(request.url());
  if (offline) { await route.fulfill({ status: 503, body: "Unavailable" }); return; }
  if (request.method() !== "GET") throw new Error("The background checker must not write to Drive.");
  if (parsed.pathname.endsWith("/about")) { await route.fulfill({ json: { user: { permissionId: request.headers().authorization?.includes("account-b-token") ? "other-disposable-account" : accountId, emailAddress: "fixture@example.invalid" } } }); return; }
  if (parsed.pathname === "/drive/v3/files") {
    const query = parsed.searchParams.get("q") ?? "";
    const name = query.match(/name = '([^']+)'/)?.[1];
    const parent = query.match(/'([^']+)' in parents/)?.[1];
    const files = [...objects.values()].filter((file) => (!name || file.name === name) && (!parent || file.parents.includes(parent)));
    await route.fulfill({ json: { files: files.map(record) } }); return;
  }
  const id = decodeURIComponent(parsed.pathname.split("/").at(-1));
  const file = objects.get(id);
  if (!file) { await route.fulfill({ status: 404, body: "Missing" }); return; }
  if (parsed.searchParams.get("alt") === "media") {
    if (file.parents.includes("metadata")) {
      metadataGets++; firstMetadataStarted(); await barrier;
      if (changeManifestDuringDownload) {
        changeManifestDuringDownload = false;
        manifest.cloudVersion++;
        objects.get("active").bytes = Buffer.from(JSON.stringify(manifest));
      }
    }
    if (id === "active") manifestGets++;
    await route.fulfill({ contentType: file.mimeType, body: file.bytes }); return;
  }
  await route.fulfill({ json: record(file) });
});

try {
  await page.goto(`${url}/settings`);
  await page.evaluate(async ({ fixture, accountId }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    account.setActiveGoogleAccount(accountId);
    await store.prepareAccountStorage(accountId);
    await store.clearLocalWorkspaceData();
    await store.saveMetadataRestoreBundle(fixture);
    await store.saveLocalSyncBase({ schemaVersion: 1, accountId, revision: await revision.computeBundleRevision(fixture), bundle: fixture });
    const identity = await import("/src/lib/googleDrive/identity.ts");
    identity.rememberGoogleDriveToken({ accessToken: "background-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" });
  }, { fixture, accountId });

  const started = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("nav-dashboard").waitFor();
  const shellMs = Date.now() - started;
  assert.equal(await page.getByText("Checking your latest MyVault backup", { exact: true }).count(), 0);
  await page.waitForFunction(() => document.querySelector('[data-testid="drive-background-status"]')?.textContent?.includes("Downloading"));
  await firstMetadata;
  assert.ok(metadataGets > 0);
  const downloadStartedMs = Date.now() - started;
  await page.evaluate(() => { window.history.pushState({}, "", "/courses/course-fiqh/notes/note-tawakkul"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.getByTestId("note-title").waitFor();
  const localNoteReadyMs = Date.now() - started;
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor();
  const typingStart = Date.now();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially("Typed during the Drive download.");
  const typingMs = Date.now() - typingStart;
  releaseDownloads();
  await page.waitForFunction(() => document.querySelector('[data-testid="drive-background-status"]')?.textContent?.includes("Update ready"));
  assert.match(await editor.innerText(), /Typed during the Drive download/);
  await page.screenshot({ path: "/tmp/myvault-background-editor-staged.png", fullPage: true });
  const staged = await page.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    return { localVersion: (await store.loadMetadataRestoreBundle()).cloudVersion, incomingVersion: (await store.loadStagedIncomingDriveBundle()).bundle.cloudVersion };
  });
  assert.equal(staged.localVersion, fixture.cloudVersion);
  assert.equal(staged.incomingVersion, remote.cloudVersion);

  await page.getByTestId("nav-settings").click();
  await page.waitForFunction(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    return (await store.loadLocalNoteDraft("note-tawakkul"))?.richTextDocument?.text.includes("Typed during the Drive download");
  });
  const retry = await page.evaluate(async (accountId) => {
    const refresh = await import("/src/lib/sync/driveRefresh.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    return refresh.refreshLatestDriveMetadataSafely(identity.getCachedGoogleDriveToken(), accountId);
  }, accountId);
  assert.equal(retry.staged, false);
  assert.equal(retry.metadataRestore.cloudVersion, remote.cloudVersion);
  const beforeUnchanged = metadataGets;
  await page.evaluate(async (accountId) => {
    const refresh = await import("/src/lib/sync/driveRefresh.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    await refresh.refreshLatestDriveMetadataSafely(identity.getCachedGoogleDriveToken(), accountId);
  }, accountId);
  assert.equal(metadataGets, beforeUnchanged, "An unchanged committed manifest must not redownload metadata.");

  manifest.cloudVersion++;
  objects.get("active").bytes = Buffer.from(JSON.stringify(manifest));
  changeManifestDuringDownload = true;
  const mixed = await page.evaluate(async (accountId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const refresh = await import("/src/lib/sync/driveRefresh.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    const before = JSON.stringify(await store.loadMetadataRestoreBundle());
    let message = "";
    try { await refresh.refreshLatestDriveMetadataSafely(identity.getCachedGoogleDriveToken(), accountId); } catch (error) { message = error.message; }
    return { message, preserved: before === JSON.stringify(await store.loadMetadataRestoreBundle()) };
  }, accountId);
  assert.match(mixed.message, /Drive changed during the download/);
  assert.equal(mixed.preserved, true);

  const failedSave = await page.evaluate(async (accountId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const lease = await import("/src/lib/sync/editorLease.ts");
    const draft = { ...await store.loadLocalNoteDraft("note-tawakkul"), title: "Recovered after quota failure" };
    const release = await lease.acquireNoteEditorLease(accountId);
    const generation = await store.loadLocalVaultGeneration();
    const operationCount = (await store.loadPendingLocalSyncOperations()).length;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (value?.noteId === draft.noteId && value?.title === draft.title) throw new DOMException("Fixture quota", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
    let refused = false;
    try { await store.saveLocalNoteDraft(draft, accountId); } catch { refused = true; }
    lease.retainFailedEditorSave(accountId, draft, release);
    let blocked = false;
    try { await lease.withLocalVaultUpdate(accountId, async () => true); } catch { blocked = true; }
    const unchanged = generation === await store.loadLocalVaultGeneration() && operationCount === (await store.loadPendingLocalSyncOperations()).length;
    IDBObjectStore.prototype.put = originalPut;
    const retained = lease.hasFailedEditorSaves(accountId);
    await lease.retryFailedEditorSaves(accountId);
    return { refused, blocked, unchanged, retained, recovered: (await store.loadLocalNoteDraft(draft.noteId)).title, released: !lease.hasFailedEditorSaves(accountId) };
  }, accountId);
  assert.deepEqual(failedSave, { refused: true, blocked: true, unchanged: true, retained: true, recovered: "Recovered after quota failure", released: true });

  const races = await page.evaluate(async (accountId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const account = await import("/src/lib/sync/accountContext.ts");
    const base = await store.loadLocalSyncBase();
    const draft = await store.loadLocalNoteDraft("note-tawakkul");
    const generation = await store.loadLocalVaultGeneration();
    await store.saveLocalNoteDraft({ ...draft, title: "Later edit survives upload" });
    const settled = await store.settlePublishedDriveBundle(base.bundle, base, generation);
    let rejected = false;
    try { await store.applyMetadataRestorePreservingLocalChangesAtomically(base.bundle, base, generation); } catch { rejected = true; }
    const kept = await store.loadLocalNoteDraft(draft.noteId);
    const identity = await import("/src/lib/googleDrive/identity.ts");
    identity.rememberGoogleDriveToken({ accessToken: "account-b-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" });
    account.setActiveGoogleAccount("other-disposable-account");
    await store.saveLocalNoteDraft({ ...draft, title: "Late account A autosave" }, accountId);
    const other = await store.loadLocalNoteDraft(draft.noteId);
    identity.rememberGoogleDriveToken({ accessToken: "background-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" });
    account.setActiveGoogleAccount(accountId);
    return { settled, rejected, kept: kept.title, other, original: (await store.loadLocalNoteDraft(draft.noteId)).title };
  }, accountId);
  assert.deepEqual(races, { settled: false, rejected: true, kept: "Later edit survives upload", other: null, original: "Late account A autosave" });

  const otherPage = await context.newPage();
  await otherPage.goto(`${url}/settings`);
  await otherPage.evaluate(async (accountId) => { const lease = await import("/src/lib/sync/editorLease.ts"); window.releaseFixtureLease = await lease.acquireNoteEditorLease(accountId); }, accountId);
  const blocked = await page.evaluate(async (accountId) => {
    const lease = await import("/src/lib/sync/editorLease.ts");
    try { await lease.withLocalVaultUpdate(accountId, async () => true); return false; } catch { return true; }
  }, accountId);
  assert.equal(blocked, true, "A different tab's editor must prevent local replacement.");
  await otherPage.evaluate(() => window.releaseFixtureLease());
  await otherPage.close();

  offline = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("nav-dashboard").waitFor();
  await page.getByTestId("nav-dashboard").click();
  await page.waitForFunction(() => /Drive unavailable|Update needs review/.test(document.querySelector('[data-testid="drive-background-status"]')?.textContent ?? ""));
  await page.screenshot({ path: "/tmp/myvault-offline-cached-shell.png", fullPage: true });
  assert.equal(await page.getByText("Checking your latest MyVault backup", { exact: true }).count(), 0);
  console.log(JSON.stringify({ result: "PASS", shellMs, downloadStartedMs, localNoteReadyMs, typingMs, metadataGets, manifestGets, checks: ["delayed-download-shell", "course-editor-typing", "staged-update", "autosave-flush", "retry-apply", "unchanged-skip", "manifest-changed-during-download", "quota-atomic-rollback", "failed-save-recovery", "late-edit-not-cleared", "atomic-generation-check", "late-account-save", "cross-tab-editor", "offline-shell"] }, null, 2));
} finally {
  releaseDownloads();
  await browser.close();
}
