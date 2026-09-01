import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadDriveFileJson, findMyVaultDriveMap, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_DRIVE_SCOPE,
  disconnectGoogleDrive,
  getCachedGoogleDriveToken,
  hasGoogleClientId,
  hasPreviousGoogleDriveAuthorization,
  isGoogleDriveInteractionRequired,
  requestGoogleDriveToken,
  type GoogleDriveToken,
} from "@/lib/googleDrive/identity";
import {
  assertGoogleDriveSession,
  runWithVerifiedGoogleDriveSession,
  verifyAndActivateGoogleDriveSession,
} from "@/lib/googleDrive/accountSession";
import {
  buildDriveManifestPreview,
  parseDriveSyncManifest,
  type DriveManifestPreview,
} from "@/lib/restore/driveManifestPreview";
import { type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  createLocalRecoverySnapshot,
  hasPendingLocalChanges,
  loadLocalSyncBase,
  loadMetadataRestoreBundle,
  saveLocalSyncBase,
} from "@/lib/restore/localRestoreStore";
import { getActiveAccountId } from "@/lib/sync/accountContext";
import { computeBundleRevision } from "@/lib/sync/revision";
import { stageVerifiedMetadataRestore, verifyDriveManifestFiles } from "@/lib/restore/verifiedDriveRestore";
import { getGoogleDriveStartupAction } from "@/lib/googleDrive/authPolicy";
import { applyIncomingDriveBundleSafely } from "@/lib/sync/safePull";

export type GoogleDriveConnectionStatus =
  | "setup-needed"
  | "initializing"
  | "disconnected"
  | "connecting"
  | "renewing"
  | "reauth-required"
  | "connected"
  | "no-backup"
  | "scanning"
  | "ready"
  | "reading-manifest"
  | "preview-ready"
  | "restoring-metadata"
  | "metadata-restored"
  | "error";

type ConnectionState = {
  status: GoogleDriveConnectionStatus;
  token: GoogleDriveToken | null;
  accountId: string | null;
  scan: MyVaultDriveScan | null;
  manifestPreview: DriveManifestPreview | null;
  metadataRestore: MetadataRestoreBundle | null;
  error: string | null;
};

