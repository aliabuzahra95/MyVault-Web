import { downloadDriveFileJson, findMyVaultDriveMap, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import { assertGoogleDriveSession, verifyAndActivateGoogleDriveSession, type VerifiedGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import type { GoogleDriveToken } from "@/lib/googleDrive/identity";
import { buildDriveManifestPreview, parseDriveSyncManifest, type DriveManifestPreview } from "@/lib/restore/driveManifestPreview";
import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { applyMetadataRestorePreservingLocalChangesAtomically, createLocalRecoverySnapshot, loadLocalSyncBase, loadLastAppliedDriveManifest, loadMetadataRestoreBundle, loadLocalVaultGeneration, saveLastAppliedDriveManifest, stageIncomingDriveBundle } from "@/lib/restore/localRestoreStore";
import { stageVerifiedMetadataRestore, verifyDriveManifestFiles } from "@/lib/restore/verifiedDriveRestore";
import { withAccountSyncLock } from "@/lib/sync/accountContext";
import { computeBundleRevision, computeManifestRevision } from "@/lib/sync/revision";
import { applyIncomingDriveBundleSafely } from "@/lib/sync/safePull";
import { ActiveEditorError, withLocalVaultUpdate } from "@/lib/sync/editorLease";
import { assertNoActiveGraphNamespace, GoogleDriveWebGraphTransport } from "@/lib/googleDrive/graphTransport";
import { InternalWebGraphWorkflow, WEB_GRAPH_RESTORE_ENABLED } from "@/lib/restore/webGraphWorkflow";
import { loadLastNotifiedGraphTip, markGraphTipNotified, type WebLatestBackupNotice } from "@/lib/restore/latestBackupNotice";

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

export async function readVerifiedDriveBackupPreview(session: VerifiedGoogleDriveSession) {
  assertGoogleDriveSession(session.token, session.accountId);
  if (WEB_GRAPH_RESTORE_ENABLED) {
    const graph = await GoogleDriveWebGraphTransport.open(session);
    if (graph) return { scan: graph.previewScan(), manifestPreview: null, error: null, graphBackup: true };
  }
  return { ...await readDriveManifestPreview(session.token.accessToken), graphBackup: false };
}

type RefreshResult = { scan: MyVaultDriveScan; manifestPreview: DriveManifestPreview | null; metadataRestore: MetadataRestoreBundle | null; staged: boolean; graphBackup: boolean; latestBackup: WebLatestBackupNotice | null };
const active = new Map<string, { token: string; promise: Promise<RefreshResult> }>();

export function refreshLatestDriveMetadataSafely(token: GoogleDriveToken, accountId: string, manualRestore = false): Promise<RefreshResult> {
  const workKey = `${accountId}:${manualRestore ? "manual" : "automatic"}`;
  const existing = active.get(workKey);
  if (existing?.token === token.accessToken) return existing.promise;
  const promise = (async (): Promise<RefreshResult> => {
    assertGoogleDriveSession(token, accountId);
    if (WEB_GRAPH_RESTORE_ENABLED) {
      const session = await verifyAndActivateGoogleDriveSession(token);
      if (session.accountId !== accountId) throw new Error("Google account changed before Restore.");
      const graph = await GoogleDriveWebGraphTransport.open(session);
      if (graph) {
        // Graph backups remain strictly manual. Focus/load checks must not apply them.
        let latestBackup: WebLatestBackupNotice | null = null;
        if (manualRestore) {
          update(accountId, { phase: "applying", error: null });
          await new InternalWebGraphWorkflow(graph).restore();
        } else {
          latestBackup = await new InternalWebGraphWorkflow(graph).latestBackupNotice(
            loadLastNotifiedGraphTip(accountId, graph.lineageId),
          );
          if (latestBackup?.remoteCommitId) markGraphTipNotified(accountId, graph.lineageId, latestBackup.remoteCommitId);
        }
        const metadataRestore = await loadMetadataRestoreBundle();
        assertGoogleDriveSession(token, accountId);
        const current = manualRestore || latestBackup === null;
        const phase = current ? "current" : latestBackup?.status === "BLOCKED" ? "error" : "staged";
        update(accountId, { phase, checkedAt: Date.now(),
          ...(manualRestore ? { appliedAt: Date.now(), error: null } : { error: latestBackup?.message ?? null }) });
        return { scan: graph.previewScan(),
          manifestPreview: null, metadataRestore, staged: !current, graphBackup: true, latestBackup };
      }
    }
    return withAccountSyncLock(accountId, async () => {
    assertGoogleDriveSession(token, accountId);
    update(accountId, { phase: "checking", error: null });
    await assertNoActiveGraphNamespace(token.accessToken);
    assertGoogleDriveSession(token, accountId);
    const startingGeneration = await loadLocalVaultGeneration();
    const preview = await readDriveManifestPreview(token.accessToken);
    assertGoogleDriveSession(token, accountId);
    update(accountId, { checkedAt: Date.now() });
    if (preview.error) throw new Error(preview.error);
    const local = await loadMetadataRestoreBundle();
    if (!preview.manifestPreview) {
      update(accountId, { phase: "idle" });
      return { ...preview, metadataRestore: local, staged: false, graphBackup: false, latestBackup: null };
    }
    if ("incrementalBackup" in preview.manifestPreview.manifest && !manualRestore) {
      update(accountId, { phase: "staged", error: "An incremental backup is available. Use Restore to apply it; it will not be applied automatically." });
      return { ...preview, metadataRestore: local, staged: true, graphBackup: false, latestBackup: null };
    }
    const pinned = await computeManifestRevision(preview.manifestPreview.manifest);
    const [applied, base] = await Promise.all([loadLastAppliedDriveManifest(), loadLocalSyncBase()]);
    if (local && applied?.manifestId === preview.scan.manifestFile!.id && applied.revisionId === pinned.revisionId && applied.bundleRevisionId === base?.revision.revisionId) {
      update(accountId, { phase: "current" });
      return { ...preview, metadataRestore: local, staged: false, graphBackup: false, latestBackup: null };
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
        if (incoming.incrementalBackupState) {
          await applyMetadataRestorePreservingLocalChangesAtomically(incoming, nextBase, startingGeneration);
        } else {
          await applyIncomingDriveBundleSafely(incoming, nextBase);
        }
        assertGoogleDriveSession(token, accountId);
        await saveLastAppliedDriveManifest(accountId, { manifestId: preview.scan.manifestFile!.id, revisionId: pinned.revisionId, bundleRevisionId: nextBase.revision.revisionId });
      });
    } catch (error) {
      assertGoogleDriveSession(token, accountId);
      update(accountId, { phase: "staged", error: error instanceof Error ? error.message : "The update needs review. Local work was preserved." });
      return { ...preview, metadataRestore: local, staged: true, graphBackup: false, latestBackup: null };
    }
    update(accountId, { phase: "current", appliedAt: Date.now(), error: null });
    return { ...preview, metadataRestore: incoming, staged: false, graphBackup: false, latestBackup: null };
    });
  })().catch((error) => {
    update(accountId, { phase: "error", error: error instanceof Error ? error.message : "Drive is unavailable. Local data was preserved." });
    throw error;
  });
  active.set(workKey, { token: token.accessToken, promise });
  void promise.finally(() => { if (active.get(workKey)?.promise === promise) active.delete(workKey); }).catch(() => undefined);
  return promise;
}
