import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { DriveSyncManifest } from "../src/lib/restore/driveManifestPreview";
import { RestoreCompatibilityError, sha256Blob, stageVerifiedMetadataRestore } from "../src/lib/restore/verifiedDriveRestore";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup";

// Fault model, not an Android runtime test. Check the exact read-only reference
// before modeling its existing-ID upload followed by later manifest publication.
const androidRepo = process.argv[2];
assert.ok(androidRepo, "Pass the read-only Android repository path.");
const androidRef = "182282cbba582224fc697ea7146d89854830d082";
const androidPath = "app/src/main/java/com/myvault/app/data/sync/GoogleDriveIncrementalSyncRepository.kt";
const androidSource = execFileSync("git", ["show", `${androidRef}:${androidPath}`], {
  cwd: androidRepo,
  encoding: "utf8",
});
assert.ok(androidSource.includes("remote?.cloudFileId ?: drive.findChild(parentId, entry.fileName)?.id"));
assert.ok(androidSource.includes("existingFileId = existingId"));
assert.ok(androidSource.includes('methodOverride = if (!existingFileId.isNullOrBlank()) "PATCH" else null'));
assert.ok(androidSource.indexOf("val uploaded = drive.uploadFile(") < androidSource.indexOf("drive.uploadTextFile("));

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network access is forbidden in this fault test."); };

try {
  const source = representativeAndroidBackup();
  const objects = new Map<string, Blob>();
  const manifest: DriveSyncManifest = {
    schemaVersion: 1,
    cloudVersion: source.cloudVersion,
    storage: "google-drive-api",
    layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups",
    entries: structuredClone(source.fileEntries ?? []),
  };
  for (const file of source.files) {
    const bytes = new Blob([JSON.stringify(file.json)], { type: "application/json" });
    objects.set(file.cloudFileId, bytes);
    manifest.entries.push({
      path: file.entryPath,
      fileName: file.fileName,
      backupEntry: file.backupEntry,
      kind: "metadata",
      cloudFileId: file.cloudFileId,
      size: bytes.size,
      sha256: await sha256Blob(bytes),
      updatedAt: manifest.cloudVersion,
    });
  }
  const read = (snapshot: DriveSyncManifest, storage = objects) => stageVerifiedMetadataRestore({
    accessToken: "synthetic-no-network",
    manifest: snapshot,
    download: async (_token, entry) => {
      const bytes = storage.get(entry.cloudFileId);
      assert.ok(bytes, `Missing synthetic object ${entry.cloudFileId}`);
      return bytes;
    },
  });
  const initial = await read(manifest);
  assert.equal(initial.issues.length, 0);
  console.log("PASS: unchanged synthetic manifest and raw metadata bytes pass the production Web validator.");

  const safetyObjects = new Map(objects);
  const committedManifestBytes = JSON.stringify(manifest);
  const noteEntry = manifest.entries.find((entry) => entry.fileName === "notes.json")!;
  const originalNotes = objects.get(noteEntry.cloudFileId)!;
  const notes = JSON.parse(await originalNotes.text()) as Array<{ id: string; updatedAt: number }>;
  notes.find((note) => note.id === "note-tawakkul")!.updatedAt = 101;
  const changedNotes = new Blob([JSON.stringify(notes)], { type: "application/json" });
  assert.equal(changedNotes.size, originalNotes.size, "The fault must not depend on a file-size mismatch.");
  assert.notEqual(await sha256Blob(changedNotes), noteEntry.sha256);

  // Android PATCH succeeds, then execution stops before sync_manifest.json.
  objects.set(noteEntry.cloudFileId, changedNotes);
  assert.equal(JSON.stringify(manifest), committedManifestBytes);
  await assert.rejects(read(manifest), (error: unknown) => {
    assert.ok(error instanceof RestoreCompatibilityError);
    assert.ok(error.issues.includes("notes.json: downloaded SHA-256 checksum does not match the manifest."));
    return true;
  });
  console.log("REPRODUCED BLOCKER: interrupted Android-style overwrite leaves the old manifest unchanged but unrestorable by checksum.");

  const manifestOnlyRecovery = JSON.parse(committedManifestBytes) as DriveSyncManifest;
  await assert.rejects(read(manifestOnlyRecovery), RestoreCompatibilityError);
  assert.equal((await read(manifestOnlyRecovery, safetyObjects)).issues.length, 0);
  console.log("PASS: a manifest-only copy cannot recover overwritten bytes; an external copy of the actual bytes can.");

  // Control for Web's existing create-new-object strategy: retain old bytes,
  // stage a distinct ID, then publish that ID using the unchanged v1 contract.
  const appendOnlyObjects = new Map(safetyObjects);
  const newId = "synthetic-web-generation-notes";
  appendOnlyObjects.set(newId, changedNotes);
  assert.equal((await read(manifest, appendOnlyObjects)).issues.length, 0);
  const webManifest = structuredClone(manifest);
  webManifest.cloudVersion += 1;
  Object.assign(webManifest.entries.find((entry) => entry.fileName === "notes.json")!, {
    cloudFileId: newId,
    sha256: await sha256Blob(changedNotes),
    size: changedNotes.size,
  });
  assert.equal((await read(webManifest, appendOnlyObjects)).issues.length, 0);
  console.log("PASS: distinct staged object IDs keep the previous and next metadata snapshots valid without a schema change.");

  // A subsequent Android push uses the ID supplied in the Web manifest too.
  notes.find((note) => note.id === "note-tawakkul")!.updatedAt = 102;
  appendOnlyObjects.set(newId, new Blob([JSON.stringify(notes)], { type: "application/json" }));
  await assert.rejects(read(webManifest, appendOnlyObjects), RestoreCompatibilityError);
  console.log("REPRODUCED BLOCKER: a later Android-style overwrite also invalidates the Web-published snapshot.");
  console.log(`Reference: Android ${androidRef}; no cloud requests, app/database writes, or real user data used.`);
  console.log("These passing assertions prove the failure model, not bidirectional release acceptance.");
} finally {
  globalThis.fetch = originalFetch;
}
