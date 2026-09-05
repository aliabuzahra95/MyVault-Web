import { downloadDriveFileJson, findMyVaultDriveMap, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import { assertGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import type { GoogleDriveToken } from "@/lib/googleDrive/identity";
import { buildDriveManifestPreview, parseDriveSyncManifest, type DriveManifestPreview } from "@/lib/restore/driveManifestPreview";
import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { createLocalRecoverySnapshot, loadLocalSyncBase, loadLastAppliedDriveManifest, loadMetadataRestoreBundle, loadLocalVaultGeneration, saveLastAppliedDriveManifest, stageIncomingDriveBundle } from "@/lib/restore/localRestoreStore";
import { stageVerifiedMetadataRestore, verifyDriveManifestFiles } from "@/lib/restore/verifiedDriveRestore";
import { withAccountSyncLock } from "@/lib/sync/accountContext";
import { computeBundleRevision, computeManifestRevision } from "@/lib/sync/revision";
import { applyIncomingDriveBundleSafely } from "@/lib/sync/safePull";
import { ActiveEditorError, withLocalVaultUpdate } from "@/lib/sync/editorLease";

export type DriveRefreshStatus = {
  phase: "idle" | "checking" | "downloading" | "validating" | "applying" | "current" | "staged" | "error";
  error: string | null;
  checkedAt: number | null;
  appliedAt: number | null;
};
const idle: DriveRefreshStatus = { phase: "idle", error: null, checkedAt: null, appliedAt: null };
const statuses = new Map<string, DriveRefreshStatus>();
const listeners = new Set<() => void>();
export const subscribeDriveRefresh = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getDriveRefreshStatus = (accountId: string) => statuses.get(accountId) ?? idle;
function update(accountId: string, value: Partial<DriveRefreshStatus>) {
  statuses.set(accountId, { ...getDriveRefreshStatus(accountId), ...value });
  listeners.forEach((listener) => listener());
}

export async function readDriveManifestPreview(accessToken: string) {
  const scan = await findMyVaultDriveMap(accessToken);
  if (!scan.ready || !scan.manifestFile) return { scan, manifestPreview: null, error: scan.manifestFile ? "This Drive backup is incomplete. Local data was not replaced." : null };
  const raw = await downloadDriveFileJson<unknown>(accessToken, scan.manifestFile.id);
  const parsed = parseDriveSyncManifest(raw);
  if (!parsed.manifest || parsed.issues.length) throw new Error(parsed.issues[0] ?? "The Drive manifest could not be read.");
  return { scan, manifestPreview: buildDriveManifestPreview(parsed.manifest, parsed.issues), error: null };
}

type RefreshResult = { scan: MyVaultDriveScan; manifestPreview: DriveManifestPreview | null; metadataRestore: MetadataRestoreBundle | null; staged: boolean };
const active = new Map<string, { token: string; promise: Promise<RefreshResult> }>();

export function refreshLatestDriveMetadataSafely(token: GoogleDriveToken, accountId: string): Promise<RefreshResult> {
  const existing = active.get(accountId);
  if (existing?.token === token.accessToken) return existing.promise;
  const promise = withAccountSyncLock(accountId, async () => {
    assertGoogleDriveSession(token, accountId);
    update(accountId, { phase: "checking", error: null });
    const startingGeneration = await loadLocalVaultGeneration();
    const preview = await readDriveManifestPreview(token.accessToken);
    assertGoogleDriveSession(token, accountId);
    update(accountId, { checkedAt: Date.now() });
    if (preview.error) throw new Error(preview.error);
    const local = await loadMetadataRestoreBundle();
    if (!preview.manifestPreview) {
      update(accountId, { phase: "idle" });
      return { ...preview, metadataRestore: local, staged: false };
    }
    const pinned = await computeManifestRevision(preview.manifestPreview.manifest);
    const [applied, base] = await Promise.all([loadLastAppliedDriveManifest(), loadLocalSyncBase()]);
    if (local && applied?.manifestId === preview.scan.manifestFile!.id && applied.revisionId === pinned.revisionId && applied.bundleRevisionId === base?.revision.revisionId) {
      update(accountId, { phase: "current" });
      return { ...preview, metadataRestore: local, staged: false };
    }
    update(accountId, { phase: "downloading" });
    const verification = await verifyDriveManifestFiles(token.accessToken, preview.manifestPreview.manifest, preview.scan);
    const incoming = await stageVerifiedMetadataRestore({ accessToken: token.accessToken, manifest: preview.manifestPreview.manifest, compatibilityIssues: verification.issues });
    update(accountId, { phase: "validating" });
    assertGoogleDriveSession(token, accountId);
    const latest = await readDriveManifestPreview(token.accessToken);
    if (latest.scan.manifestFile?.id !== preview.scan.manifestFile!.id || !latest.manifestPreview || (await computeManifestRevision(latest.manifestPreview.manifest)).revisionId !== pinned.revisionId) {
      throw new Error("Drive changed during the download. Local data was preserved; retry to check the new backup.");
    }
    const nextBase = { schemaVersion: 1 as const, accountId, revision: await computeBundleRevision(incoming), bundle: structuredClone(incoming) };
    assertGoogleDriveSession(token, accountId);
    await stageIncomingDriveBundle(incoming, nextBase);
    try {
      await withLocalVaultUpdate(accountId, async () => {
        assertGoogleDriveSession(token, accountId);
        if (await loadLocalVaultGeneration() !== startingGeneration) throw new ActiveEditorError();
        update(accountId, { phase: "applying" });
        await createLocalRecoverySnapshot("before-background-drive-apply");
        assertGoogleDriveSession(token, accountId);
        await applyIncomingDriveBundleSafely(incoming, nextBase);
        assertGoogleDriveSession(token, accountId);
        await saveLastAppliedDriveManifest(accountId, { manifestId: preview.scan.manifestFile!.id, revisionId: pinned.revisionId, bundleRevisionId: nextBase.revision.revisionId });
      });
    } catch (error) {
      assertGoogleDriveSession(token, accountId);
      update(accountId, { phase: "staged", error: error instanceof Error ? error.message : "The update needs review. Local work was preserved." });
      return { ...preview, metadataRestore: local, staged: true };
    }
    update(accountId, { phase: "current", appliedAt: Date.now(), error: null });
    return { ...preview, metadataRestore: incoming, staged: false };
  }).catch((error) => {
    update(accountId, { phase: "error", error: error instanceof Error ? error.message : "Drive is unavailable. Local data was preserved." });
    throw error;
  });
  active.set(accountId, { token: token.accessToken, promise });
  void promise.finally(() => { if (active.get(accountId)?.promise === promise) active.delete(accountId); }).catch(() => undefined);
  return promise;
}