function createInitialState(): ConnectionState {
  const token = getCachedGoogleDriveToken();
  return {
    status: hasGoogleClientId() ? "initializing" : "setup-needed",
    token,
    accountId: null,
    scan: null,
    manifestPreview: null,
    metadataRestore: null,
    error: hasGoogleClientId() ? null : "Add a Google OAuth client ID before connecting to Drive.",
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong while talking to Google Drive.";
}

async function readDriveManifestPreview(accessToken: string) {
  const scan = await findMyVaultDriveMap(accessToken);
  if (!scan.ready || !scan.manifestFile) {
    return {
      scan,
      manifestPreview: null,
      error: scan.manifestFile
        ? "A MyVault folder exists in this account, but its backup is incomplete. Run a fresh backup from MyVault Android, then check again."
        : null,
    };
  }

  const rawManifest = await downloadDriveFileJson<unknown>(accessToken, scan.manifestFile.id);
  const parsed = parseDriveSyncManifest(rawManifest);

  if (!parsed.manifest) {
    throw new Error(parsed.issues[0] ?? "The Drive manifest could not be read.");
  }

  return {
    scan,
    manifestPreview: buildDriveManifestPreview(parsed.manifest, parsed.issues),
    error: null,
  };
}

async function ensureBaseForBundle(bundle: MetadataRestoreBundle) {
  const currentBase = await loadLocalSyncBase();
  if (currentBase) return currentBase;
  if (await hasPendingLocalChanges()) {
    throw new Error("Website changes are present but their immutable Drive baseline is missing. Nothing was replaced; reconnect and restore before backing up.");
  }
  const base = {
    schemaVersion: 1 as const,
    accountId: getActiveAccountId(),
    revision: await computeBundleRevision(bundle),
    bundle: structuredClone(bundle),
  };
  await saveLocalSyncBase(base);
  return base;
}

type AutomaticDriveRefresh = {
  scan: MyVaultDriveScan;
  manifestPreview: DriveManifestPreview | null;
  metadataRestore: MetadataRestoreBundle | null;
};

const automaticRefreshes = new Map<string, Promise<AutomaticDriveRefresh>>();
const completedAutomaticRefreshes = new Map<string, { completedAt: number; result: AutomaticDriveRefresh }>();

async function refreshLatestDriveMetadataSafely(token: GoogleDriveToken, accountId: string) {
  const completed = completedAutomaticRefreshes.get(accountId);
  if (completed && Date.now() - completed.completedAt < 30_000 && !(await hasPendingLocalChanges())) return completed.result;
  const existing = automaticRefreshes.get(accountId);
  if (existing) return existing;

  const refresh = (async () => {
    const previewResult = await readDriveManifestPreview(token.accessToken);
    assertGoogleDriveSession(token, accountId);
    if (!previewResult.manifestPreview) {
      const result = {
        scan: previewResult.scan,
        manifestPreview: null,
        metadataRestore: await loadMetadataRestoreBundle(),
      };
      completedAutomaticRefreshes.set(accountId, { completedAt: Date.now(), result });
      return result;
    }

    const driveVerification = await verifyDriveManifestFiles(
      token.accessToken,
      previewResult.manifestPreview.manifest,
      previewResult.scan,
    );
    const metadataRestore = await stageVerifiedMetadataRestore({
      accessToken: token.accessToken,
      manifest: previewResult.manifestPreview.manifest,
      compatibilityIssues: [...previewResult.manifestPreview.issues, ...driveVerification.issues],
    });
    assertGoogleDriveSession(token, accountId);
    const [existingBase, hasPending] = await Promise.all([loadLocalSyncBase(), hasPendingLocalChanges()]);
    const base = {
      schemaVersion: 1 as const,
      accountId,
      revision: await computeBundleRevision(metadataRestore),
      bundle: structuredClone(metadataRestore),
    };
    if (hasPending || existingBase?.revision.revisionId !== base.revision.revisionId) {
      await createLocalRecoverySnapshot("before-automatic-safe-pull");
    }
    await applyIncomingDriveBundleSafely(metadataRestore, base);
    const result = {
      scan: previewResult.scan,
      manifestPreview: previewResult.manifestPreview,
      metadataRestore,
    };
    completedAutomaticRefreshes.set(accountId, { completedAt: Date.now(), result });
    return result;
  })();

  automaticRefreshes.set(accountId, refresh);
  void refresh.finally(() => automaticRefreshes.delete(accountId)).catch(() => undefined);
  return refresh;
}

export function useGoogleDriveConnection() {
  const [state, setState] = useState<ConnectionState>(createInitialState);

  useEffect(() => {
    let cancelled = false;
    let refreshId = 0;

    const refreshSession = async () => {
      const currentRefreshId = ++refreshId;
      let token = getCachedGoogleDriveToken();
      const startupAction = getGoogleDriveStartupAction({
        configured: hasGoogleClientId(),
        hasUsableToken: Boolean(token),
        previouslyAuthorized: hasPreviousGoogleDriveAuthorization(),
      });
      if (startupAction === "setup-needed") {
        setState(createInitialState());
        return;
      }
      if (startupAction === "disconnected") {
        setState((current) => ({ ...current, status: "disconnected", token: null, accountId: null, scan: null, manifestPreview: null, error: null }));
        return;
      }

      if (startupAction === "renew-token") {
        setState((current) => ({ ...current, status: "renewing", token: null, error: null }));
        try {
          token = await requestGoogleDriveToken({ forceRefresh: true, interactive: false });
        } catch (error) {
          if (cancelled || currentRefreshId !== refreshId) return;
          setState((current) => ({
            ...current,
            status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error",
            token: null,
            error: getErrorMessage(error),
          }));
          return;
        }
      }

      if (!token) return;

      void runWithVerifiedGoogleDriveSession(
        async () => undefined,
        { interactive: false, onRenewing: () => setState((current) => ({ ...current, status: "renewing", error: null })) },
      )
        .then(async ({ session }) => {
          const { token: verifiedToken, accountId } = session;
          assertGoogleDriveSession(verifiedToken, accountId);
          const localMetadata = await loadMetadataRestoreBundle();
          try {
            if (localMetadata) await ensureBaseForBundle(localMetadata);
            const refreshed = await refreshLatestDriveMetadataSafely(verifiedToken, accountId);
            assertGoogleDriveSession(verifiedToken, accountId);
            if (cancelled || currentRefreshId !== refreshId) return;
            setState({
              status: refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
              token: verifiedToken,
              accountId,
              scan: refreshed.scan,
              manifestPreview: refreshed.manifestPreview,
              metadataRestore: refreshed.metadataRestore,
              error: null,
            });
          } catch (error) {
            if (cancelled || currentRefreshId !== refreshId) return;
            setState({
              status: "connected",
              token: verifiedToken,
              accountId,
              scan: null,
              manifestPreview: null,
              metadataRestore: localMetadata,
              error: `The automatic safe sync check stopped without replacing local work. ${getErrorMessage(error)}`,
            });
          }
        })
        .catch((error) => {
          if (cancelled || currentRefreshId !== refreshId) return;
          setState((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
        });
    };

    void refreshSession();
    const handleSessionChange = () => void refreshSession();
    window.addEventListener("myvault-google-drive-session-changed", handleSessionChange);

    return () => {
      cancelled = true;
      window.removeEventListener("myvault-google-drive-session-changed", handleSessionChange);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!hasGoogleClientId()) {
      setState((current) => ({
        ...current,
        status: "setup-needed",
        error: "Add VITE_GOOGLE_CLIENT_ID to the web app environment first.",
      }));
      return null;
    }

    setState((current) => ({ ...current, status: "connecting", error: null }));

    try {
      const token = await requestGoogleDriveToken();
      const { accountId } = await verifyAndActivateGoogleDriveSession(token);
      const refreshed = await refreshLatestDriveMetadataSafely(token, accountId);
      setState({
        status: refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
        token,
        accountId,
        scan: refreshed.scan,
        manifestPreview: refreshed.manifestPreview,
        metadataRestore: refreshed.metadataRestore,
        error: null,
      });
      return token;
    } catch (error) {
      setState((current) => ({
        ...current,
        status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error",
        error: getErrorMessage(error),
      }));
      return null;
    }
  }, []);

  const chooseAnotherAccount = useCallback(async () => {
    if (!hasGoogleClientId()) {
      setState((current) => ({
        ...current,
        status: "setup-needed",
        error: "Add VITE_GOOGLE_CLIENT_ID to the web app environment first.",
      }));
      return null;
    }

    setState((current) => ({ ...current, status: "connecting", error: null }));

    try {
      const token = await requestGoogleDriveToken({
        forceRefresh: true,
        interactive: true,
        selectAccount: true,
      });
      const { accountId } = await verifyAndActivateGoogleDriveSession(token);
      const refreshed = await refreshLatestDriveMetadataSafely(token, accountId);
      setState({
        status: refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
        token,
        accountId,
        scan: refreshed.scan,
        manifestPreview: refreshed.manifestPreview,
        metadataRestore: refreshed.metadataRestore,
        error: null,
      });
      return token;
    } catch (error) {
      setState((current) => ({
        ...current,
        status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error",
        error: getErrorMessage(error),
      }));
      return null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectGoogleDrive({ revoke: false });
    setState({
      status: hasGoogleClientId() ? "disconnected" : "setup-needed",
      token: null,
      accountId: null,
      scan: null,
      manifestPreview: null,
      metadataRestore: null,
      error: null,
    });
  }, []);

  const scanForMyVault = useCallback(async () => {
    setState((current) => ({ ...current, status: "scanning", error: null }));

    try {
      const { session, value: scan } = await runWithVerifiedGoogleDriveSession(
        async ({ token, accountId }) => {
          const result = await findMyVaultDriveMap(token.accessToken);
          assertGoogleDriveSession(token, accountId);
          return result;
        },
        { interactive: true, onRenewing: () => setState((current) => ({ ...current, status: "renewing", error: null })) },
      );
      const { token, accountId } = session;
      setState((current) => ({
        ...current,
        token,
        accountId,
        status: scan.ready ? "ready" : scan.manifestFile ? "connected" : "no-backup",
        scan,
        manifestPreview: scan.ready ? current.manifestPreview : null,
        metadataRestore: scan.ready ? current.metadataRestore : null,
        error: scan.ready || !scan.manifestFile ? null : "A MyVault folder exists in this account, but its backup is incomplete. Run a fresh backup from MyVault Android, then check again.",
      }));
      return scan;
    } catch (error) {
      setState((current) => ({ ...current, status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error", error: getErrorMessage(error) }));
      return null;
    }
  }, []);

  const prepareRestorePreview = useCallback(async () => {
    setState((current) => ({ ...current, status: "scanning", error: null, manifestPreview: null }));

    try {
      const { session, value: previewResult } = await runWithVerifiedGoogleDriveSession(
        async ({ token, accountId }) => {
          const result = await readDriveManifestPreview(token.accessToken);
          assertGoogleDriveSession(token, accountId);
          return result;
        },
        { interactive: true, onRenewing: () => setState((current) => ({ ...current, status: "renewing", error: null })) },
      );
      const { token, accountId } = session;
      if (!previewResult.manifestPreview) {
        setState((current) => ({
          ...current,
          token,
          accountId,
          status: previewResult.scan.manifestFile ? "connected" : "no-backup",
          scan: previewResult.scan,
          manifestPreview: null,
          error: previewResult.error,
        }));
        return null;
      }

      const manifestPreview = previewResult.manifestPreview;
      setState((current) => ({
        ...current,
        token,
        accountId,
        status: "preview-ready",
        scan: previewResult.scan,
        manifestPreview,
        metadataRestore: current.metadataRestore?.cloudVersion === manifestPreview.manifest.cloudVersion ? current.metadataRestore : null,
        error: manifestPreview.issues.length ? "Manifest loaded, but it has warnings to review." : null,
      }));

      return manifestPreview;
    } catch (error) {
      setState((current) => ({ ...current, status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error", error: getErrorMessage(error), manifestPreview: null }));
      return null;
    }
  }, []);

  const restoreMetadata = useCallback(async () => {
    try {
      setState((current) => ({ ...current, status: "scanning", error: null }));
      const { session, value: staged } = await runWithVerifiedGoogleDriveSession(
        async ({ token, accountId }) => {
          // Restore discovery is always fresh and bound to this verified session.
          const previewResult = await readDriveManifestPreview(token.accessToken);
          assertGoogleDriveSession(token, accountId);
          if (!previewResult.manifestPreview) return { previewResult, metadataRestore: null };
          const driveVerification = await verifyDriveManifestFiles(token.accessToken, previewResult.manifestPreview.manifest, previewResult.scan);
          const metadataRestore = await stageVerifiedMetadataRestore({
            accessToken: token.accessToken,
            manifest: previewResult.manifestPreview.manifest,
            compatibilityIssues: [...previewResult.manifestPreview.issues, ...driveVerification.issues],
          });
          assertGoogleDriveSession(token, accountId);
          return { previewResult, metadataRestore };
        },
        { interactive: true, onRenewing: () => setState((current) => ({ ...current, status: "renewing", error: null })) },
      );
      const { token, accountId } = session;
      const { previewResult, metadataRestore } = staged;
      const scan = previewResult.scan;
      const manifestPreview = previewResult.manifestPreview;

      if (!manifestPreview) {
        setState((current) => ({
          ...current,
          status: previewResult.scan.manifestFile ? "connected" : "no-backup",
          token,
          accountId,
          scan,
          manifestPreview: null,
          metadataRestore: null,
          error: previewResult.error,
        }));
        return null;
      }

      setState((current) => ({ ...current, status: "restoring-metadata", scan, manifestPreview, error: null }));
      if (!metadataRestore) throw new Error("The Drive backup could not be staged.");

      await createLocalRecoverySnapshot("before-drive-restore");
      assertGoogleDriveSession(token, accountId);
      const base = {
        schemaVersion: 1,
        accountId,
        revision: await computeBundleRevision(metadataRestore),
        bundle: structuredClone(metadataRestore),
      } as const;
      assertGoogleDriveSession(token, accountId);
      await applyIncomingDriveBundleSafely(metadataRestore, base);

      setState((current) => ({
        ...current,
        status: "metadata-restored",
        token,
        accountId,
        scan,
        manifestPreview,
        metadataRestore,
        error: null,
      }));

      return metadataRestore;
    } catch (error) {
      setState((current) => ({ ...current, status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error", error: getErrorMessage(error) }));
      return null;
    }
  }, []);

  return useMemo(
    () => ({
      ...state,
      clientId: GOOGLE_CLIENT_ID,
      driveScope: GOOGLE_DRIVE_SCOPE,
      isConfigured: hasGoogleClientId(),
      isBusy: state.status === "initializing" || state.status === "connecting" || state.status === "renewing" || state.status === "scanning" || state.status === "reading-manifest" || state.status === "restoring-metadata",
      connect,
      chooseAnotherAccount,
      disconnect,
      scanForMyVault,
      prepareRestorePreview,
      restoreMetadata,
    }),
    [chooseAnotherAccount, connect, disconnect, prepareRestorePreview, restoreMetadata, scanForMyVault, state],
  );
}
