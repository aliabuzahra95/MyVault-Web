import { GoogleDriveWebGraphTransport, type VerifiedGraphLayout } from "../../src/lib/googleDrive/graphTransport";
import { rememberGoogleDriveToken } from "../../src/lib/googleDrive/identity";
import { verifyAndActivateGoogleDriveSession } from "../../src/lib/googleDrive/accountSession";
import { InternalWebGraphWorkflow } from "../../src/lib/restore/webGraphWorkflow";
import { BackupGraph, reconstructBackupGraph, verifyGraphObject } from "../../src/lib/restore/backupGraph";
import { backupBytesSha256 } from "../../src/lib/restore/incrementalBackup";
import { captureWebGraphSnapshot, loadWebGraphState, pendingWebGraphOperations } from "../../src/lib/restore/webGraphStore";
import { createInitialMetadataRestoreBundle } from "../../src/lib/sync/syncPreflight";
import { saveLocalCreatedNote, saveLocalCreatedAttachment, saveLocalAttachmentBlob, saveLocalPdfReaderState,
  deleteLocalPdfReaderState, loadPendingLocalSyncOperations } from "../../src/lib/restore/localRestoreStore";

let transport: GoogleDriveWebGraphTransport;
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const note = (id: string, title: string, updatedAt = 100) => ({ id, title, folderId: null, parentNoteId: null,
  bodyPreview: title, isPinned: false, isFolderPinned: false, orderIndex: 0, createdAt: 50, updatedAt,
  tagNames: [], wordCount: 1, characterCount: title.length });
const attachment = (id: string, sizeBytes: number, name = "Disposable PDF") => ({ id, sizeBytes, name,
  noteId: null, libraryFolderId: null, mimeType: "application/pdf", createdAt: 50, isPinned: false });

export async function connect(accessToken: string, layout: VerifiedGraphLayout) {
  const token = rememberGoogleDriveToken({ accessToken, expiresAt: Date.now() + 3_000_000, scope: "https://www.googleapis.com/auth/drive.file" });
  const session = await verifyAndActivateGoogleDriveSession(token);
  transport = new GoogleDriveWebGraphTransport(session, layout);
  await transport.verifyLayout();
  return { accountId: session.accountId, lineageId: layout.lineageId };
}

export async function root() {
  const bundle = createInitialMetadataRestoreBundle(50);
  bundle.files.find((f) => f.fileName === "notes.json")!.json = ["n", "keep"].map((id) => ({ ...note(id, id === "n" ? "Original العربية" : "Keep"),
    bodyPlainText: id === "n" ? "Original العربية" : "Keep", isFavourite: false, deletedAt: null, unknownField: { keep: "العربية" } }));
  bundle.files.find((f) => f.fileName === "blocks.json")!.json = [{ id: "n-rich-text", noteId: "n", type: "rich_text", orderIndex: 0,
    content: JSON.stringify({ text: "Original العربية", styleMarks: [{ start: 0, end: 8, style: "Bold" }],
      noteLinks: [{ start: 0, end: 8, noteId: "keep" }], futureEnvelopeField: { keep: true } }) }];
  bundle.files.find((f) => f.fileName === "attachments.json")!.json = [{ id: "pdf", fileName: "test.pdf", noteId: null,
    libraryFolderId: null, mimeType: "application/pdf", sizeBytes: 4096, createdAt: 50, fileEntry: "files/pdf" }];
  return new InternalWebGraphWorkflow(transport).createRoot(
    await captureWebGraphSnapshot(transport.accountId, transport.lineageId), bundle,
    { pdf: new Blob([new Uint8Array(4096).fill(79)]) });
}

export async function publish(kind: string) {
  if (kind === "one-note") await saveLocalCreatedNote(note("n", "Renamed العربية"));
  if (kind === "three-notes") {
    for (let i = 0; i < 20; i++) await saveLocalCreatedNote(note("n", `Edit ${i}`, 300 + i));
    await saveLocalCreatedNote(note("keep", "Updated keep", 400));
    await saveLocalCreatedNote(note("three", "Third note", 400));
  }
  if (kind === "replacement") {
    await saveLocalCreatedAttachment(attachment("pdf", 8192));
    await saveLocalAttachmentBlob("pdf", new Blob([new Uint8Array(8192).fill(82)]));
  }
  if (kind === "metadata-only") await saveLocalCreatedAttachment(attachment("pdf", 8192, "Renamed PDF"));
  if (kind === "new-attachment") {
    await saveLocalCreatedAttachment(attachment("new-pdf", 1024));
    await saveLocalAttachmentBlob("new-pdf", new Blob([new Uint8Array(1024).fill(65)]));
  }
  if (kind === "progress") await saveLocalPdfReaderState({ schemaVersion: 1, attachmentId: "pdf", pageIndex: 0,
    pageCount: 2, progressPercent: 0, zoom: 1, lastOpenedAt: 1, updatedAt: 1, pendingDriveSync: true });
  if (kind === "delete") await deleteLocalPdfReaderState("pdf");
  return new InternalWebGraphWorkflow(transport).publish();
}

