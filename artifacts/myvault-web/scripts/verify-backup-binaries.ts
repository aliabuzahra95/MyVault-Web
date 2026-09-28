import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { appendBackupDelta, backupBytesSha256, createBackupDelta, incrementalBackup, INCREMENTAL_BACKUP_PUBLICATION_ENABLED } from "../src/lib/restore/incrementalBackup";
import { BACKUP_BINARY_READER_CAPABILITY, type BackupBinaryDescriptor } from "../src/lib/restore/backupBinaryDescriptors";
import { stageVerifiedMetadataRestore } from "../src/lib/restore/verifiedDriveRestore";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup";
import type { DriveSyncManifest } from "../src/lib/restore/driveManifestPreview";

const directory = process.env.MYVAULT_BINARY_COMPAT_DIR;
assert.ok(directory, "Set MYVAULT_BINARY_COMPAT_DIR to a disposable directory.");
mkdirSync(directory, { recursive: true });
globalThis.fetch = async () => { throw new Error("Real network requests forbidden."); };
type Fixture = { manifest: DriveSyncManifest; objects: Record<string, string> };
const source = representativeAndroidBackup();
const objects: Record<string, string> = {};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const store = (id: string, bytes: Uint8Array) => { objects[id] = Buffer.from(bytes).toString("base64"); };
const bytes = (storage: Record<string, string>, id: string) => {
  assert.ok(id in storage, `Missing object ${id}; no checkpoint fallback permitted`);
  return new Uint8Array(Buffer.from(storage[id], "base64"));
};
let manifest: DriveSyncManifest = { schemaVersion: 1, cloudVersion: 100, storage: "google-drive-api", layout: "MyVault", entries: structuredClone(source.fileEntries ?? []) };
for (const entry of manifest.entries) {
  const binary = new Uint8Array(entry.size).fill(79);
  store(entry.cloudFileId, binary); entry.sha256 = await backupBytesSha256(binary);
}
for (const file of source.files) {
  const data = encode(file.json); store(file.cloudFileId, data);
  manifest.entries.push({ path: file.entryPath, fileName: file.fileName, backupEntry: file.backupEntry, kind: "metadata",
    cloudFileId: file.cloudFileId, size: data.length, sha256: await backupBytesSha256(data), updatedAt: 100 });
}
const checkpoint = structuredClone(manifest);
const attachments = source.files.find((file) => file.fileName === "attachments.json")!.json as Record<string, unknown>[];
const original = structuredClone(attachments.find((row) => row.id === "pdf-aqidah")!);
const read = (candidate: DriveSyncManifest, storage = objects, requested: string[] = []) => stageVerifiedMetadataRestore({
  accessToken: "disposable-no-network", manifest: candidate,
  download: async (_token, entry) => new Blob([bytes(storage, entry.cloudFileId)]),
  downloadDelta: async (_token, id) => new Blob([bytes(storage, id)]),
  downloadBinary: async (_token, entry) => { requested.push(entry.cloudFileId); return new Blob([bytes(storage, entry.cloudFileId)]); },
});
await read(checkpoint); // Historical checkpoint-only behavior must not need a descriptor capability.
writeFileSync(join(directory, "legacy.json"), JSON.stringify({ manifest: checkpoint, objects }));
const descriptor = async (attachmentId: string, id: string, size: number, fill: number): Promise<BackupBinaryDescriptor> => {
  const data = new Uint8Array(size).fill(fill); store(id, data);
  return { attachmentId, cloudFileId: id, size, sha256: await backupBytesSha256(data) };
};
const replacement = await descriptor("pdf-aqidah", "web-replacement-8192", 8192, 82);
const newClip = await descriptor("new-clip", "web-new-clip", 1024, 67);
const removed = await descriptor("delete-me", "web-delete-me", 512, 68);
const row = (id: string, size: number) => ({ ...original, id, sizeBytes: size, fileEntry: `files/${id}` });
const upsert = (value: Record<string, unknown>) => ({ file: "attachments.json", key: [String(value.id)], operation: "upsert" as const, value });
const deltas = [
  createBackupDelta("binary-base", "binary-base", "web-binary-1", [upsert(row("pdf-aqidah", 8192))], [replacement]),
  createBackupDelta("binary-base", "web-binary-1", "web-binary-2", [upsert({ ...row("pdf-aqidah", 8192), displayName: "Renamed العربية PDF" })]),
  createBackupDelta("binary-base", "web-binary-2", "web-binary-3", [upsert(row("new-clip", 1024)), upsert(row("delete-me", 512))], [newClip, removed]),
  createBackupDelta("binary-base", "web-binary-3", "web-binary-4", [{ file: "attachments.json", key: ["delete-me"], operation: "delete" }]),
];
for (const delta of deltas) {
  const id = `web-object-${delta.deltaId}`; store(id, encode(delta));
  manifest = await appendBackupDelta(manifest, delta, id, manifest.cloudVersion + 1);
}
assert.equal(incrementalBackup(manifest)!.requiredReader, BACKUP_BINARY_READER_CAPABILITY);
assert.equal(incrementalBackup(manifest)!.version, 2);
assert.deepEqual(manifest.entries, checkpoint.entries, "Checkpoint index must remain immutable");
const requested: string[] = [];
const restored = await read(manifest, objects, requested);
assert.equal(restored.binaryDescriptorsVerified, true);
assert.equal(restored.fileEntries!.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.size, 8192);
assert.equal(restored.fileEntries!.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.cloudFileId, replacement.cloudFileId);
assert.ok(restored.fileEntries!.some((entry) => entry.backupEntry === "files/new-clip"));
assert.ok(!restored.fileEntries!.some((entry) => entry.backupEntry === "files/delete-me"));
assert.ok(!requested.includes(checkpoint.entries.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.cloudFileId));
assert.ok(!requested.includes(removed.cloudFileId), "Superseded/deleted objects are not restored");
assert.deepEqual(restored.files.find((file) => file.fileName === "notes.json")!.json, source.files.find((file) => file.fileName === "notes.json")!.json);
assert.deepEqual(restored.files.find((file) => file.fileName === "blocks.json")!.json, source.files.find((file) => file.fileName === "blocks.json")!.json);
writeFileSync(join(directory, "web.json"), JSON.stringify({ manifest, objects }));
const missing = { ...objects }; delete missing[replacement.cloudFileId];
await assert.rejects(read(manifest, missing), /Missing object/);
const corrupt = { ...objects, [replacement.cloudFileId]: Buffer.alloc(8192, 88).toString("base64") };
await assert.rejects(read(manifest, corrupt), /verification failed/);
const wrongLength = { ...objects, [replacement.cloudFileId]: Buffer.alloc(4096, 82).toString("base64") };
await assert.rejects(read(manifest, wrongLength), /verification failed/);
async function readOne(changes: Parameters<typeof createBackupDelta>[3], binaries?: BackupBinaryDescriptor[]) {
  const delta = createBackupDelta("binary-base", "binary-base", "bad-delta", changes, binaries);
  const id = "bad-object"; const storage = { ...objects, [id]: Buffer.from(encode(delta)).toString("base64") };
  const candidate = await appendBackupDelta(checkpoint, delta, id, 101);
  // Require full binary validation even for metadata-only negative cases.
  Object.assign(candidate.incrementalBackup as object, { version: 2, requiredReader: BACKUP_BINARY_READER_CAPABILITY });
  return read(candidate, storage);
}
await assert.rejects(readOne([upsert(row("new-unmapped", 20))], []), /no valid binary descriptor/);
await assert.rejects(readOne([upsert(row("pdf-aqidah", 8192))], []), /byte count differ/);
assert.throws(() => createBackupDelta("b", "b", "d", [upsert(row("pdf-aqidah", 8192))], [replacement, replacement]), /unbound|Duplicate/);
assert.throws(() => createBackupDelta("b", "b", "d", [{ file: "attachments.json", key: ["pdf-aqidah"], operation: "delete" }], [replacement]), /upsert/);
await assert.rejects(readOne([upsert(row("pdf-aqidah", 8192))], [{ ...replacement, cloudFileId: checkpoint.entries.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.cloudFileId }]), /Immutable Drive object/);
const hidden = structuredClone(manifest);
Object.assign(hidden.incrementalBackup as object, { version: 1, requiredReader: "checkpoint-delta-v1" });
await assert.rejects(read(hidden), /new reader capability/);
const unknown = structuredClone(manifest);
Object.assign(unknown.incrementalBackup as object, { requiredReader: "unknown-reader" });
await assert.rejects(read(unknown), /Unsupported/);
// Execute the actual pre-extension Web parser, not a mock of its version check.
const oldSource = execFileSync("git", ["show", "c42b699:artifacts/myvault-web/src/lib/restore/incrementalBackup.ts"], { encoding: "utf8" });
const oldModule = { exports: {} as { incrementalBackup: typeof incrementalBackup } };
new Function("module", `${stripTypeScriptTypes(oldSource).replace(/^export /gm, "")}\nmodule.exports = { incrementalBackup };`)(oldModule);
assert.throws(() => oldModule.exports.incrementalBackup(manifest), /Unsupported incremental backup capability/);
assert.equal(INCREMENTAL_BACKUP_PUBLICATION_ENABLED, false);
const androidPath = join(directory, "android.json");
if (existsSync(androidPath)) {
  const fixture = JSON.parse(readFileSync(androidPath, "utf8")) as Fixture;
  const result = await read(fixture.manifest, fixture.objects);
  assert.equal(result.fileEntries!.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.size, 8192);
  assert.equal(result.fileEntries!.find((entry) => entry.backupEntry === "files/pdf-aqidah")!.cloudFileId, "android-replacement-8192");
  assert.ok(!result.fileEntries!.some((entry) => entry.backupEntry === "files/delete-me"));
  console.log("PASS Android-created binary delta -> actual Web restore reader: replacement 8192 bytes, new attachment, exact deletion, metadata-only retention.");
} else console.log("Android -> Web fixture gate pending Android tests; rerun this script afterward.");
console.log("PASS Web binary reader/writer fixture, historical checkpoint, immutable index, missing/corrupt/size failures, required capability, pre-extension parser rejection. No network or real data.");
