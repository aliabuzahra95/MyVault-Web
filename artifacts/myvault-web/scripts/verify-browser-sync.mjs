import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup.ts";

const baseUrl = process.env.MYVAULT_URL ?? "http://localhost:18899";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const firstPage = await context.newPage();
const secondPage = await context.newPage();

try {
  await Promise.all([firstPage.goto(`${baseUrl}/settings`), secondPage.goto(`${baseUrl}/settings`)]);
  const accountA = "permission-account-a";
  const accountB = "permission-account-b";
  const bundleA = representativeAndroidBackup();
  const bundleB = representativeAndroidBackup();
  const notesB = bundleB.files.find((file) => file.fileName === "notes.json")?.json;
  notesB.find((note) => note.id === "note-tawakkul").title = "Account B only";

  await firstPage.evaluate(async ({ accountA, accountB, bundleA, bundleB }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");

    account.setActiveGoogleAccount(accountA);
    await store.prepareAccountStorage(accountA);
    await store.clearLocalWorkspaceData();
    await store.saveMetadataRestoreBundle(bundleA);
    await store.saveLocalSyncBase({
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(bundleA),
      bundle: structuredClone(bundleA),
    });

    account.setActiveGoogleAccount(accountB);
    await store.prepareAccountStorage(accountB);
    await store.clearLocalWorkspaceData();
    if (await store.loadMetadataRestoreBundle() !== null) throw new Error("Account B saw Account A metadata.");
    await store.saveMetadataRestoreBundle(bundleB);
    await store.saveLocalSyncBase({
      schemaVersion: 1,
      accountId: accountB,
      revision: await revision.computeBundleRevision(bundleB),
      bundle: structuredClone(bundleB),
    });
  }, { accountA, accountB, bundleA, bundleB });

  const accountIsolation = await firstPage.evaluate(async ({ accountA, accountB }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    account.setActiveGoogleAccount(accountA);
    const firstBundle = await store.loadMetadataRestoreBundle();
    const firstNotes = firstBundle?.files.find((file) => file.fileName === "notes.json")?.json;
    const first = Array.isArray(firstNotes) ? firstNotes.find((note) => note.id === "note-tawakkul")?.title : null;
    account.setActiveGoogleAccount(accountB);
    const secondBundle = await store.loadMetadataRestoreBundle();
    const secondNotes = secondBundle?.files.find((file) => file.fileName === "notes.json")?.json;
    const second = Array.isArray(secondNotes) ? secondNotes.find((note) => note.id === "note-tawakkul")?.title : null;
    return { first, second };
  }, { accountA, accountB });
  assert.deepEqual(accountIsolation, { first: "التوكل - Tawakkul", second: "Account B only" });

  const targetedClear = await firstPage.evaluate(async ({ accountA, accountB }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    await store.clearLocalWorkspaceData(accountA);
    account.setActiveGoogleAccount(accountB);
    const retainedBundle = await store.loadMetadataRestoreBundle();
    const retainedNotes = retainedBundle?.files.find((file) => file.fileName === "notes.json")?.json;
    return {
      accountAEmpty: await (async () => {
        account.setActiveGoogleAccount(accountA);
        return await store.loadMetadataRestoreBundle() === null;
      })(),
      accountBTitle: Array.isArray(retainedNotes) ? retainedNotes.find((note) => note.id === "note-tawakkul")?.title : null,
    };
  }, { accountA, accountB });
  assert.deepEqual(targetedClear, { accountAEmpty: true, accountBTitle: "Account B only" });

  const preservingRestore = await firstPage.evaluate(async ({ accountA, bundleA }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const safePull = await import("/src/lib/sync/safePull.ts");
    account.setActiveGoogleAccount(accountA);
    await store.clearLocalWorkspaceData();

    const originalBundle = structuredClone(bundleA);
    await store.saveMetadataRestoreBundle(originalBundle);
    const originalBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(originalBundle),
      bundle: structuredClone(originalBundle),
    };
    await store.saveLocalSyncBase(originalBase);
    await store.saveLocalCreatedNote({
      id: "pending-browser-note",
      folderId: null,
      parentNoteId: null,
      title: "Unsynchronised browser note",
      bodyPreview: "Must survive Drive restore",
      wordCount: 4,
      characterCount: 26,
      isPinned: false,
      isFolderPinned: false,
      orderIndex: 999,
      tagNames: [],
      createdAt: 350,
      updatedAt: 350,
    });

    const refreshedBundle = structuredClone(originalBundle);
    refreshedBundle.cloudVersion += 1;
    const refreshedNotes = refreshedBundle.files.find((file) => file.fileName === "notes.json")?.json;
    const refreshedNote = Array.isArray(refreshedNotes) ? refreshedNotes.find((note) => note.id === "note-tawakkul") : null;
    if (refreshedNote) refreshedNote.title = "Latest Drive title";
    const refreshedBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(refreshedBundle),
      bundle: structuredClone(refreshedBundle),
    };

    const result = await safePull.applyIncomingDriveBundleSafely(refreshedBundle, refreshedBase);
    const restoredBundle = await store.loadMetadataRestoreBundle();
    const retainedBase = await store.loadLocalSyncBase();
    const restoredNotes = restoredBundle?.files.find((file) => file.fileName === "notes.json")?.json;
    const retainedBaseNotes = retainedBase?.bundle.files.find((file) => file.fileName === "notes.json")?.json;
    const visibleNotes = await fetch("/api/notes").then((response) => response.json());
    return {
      result,
      restoredTitle: Array.isArray(restoredNotes) ? restoredNotes.find((note) => note.id === "note-tawakkul")?.title : null,
      retainedBaseTitle: Array.isArray(retainedBaseNotes) ? retainedBaseNotes.find((note) => note.id === "note-tawakkul")?.title : null,
      localNoteRetained: (await store.loadLocalCreatedNotes()).some((note) => note.id === "pending-browser-note"),
      pendingOperationRetained: (await store.loadPendingLocalSyncOperations()).some((operation) => operation.entityId === "pending-browser-note"),
      localNoteVisible: Array.isArray(visibleNotes) && visibleNotes.some((note) => note.id === "pending-browser-note"),
      refreshedDriveNoteVisible: Array.isArray(visibleNotes) && visibleNotes.some((note) => note.id === "note-tawakkul" && note.title === "Latest Drive title"),
    };
  }, { accountA, bundleA });
  assert.equal(preservingRestore.result.preservedLocalChanges, true);
  assert.equal(preservingRestore.result.preservedExistingBase, false);
  assert.ok(preservingRestore.result.mergedRemoteChanges > 0);
  assert.ok(preservingRestore.result.mergedWebsiteChanges > 0);
  assert.equal(preservingRestore.restoredTitle, "Latest Drive title", "Restore must refresh the verified Drive metadata.");
  assert.equal(preservingRestore.retainedBaseTitle, "Latest Drive title", "A successful restore must become the merge baseline for retained website changes.");
  assert.equal(preservingRestore.localNoteRetained, true, "Restore must not erase a local browser note.");
  assert.equal(preservingRestore.pendingOperationRetained, true, "Restore must keep the browser note pending for safe backup.");
  assert.equal(preservingRestore.localNoteVisible, true, "The preserved local note must remain visible after restore.");
  assert.equal(preservingRestore.refreshedDriveNoteVisible, true, "The refreshed Drive corpus must be visible alongside local changes.");

  const fieldLevelSafePull = await firstPage.evaluate(async ({ accountA, bundleA }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const richText = await import("/src/lib/restore/vaultRichText.ts");
    const safePull = await import("/src/lib/sync/safePull.ts");
    account.setActiveGoogleAccount(accountA);
    await store.clearLocalWorkspaceData();

    const original = structuredClone(bundleA);
    await store.saveMetadataRestoreBundle(original);
    const originalBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(original),
      bundle: structuredClone(original),
    };
    await store.saveLocalSyncBase(originalBase);
    const notes = original.files.find((file) => file.fileName === "notes.json")?.json;
    const note = Array.isArray(notes) ? notes.find((row) => row.id === "note-tawakkul") : null;
    const blocks = original.files.find((file) => file.fileName === "blocks.json")?.json;
    const noteBlocks = Array.isArray(blocks) ? blocks.filter((row) => row.noteId === "note-tawakkul") : [];
    await store.saveLocalNoteDraft({
      schemaVersion: 1,
      noteId: "note-tawakkul",
      baseCloudVersion: original.cloudVersion,
      baseUpdatedAt: note?.updatedAt ?? 0,
      baseRevisionId: originalBase.revision.revisionId,
      title: note?.title ?? "Original title",
      mode: "rich_text",
      richTextDocument: richText.blocksToVaultRichText(noteBlocks),
      blocks: noteBlocks,
      isPinned: !Boolean(note?.isPinned),
      savedAt: 250,
      pendingDriveSync: true,
    });

    const incoming = structuredClone(original);
    incoming.cloudVersion += 1;
    const incomingNotes = incoming.files.find((file) => file.fileName === "notes.json")?.json;
    const incomingNote = Array.isArray(incomingNotes) ? incomingNotes.find((row) => row.id === "note-tawakkul") : null;
    if (incomingNote) {
      incomingNote.title = "Android changed title";
      incomingNote.updatedAt = 300;
    }
    const incomingBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(incoming),
      bundle: structuredClone(incoming),
    };
    const result = await safePull.applyIncomingDriveBundleSafely(incoming, incomingBase);
    const reconciledNotes = result.reconciledBundle.files.find((file) => file.fileName === "notes.json")?.json;
    const reconciled = Array.isArray(reconciledNotes) ? reconciledNotes.find((row) => row.id === "note-tawakkul") : null;
    return {
      title: reconciled?.title,
      isPinned: reconciled?.isPinned,
      expectedPinned: !Boolean(note?.isPinned),
    };
  }, { accountA, bundleA });
  assert.equal(fieldLevelSafePull.title, "Android changed title", "The exact reconciled candidate must retain Android's independent field change.");
  assert.equal(fieldLevelSafePull.isPinned, fieldLevelSafePull.expectedPinned, "The exact reconciled candidate must retain the Website's independent field change.");

  const sameNoteSafePull = await firstPage.evaluate(async ({ accountA, bundleA }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const safePull = await import("/src/lib/sync/safePull.ts");
    account.setActiveGoogleAccount(accountA);
    await store.clearLocalWorkspaceData();
    const originalBundle = structuredClone(bundleA);
    await store.saveMetadataRestoreBundle(originalBundle);
    const originalBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(originalBundle),
      bundle: structuredClone(originalBundle),
    };
    await store.saveLocalSyncBase(originalBase);
    const originalNotes = originalBundle.files.find((file) => file.fileName === "notes.json")?.json;
    const originalNote = Array.isArray(originalNotes) ? originalNotes.find((note) => note.id === "note-tawakkul") : null;
    await store.saveLocalNoteDraft({
      schemaVersion: 1,
      noteId: "note-tawakkul",
      baseCloudVersion: originalBundle.cloudVersion,
      baseUpdatedAt: originalNote?.updatedAt ?? 0,
      baseRevisionId: originalBase.revision.revisionId,
      title: originalNote?.title ?? "Local note",
      mode: "rich_text",
      richTextDocument: { text: "", styleMarks: [], noteLinks: [] },
      blocks: [],
      isPinned: Boolean(originalNote?.isPinned),
      savedAt: 500,
      pendingDriveSync: true,
    });

    const incoming = structuredClone(originalBundle);
    incoming.cloudVersion += 1;
    const incomingBlocks = incoming.files.find((file) => file.fileName === "blocks.json")?.json;
    const body = Array.isArray(incomingBlocks) ? incomingBlocks.find((block) => block.noteId === "note-tawakkul" && block.type === "rich_text") : null;
    if (body) body.content = JSON.stringify({ text: "Android body must remain available.", styleMarks: [], noteLinks: [] });
    const incomingBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(incoming),
      bundle: structuredClone(incoming),
    };
    let error = "";
    let result = null;
    try {
      result = await safePull.applyIncomingDriveBundleSafely(incoming, incomingBase);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const retainedBundle = await store.loadMetadataRestoreBundle();
    const retainedBase = await store.loadLocalSyncBase();
    const retainedDraft = await store.loadLocalNoteDraft("note-tawakkul");
    const recovered = (await store.loadLocalCreatedNotes()).find((note) => note.title.includes("Website conflict copy"));
    const recoveredDraft = recovered ? await store.loadLocalNoteDraft(recovered.id) : null;
    const conflicts = await store.loadLocalSyncConflicts();
    return {
      error,
      result,
      bundleCloudVersion: retainedBundle?.cloudVersion,
      baseCloudVersion: retainedBase?.bundle.cloudVersion,
      draftText: retainedDraft?.richTextDocument?.text,
      conflict: conflicts.find((item) => item.fileName === "blocks.json"),
      recoveredTitle: recovered?.title,
      recoveredDraftText: recoveredDraft?.richTextDocument?.text,
    };
  }, { accountA, bundleA });
  assert.equal(sameNoteSafePull.error, "");
  assert.equal(sameNoteSafePull.result?.recoveredConflictCopies, 1, "A same-note conflict must produce one explicit website copy.");
  assert.equal(sameNoteSafePull.bundleCloudVersion, bundleA.cloudVersion + 1, "The verified incoming Drive note must become the active restored note.");
  assert.equal(sameNoteSafePull.baseCloudVersion, bundleA.cloudVersion + 1, "The verified incoming Drive revision must become the next immutable Base.");
  assert.equal(sameNoteSafePull.draftText, undefined, "The conflicting draft must stop shadowing the Drive note.");
  assert.match(sameNoteSafePull.recoveredTitle ?? "", /Website conflict copy/);
  assert.equal(sameNoteSafePull.recoveredDraftText, "", "The website version, including an empty body, must remain available as a recovered note.");
  assert.ok(sameNoteSafePull.conflict?.baseValue, "The conflict record must retain the Base version.");
  assert.ok(sameNoteSafePull.conflict?.webValue, "The conflict record must retain the Web version.");
  assert.ok(sameNoteSafePull.conflict?.remoteValue, "The conflict record must retain the Android/Drive version.");
  assert.equal(sameNoteSafePull.conflict?.resolution, "keep-both");

  const legacyRebaseRecovery = await firstPage.evaluate(async ({ accountA, bundleA }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const safePull = await import("/src/lib/sync/safePull.ts");
    account.setActiveGoogleAccount(accountA);
    await store.clearLocalWorkspaceData();

    const latest = structuredClone(bundleA);
    latest.cloudVersion += 3;
    const latestBlocks = latest.files.find((file) => file.fileName === "blocks.json")?.json;
    const latestBody = Array.isArray(latestBlocks) ? latestBlocks.find((block) => block.noteId === "note-tawakkul" && block.type === "rich_text") : null;
    if (latestBody) latestBody.content = JSON.stringify({ text: "Drive body remains canonical.", styleMarks: [], noteLinks: [] });
    const latestNotes = latest.files.find((file) => file.fileName === "notes.json")?.json;
    const latestNote = Array.isArray(latestNotes) ? latestNotes.find((note) => note.id === "note-tawakkul") : null;
    const latestBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(latest),
      bundle: structuredClone(latest),
    };
    await store.saveMetadataRestoreBundle(latest);
    await store.saveLocalSyncBase(latestBase);
    await store.saveLocalNoteDraft({
      schemaVersion: 1,
      noteId: "note-tawakkul",
      baseCloudVersion: latest.cloudVersion,
      baseUpdatedAt: latestNote?.updatedAt ?? 0,
      title: latestNote?.title ?? "Local note",
      mode: "rich_text",
      richTextDocument: { text: "", styleMarks: [], noteLinks: [] },
      blocks: [],
      isPinned: Boolean(latestNote?.isPinned),
      savedAt: 500,
      pendingDriveSync: true,
    });

    const result = await safePull.applyIncomingDriveBundleSafely(latest, latestBase);
    const recovered = (await store.loadLocalCreatedNotes()).find((note) => note.title.includes("Recovered website edit"));
    const recoveredDraft = recovered ? await store.loadLocalNoteDraft(recovered.id) : null;
    const restored = await store.loadMetadataRestoreBundle();
    const restoredBlocks = restored?.files.find((file) => file.fileName === "blocks.json")?.json;
    const restoredBody = Array.isArray(restoredBlocks) ? restoredBlocks.find((block) => block.noteId === "note-tawakkul" && block.type === "rich_text") : null;
    return {
      result,
      originalDraftRemoved: await store.loadLocalNoteDraft("note-tawakkul") === null,
      recoveredTitle: recovered?.title,
      recoveredDraftText: recoveredDraft?.richTextDocument?.text,
      restoredBodyText: restoredBody ? JSON.parse(restoredBody.content).text : null,
    };
  }, { accountA, bundleA });
  assert.equal(legacyRebaseRecovery.originalDraftRemoved, true, "The unsafe legacy overlay must stop shadowing the restored note.");
  assert.match(legacyRebaseRecovery.recoveredTitle ?? "", /Recovered website edit/);
  assert.equal(legacyRebaseRecovery.recoveredDraftText, "", "Even an empty legacy draft must be retained as an explicit recovered copy.");
  assert.equal(legacyRebaseRecovery.restoredBodyText, "Drive body remains canonical.");

  const cleanRestore = await firstPage.evaluate(async ({ accountA, bundleA }) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const revision = await import("/src/lib/sync/revision.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    account.setActiveGoogleAccount(accountA);
    await store.clearLocalWorkspaceData();
    const refreshedBundle = structuredClone(bundleA);
    refreshedBundle.cloudVersion += 2;
    const refreshedBase = {
      schemaVersion: 1,
      accountId: accountA,
      revision: await revision.computeBundleRevision(refreshedBundle),
      bundle: structuredClone(refreshedBundle),
    };
    const result = await store.applyMetadataRestorePreservingLocalChangesAtomically(refreshedBundle, refreshedBase);
    return {
      result,
      baseCloudVersion: (await store.loadLocalSyncBase())?.bundle.cloudVersion,
    };
  }, { accountA, bundleA });
  assert.deepEqual(cleanRestore.result, { preservedLocalChanges: false, preservedExistingBase: false });
  assert.equal(cleanRestore.baseCloudVersion, bundleA.cloudVersion + 2, "A clean restore must advance the sync base.");

  await Promise.all([firstPage, secondPage].map((page) => page.evaluate(async (accountId) => {
    const account = await import("/src/lib/sync/accountContext.ts");
    account.setActiveGoogleAccount(accountId);
  }, accountA)));

  const firstLock = firstPage.evaluate(async (accountId) => {
    const { withAccountSyncLock } = await import("/src/lib/sync/accountContext.ts");
    return withAccountSyncLock(accountId, async () => {
      const startedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { startedAt, finishedAt: Date.now() };
    });
  }, accountA);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const secondLock = secondPage.evaluate(async (accountId) => {
    const { withAccountSyncLock } = await import("/src/lib/sync/accountContext.ts");
    return withAccountSyncLock(accountId, async () => ({ startedAt: Date.now() }));
  }, accountA);
  const [firstTiming, secondTiming] = await Promise.all([firstLock, secondLock]);
  assert.ok(secondTiming.startedAt >= firstTiming.finishedAt - 2, "The second tab entered the same-account commit lock too early.");

  const capturedOperationId = await firstPage.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    await store.saveLocalCreatedFolder({
      id: "concurrent-folder",
      parentId: null,
      title: "Before commit",
      description: null,
      mode: "study",
      orderIndex: 0,
      createdAt: 100,
      updatedAt: 100,
    });
    return (await store.loadPendingLocalSyncOperations()).at(-1)?.id;
  });
  assert.ok(capturedOperationId);

  await secondPage.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    await store.saveLocalCreatedFolder({
      id: "concurrent-folder",
      parentId: null,
      title: "Edited in another tab",
      description: null,
      mode: "study",
      orderIndex: 0,
      createdAt: 100,
      updatedAt: 200,
    });
  });
  const concurrentResult = await firstPage.evaluate(async (operationId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const cleared = await store.clearLocalSyncPendingChanges([operationId]);
    const pending = await store.loadPendingLocalSyncOperations();
    const folders = await store.loadLocalCreatedFolders();
    return {
      cleared,
      pendingCount: pending.length,
      title: folders.find((folder) => folder.id === "concurrent-folder")?.title,
    };
  }, capturedOperationId);
  assert.equal(concurrentResult.cleared.clearedOverlayStores, false);
  assert.equal(concurrentResult.pendingCount, 1);
  assert.equal(concurrentResult.title, "Edited in another tab");
  await secondPage.close();

  await context.setOffline(true);
  const offlineResult = await firstPage.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    await store.saveLocalCreatedNote({
      id: "offline-note",
      folderId: null,
      parentNoteId: null,
      title: "Saved while offline",
      bodyPreview: "",
      wordCount: 0,
      characterCount: 0,
      isPinned: false,
      isFolderPinned: false,
      orderIndex: 0,
      tagNames: [],
      createdAt: 300,
      updatedAt: 300,
    });
    const notes = await store.loadLocalCreatedNotes();
    const operations = await store.loadPendingLocalSyncOperations();
    return {
      saved: notes.some((note) => note.id === "offline-note"),
      journalled: operations.some((operation) => operation.entityId === "offline-note"),
    };
  });
  await context.setOffline(false);
  assert.deepEqual(offlineResult, { saved: true, journalled: true });

  const driveFiles = new Map();
  const uploadOrder = [];
  let driveSequence = 0;
  let mockPermissionId = "permission-account-c";
  let corruptReadbackName = null;
  const folderMimeType = "application/vnd.google-apps.folder";
  const publicRecord = (file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: String(file.bytes?.length ?? 0),
    modifiedTime: file.modifiedTime,
    parents: file.parents,
  });
  const addDriveFile = ({ name, mimeType, parents, bytes = Buffer.alloc(0) }) => {
    const id = `mock-drive-${++driveSequence}`;
    const file = { id, name, mimeType, parents, bytes, modifiedTime: new Date(1_780_000_000_000 + driveSequence).toISOString() };
    driveFiles.set(id, file);
    return file;
  };
  const parseMultipart = (request) => {
    const contentType = request.headers()["content-type"] ?? "";
    const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
    assert.ok(boundary, "Drive multipart upload is missing its boundary.");
    const body = request.postDataBuffer();
    assert.ok(body, "Drive multipart upload is missing its body.");
    const text = body.toString("utf8");
    const firstHeadersEnd = text.indexOf("\r\n\r\n");
    const metadataStart = firstHeadersEnd + 4;
    const metadataEnd = text.indexOf(`\r\n--${boundary}`, metadataStart);
    const secondHeadersEnd = text.indexOf("\r\n\r\n", metadataEnd);
    const payloadStart = secondHeadersEnd + 4;
    const payloadEnd = text.lastIndexOf(`\r\n--${boundary}--`);
    return {
      metadata: JSON.parse(text.slice(metadataStart, metadataEnd)),
      bytes: Buffer.from(text.slice(payloadStart, payloadEnd), "utf8"),
    };
  };

  await context.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/drive/v3/about") {
      const bearer = request.headers().authorization?.replace(/^Bearer\s+/i, "");
      const permissionId = bearer === "account-a-token"
        ? "permission-account-a"
        : bearer === "account-b-token"
          ? "permission-account-b"
          : mockPermissionId;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { permissionId, displayName: "Safe Sync Fixture" } }) });
      return;
    }
    if (path === "/drive/v3/files" && request.method() === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const name = query.match(/name = '([^']+)'/)?.[1];
      const parentId = query.match(/'([^']+)' in parents/)?.[1];
      const requiresFolder = query.includes(`mimeType = '${folderMimeType}'`);
      const excludesFolder = query.includes(`mimeType != '${folderMimeType}'`);
      const files = [...driveFiles.values()].filter((file) => (
        (!name || file.name === name)
        && (!parentId || file.parents.includes(parentId))
        && (!requiresFolder || file.mimeType === folderMimeType)
        && (!excludesFolder || file.mimeType !== folderMimeType)
      ));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: files.map(publicRecord) }) });
      return;
    }
    if (path === "/drive/v3/files" && request.method() === "POST") {
      const input = request.postDataJSON();
      const file = addDriveFile({ name: input.name, mimeType: input.mimeType, parents: input.parents });
      uploadOrder.push(file.name);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publicRecord(file)) });
      return;
    }
    if (path === "/upload/drive/v3/files" && request.method() === "POST") {
      const { metadata, bytes } = parseMultipart(request);
      const file = addDriveFile({ name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents, bytes });
      uploadOrder.push(file.name);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publicRecord(file)) });
      return;
    }
    const uploadFileId = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (uploadFileId && request.method() === "PATCH") {
      const file = driveFiles.get(decodeURIComponent(uploadFileId));
      if (!file) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
        return;
      }
      file.bytes = request.postDataBuffer() ?? Buffer.alloc(0);
      file.modifiedTime = new Date(1_780_000_000_000 + ++driveSequence).toISOString();
      uploadOrder.push(file.name);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publicRecord(file)) });
      return;
    }
    const fileId = path.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (fileId && request.method() === "GET" && url.searchParams.get("alt") === "media") {
      const file = driveFiles.get(decodeURIComponent(fileId));
      await route.fulfill(file
        ? { status: 200, contentType: file.mimeType, body: file.name === corruptReadbackName ? Buffer.concat([file.bytes, Buffer.from("corrupt")]) : file.bytes }
        : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
      return;
    }
    if (fileId && request.method() === "DELETE") {
      driveFiles.delete(decodeURIComponent(fileId));
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.abort("failed");
  });

  const sessionContext = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await sessionContext.route("https://www.googleapis.com/drive/v3/about**", async (route) => {
    const bearer = route.request().headers().authorization?.replace(/^Bearer\s+/i, "");
    const permissionId = bearer === "account-a-token" ? "permission-account-a" : "permission-account-b";
    const emailAddress = bearer === "account-a-token" ? "account-a@example.com" : "aah4x-test@example.com";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { permissionId, displayName: "Account isolation fixture", emailAddress } }) });
  });
  await sessionContext.route("https://www.googleapis.com/drive/v3/files**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: [] }) });
  });
  const sessionPage = await sessionContext.newPage();
  const isolatedBaseUrl = new URL(baseUrl);
  isolatedBaseUrl.hostname = "127.0.0.1";
  await sessionPage.goto(isolatedBaseUrl.toString());
  const staleSessionGate = await sessionPage.evaluate(async () => {
    const identity = await import("/src/lib/googleDrive/identity.ts");
    const session = await import("/src/lib/googleDrive/accountSession.ts");
    const setToken = (accessToken) => identity.rememberGoogleDriveToken({
        accessToken,
        expiresAt: Date.now() + 3_600_000,
        scope: "https://www.googleapis.com/auth/drive.file",
      });

    const tokenA = setToken("account-a-token");
    let verifiedA;
    try {
      verifiedA = await session.verifyAndActivateGoogleDriveSession(tokenA);
    } catch (error) {
      throw new Error(`Account A verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const tokenB = setToken("account-b-token");
    let verifiedB;
    try {
      verifiedB = await session.verifyAndActivateGoogleDriveSession(tokenB);
    } catch (error) {
      const account = await import("/src/lib/sync/accountContext.ts");
      throw new Error(`Account B verification failed: ${error instanceof Error ? error.message : String(error)}; active=${account.getActiveAccountId()}; current=${identity.getCachedGoogleDriveToken()?.accessToken ?? "none"}`);
    }
    let staleError = "";
    try {
      session.assertGoogleDriveSession(tokenA, verifiedA.accountId);
    } catch (error) {
      staleError = error instanceof Error ? error.message : String(error);
    }
    return { accountA: verifiedA.accountId, accountB: verifiedB.accountId, staleError };
  });
  assert.equal(staleSessionGate.accountA, "permission-account-a");
  assert.equal(staleSessionGate.accountB, "permission-account-b");
  assert.match(staleSessionGate.staleError, /account changed/i);
  await sessionPage.evaluate(() => {
    history.pushState(null, "", "/settings");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await sessionPage.getByText("aah4x-test@example.com").waitFor();
  await sessionPage.getByText("No MyVault backup in this account").waitFor();
  if (process.env.MYVAULT_SCREENSHOT_PATH) {
    await sessionPage.waitForTimeout(300);
    await sessionPage.screenshot({ path: process.env.MYVAULT_SCREENSHOT_PATH, fullPage: false });
  }
  await sessionContext.close();

  const driveCommit = await firstPage.evaluate(async () => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const writeBack = await import("/src/lib/sync/driveWriteBack.ts");
    const accountId = "permission-account-c";
    identity.rememberGoogleDriveToken({ accessToken: "mock-token", expiresAt: Date.now() + 3_600_000, scope: "https://www.googleapis.com/auth/drive.file" });
    account.setActiveGoogleAccount(accountId);
    await store.prepareAccountStorage(accountId);
    await store.clearLocalWorkspaceData();
    await store.saveLocalCreatedFolder({
      id: "web-first-folder",
      parentId: null,
      title: "Web-first Study",
      description: null,
      mode: "study",
      orderIndex: 0,
      createdAt: 400,
      updatedAt: 400,
    });
    await store.saveLocalCreatedNote({
      id: "web-first-note",
      folderId: "web-first-folder",
      parentNoteId: null,
      title: "Created safely on Web",
      bodyPreview: "",
      wordCount: 0,
      characterCount: 0,
      isPinned: false,
      isFolderPinned: false,
      orderIndex: 0,
      tagNames: [],
      createdAt: 400,
      updatedAt: 400,
    });
    const result = await writeBack.writeWebsiteChangesToDrive({ accessToken: "mock-token" });
    return {
      result,
      pendingOperations: (await store.loadPendingLocalSyncOperations()).length,
      base: await store.loadLocalSyncBase(),
    };
  });
  assert.equal(driveCommit.result.status, "uploaded");
  assert.equal(driveCommit.result.uploadedMetadataFiles, 22);
  assert.equal(driveCommit.result.localStateUpdated, true);
  assert.equal(driveCommit.pendingOperations, 0);
  assert.equal(driveCommit.base?.accountId, "permission-account-c");
  assert.equal(uploadOrder.at(-1), "sync_manifest.json", "The manifest must be the final Drive write.");
  const committedManifestFile = [...driveFiles.values()].find((file) => file.name === "sync_manifest.json");
  assert.ok(committedManifestFile);
  const committedManifest = JSON.parse(committedManifestFile.bytes.toString("utf8"));
  assert.equal(committedManifest.entries.filter((entry) => entry.kind === "metadata").length, 22);
  assert.equal(committedManifest.entries.some((entry) => entry.fileName === "ai_messages.json"), false);
  const notesEntry = committedManifest.entries.find((entry) => entry.fileName === "notes.json");
  const notesFile = driveFiles.get(notesEntry.cloudFileId);
  assert.ok(JSON.parse(notesFile.bytes.toString("utf8")).some((note) => note.id === "web-first-note"));

  const existingNoteCommit = await firstPage.evaluate(async (accountId) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const writeBack = await import("/src/lib/sync/driveWriteBack.ts");
    const bundle = await store.loadMetadataRestoreBundle();
    const localBase = await store.loadLocalSyncBase();
    const notes = bundle?.files.find((file) => file.fileName === "notes.json")?.json;
    const folders = bundle?.files.find((file) => file.fileName === "folders.json")?.json;
    const existing = Array.isArray(notes) ? notes.find((note) => note.id === "web-first-note") : null;
    const existingFolder = Array.isArray(folders) ? folders.find((folder) => folder.id === "web-first-folder") : null;
    if (!bundle || !localBase || !existing || !existingFolder) throw new Error("The first backup did not become the local sync base.");
    await store.saveLocalCreatedFolder({
      id: "web-first-folder",
      parentId: null,
      title: "Existing folder renamed after restore",
      description: null,
      mode: "study",
      orderIndex: 0,
      createdAt: existingFolder.createdAt,
      updatedAt: 440,
    });
    await store.saveLocalCreatedNote({
      id: "new-note-after-restore",
      folderId: "web-first-folder",
      parentNoteId: null,
      title: "New note created after restore",
      bodyPreview: "This note is added in the same backup as existing edits.",
      wordCount: 10,
      characterCount: 57,
      isPinned: false,
      isFolderPinned: false,
      orderIndex: 1,
      tagNames: [],
      createdAt: 445,
      updatedAt: 445,
    });
    await store.saveLocalNoteDraft({
      schemaVersion: 1,
      noteId: "web-first-note",
      baseCloudVersion: bundle.cloudVersion,
      baseUpdatedAt: existing.updatedAt,
      baseRevisionId: localBase.revision.revisionId,
      title: "Existing note edited on Web",
      mode: "rich_text",
      richTextDocument: {
        text: "An existing note now has an updated body.",
        styleMarks: [{ start: 3, end: 11, style: "Bold" }],
        noteLinks: [],
      },
      blocks: [],
      isPinned: false,
      savedAt: Date.now(),
      pendingDriveSync: true,
    });
    const result = await writeBack.writeWebsiteChangesToDrive({ accessToken: "mock-token" });
    return {
      result,
      pendingOperations: (await store.loadPendingLocalSyncOperations()).length,
    };
  }, driveCommit.base.accountId);
  assert.equal(existingNoteCommit.result.status, "uploaded", "An edit to a note already present on Web and Android must upload.");
  assert.equal(existingNoteCommit.pendingOperations, 0);
  const editedManifestFile = [...driveFiles.values()].filter((file) => file.name === "sync_manifest.json").toSorted((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
  const editedManifest = JSON.parse(editedManifestFile.bytes.toString("utf8"));
  const editedNotesEntry = editedManifest.entries.find((entry) => entry.fileName === "notes.json");
  const editedBlocksEntry = editedManifest.entries.find((entry) => entry.fileName === "blocks.json");
  const editedFoldersEntry = editedManifest.entries.find((entry) => entry.fileName === "folders.json");
  const editedNotes = JSON.parse(driveFiles.get(editedNotesEntry.cloudFileId).bytes.toString("utf8"));
  const editedBlocks = JSON.parse(driveFiles.get(editedBlocksEntry.cloudFileId).bytes.toString("utf8"));
  const editedFolders = JSON.parse(driveFiles.get(editedFoldersEntry.cloudFileId).bytes.toString("utf8"));
  assert.equal(editedNotes.find((note) => note.id === "web-first-note")?.title, "Existing note edited on Web");
  assert.equal(editedNotes.find((note) => note.id === "new-note-after-restore")?.title, "New note created after restore");
  assert.equal(JSON.parse(editedBlocks.find((block) => block.noteId === "web-first-note" && block.type === "rich_text")?.content).text, "An existing note now has an updated body.");
  assert.equal(JSON.parse(editedBlocks.find((block) => block.noteId === "new-note-after-restore" && block.type === "rich_text")?.content).text, "This note is added in the same backup as existing edits.");
  assert.equal(editedFolders.find((folder) => folder.id === "web-first-folder")?.name, "Existing folder renamed after restore");

  await firstPage.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const bundle = await store.loadMetadataRestoreBundle();
    const base = await store.loadLocalSyncBase();
    const notes = bundle?.files.find((file) => file.fileName === "notes.json")?.json;
    const note = Array.isArray(notes) ? notes.find((candidate) => candidate.id === "web-first-note") : null;
    if (!bundle || !base || !note) throw new Error("Concurrent-note fixture is missing its immutable base.");
    await store.saveLocalNoteDraft({
      schemaVersion: 1,
      noteId: "web-first-note",
      baseCloudVersion: bundle.cloudVersion,
      baseUpdatedAt: note.updatedAt,
      baseRevisionId: base.revision.revisionId,
      title: note.title,
      mode: "rich_text",
      richTextDocument: { text: "Website concurrent body.", styleMarks: [], noteLinks: [] },
      blocks: [],
      isPinned: Boolean(note.isPinned),
      savedAt: Date.now(),
      pendingDriveSync: true,
    });
  });

  const concurrentManifestFile = [...driveFiles.values()].find((file) => file.name === "sync_manifest.json");
  const concurrentManifest = JSON.parse(concurrentManifestFile.bytes.toString("utf8"));
  concurrentManifest.cloudVersion = Math.max(Date.now(), concurrentManifest.cloudVersion + 1);
  const mutateMetadata = (fileName, update) => {
    const entry = concurrentManifest.entries.find((candidate) => candidate.fileName === fileName);
    const file = driveFiles.get(entry.cloudFileId);
    const json = JSON.parse(file.bytes.toString("utf8"));
    update(json);
    file.bytes = Buffer.from(JSON.stringify(json));
    file.modifiedTime = new Date(concurrentManifest.cloudVersion).toISOString();
    entry.sha256 = createHash("sha256").update(file.bytes).digest("hex");
    entry.size = file.bytes.length;
    entry.updatedAt = concurrentManifest.cloudVersion;
  };
  mutateMetadata("notes.json", (notes) => {
    const note = notes.find((candidate) => candidate.id === "web-first-note");
    note.bodyPlainText = "Android concurrent body.";
    note.updatedAt = concurrentManifest.cloudVersion;
  });
  mutateMetadata("blocks.json", (blocks) => {
    const block = blocks.find((candidate) => candidate.noteId === "web-first-note" && candidate.type === "rich_text");
    block.content = JSON.stringify({ text: "Android concurrent body.", styleMarks: [], noteLinks: [] });
  });
  concurrentManifestFile.bytes = Buffer.from(JSON.stringify(concurrentManifest));
  concurrentManifestFile.modifiedTime = new Date(concurrentManifest.cloudVersion).toISOString();

  const concurrentCommit = await firstPage.evaluate(async () => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const writeBack = await import("/src/lib/sync/driveWriteBack.ts");
    const result = await writeBack.writeWebsiteChangesToDrive({ accessToken: "mock-token" });
    const conflicts = await store.loadLocalSyncConflicts();
    return { result, resolvedConflict: conflicts.find((conflict) => conflict.resolution === "keep-both") };
  });
  assert.equal(concurrentCommit.result.status, "uploaded");
  assert.equal(concurrentCommit.resolvedConflict?.resolution, "keep-both");
  const concurrentFinalManifest = JSON.parse([...driveFiles.values()].find((file) => file.name === "sync_manifest.json").bytes.toString("utf8"));
  const concurrentNotesEntry = concurrentFinalManifest.entries.find((entry) => entry.fileName === "notes.json");
  const concurrentBlocksEntry = concurrentFinalManifest.entries.find((entry) => entry.fileName === "blocks.json");
  const concurrentNotes = JSON.parse(driveFiles.get(concurrentNotesEntry.cloudFileId).bytes.toString("utf8"));
  const concurrentBlocks = JSON.parse(driveFiles.get(concurrentBlocksEntry.cloudFileId).bytes.toString("utf8"));
  const recoveredConflictNote = concurrentNotes.find((note) => note.title.includes("Website conflict copy"));
  assert.ok(recoveredConflictNote, "The website version must be uploaded as an explicit recovered note.");
  assert.equal(JSON.parse(concurrentBlocks.find((block) => block.noteId === "web-first-note" && block.type === "rich_text").content).text, "Android concurrent body.");
  assert.equal(JSON.parse(concurrentBlocks.find((block) => block.noteId === recoveredConflictNote.id && block.type === "rich_text").content).text, "Website concurrent body.");

  driveFiles.clear();
  uploadOrder.length = 0;
  mockPermissionId = "permission-account-d";
  corruptReadbackName = "folders.json";
  const failedCommit = await firstPage.evaluate(async () => {
    const account = await import("/src/lib/sync/accountContext.ts");
    const identity = await import("/src/lib/googleDrive/identity.ts");
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const writeBack = await import("/src/lib/sync/driveWriteBack.ts");
    const accountId = "permission-account-d";
    identity.rememberGoogleDriveToken({ accessToken: "mock-token", expiresAt: Date.now() + 3_600_000, scope: "https://www.googleapis.com/auth/drive.file" });
    account.setActiveGoogleAccount(accountId);
    await store.prepareAccountStorage(accountId);
    await store.clearLocalWorkspaceData();
    await store.saveLocalCreatedFolder({
      id: "failure-folder",
      parentId: null,
      title: "Must remain local",
      description: null,
      mode: "study",
      orderIndex: 0,
      createdAt: 500,
      updatedAt: 500,
    });
    let error = "";
    try {
      await writeBack.writeWebsiteChangesToDrive({ accessToken: "mock-token" });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      error,
      pendingOperations: (await store.loadPendingLocalSyncOperations()).length,
      folders: await store.loadLocalCreatedFolders(),
    };
  });
  assert.match(failedCommit.error, /same bytes/i);
  assert.equal(failedCommit.pendingOperations, 1, "A failed staged upload must retain its journal entry.");
  assert.equal(failedCommit.folders.some((folder) => folder.id === "failure-folder"), true);
  assert.equal([...driveFiles.values()].some((file) => file.name === "sync_manifest.json"), false, "A failed staged upload must never commit a manifest.");
  corruptReadbackName = null;

  console.log("Browser sync contract verified: account isolation, locking, offline journalling, manifest-last commit, and failed-upload recovery all passed.");
} finally {
  await browser.close();
}
