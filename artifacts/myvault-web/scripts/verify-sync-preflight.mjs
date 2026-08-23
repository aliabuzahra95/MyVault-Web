import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { strFromU8, unzipSync } from "fflate";

const baseUrl = process.env.MYVAULT_URL ?? "http://localhost:18899";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const now = 1787125200000;
const restoredPdfBytes = "restored-pdf";
const restoredPdfSha256 = createHash("sha256").update(restoredPdfBytes).digest("hex");
const richText = (text) => ({ text, styleMarks: [], noteLinks: [] });
const files = [
  ["manifest.json", { format: "myvault-backup", version: 1 }],
  ["folders.json", [
    { id: "study-root", parentId: null, name: "Study", description: null, orderIndex: 0, isFavourite: false, mode: "study", createdAt: now, updatedAt: now, deletedAt: null, preservedField: "keep-folder" },
    { id: "library-root", parentId: null, name: "Library", description: null, orderIndex: 0, isFavourite: false, mode: "library", createdAt: now, updatedAt: now, deletedAt: null },
    { id: "course-root", parentId: null, name: "Course", description: null, orderIndex: 0, isFavourite: false, mode: "course:course-1", createdAt: now, updatedAt: now, deletedAt: null },
  ]],
  ["notes.json", [{ id: "note-1", folderId: "study-root", parentNoteId: null, title: "Restored note", bodyPlainText: JSON.stringify(richText("Original")), isPinned: false, isFolderPinned: false, isFavourite: false, orderIndex: 0, createdAt: now, updatedAt: now, deletedAt: null, preservedField: "keep-note" }]],
  ["blocks.json", []],
  ["attachments.json", [{ id: "attachment-1", noteId: null, libraryFolderId: "library-root", fileName: "Restored.pdf", mimeType: "application/pdf", sizeBytes: 1200, localPath: "/old/path", remoteUrl: null, isPinned: false, createdAt: now, deletedAt: null }]],
  ["pdf_reading_progress.json", [{ attachmentId: "attachment-1", pageIndex: 0, pageCount: 10, progressPercent: 0.1, lastOpenedAt: now, updatedAt: now, preservedField: "keep-progress" }]],
  ["pdf_annotations.json", []],
  ["folder_sticky_notes.json", []],
  ["courses.json", [{ id: "course-1", title: "Fiqh", rootFolderId: "course-root", lastOpenedNoteId: null, createdAt: now, updatedAt: now }]],
  ["course_concept_cards.json", []],
  ["tags.json", []],
  ["note_tags.json", []],
  ["note_tables.json", []],
  ["ai_history.json", [{ id: "private-ai-row", preservedField: "untouched" }]],
].map(([fileName, json], index) => ({
  fileName,
  entryPath: `metadata/${fileName}`,
  backupEntry: fileName,
  cloudFileId: `cloud-${index}`,
  size: JSON.stringify(json).length,
  updatedAt: now,
  itemCount: Array.isArray(json) ? json.length : null,
  json,
}));

const bundle = {
  schemaVersion: 1,
  restoredAt: new Date(now).toISOString(),
  cloudVersion: 42,
  driveEntryCount: files.length,
  metadataFileCount: files.length,
  metadataBytes: files.reduce((total, file) => total + file.size, 0),
  files,
  fileEntries: [{ path: "files/attachment-1", fileName: "Restored.pdf", backupEntry: "files/attachment-1", kind: "file", sha256: restoredPdfSha256, size: restoredPdfBytes.length, cloudFileId: "drive-attachment-1", updatedAt: now }],
  counts: { courses: 1, folders: 3, notes: 1, blocks: 0, attachments: 1, tags: 0, stickyNotes: 0, pdfAnnotations: 0 },
  groupSummaries: [],
  issues: [],
};
const sourceSnapshot = JSON.stringify(bundle);