export async function verify() {
  const inventory = await transport.commits();
  const graph = await BackupGraph.discover(inventory, transport.accountId, transport.lineageId);
  check(graph.status === "SINGLE_TIP", "Expected one graph tip");
  const rebuilt = await reconstructBackupGraph(graph, async (id) => {
    const bytes = await transport.read(id); check(bytes, "Missing graph bytes"); return bytes!;
  });
  check(rebuilt.binaries?.find((b) => b.attachmentId === "pdf")?.size === 8192, "Replacement size mismatch");
  check(rebuilt.binaries?.find((b) => b.attachmentId === "new-pdf")?.size === 1024, "New binary size mismatch");
  return { refs: inventory.map((o) => o.objectRef), expectedPdfSize: 8192, expectedTitle: "Edit 19" };
}

export async function restore() { return new InternalWebGraphWorkflow(transport).restore(); }

export async function stageInterrupted(phase: string, title: string) {
  await saveLocalCreatedNote(note("n", title, 700));
  let stopped = false;
  try { await new InternalWebGraphWorkflow(transport, async (p) => {
    if (p === phase) throw new Error("Disposable simulated interruption");
  }).publish(); } catch { stopped = true; }
  const pending = await pendingWebGraphOperations(transport.accountId);
  check(stopped && pending.length === 1, "Durable interruption not established");
  return { operationId: pending[0].operationId, commitId: pending[0].next.commit.commitId };
}

export async function editNewer() { await saveLocalCreatedNote(note("n", "Newer N+1", 800)); }
export async function pending() { return (await loadPendingLocalSyncOperations()).length; }
export async function positions() { return loadWebGraphState(transport.accountId, transport.lineageId); }
export async function fork() {
  const graph = await BackupGraph.discover(await transport.commits(), transport.accountId, transport.lineageId);
  check(graph.status === "FORK" && graph.tips.length === 2, "Both concurrent siblings must survive");
  let backupBlocked = false; let restoreBlocked = false;
  try { await new InternalWebGraphWorkflow(transport).publish(); } catch { backupBlocked = true; }
  try { await new InternalWebGraphWorkflow(transport).restore(); } catch { restoreBlocked = true; }
  check(backupBlocked && restoreBlocked, "Fork did not block ordinary operations");
  return { status: graph.status, tips: graph.tips };
}

/** Provider receipt tests only. These deliberately tiny objects are not backup commits. */
export async function providerContracts() {
  const ids = await transport.reserveIds(2);
  const bytes = new TextEncoder().encode("disposable receipt fixture");
  const ref = { cloudFileId: ids[0], sha256: await backupBytesSha256(bytes), size: bytes.length };
  await transport.create(ids[0], "commit", bytes);
  await verifyGraphObject(ref, (await transport.read(ids[0]))!);
  check((await transport.commits()).length === 1, "Provider inventory missing receipt");
  check((await transport.commits()).length === 1, "Warm provider inventory changed");
  await transport.create(ids[0], "commit", bytes);
  await verifyGraphObject(ref, (await transport.read(ids[0]))!);
  const changed = new TextEncoder().encode("conflicting immutable bytes");
  await transport.create(ids[0], "commit", changed);
  let mismatchRejected = false;
  try { await verifyGraphObject({ ...ref, sha256: await backupBytesSha256(changed), size: changed.length }, (await transport.read(ids[0]))!); }
  catch { mismatchRejected = true; }
  check(mismatchRejected, "A conflicting intended ID was accepted");
  await transport.create(ids[1], "commit", bytes);
  check((await transport.commits()).length === 2, "Fresh sibling receipt was hidden by cache");
  return { digestVerified: true, exact409Recovered: true, conflicting409Rejected: true, freshSiblingDiscovered: true };
}
