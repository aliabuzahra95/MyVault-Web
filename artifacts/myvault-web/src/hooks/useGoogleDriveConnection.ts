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
  applyMetadataRestoreAtomically,
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
          const metadataRestore = await loadMetadataRestoreBundle();
          assertGoogleDriveSession(verifiedToken, accountId);
          if (metadataRestore) await ensureBaseForBundle(metadataRestore);
          if (cancelled || currentRefreshId !== refreshId) return;
          setState({
            status: "connected",
            token: verifiedToken,
            accountId,
            scan: null,
            manifestPreview: null,
            metadataRestore,
            error: null,
          });
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
      setState((current) => ({ ...current, status: "connected", token, accountId, error: null }));
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
      setState({
        status: "connected",
        token,
        accountId,
        scan: null,
        manifestPreview: null,
        metadataRestore: null,
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
          if (previewResult.manifestPreview.issues.length) {
            throw new Error(previewResult.manifestPreview.issues[0]);
          }
          await verifyDriveManifestFiles(token.accessToken, previewResult.manifestPreview.manifest, previewResult.scan);
          const metadataRestore = await stageVerifiedMetadataRestore({
            accessToken: token.accessToken,
            manifest: previewResult.manifestPreview.manifest,
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

      if (await hasPendingLocalChanges()) {
        await createLocalRecoverySnapshot("restore-blocked-dirty-workspace");
        throw new Error("This browser has unsynchronised website changes. Restore was stopped so those changes cannot be erased. Use the safe sync check to reconcile them with Drive.");
      }

      await createLocalRecoverySnapshot("before-drive-restore");
      assertGoogleDriveSession(token, accountId);
      const base = {
        schemaVersion: 1,
        accountId,
        revision: await computeBundleRevision(metadataRestore),
        bundle: structuredClone(metadataRestore),
      } as const;
      assertGoogleDriveSession(token, accountId);
      await applyMetadataRestoreAtomically(metadataRestore, base);

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
