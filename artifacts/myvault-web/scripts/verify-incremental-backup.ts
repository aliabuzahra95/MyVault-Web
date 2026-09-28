import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  appendBackupDelta, backupBytesSha256, backupDeltasAfter, createBackupDelta, incrementalBackup,
  reconstructIncrementalBackup, INCREMENTAL_BACKUP_PUBLICATION_ENABLED, type BackupRecordChange,
} from "../src/lib/restore/incrementalBackup";
import { coalescedBackupChanges, publishIncrementalBackup, publishVerifiedBackupDelta, type IncrementalBackupTransport } from "../src/lib/restore/incrementalBackupWriter";
import { permanentBackupOverlayDeletes } from "../src/lib/restore/permanentBackupDeletions";
import { stageVerifiedMetadataRestore } from "../src/lib/restore/verifiedDriveRestore";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup";
import type { DriveSyncManifest } from "../src/lib/restore/driveManifestPreview";

const directory = process.env.MYVAULT_BACKUP_COMPAT_DIR;
assert.ok(directory, "Set MYVAULT_BACKUP_COMPAT_DIR to a disposable fixture directory.");
mkdirSync(directory, { recursive: true });
globalThis.fetch = async () => { throw new Error("Real network requests are forbidden by this compatibility test."); };
const encode = (text: string) => new TextEncoder().encode(text);
const source = representativeAndroidBackup();
const objects: Record<string, string> = {};
let manifest: DriveSyncManifest = { schemaVersion: 1, cloudVersion: 100, storage: "google-drive-api", layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups", entries: structuredClone(source.fileEntries ?? []) };
const checkpoint = Object.fromEntries(source.files.map((file) => [file.fileName, structuredClone(file.json)]));
(checkpoint["settings.json"] as Record<string, unknown>).quranMemorizationRecords = [
  { verseKey: "2:286", surahNumber: 2, ayahNumber: 286, reviewCount: 4, startedAt: 50, lastReviewedAt: 100, updatedAt: 100 },
];
const seedNotes = checkpoint["notes.json"] as Record<string, unknown>[];
seedNotes.push({ ...structuredClone(seedNotes.find((note) => note.id === "note-hadith")!), id: "explicitly-deleted-note", title: "Disposable permanent-delete fixture" });
const checkpointBefore = structuredClone(checkpoint);
for (const file of source.files) {
  const text = JSON.stringify(checkpoint[file.fileName]);
  objects[file.cloudFileId] = text;
  manifest.entries.push({ path: file.entryPath, fileName: file.fileName, backupEntry: file.backupEntry, kind: "metadata", cloudFileId: file.cloudFileId, size: encode(text).length, sha256: await backupBytesSha256(encode(text)), updatedAt: 100 });
}
const oldManifest = structuredClone(manifest);
const read = async (candidate: DriveSyncManifest, storage = objects) => stageVerifiedMetadataRestore({
  accessToken: "disposable-no-network", manifest: candidate,
  download: async (_token, entry) => new Blob([storage[entry.cloudFileId]]),
  downloadDelta: async (_token, fileId) => { assert.ok(fileId in storage, "Missing delta object"); return new Blob([storage[fileId]]); },
});
const originalBundle = await read(manifest);
assert.equal(originalBundle.issues.length, 0);
writeFileSync(join(directory, "legacy.json"), JSON.stringify({ manifest, objects, expected: checkpoint }));

const note = structuredClone((checkpoint["notes.json"] as Record<string, unknown>[]).find((row) => row.id === "note-tawakkul")!);
assert.ok(note);
const edited = { ...note, title: "English العربية", bodyPlainText: "One note changed — الكليات • concepts.", updatedAt: 101 };
const coalesced = coalescedBackupChanges(["H", "He", "Hello"].map((bodyPlainText) => ({ file: "notes.json", key: [String(note.id)], operation: "upsert", value: { ...edited, bodyPlainText } })));
assert.equal(coalesced.length, 1);
const deltas = [
  createBackupDelta("checkpoint-100", "checkpoint-100", "web-delta-1", [{ file: "notes.json", key: [String(note.id)], operation: "upsert", value: edited }]),
  createBackupDelta("checkpoint-100", "web-delta-1", "web-delta-2", [{ file: "notes.json", key: ["explicitly-deleted-note"], operation: "delete" }]),
  createBackupDelta("checkpoint-100", "web-delta-2", "web-delta-3", [{ file: "notes.json", key: [String(note.id)], operation: "upsert", value: { ...edited, title: "Final title" } }]),
];
let committed = { id: "committed-manifest", text: JSON.stringify(manifest) };
let creates = 0;
const history: string[] = [];
const transport: IncrementalBackupTransport = {
  readCommitted: async () => ({ ...committed }),
  createDelta: async (deltaId, bytes) => { creates++; const id = `web-object-${deltaId}`; objects[id] = new TextDecoder().decode(bytes); return id; },
  readObject: async (id) => encode(objects[id]),
  preserve: async (previous) => { history.push(previous.text); },
  commit: async (previous, text) => { assert.equal(committed.text, previous.text); committed = { id: previous.id, text }; },
};
assert.equal(INCREMENTAL_BACKUP_PUBLICATION_ENABLED, false);
await assert.rejects(publishIncrementalBackup(transport, committed, deltas[0]), /disabled/);
assert.equal(creates, 0);
assert.equal((await publishVerifiedBackupDelta(transport, committed, null)).text, committed.text);
assert.equal(creates, 0, "Zero changes must allocate no remote object");
for (const delta of deltas) committed = await publishVerifiedBackupDelta(transport, committed, delta);
assert.equal(creates, 3, "Exactly one object per settled delta, not per record/keystroke");
manifest = JSON.parse(committed.text) as DriveSyncManifest;
const previous = { id: committed.id, text: history.at(-1)! };
await publishVerifiedBackupDelta(transport, previous, deltas[2]);
assert.equal(creates, 3, "Lost local acknowledgement retries must not duplicate committed objects");
const extension = incrementalBackup(manifest)!;
assert.equal(backupDeltasAfter(extension, "checkpoint-100")?.length, 3);
assert.equal(backupDeltasAfter(extension, "web-delta-1")?.length, 2);
assert.equal(backupDeltasAfter(extension, "web-delta-3")?.length, 0);
assert.equal(backupDeltasAfter(extension, "unknown"), null);
const restored = await read(manifest);
assert.equal((restored.files.find((file) => file.fileName === "notes.json")!.json as Record<string, unknown>[]).find((row) => row.id === note.id)?.title, "Final title");
assert.deepEqual(restored.incrementalBackupState?.permanentDeletions.map((change) => change.key), [["explicitly-deleted-note"]]);
assert.deepEqual(checkpoint, checkpointBefore, "Source note/data must remain unchanged");
const reconstruction = await reconstructIncrementalBackup(checkpoint, extension, async (descriptor) => encode(objects[descriptor.cloudFileId]));
assert.equal((reconstruction.files["notes.json"] as Record<string, unknown>[]).some((row) => row.id === "explicitly-deleted-note"), false);
assert.equal((reconstruction.files["notes.json"] as Record<string, unknown>[]).some((row) => row.id === "note-hadith"), true, "Unrelated stable IDs survive deletion");
writeFileSync(join(directory, "web.json"), JSON.stringify({ manifest, objects, expected: reconstruction.files }));
assert.deepEqual(permanentBackupOverlayDeletes(restored.incrementalBackupState!.permanentDeletions), [{ entityType: "note", stores: ["note-drafts", "created-notes"], entityId: "explicitly-deleted-note" }]);
assert.deepEqual(permanentBackupOverlayDeletes([]), [], "Absence never creates a deletion instruction");
assert.throws(() => createBackupDelta("base", "base", "d", [{ file: "notes.json", key: ["wrong"], operation: "upsert", value: edited }]), /ID differs/);
assert.throws(() => createBackupDelta("base", "base", "d", [{ file: "../../notes.json", key: ["n"], operation: "delete" }]), /Invalid backup record key/);
const broken = structuredClone(manifest);
(broken.incrementalBackup as typeof extension).deltas[1].parentId = "not-the-parent";
await assert.rejects(read(broken), /ancestry/);
const corrupt = { ...objects, [extension.deltas[0].cloudFileId]: "corrupt" };
await assert.rejects(read(manifest, corrupt), /byte verification/);
const absent = { ...objects }; delete absent[extension.deltas[1].cloudFileId];
await assert.rejects(read(manifest, absent), /Missing delta/);
const failed = { ...transport, commit: async () => { throw new Error("simulated publication failure"); } };
const beforeFailure = committed.text;
const failureDelta = createBackupDelta("checkpoint-100", "web-delta-3", "web-failed", [{ file: "notes.json", key: [String(note.id)], operation: "upsert", value: edited }]);
await assert.rejects(publishVerifiedBackupDelta(failed, committed, failureDelta), /publication failure/);
assert.equal(committed.text, beforeFailure);
await read(JSON.parse(history[0]) as DriveSyncManifest);

const androidPath = join(directory, "android.json");
if (existsSync(androidPath)) {
  const fixture = JSON.parse(readFileSync(androidPath, "utf8")) as { manifest: DriveSyncManifest; objects: Record<string, string>; expected: Record<string, unknown> };
  const result = await read(fixture.manifest, fixture.objects);
  assert.deepEqual(Object.fromEntries(result.files.map((file) => [file.fileName, file.json])), fixture.expected);
  console.log("PASS Android writer -> production Web reader (checkpoint + three deltas, exact deletion, bilingual/rich-text preservation)");
} else console.log("Android -> Web gate pending: run Android fixture tests then rerun this script.");
console.log("PASS legacy Web restore, Web writer/reader, coalescing, zero-change, ancestry catch-up, explicit deletion, checksums, missing objects, interrupted commit and retry; no real network/user data.");
console.log(`Fixtures: ${directory}. Incremental publication remains DISABLED.`);