await page.goto(`${baseUrl}/settings`);
await page.evaluate(async ({ bundle, now }) => {
  await new Promise((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase("myvault-web-restore");
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error("Database deletion was blocked."));
  });
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore", 7);
    request.onupgradeneeded = () => {
      [
        "metadata-bundles", "note-drafts", "created-folders", "created-notes", "created-attachments",
        "attachment-blobs", "pdf-reader-state", "pdf-annotation-changes", "created-course-folders",
        "created-course-sticky-notes", "created-course-concepts",
      ].forEach((name) => request.result.createObjectStore(name));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const put = (storeName, value, key) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  await put("metadata-bundles", bundle, "current");
  await put("note-drafts", { schemaVersion: 1, noteId: "note-1", baseCloudVersion: 41, baseUpdatedAt: now, title: "Edited restored note", mode: "rich_text", richTextDocument: { text: "Edited safely", styleMarks: [{ start: 0, end: 6, style: "Bold" }], noteLinks: [] }, blocks: [], isPinned: true, savedAt: now + 1, pendingDriveSync: true }, "note-1");
  await put("note-drafts", { schemaVersion: 1, noteId: "in1", baseCloudVersion: 0, baseUpdatedAt: now, title: "Tawakkul — Complete Reliance on Allah", mode: "rich_text", richTextDocument: { text: "Legacy demo", styleMarks: [], noteLinks: [] }, blocks: [], isPinned: true, savedAt: now, pendingDriveSync: true }, "in1");
  await put("created-folders", { id: "web-study-folder", parentId: "study-root", title: "Web research", description: null, mode: "study", workspace: "islamic_corpus", orderIndex: 1, createdAt: now, updatedAt: now }, "web-study-folder");
  await put("created-notes", { id: "web-note", folderId: "web-study-folder", parentNoteId: null, title: "Web note", bodyPreview: "", wordCount: 0, characterCount: 0, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: now, updatedAt: now }, "web-note");
  await put("created-notes", { id: "web-course-note", folderId: "web-course-folder", parentNoteId: null, title: "Web lesson", bodyPreview: "", wordCount: 0, characterCount: 0, isPinned: false, isFolderPinned: false, orderIndex: 0, tagNames: [], createdAt: now, updatedAt: now }, "web-course-note");
  await put("note-drafts", { schemaVersion: 1, noteId: "web-course-note", baseCloudVersion: 42, baseUpdatedAt: now, title: "Web lesson", mode: "rich_text", richTextDocument: { text: "Course notes", styleMarks: [], noteLinks: [] }, blocks: [], isPinned: false, savedAt: now + 2, pendingDriveSync: true }, "web-course-note");
  await put("created-attachments", { id: "web-file-1", noteId: null, libraryFolderId: "library-root", name: "New source.pdf", mimeType: "application/pdf", sizeBytes: 8, isPinned: false, readingProgressPercent: 0, createdAt: now, updatedAt: now }, "web-file-1");
  await put("attachment-blobs", new Blob(["pdf-data"], { type: "application/pdf" }), "web-file-1");
  await put("pdf-reader-state", { schemaVersion: 1, attachmentId: "attachment-1", pageIndex: 4, pageCount: 10, progressPercent: 50, zoom: 1, lastOpenedAt: now + 3, updatedAt: now + 3, pendingDriveSync: true }, "attachment-1");
  await put("pdf-annotation-changes", { schemaVersion: 1, id: "annotation-1", attachmentId: "attachment-1", operation: "upsert", annotation: { id: "annotation-1", attachmentId: "attachment-1", libraryFolderId: "library-root", pageIndex: 2, left: 0.1, top: 0.2, right: 0.4, bottom: 0.3, color: "yellow", noteText: null, annotationType: "highlight", textSize: 16, backgroundColor: "none", displayTitle: null, displayFolderId: "library-root", createdAt: now, updatedAt: now }, savedAt: now, pendingDriveSync: true }, "annotation-1");
  await put("created-course-folders", { schemaVersion: 1, id: "web-course-folder", courseId: "course-1", parentId: "course-root", mode: "course:course-1", title: "Lesson 2", description: null, orderIndex: 1, createdAt: now, updatedAt: now, pendingDriveSync: true }, "web-course-folder");
  await put("created-course-sticky-notes", { schemaVersion: 1, id: "web-sticky", courseId: "course-1", folderId: "web-course-folder", text: "Revise", createdAt: now, updatedAt: now, pendingDriveSync: true }, "web-sticky");
  await put("created-course-concepts", { schemaVersion: 1, id: "web-concept", courseId: "course-1", term: "Niyyah", arabicTerm: null, definition: "Intention", details: null, sortOrder: 0, createdAt: now, updatedAt: now, pendingDriveSync: true }, "web-concept");
  database.close();
}, { bundle, now });

