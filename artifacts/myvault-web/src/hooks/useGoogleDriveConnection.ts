import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { findMyVaultDriveMap, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
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
  type DriveManifestPreview,
} from "@/lib/restore/driveManifestPreview";
import { type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  hasPendingLocalChanges,
  loadLocalSyncBase,
  loadMetadataRestoreBundle,
  saveLocalSyncBase,
} from "@/lib/restore/localRestoreStore";
import { getActiveAccountId } from "@/lib/sync/accountContext";
import { computeBundleRevision } from "@/lib/sync/revision";
import { getGoogleDriveStartupAction } from "@/lib/googleDrive/authPolicy";
import { getDriveRefreshStatus, readDriveManifestPreview, refreshLatestDriveMetadataSafely, subscribeDriveRefresh } from "@/lib/sync/driveRefresh";

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

export function useGoogleDriveConnection() {
  const [state, setState] = useState<ConnectionState>(createInitialState);
  const background = useSyncExternalStore(subscribeDriveRefresh, () => getDriveRefreshStatus(getActiveAccountId()));

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
            if (cancelled || currentRefreshId !== refreshId) return;
            setState((current) => ({ ...current, status: "connected", token: verifiedToken, accountId, metadataRestore: localMetadata }));
            const refreshed = await refreshLatestDriveMetadataSafely(verifiedToken, accountId);
            assertGoogleDriveSession(verifiedToken, accountId);
            if (cancelled || currentRefreshId !== refreshId) return;
            setState({
              status: refreshed.staged ? "connected" : refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
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
        status: refreshed.staged ? "connected" : refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
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
        status: refreshed.staged ? "connected" : refreshed.manifestPreview ? "metadata-restored" : refreshed.scan.manifestFile ? "connected" : "no-backup",
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
      const { session, value: refreshed } = await runWithVerifiedGoogleDriveSession(
        ({ token, accountId }) => refreshLatestDriveMetadataSafely(token, accountId),
        { interactive: true, onRenewing: () => setState((current) => ({ ...current, status: "renewing", error: null })) },
      );
      assertGoogleDriveSession(session.token, session.accountId);
      setState((current) => ({
        ...current,
        status: refreshed.staged ? "connected" : refreshed.manifestPreview ? "metadata-restored" : "no-backup",
        token: session.token,
        accountId: session.accountId,
        scan: refreshed.scan,
        manifestPreview: refreshed.manifestPreview,
        metadataRestore: refreshed.metadataRestore,
        error: refreshed.staged ? getDriveRefreshStatus(session.accountId).error : null,
      }));
      return refreshed.staged ? null : refreshed.metadataRestore;
    } catch (error) {
      setState((current) => ({ ...current, status: isGoogleDriveInteractionRequired(error) ? "reauth-required" : "error", error: getErrorMessage(error) }));
      return null;
    }
  }, []);

  return useMemo(
    () => ({
      ...state,
      background,
      error: state.error ?? background.error,
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
    [chooseAnotherAccount, connect, disconnect, prepareRestorePreview, restoreMetadata, scanForMyVault, state, background],
  );
}
