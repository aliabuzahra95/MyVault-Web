import { InternalWebGraphWorkflow, WEB_GRAPH_RESTORE_ENABLED, type WebGraphTransport } from "../../src/lib/restore/webGraphWorkflow";
import { BackupGraph, BACKUP_GRAPH_PUBLICATION_ENABLED, parseGraphCommit, reconstructBackupGraph, type GraphObject, type GraphObjectRef, type BackupGraphCommit } from "../../src/lib/restore/backupGraph";
import { backupBytesSha256, createBackupDelta, INCREMENTAL_BACKUP_PUBLICATION_ENABLED } from "../../src/lib/restore/incrementalBackup";
import { encodeGraphCommit } from "../../src/lib/restore/backupGraph";
import { createInitialMetadataRestoreBundle } from "../../src/lib/sync/syncPreflight";
import { captureWebGraphSnapshot, loadWebGraphState, pendingWebGraphOperations, loadStagedGraphObjects, loadWebGraphOperation,
  completeWebGraphOperation } from "../../src/lib/restore/webGraphStore";
import { saveLocalCreatedNote, saveLocalCreatedAttachment, saveLocalAttachmentBlob, saveLocalPdfReaderState,
  deleteLocalPdfReaderState, loadMetadataRestoreBundle, loadLocalCreatedNotes, loadPendingLocalSyncOperations,
  saveMetadataRestoreBundle, loadLocalAttachmentBlob, backupGraphStorageTransaction, type LocalSyncOperation } from "../../src/lib/restore/localRestoreStore";
import { setActiveGoogleAccount, getActiveAccountId, accountStorageKey } from "../../src/lib/sync/accountContext";
import { acquireNoteEditorLease } from "../../src/lib/sync/editorLease";
import { verifyGraphTransportContracts } from "./web-graph-transport";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(work: () => Promise<unknown>, message: string) {
  let rejected = false; try { await work(); } catch { rejected = true; } check(rejected, message);
}
const row = (id: string, title: string, updatedAt = 100) => ({ id, folderId: null, parentNoteId: null, title, bodyPlainText: title,
  isPinned: false, isFavourite: false, isFolderPinned: false, orderIndex: 0, createdAt: 50, updatedAt, deletedAt: null, unknownField: { keep: "العربية" } });
const overlay = (id: string, title: string, updatedAt = 200) => ({ id, title, bodyPreview: title, folderId: null, parentNoteId: null,
  isPinned: false, isFolderPinned: false, orderIndex: 0, createdAt: 50, updatedAt, tagNames: [], wordCount: 1, characterCount: title.length });
const attachment = (id: string, size: number, title = "PDF العربية") => ({ id, name: title, noteId: null, libraryFolderId: null,
  mimeType: "application/pdf", sizeBytes: size, createdAt: 50, isPinned: false });