await page.reload();
await page.getByTestId("sync-preflight-status").waitFor();
assert.equal(await page.getByTestId("sync-preflight-status").textContent(), "Compatible with the Android backup");
assert.equal(await page.getByText("Edited notes").locator("xpath=preceding-sibling::p").textContent(), "2");
const legacyDemoResponseStatus = await page.evaluate(async () => (await fetch("/api/notes/in1")).status);
assert.equal(legacyDemoResponseStatus, 404, "Restored corpus routes still exposed the Tawakkul demo note.");
for (const fileName of ["folders.json", "notes.json", "attachments.json", "pdf_reading_progress.json", "pdf_annotations.json", "folder_sticky_notes.json", "course_concept_cards.json"]) {
  await page.getByTestId(`sync-file-${fileName}`).waitFor();
}
assert.match(await page.getByTestId("preserved-file-count").textContent(), /restored metadata files remain untouched/);

const prepared = await page.evaluate(async () => {
  const { runSyncPreflight } = await import("/src/lib/sync/syncPreflight.ts");
  return runSyncPreflight();
});
const legacyDemoDraft = await page.evaluate(async () => {
  const { loadLocalNoteDraft } = await import("/src/lib/restore/localRestoreStore.ts");
  return loadLocalNoteDraft("in1");
});
assert.equal(legacyDemoDraft, null, "The obsolete Tawakkul demo draft was not removed.");
const rebasedDraft = await page.evaluate(async () => {
  const { loadLocalNoteDraft } = await import("/src/lib/restore/localRestoreStore.ts");
  return loadLocalNoteDraft("note-1");
});
assert.equal(rebasedDraft.baseCloudVersion, 42, "An unchanged note was not rebased onto the latest Android backup.");
const preparedNote = prepared.preparedFiles["notes.json"].find((row) => row.id === "note-1");
assert.equal(preparedNote.preservedField, "keep-note");
assert.equal(JSON.parse(preparedNote.bodyPlainText).text, "Edited safely");
assert.equal(prepared.preparedFiles["folders.json"].find((row) => row.id === "study-root").preservedField, "keep-folder");
assert.equal(prepared.preparedFiles["folders.json"].find((row) => row.id === "web-course-folder").mode, "course:course-1");
assert.equal(prepared.preparedFiles["attachments.json"].find((row) => row.id === "web-file-1").fileEntry, "files/web-file-1");
assert.equal(prepared.preparedFiles["pdf_reading_progress.json"].find((row) => row.attachmentId === "attachment-1").progressPercent, 0.5);
assert.equal(prepared.touchedFiles.find((file) => file.fileName === "pdf_reading_progress.json").changedRows, 1);
assert.equal(prepared.preparedFiles["ai_history.json"], undefined, "Untouched files should not be rebuilt by the dry run.");

const archiveResult = await page.evaluate(async ({ createdAt, restoredPdfBytes }) => {
  const { createLocalBackupArchive } = await import("/src/lib/sync/localBackupExport.ts");
  const result = await createLocalBackupArchive({
    accessToken: "read-only-test-token",
    createdAt,
    refreshDriveManifest: false,
    downloadDriveBlob: async () => new Blob([restoredPdfBytes], { type: "application/pdf" }),
  });
  return {
    bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
    fileName: result.fileName,
    summary: result.summary,
  };
}, { createdAt: now + 100, restoredPdfBytes });
assert.match(archiveResult.fileName, /\.vaultbackup$/);
assert.equal(archiveResult.summary.includedAttachmentFiles, 2);
const archiveEntries = unzipSync(new Uint8Array(archiveResult.bytes));
for (const entryName of ["manifest.json", "folders.json", "notes.json", "attachments.json", "ai_history.json", "files/attachment-1", "files/web-file-1"]) {
  assert.ok(archiveEntries[entryName], `Archive is missing ${entryName}.`);
}
assert.deepEqual(JSON.parse(strFromU8(archiveEntries["manifest.json"])), { format: "myvault-backup", version: 1, createdAt: now + 100 });
assert.equal(JSON.parse(strFromU8(archiveEntries["notes.json"])).find((row) => row.id === "note-1").preservedField, "keep-note");
assert.equal(JSON.parse(strFromU8(archiveEntries["ai_history.json"]))[0].preservedField, "untouched");
assert.equal(strFromU8(archiveEntries["files/attachment-1"]), restoredPdfBytes);
assert.equal(strFromU8(archiveEntries["files/web-file-1"]), "pdf-data");

