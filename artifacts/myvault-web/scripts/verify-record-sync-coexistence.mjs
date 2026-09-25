import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup.ts";

const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext();
const page = await context.newPage();
const accountId = "record-sync-coexistence-disposable";
const local = representativeAndroidBackup();
const remote = structuredClone(local);
remote.cloudVersion += 1;
remote.files.find((file) => file.fileName === "notes.json").json.find((note) => note.id === "note-hadith").title = "New backup title";
const folderMime = "application/vnd.google-apps.folder";
const objects = new Map();
for (const name of ["MyVault", "metadata", "files", "manifests", "backups"]) {
  objects.set(name, { id: name, name, parents: [name === "MyVault" ? "root" : "MyVault"], mimeType: folderMime, bytes: Buffer.alloc(0) });
}
const entries = remote.files.map((file) => {
  const bytes = Buffer.from(JSON.stringify(file.json));
  const id = `remote-${file.fileName}`;
  objects.set(id, { id, name: file.fileName, parents: ["metadata"], mimeType: "application/json", bytes });
  return { path: `metadata/${file.fileName}`, fileName: file.fileName, backupEntry: file.backupEntry,
    kind: "metadata", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), cloudFileId: id, updatedAt: remote.cloudVersion };
});
for (const entry of remote.fileEntries) {
  objects.set(entry.cloudFileId, { id: entry.cloudFileId, name: entry.fileName, parents: ["files"], mimeType: "application/pdf", bytes: Buffer.alloc(entry.size) });
  entries.push(entry);
}
const manifest = { schemaVersion: 1, storage: "google-drive-api", cloudVersion: remote.cloudVersion,
  layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups", entries };
objects.set("active", { id: "active", name: "sync_manifest.json", parents: ["manifests"], mimeType: "application/json", bytes: Buffer.from(JSON.stringify(manifest)) });
let metadataDownloads = 0;
await context.route("**/api/google-drive-auth", (route) => route.fulfill({ json: {
  accessToken: "coexistence-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file",
} }));
const record = ({ bytes, ...file }) => ({ ...file, size: String(bytes.length) });
await context.route("https://www.googleapis.com/**", async (route) => {
  const request = route.request();
  const parsed = new URL(request.url());
  if (request.method() !== "GET") throw new Error("Coexistence test must not write Drive data.");
  if (parsed.pathname.endsWith("/about")) {
    await route.fulfill({ json: { user: { permissionId: accountId, emailAddress: "fixture@example.invalid" } } });
    return;
  }
  if (parsed.pathname === "/drive/v3/files") {
    const query = parsed.searchParams.get("q") ?? "";
    const name = query.match(/name = '([^']+)'/)?.[1];
    const parent = query.match(/'([^']+)' in parents/)?.[1];
    const files = [...objects.values()].filter((file) => (!name || file.name === name) && (!parent || file.parents.includes(parent)));
    await route.fulfill({ json: { files: files.map(record) } });
    return;
  }
  const id = decodeURIComponent(parsed.pathname.split("/").at(-1));
  const file = objects.get(id);
  if (!file) { await route.fulfill({ status: 404, body: "Missing" }); return; }
  if (parsed.searchParams.get("alt") === "media") {
    if (file.parents.includes("metadata")) metadataDownloads += 1;
    await route.fulfill({ contentType: file.mimeType, body: file.bytes });
    return;
  }
  await route.fulfill({ json: record(file) });
});

try {
  await page.goto(`${process.env.MYVAULT_URL ?? "http://localhost:18899"}/settings`);
  const automaticResult = await page.evaluate(async ({ accountId, local }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const sync = await import("/src/lib/recordSync/store.ts");
    const refresh = await import("/src/lib/sync/driveRefresh.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    account.setActiveGoogleAccount(accountId);
    await store.prepareAccountStorage(accountId);
    await store.clearLocalWorkspaceData();
    await store.saveMetadataRestoreBundle(local);
    await store.saveLocalSyncBase({ schemaVersion: 1, accountId, revision: await revision.computeBundleRevision(local), bundle: local });
    await sync.saveRecordSyncControl({ accountId, clientId: "fixture-client", enabled: true, paused: false, cursor: "fixture-cursor" });
    const token = { accessToken: "coexistence-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" };
    identity.rememberGoogleDriveToken(token);
    const automatic = await refresh.refreshLatestDriveMetadataSafely(token, accountId);
    const titleBefore = (await store.loadMetadataRestoreBundle()).files.find((file) => file.fileName === "notes.json").json.find((note) => note.id === "note-hadith").title;
    return { automaticStaged: automatic.staged, titleBefore };
  }, { accountId, local });
  assert.equal(automaticResult.automaticStaged, true);
  assert.equal(automaticResult.titleBefore, "Hadith on reliance");
  assert.equal(metadataDownloads, 0, "Automatic refresh must not download or apply the backup bundle.");

  const result = await page.evaluate(async (accountId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const sync = await import("/src/lib/recordSync/store.ts");
    const refresh = await import("/src/lib/sync/driveRefresh.ts");
    const engine = await import("/src/lib/recordSync/engine.ts");
    const token = { accessToken: "coexistence-test-token", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/drive.file" };
    const manual = await refresh.refreshLatestDriveMetadataSafely(token, accountId, true);
    const control = await sync.loadRecordSyncControl(accountId);
    const titleAfter = (await store.loadMetadataRestoreBundle()).files.find((file) => file.fileName === "notes.json").json.find((note) => note.id === "note-hadith").title;
    let reenrolBlocked = false;
    try { await engine.enrolRecordSync({ token, accountId }); } catch (error) { reenrolBlocked = String(error).includes("reconcile"); }
    return { manualStaged: manual.staged, titleAfter, control, reenrolBlocked };
  }, accountId);
  assert.equal(result.manualStaged, false);
  assert.equal(result.titleAfter, "New backup title");
  assert.equal(result.control.enabled, false);
  assert.equal(result.control.paused, true);
  assert.equal(result.control.restoreReconciliationRequired, true);
  assert.equal(result.reenrolBlocked, true);
  assert.ok(metadataDownloads > 0, "Explicit Restore should download backup metadata.");
  console.log("Record-sync coexistence: automatic refresh gated; explicit Restore applied and paused sync for reconciliation.");
} finally {
  await browser.close();
}