type ObjectData = { role: string; bytes: Uint8Array };
class LocalObjects implements WebGraphTransport {
  readonly accountId: string; readonly lineageId = "disposable-web-lineage";
  data = new Map<string, ObjectData>(); creates: string[] = []; reads: string[] = []; sequence = 0;
  loseRole: string | null = null;
  constructor(accountId: string) { this.accountId = accountId; }
  assertAccount() { check(getActiveAccountId() === this.accountId, "Account mismatch"); }
  async reserveIds(count: number) { return Array.from({ length: count }, () => `${this.accountId}-object-${++this.sequence}`); }
  async commits(): Promise<GraphObject[]> {
    return [...this.data.entries()].filter(([, o]) => o.role === "commit").map(([cloudFileId, o]) => ({
      objectRef: { cloudFileId, sha256: "", size: o.bytes.length }, bytes: new Uint8Array(o.bytes),
    })).reduce(async (result, obj) => [...await result, { ...obj, objectRef: { ...obj.objectRef, sha256: await backupBytesSha256(obj.bytes) } }], Promise.resolve([] as GraphObject[]));
  }
  async read(id: string) { this.reads.push(id); return this.data.get(id)?.bytes.slice() ?? null; }
  async create(id: string, role: string, bytes: Uint8Array) {
    check(!this.data.has(id), "Immutable object overwrite attempted"); this.data.set(id, { role, bytes: bytes.slice() }); this.creates.push(role);
    if (this.loseRole === role) { this.loseRole = null; throw new Error("Disposable uncertain create response"); }
  }
  async append(parent: { commit: BackupGraphCommit; objectRef: GraphObjectRef }, changes: Parameters<typeof createBackupDelta>[3], binaries?: Parameters<typeof createBackupDelta>[4]) {
    const delta = createBackupDelta(parent.commit.checkpoint.checkpointId, parent.commit.delta?.deltaId ?? parent.commit.checkpoint.checkpointId,
      crypto.randomUUID(), changes, binaries);
    const [deltaFile, commitFile] = await this.reserveIds(2); const bytes = new TextEncoder().encode(JSON.stringify(delta));
    this.data.set(deltaFile, { role: "delta", bytes });
    const commit = { ...parent.commit, commitId: crypto.randomUUID(), kind: "delta" as const,
      requiredReaders: [...new Set([...parent.commit.requiredReaders, "checkpoint-delta-v1", ...(binaries ? ["checkpoint-delta-binaries-v1"] : [])])].sort(),
      parents: [{ commitId: parent.commit.commitId, ...parent.objectRef }],
      delta: { deltaId: delta.deltaId, parentId: delta.parentId, cloudFileId: deltaFile, sha256: await backupBytesSha256(bytes), size: bytes.length } };
    const raw = encodeGraphCommit(commit); this.data.set(commitFile, { role: "commit", bytes: raw });
    return { commit, objectRef: { cloudFileId: commitFile, sha256: await backupBytesSha256(raw), size: raw.length } };
  }
}

async function fixture(accountId: string) {
  setActiveGoogleAccount(accountId);
  const store = new LocalObjects(accountId); const workflow = new InternalWebGraphWorkflow(store);
  const bundle = createInitialMetadataRestoreBundle(50);
  bundle.files.find((f) => f.fileName === "notes.json")!.json = [row("n", "Original العربية"), row("keep", "Keep")];
  bundle.files.find((f) => f.fileName === "blocks.json")!.json = [{ id: "n-rich-text", noteId: "n", type: "rich_text", orderIndex: 0,
    content: JSON.stringify({ text: "Original العربية", styleMarks: [{ start: 0, end: 8, style: "Bold" }], noteLinks: [{ start: 0, end: 8, noteId: "keep" }], futureEnvelopeField: { keep: true } }) }];
  bundle.files.find((f) => f.fileName === "attachments.json")!.json = [{ id: "pdf", fileName: "test.pdf", noteId: null,
    libraryFolderId: null, mimeType: "application/pdf", sizeBytes: 4096, createdAt: 50, fileEntry: "files/pdf" }];
  const snapshot = await captureWebGraphSnapshot(accountId, store.lineageId);
  await workflow.createRoot(snapshot, bundle, { pdf: new Blob([new Uint8Array(4096).fill(79)]) });
  check(store.creates.at(-1) === "commit", "Root commit not last");
  return { store, workflow };
}