const corruptExportError = await page.evaluate(async ({ createdAt }) => {
  const { createLocalBackupArchive } = await import("/src/lib/sync/localBackupExport.ts");
  try {
    await createLocalBackupArchive({
      accessToken: "read-only-test-token",
      createdAt,
      refreshDriveManifest: false,
      downloadDriveBlob: async () => new Blob(["corruptedpdf"], { type: "application/pdf" }),
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}, { createdAt: now + 200 });
assert.match(corruptExportError, /integrity check/);

const localFileSizeError = await page.evaluate(async ({ createdAt }) => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore", 7);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("attachment-blobs", "readwrite");
    transaction.objectStore("attachment-blobs").put(new Blob(["bad"]), "web-file-1");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();

  const { createLocalBackupArchive } = await import("/src/lib/sync/localBackupExport.ts");
  try {
    await createLocalBackupArchive({
      accessToken: "read-only-test-token",
      createdAt,
      refreshDriveManifest: false,
      downloadDriveBlob: async () => new Blob(["restored-pdf"], { type: "application/pdf" }),
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}, { createdAt: now + 300 });
assert.match(localFileSizeError, /changed size/);

const snapshotAfterReady = await page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore", 7);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise((resolve, reject) => {
    const request = database.transaction("metadata-bundles", "readonly").objectStore("metadata-bundles").get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return JSON.stringify(value);
});
assert.equal(snapshotAfterReady, sourceSnapshot, "Preflight changed the restored source bundle.");

const staleIdRecovery = await page.evaluate(async ({ createdAt, restoredPdfBytes }) => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore", 7);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("attachment-blobs", "readwrite");
    transaction.objectStore("attachment-blobs").put(new Blob(["pdf-data"], { type: "application/pdf" }), "web-file-1");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();

  const [{ createLocalBackupArchive }, { GoogleDriveRequestError }] = await Promise.all([
    import("/src/lib/sync/localBackupExport.ts"),
    import("/src/lib/googleDrive/driveClient.ts"),
  ]);
  const attemptedIds = [];
  await createLocalBackupArchive({
    accessToken: "read-only-test-token",
    createdAt,
    refreshDriveManifest: false,
    downloadDriveBlob: async (entry) => {
      attemptedIds.push(entry.cloudFileId);
      if (entry.cloudFileId === "drive-attachment-1") throw new GoogleDriveRequestError("missing", 404);
      return new Blob([restoredPdfBytes], { type: "application/pdf" });
    },
    recoverDriveFile: async (entry) => ({ id: "recovered-drive-file", name: entry.fileName }),
  });
  return attemptedIds;
}, { createdAt: now + 400, restoredPdfBytes });
assert.deepEqual(staleIdRecovery, ["drive-attachment-1", "recovered-drive-file"]);

const missingDriveFileError = await page.evaluate(async ({ createdAt }) => {
  const [{ createLocalBackupArchive }, { GoogleDriveRequestError }] = await Promise.all([
    import("/src/lib/sync/localBackupExport.ts"),
    import("/src/lib/googleDrive/driveClient.ts"),
  ]);
  try {
    await createLocalBackupArchive({
      accessToken: "read-only-test-token",
      createdAt,
      refreshDriveManifest: false,
      downloadDriveBlob: async () => { throw new GoogleDriveRequestError("missing", 404); },
      recoverDriveFile: async () => null,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}, { createdAt: now + 500 });
assert.match(missingDriveFileError, /source file for “Restored\.pdf”/);

await page.screenshot({ path: "/tmp/myvault-sync-preflight-desktop.png", fullPage: true });
await page.getByTestId("create-local-backup").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/myvault-local-backup-controls.png" });
await page.setViewportSize({ width: 1280, height: 800 });
await page.screenshot({ path: "/tmp/myvault-sync-preflight-laptop.png", fullPage: true });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "Settings introduced horizontal scrolling.");

await page.evaluate(async ({ now }) => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("myvault-web-restore", 7);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction("note-drafts", "readwrite");
  const store = transaction.objectStore("note-drafts");
  const draft = await new Promise((resolve, reject) => {
    const request = store.get("note-1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  store.put({ ...draft, baseCloudVersion: 41, baseUpdatedAt: now - 1 }, "note-1");
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}, { now });
await page.getByTestId("run-sync-preflight").click();
await page.getByText("Needs attention before sync").waitFor();
assert.match(await page.getByTestId("sync-preflight-blockers").textContent(), /changed in the restored backup after the website edit began/);

await browser.close();
console.log("Sync/export verification passed: Android archive contents, stale Drive ID recovery, missing-file messaging, integrity rejection, source preservation, responsive layout, and conflict blocking.");
