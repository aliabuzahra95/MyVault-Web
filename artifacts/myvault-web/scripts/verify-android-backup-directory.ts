import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseDriveSyncManifest } from "../src/lib/restore/driveManifestPreview";
import { sha256Blob, stageVerifiedMetadataRestore } from "../src/lib/restore/verifiedDriveRestore";

const backupRoot = process.env.MYVAULT_ANDROID_BACKUP_DIR;
assert.ok(backupRoot, "Set MYVAULT_ANDROID_BACKUP_DIR to a read-only mounted MyVault Drive folder.");

const manifestPath = join(backupRoot, "manifests", "sync_manifest.json");
const parsed = parseDriveSyncManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
assert.ok(parsed.manifest, "The mounted Android sync manifest could not be parsed.");

const metadataDirectory = join(backupRoot, "metadata");
const localMetadata = await Promise.all((await readdir(metadataDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map(async (entry) => {
    const bytes = await readFile(join(metadataDirectory, entry.name));
    const blob = new Blob([bytes], { type: "application/json" });
    return { name: entry.name, blob, sha256: await sha256Blob(blob) };
  }));
const byChecksum = new Map(localMetadata.map((file) => [file.sha256, file]));

const restored = await stageVerifiedMetadataRestore({
  accessToken: "read-only-local-fixture",
  manifest: parsed.manifest,
  compatibilityIssues: parsed.issues,
  download: async (_token, entry) => {
    const file = byChecksum.get(entry.sha256.toLowerCase());
    assert.ok(file, `Mounted backup is missing bytes for ${entry.fileName} (${basename(entry.path)}).`);
    return file.blob;
  },
});

console.log(JSON.stringify({
  result: "PASS",
  cloudVersion: restored.cloudVersion,
  metadataFiles: restored.metadataFileCount,
  counts: restored.counts,
}, null, 2));