export async function runWebGraphRuntime() {
  const tests: string[] = []; let fixtureNumber = 0;
  const newFixture = () => fixture(`graph-runtime-${++fixtureNumber}`);
  check(!BACKUP_GRAPH_PUBLICATION_ENABLED && !INCREMENTAL_BACKUP_PUBLICATION_ENABLED && WEB_GRAPH_RESTORE_ENABLED,
    "Only the coordinated graph Restore route may be enabled on Web");
  tests.push("Web publication disabled; coordinated graph Restore enabled");
  const { store, workflow } = await newFixture();
  const rootState = await loadWebGraphState(store.accountId, store.lineageId);
  check(rootState?.trust === "VERIFIED" && rootState.published && rootState.applied === null, "Verified root is not durable or fabricated a Restore event");
  const ownRootCurrent = await workflow.restore();
  check(ownRootCurrent.status === "ALREADY_CURRENT" && (await loadWebGraphState(store.accountId, store.lineageId))!.applied === null,
    "Own publication replayed a checkpoint or fabricated Restore position"); tests.push("own publication is current without inventing Restore position");
  const before = store.creates.length; const empty = await workflow.publish();
  check(empty.status === "ALREADY_CURRENT" && empty.metrics.payloadRows === 0 && store.creates.length === before, "Zero-change path did work");
  const emptyCapture = await captureWebGraphSnapshot(store.accountId, store.lineageId);
  check(emptyCapture.bundle === null && emptyCapture.payloadRowsRead === 0, "Empty capture read the whole bundle"); tests.push("zero-change capture and object-free backup");
  {
    const f = await newFixture();
    const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const next = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Latest remote note") }]);
    f.store.reads = [];
    const behind = await f.workflow.backupStatus(next.commit.commitId);
    check(!behind.current && behind.notice === null && behind.remoteCommitId === next.commit.commitId,
      "A dismissed newer notice was incorrectly treated as current");
    check(f.store.reads.length === 0, "Freshness inspection downloaded Vault payloads");
    await f.workflow.restore();
    check((await f.workflow.backupStatus()).current, "Applied tip was not recognized as current");
    await saveLocalCreatedNote(overlay("n", "Local browser edit"));
    const restored = await f.workflow.restore({ overwriteLocalChanges: true });
    const bundle = await loadMetadataRestoreBundle();
    const notes = bundle!.files.find((file) => file.fileName === "notes.json")!.json as Record<string, unknown>[];
    check(restored.commitId === next.commit.commitId && notes.find((note) => note.id === "n")?.title === "Latest remote note",
      "Explicit Restore stopped at the old checkpoint while claiming the latest tip");
    check((await f.workflow.backupStatus()).current, "Explicit Restore did not reach the latest verified tip");
    tests.push("dismissed newer notice is not current; explicit Restore replays checkpoint plus descendants");
    setActiveGoogleAccount(store.accountId);
  }
  await saveLocalCreatedNote(overlay("n", "Renamed العربية"));
  const one = await workflow.publish();
  check(one.metrics.deltasCreated === 1 && one.metrics.commitsCreated === 1 && one.metrics.binariesCreated === 0 && one.metrics.payloadRows === 1, "One-note writer work not bounded");
  let state = (await loadWebGraphState(store.accountId, store.lineageId))!;
  let delta = JSON.parse(new TextDecoder().decode(store.data.get(state.published!.commit.delta!.cloudFileId)!.bytes));
  check(delta.changes.length === 1 && delta.changes[0].file === "notes.json" && delta.changes[0].key[0] === "n", "Metadata-only rename changed unrelated/body records");
  const renamed = (await loadMetadataRestoreBundle())!;
  const unchangedBody = JSON.parse((renamed.files.find((f) => f.fileName === "blocks.json")!.json as Array<{ content: string }>)[0].content);
  check(unchangedBody.text === "Original العربية" && unchangedBody.styleMarks[0].style === "Bold"
    && unchangedBody.noteLinks[0].noteId === "keep" && unchangedBody.futureEnvelopeField.keep === true, "Rename stripped rich text");
  check((await loadPendingLocalSyncOperations()).length === 0, "Exact acknowledgement failed"); tests.push("one note creates one delta and last commit");
  for (let i = 0; i < 20; i++) await saveLocalCreatedNote(overlay("n", `Edit ${i}`, 300 + i));
  await saveLocalCreatedNote(overlay("keep", "Updated keep", 400));
  await saveLocalCreatedNote(overlay("three", "Third note", 400));
  await workflow.publish(); state = (await loadWebGraphState(store.accountId, store.lineageId))!;
  delta = JSON.parse(new TextDecoder().decode(store.data.get(state.published!.commit.delta!.cloudFileId)!.bytes));
  check(delta.changes.filter((c: { file: string }) => c.file === "notes.json").length === 3, "Rapid edits created excess changes"); tests.push("twenty edits coalesce; three notes in one delta");
  await saveLocalCreatedAttachment(attachment("pdf", 8192)); await saveLocalAttachmentBlob("pdf", new Blob([new Uint8Array(8192).fill(82)]));
  const replacement = await workflow.publish(); check(replacement.metrics.binariesCreated === 1, "Replacement binary not created");
  const graph = await BackupGraph.discover(await store.commits(), store.accountId, store.lineageId);
  const rebuilt = await reconstructBackupGraph(graph, async (id) => (await store.read(id))!);
  check(rebuilt.binaries?.find((b) => b.attachmentId === "pdf")?.size === 8192, "Replacement did not resolve");
  check(store.data.get(rootState.published.commit.checkpoint.cloudFileId), "Checkpoint destroyed"); tests.push("4096 to 8192 immutable replacement");
  await saveLocalCreatedAttachment(attachment("pdf", 8192, "Metadata only"));
  const meta = await workflow.publish(); check(meta.metrics.binariesCreated === 0, "Metadata-only uploaded binary"); tests.push("metadata-only binary reuse");
  await saveLocalCreatedAttachment(attachment("new-pdf", 1024)); await saveLocalAttachmentBlob("new-pdf", new Blob([new Uint8Array(1024).fill(65)]));
  check((await workflow.publish()).metrics.binariesCreated === 1, "New attachment not backed up"); tests.push("new attachment descriptor");
  await saveLocalPdfReaderState({ schemaVersion: 1, attachmentId: "pdf", pageIndex: 0, pageCount: 2, progressPercent: 0, zoom: 1,
    lastOpenedAt: 1, updatedAt: 1, pendingDriveSync: true }); await workflow.publish();
  await deleteLocalPdfReaderState("pdf"); await workflow.publish();
  const bundle = (await loadMetadataRestoreBundle())!;
  check((bundle.files.find((f) => f.fileName === "pdf_reading_progress.json")!.json as unknown[]).length === 0, "Exact deletion failed");
  check((bundle.files.find((f) => f.fileName === "notes.json")!.json as Array<{ id: string }>).some((n) => n.id === "keep"), "Absence deleted unrelated note"); tests.push("explicit delete; absence never deletes");
  const writerFixture = { accountId: store.accountId, lineageId: store.lineageId,
    refs: (await store.commits()).map((o) => o.objectRef), objects: Object.fromEntries([...store.data].map(([id, o]) => [id, btoa(String.fromCharCode(...o.bytes))])),
    expectedPdfSize: 8192, expectedTitle: "Edit 19" };

  for (const phase of ["after-stage", "after-delta", "after-commit", "before-local-completion"]) {
    const f = await newFixture(); await saveLocalCreatedNote(overlay("n", `Recover ${phase}`));
    let crashed = false; const interrupted = new InternalWebGraphWorkflow(f.store, async (p) => { if (p === phase && !crashed) { crashed = true; throw new Error("Crash boundary"); } });
    await rejects(() => interrupted.publish(), "Publication did not stop at crash boundary");
    const operations = await pendingWebGraphOperations(f.store.accountId); check(operations.length === 1, "Intent not durable");
    const expectedCommit = operations[0].next.commit.commitId;
    const after = await new InternalWebGraphWorkflow(f.store).publish();
    check(after.commitId === expectedCommit && (await pendingWebGraphOperations(f.store.accountId)).length === 0, "Restart created another publication");
    const commits = await f.store.commits(); check(commits.length === 2, "Duplicate logical commit after recovery");
    check(await completeWebGraphOperation(f.store.accountId, operations[0].operationId) === false, "Completion advanced twice");
    tests.push(`restart ${phase}; exact retry and idempotent completion`);
  }
  for (const role of ["binary", "delta"]) {
    const f = await newFixture();
    if (role === "binary") { await saveLocalCreatedAttachment(attachment("pdf", 8192)); await saveLocalAttachmentBlob("pdf", new Blob([new Uint8Array(8192).fill(82)])); }
    else await saveLocalCreatedNote(overlay("n", "Uncertain delta"));
    f.store.loseRole = role; await rejects(() => f.workflow.publish(), "Uncertain create not simulated");
    await new InternalWebGraphWorkflow(f.store).publish(); check((await f.store.commits()).length === 2, "Retry duplicated commit"); tests.push(`uncertain ${role} response recovered without overwrite`);
  }
  {
    const f = await newFixture(); await saveLocalCreatedNote(overlay("n", "Generation N", 200));
    let edited = false;
    const racing = new InternalWebGraphWorkflow(f.store, async (phase) => {
      if (phase === "after-delta" && !edited) { edited = true; await saveLocalCreatedNote(overlay("n", "Generation N+1", 300)); }
    });
    await racing.publish();
    check((await loadLocalCreatedNotes()).find((n) => n.id === "n")?.title === "Generation N+1", "Newer overlay lost");
    check((await loadPendingLocalSyncOperations()).length === 1, "N acknowledgement erased N+1");
    await f.workflow.publish(); check((await loadPendingLocalSyncOperations()).length === 0, "N+1 could not publish"); tests.push("N acknowledgement retains N+1, subsequent backup succeeds");
  }
  {
    const f = await newFixture(); await saveLocalCreatedNote(overlay("n", "N binary", 200));
    const interrupted = new InternalWebGraphWorkflow(f.store, async (phase) => { if (phase === "after-stage") throw new Error("Stop"); });
    await rejects(() => interrupted.publish(), "Missing staged bytes test not staged");
    const op = (await pendingWebGraphOperations(f.store.accountId))[0];
    const objects = await loadStagedGraphObjects(f.store.accountId, op);
    await backupGraphStorageTransaction("readwrite", (tx, finish) => {
      const first = objects[0]; tx.objectStore("backup-graph-staged-objects").put({ ...first, bytes: new Blob(["corrupt"]) }, [f.store.accountId, op.operationId, first.objectRef.cloudFileId]); finish(undefined);
    });
    await rejects(() => f.workflow.publish(), "Corrupt staging was accepted");
    check((await loadPendingLocalSyncOperations()).length === 1 && (await f.store.commits()).length === 1, "Corrupt staging acknowledged changes"); tests.push("corrupt durable staging fails closed");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const a = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Branch A") }]);
    const b = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Branch B") }]);
    const fork = await BackupGraph.discover(await f.store.commits(), f.store.accountId, f.store.lineageId);
    check(fork.status === "FORK" && fork.tips.includes(a.commit.commitId) && fork.tips.includes(b.commit.commitId), "Sibling lost");
    await rejects(() => f.workflow.publish(), "Fork allowed Backup"); await rejects(() => f.workflow.restore(), "Fork allowed Restore"); tests.push("immutable siblings survive; fork blocks both paths");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const b = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Restore B") }]);
    await f.store.append(b, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Restore C") }]);
    f.store.reads = []; const restored = await f.workflow.restore();
    check(restored.status === "COMPLETE" && !f.store.reads.includes(parent.commit.checkpoint.cloudFileId), "Targeted Restore replayed checkpoint");
    check((await loadPendingLocalSyncOperations()).length === 0, "Restore polluted journal");
    const result = await f.workflow.restore(); check(result.status === "ALREADY_CURRENT", "Already-current Restore not fast"); tests.push("B C targeted Restore; no checkpoint replay or journal pollution");
    const currentState = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!;
    check(currentState.published?.commit.commitId === parent.commit.commitId && currentState.applied?.commit.commitId !== parent.commit.commitId, "Published and applied state conflated"); tests.push("publication and applied positions remain independent");
    const restoredPosition = currentState.applied;
    await saveLocalCreatedNote(overlay("n", "Local after Restore")); await f.workflow.publish();
    const afterBackup = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!;
    check(afterBackup.applied?.commit.commitId === restoredPosition?.commit.commitId && afterBackup.published?.commit.commitId !== restoredPosition?.commit.commitId,
      "Publishing after Restore overwrote the restored position");
    check((await f.workflow.restore()).status === "ALREADY_CURRENT", "Restore after local publication replayed old history");
    tests.push("Restore then Backup retains independent positions and current fast path");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const [id] = await f.store.reserveIds(1); const bytes = new Uint8Array(8192).fill(82); f.store.data.set(id, { role: "binary", bytes });
    const replacement = { attachmentId: "pdf", cloudFileId: id, size: bytes.length, sha256: await backupBytesSha256(bytes) };
    const attachmentRow = { id: "pdf", fileName: "new.pdf", noteId: null, libraryFolderId: null, mimeType: "application/pdf", sizeBytes: 8192, createdAt: 50, fileEntry: "files/pdf" };
    const b = await f.store.append(parent, [{ file: "attachments.json", key: ["pdf"], operation: "upsert", value: attachmentRow }], [replacement]);
    const c = await f.store.append(b, [{ file: "settings.json", key: ["settings"], operation: "upsert", value: { theme: "dark", futureSetting: "keep" } }]);
    let crashed = false;
    const restore = new InternalWebGraphWorkflow(f.store, async (phase) => { if (phase === "after-restore-stage" && !crashed) { crashed = true; throw new Error("Restore restart"); } });
    await rejects(() => restore.restore(), "Restore stage interruption not simulated");
    check((await loadWebGraphState(f.store.accountId, f.store.lineageId))!.applied === null, "Restore advanced before applying bytes");
    await new InternalWebGraphWorkflow(f.store).restore();
    check((await loadLocalAttachmentBlob("pdf"))?.size === 8192, "Replacement not durable");
    check((await loadWebGraphState(f.store.accountId, f.store.lineageId))!.applied!.commit.commitId === c.commit.commitId, "Restore recovery did not advance sequentially");
    check((await loadMetadataRestoreBundle())!.files.find((file) => file.fileName === "settings.json")!.json.theme === "dark", "Settings not applied atomically with position");
    tests.push("verified 8192 replacement and settings survive Restore restart");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const b = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "B committed") }]);
    const c = await f.store.append(b, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "C corrupt") }]);
    f.store.data.get(c.commit.delta!.cloudFileId)!.bytes = new Uint8Array([1, 2, 3]);
    await rejects(() => f.workflow.restore(), "Corrupt C accepted");
    check((await loadWebGraphState(f.store.accountId, f.store.lineageId))!.applied!.commit.commitId === b.commit.commitId, "B/C partial progress misreported"); tests.push("B succeeds, corrupt C fails, applied position stays B");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Remote") }]);
    await saveLocalCreatedNote(overlay("n", "Local"));
    await rejects(() => f.workflow.restore(), "Restore overwrote local edit");
    check((await loadLocalCreatedNotes())[0].title === "Local", "Local edit erased"); tests.push("local pending edit blocks Restore");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Remote") }]);
    const release = await acquireNoteEditorLease(f.store.accountId);
    try { await rejects(() => f.workflow.restore(), "Open editor allowed Restore completion"); }
    finally { release(); }
    await f.workflow.restore(); tests.push("unsaved open editor protected across tabs");
  }
  {
    const f = await newFixture(); await saveLocalCreatedNote(overlay("n", "Account A"));
    const interrupted = new InternalWebGraphWorkflow(f.store, async (phase) => { if (phase === "after-commit") throw new Error("Account test"); });
    await rejects(() => interrupted.publish(), "Account test not interrupted");
    const op = (await pendingWebGraphOperations(f.store.accountId))[0]; setActiveGoogleAccount("graph-runtime-account-B");
    await rejects(() => completeWebGraphOperation(f.store.accountId, op.operationId), "B completed A publication");
    check(await loadWebGraphOperation("graph-runtime-account-B", op.operationId) === null, "B saw A operation");
    setActiveGoogleAccount(f.store.accountId); await f.workflow.publish(); tests.push("account isolation and switch-back recovery");
  }
  {
    const f = await newFixture(); const bundle = (await loadMetadataRestoreBundle())!;
    await saveMetadataRestoreBundle(bundle);
    check((await loadWebGraphState(f.store.accountId, f.store.lineageId))!.trust === "INVALIDATED", "Legacy Restore did not invalidate graph proof");
    await rejects(() => f.workflow.publish(), "Invalidated baseline accepted"); tests.push("legacy Restore invalidates graph proof, without deleting data");
  }
  {
    const f = await newFixture();
    await saveLocalAttachmentBlob("pdf", new Blob([new Uint8Array(8192).fill(82)]));
    const captured = await captureWebGraphSnapshot(f.store.accountId, f.store.lineageId);
    check(captured.fingerprints.pdf?.size === 8192 && captured.overlays.some((o) => o.store === "created-attachments"), "Byte-only replacement was not journaled with metadata");
    check((await f.workflow.publish()).metrics.binariesCreated === 1, "Byte-only replacement missed upload");
    await saveLocalAttachmentBlob("pdf", new Blob([new Uint8Array(8192).fill(82)]), "verified-cache");
    check((await loadPendingLocalSyncOperations()).length === 0, "Reading/caching a verified PDF dirtied backup"); tests.push("byte-only replacement tracked; verified PDF cache creates no dirty work");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    const b = await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Incoming B") }]);
    let interrupted = false;
    const restoring = new InternalWebGraphWorkflow(f.store, async (phase) => { if (phase === "after-restore-stage" && !interrupted) { interrupted = true; throw new Error("Fork arrives after staging"); } });
    await rejects(() => restoring.restore(), "Restore stage boundary missing");
    await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "Sibling") }]);
    await rejects(() => f.workflow.restore(), "Recovery silently selected a newly forked branch");
    check((await loadWebGraphState(f.store.accountId, f.store.lineageId))!.applied === null, "Forked Restore advanced"); tests.push("fork arriving during Restore recovery blocks advancement");
  }
  {
    const f = await newFixture(); const parent = (await loadWebGraphState(f.store.accountId, f.store.lineageId))!.published!;
    await f.store.append(parent, [{ file: "notes.json", key: ["n"], operation: "upsert", value: row("n", "New parent") }]);
    await f.workflow.restore(); await saveLocalCreatedNote(overlay("n", "Edit after Restore", 400));
    await f.workflow.publish(); tests.push("Backup extends restored position, not stale publication binding");
  }
  tests.push(...await verifyGraphTransportContracts());
  const restart = await newFixture(); await saveLocalCreatedNote(overlay("n", "Browser crash N", 200));
  const stop = new InternalWebGraphWorkflow(restart.store, async (phase) => { if (phase === "after-commit") throw new Error("Real browser restart fixture"); });
  await rejects(() => stop.publish(), "Browser restart fixture not interrupted");
  const op = (await pendingWebGraphOperations(restart.store.accountId))[0];
  await saveLocalCreatedNote(overlay("n", "Browser crash N+1", 300));
  const restartFixture = { accountId: restart.store.accountId, sequence: restart.store.sequence, operationId: op.operationId,
    commitId: op.next.commit.commitId, data: [...restart.store.data].map(([id, obj]) => ({ id, role: obj.role, base64: btoa(String.fromCharCode(...obj.bytes)) })) };
  return { tests, writerFixture, restartFixture, gateDisabled: true };
}

