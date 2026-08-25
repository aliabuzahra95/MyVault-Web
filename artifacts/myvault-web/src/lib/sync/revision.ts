import type { DriveSyncManifest } from "@/lib/restore/driveManifestPreview";
import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import type { LocalSyncRevision } from "@/lib/restore/localRestoreStore";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([first], [second]) => first.localeCompare(second))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function hexadecimal(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Text(value: string) {
  return hexadecimal(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function computeManifestRevision(manifest: DriveSyncManifest) {
  const manifestSha256 = await sha256Text(canonicalJson(manifest));
  const entrySha256 = await sha256Text(canonicalJson(
    manifest.entries
      .map((entry) => ({ path: entry.path, sha256: entry.sha256, size: entry.size, cloudFileId: entry.cloudFileId }))
      .toSorted((first, second) => first.path.localeCompare(second.path)),
  ));
  return { manifestSha256, entrySha256, revisionId: `sha256:${manifestSha256}` };
}

export async function computeBundleRevision(bundle: MetadataRestoreBundle): Promise<LocalSyncRevision> {
  const metadata = bundle.files
    .map((file) => ({ fileName: file.fileName, json: file.json }))
    .toSorted((first, second) => first.fileName.localeCompare(second.fileName));
  const entries = (bundle.fileEntries ?? [])
    .map((entry) => ({ path: entry.path, sha256: entry.sha256, size: entry.size, cloudFileId: entry.cloudFileId }))
    .toSorted((first, second) => first.path.localeCompare(second.path));
  const manifestSha256 = await sha256Text(canonicalJson(metadata));
  const entrySha256 = await sha256Text(canonicalJson(entries));
  const revisionId = `sha256:${await sha256Text(`${manifestSha256}:${entrySha256}`)}`;
  return {
    schemaVersion: 1,
    revisionId,
    cloudVersion: bundle.cloudVersion,
    manifestSha256,
    entrySha256,
    capturedAt: new Date().toISOString(),
  };
}
