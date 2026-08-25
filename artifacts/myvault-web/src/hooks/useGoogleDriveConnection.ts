import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadDriveFileJson, findMyVaultDriveMap, type MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_DRIVE_SCOPE,
  disconnectGoogleDrive,
  getCachedGoogleDriveToken,
  hasGoogleClientId,
  requestGoogleDriveToken,
  type GoogleDriveToken,
} from "@/lib/googleDrive/identity";
import { assertGoogleDriveSession, verifyAndActivateGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import {
  buildDriveManifestPreview,
  parseDriveSyncManifest,
  type DriveManifestPreview,
} from "@/lib/restore/driveManifestPreview";
import { buildMetadataRestoreBundle, getMetadataManifestEntries, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import {
  createLocalRecoverySnapshot,
  hasPendingLocalChanges,
  loadLocalSyncBase,
  loadMetadataRestoreBundle,
  saveLocalSyncBase,
  saveMetadataRestoreBundle,
} from "@/lib/restore/localRestoreStore";
import { clearActiveGoogleAccount, getActiveAccountId } from "@/lib/sync/accountContext";
import { computeBundleRevision } from "@/lib/sync/revision";

export type GoogleDriveConnectionStatus =
  | "setup-needed"
  | "idle"
  | "connecting"
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
    status: token ? "connected" : hasGoogleClientId() ? "idle" : "setup-needed",
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

function tokenNeedsRefresh(token: GoogleDriveToken | null) {
  if (!token) {
    return true;
  }

  return token.expiresAt - Date.now() < 60000;
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

    const refreshSession = () => {
      const currentRefreshId = ++refreshId;
      const token = getCachedGoogleDriveToken();
      if (!token) {
        clearActiveGoogleAccount();
        setState(createInitialState());
        return;
      }

      void verifyAndActivateGoogleDriveSession(token)
        .then(async ({ accountId }) => {
          assertGoogleDriveSession(token, accountId);
          const metadataRestore = await loadMetadataRestoreBundle();
          assertGoogleDriveSession(token, accountId);
          if (metadataRestore) await ensureBaseForBundle(metadataRestore);
          if (cancelled || currentRefreshId !== refreshId) return;
          setState({
            status: "connected",
            token,
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

    refreshSession();
    window.addEventListener("myvault-google-drive-session-changed", refreshSession);

    return () => {
      cancelled = true;
      window.removeEventListener("myvault-google-drive-session-changed", refreshSession);
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
      setState((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
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
      setState((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
      return null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectGoogleDrive({ revoke: false });
    clearActiveGoogleAccount();
    setState({
      status: hasGoogleClientId() ? "idle" : "setup-needed",
      token: null,
      accountId: null,
      scan: null,
      manifestPreview: null,
      metadataRestore: null,
      error: null,
    });
  }, []);

  const scanForMyVault = useCallback(async () => {
    const cachedToken = getCachedGoogleDriveToken();
    const token = tokenNeedsRefresh(cachedToken) ? await connect() : cachedToken;

    if (!token) {
      return null;
    }

    setState((current) => ({ ...current, status: "scanning", error: null }));

    try {
      const { accountId } = await verifyAndActivateGoogleDriveSession(token);
      const scan = await findMyVaultDriveMap(token.accessToken);
      assertGoogleDriveSession(token, accountId);
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
      setState((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
      return null;
    }
  }, [connect]);

  const prepareRestorePreview = useCallback(async () => {
    const cachedToken = getCachedGoogleDriveToken();
    const token = tokenNeedsRefresh(cachedToken) ? await connect() : cachedToken;

    if (!token) {
      return null;
    }

    setState((current) => ({ ...current, status: "scanning", error: null, manifestPreview: null }));

    try {
      const { accountId } = await verifyAndActivateGoogleDriveSession(token);
      const previewResult = await readDriveManifestPreview(token.accessToken);
      assertGoogleDriveSession(token, accountId);
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
      setState((current) => ({ ...current, status: "error", error: getErrorMessage(error), manifestPreview: null }));
      return null;
    }
  }, [connect]);

  const restoreMetadata = useCallback(async () => {
    const cachedToken = getCachedGoogleDriveToken();
    const token = tokenNeedsRefresh(cachedToken) ? await connect() : cachedToken;

    if (!token) {
      return null;
    }

    try {
      const { accountId } = await verifyAndActivateGoogleDriveSession(token);
      setState((current) => ({ ...current, status: "scanning", token, accountId, error: null }));

      // A restore never reuses a preview held by a previous hook or account.
      const previewResult = await readDriveManifestPreview(token.accessToken);
      assertGoogleDriveSession(token, accountId);
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

      const metadataEntries = getMetadataManifestEntries(manifestPreview.manifest);
      const downloadedFiles = await Promise.all(
        metadataEntries.map(async (entry) => ({
          entry,
          json: await downloadDriveFileJson<unknown>(token.accessToken, entry.cloudFileId),
        })),
      );
      const metadataRestore = buildMetadataRestoreBundle(manifestPreview.manifest, downloadedFiles);
      assertGoogleDriveSession(token, accountId);

      if (metadataRestore.issues.length) {
        throw new Error(metadataRestore.issues[0]);
      }

      if (await hasPendingLocalChanges()) {
        await createLocalRecoverySnapshot("restore-blocked-dirty-workspace");
        throw new Error("This browser has unsynchronised website changes. Restore was stopped so those changes cannot be erased. Use the safe sync check to reconcile them with Drive.");
      }

      await createLocalRecoverySnapshot("before-drive-restore");
      assertGoogleDriveSession(token, accountId);
      await saveMetadataRestoreBundle(metadataRestore);
      assertGoogleDriveSession(token, accountId);
      await saveLocalSyncBase({
        schemaVersion: 1,
        accountId,
        revision: await computeBundleRevision(metadataRestore),
        bundle: structuredClone(metadataRestore),
      });

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
      setState((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
      return null;
    }
  }, [connect]);

  return useMemo(
    () => ({
      ...state,
      clientId: GOOGLE_CLIENT_ID,
      driveScope: GOOGLE_DRIVE_SCOPE,
      isConfigured: hasGoogleClientId(),
      isBusy: state.status === "connecting" || state.status === "scanning" || state.status === "reading-manifest" || state.status === "restoring-metadata",
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