export async function resumeAfterBrowserRestart(fixture: { accountId: string; sequence: number; operationId: string; commitId: string; data: Array<{ id: string; role: string; base64: string }> }) {
  setActiveGoogleAccount(fixture.accountId); const store = new LocalObjects(fixture.accountId); store.sequence = fixture.sequence;
  for (const value of fixture.data) store.data.set(value.id, { role: value.role, bytes: Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0)) });
  const op = await loadWebGraphOperation(store.accountId, fixture.operationId);
  check(op?.status === "STAGED", "Actual browser restart lost publication intent");
  const result = await new InternalWebGraphWorkflow(store).publish(); check(result.commitId === fixture.commitId, "Restart generated duplicate commit");
  check((await loadLocalCreatedNotes()).find((n) => n.id === "n")?.title === "Browser crash N+1", "Restart erased N+1");
  check((await loadPendingLocalSyncOperations()).length === 1, "Restart acknowledgement erased N+1 journal");
  return { status: "PASS", createdObjects: store.creates.length, sameCommit: true, retainedNewerEdit: true };
}

export async function coldRestoreWebWriter(fixture: { accountId: string; lineageId: string; refs: GraphObjectRef[]; objects: Record<string, string>; expectedTitle: string }) {
  setActiveGoogleAccount(fixture.accountId); const store = new LocalObjects(fixture.accountId);
  const commits = new Set(fixture.refs.map((r) => r.cloudFileId));
  for (const [id, base64] of Object.entries(fixture.objects)) store.data.set(id, { role: commits.has(id) ? "commit" : "object",
    bytes: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) });
  check(await loadMetadataRestoreBundle() === null, "Cold test must start empty");
  await new InternalWebGraphWorkflow(store).restore();
  const bundle = (await loadMetadataRestoreBundle())!;
  check((bundle.files.find((f) => f.fileName === "notes.json")!.json as Array<{ id: string; title: string }>).find((r) => r.id === "n")?.title === fixture.expectedTitle, "Cold Restore body mismatch");
  check((await loadLocalAttachmentBlob("pdf"))?.size === 8192, "Cold Restore retained stale 4096 bytes");
  check((await loadPendingLocalSyncOperations()).length === 0, "Cold Restore polluted journal");
  const already = await new InternalWebGraphWorkflow(store).restore(); check(already.status === "ALREADY_CURRENT", "Cold state was not persisted");
  return { status: "PASS", finalPdfSize: 8192, journalCount: 0 };
}
