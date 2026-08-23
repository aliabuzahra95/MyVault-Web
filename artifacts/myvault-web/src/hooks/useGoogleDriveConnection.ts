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
import {
  buildDriveManifestPreview,
  parseDriveSyncManifest,
  type DriveManifestPreview,
} from "@/lib/restore/driveManifestPreview";
import { buildMetadataRestoreBundle, getMetadataManifestEntries, type MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { loadMetadataRestoreBundle, saveMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";

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
  scan: MyVaultDriveScan | null;
  manifestPreview: DriveManifestPreview | null;
  metadataRestore: MetadataRestoreBundle | null;
  error: string | null;
};

const initialToken = getCachedGoogleDriveToken();
const initialState: ConnectionState = {
  status: initialToken ? "connected" : hasGoogleClientId() ? "idle" : "setup-needed",
  token: initialToken,
  scan: null,
  manifestPreview: null,
  metadataRestore: null,
  error: hasGoogleClientId() ? null : "Add a Google OAuth client ID before connecting to Drive.",
};

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

export function useGoogleDriveConnection() {
  const [state, setState] = useState<ConnectionState>(initialState);

  useEffect(() => {
    let cancelled = false;

    void loadMetadataRestoreBundle()
      .then((metadataRestore) => {
        if (!cancelled && metadataRestore) {
          setState((current) => ({ ...current, metadataRestore }));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
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
      setState((current) => ({ ...current, status: "connected", token, error: null }));
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
      setState({
        status: "connected",
        token,
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
    await disconnectGoogleDrive({ revoke: true });
    setState({
      status: hasGoogleClientId() ? "idle" : "setup-needed",
      token: null,
      scan: null,
      manifestPreview: null,
      metadataRestore: null,
      error: null,
    });
  }, []);

  const scanForMyVault = useCallback(async () => {
    const token = tokenNeedsRefresh(state.token) ? await connect() : state.token;

    if (!token) {
      return null;
    }

    setState((current) => ({ ...current, status: "scanning", error: null }));

    try {
      const scan = await findMyVaultDriveMap(token.accessToken);
      setState((current) => ({
        ...current,
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
  }, [connect, state.token]);

  const prepareRestorePreview = useCallback(async () => {
    const token = tokenNeedsRefresh(state.token) ? await connect() : state.token;

    if (!token) {
      return null;
    }

    setState((current) => ({ ...current, status: "scanning", error: null, manifestPreview: null }));

    try {
      const previewResult = await readDriveManifestPreview(token.accessToken);
      if (!previewResult.manifestPreview) {
        setState((current) => ({
          ...current,
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
  }, [connect, state.token]);

  const restoreMetadata = useCallback(async () => {
    const token = tokenNeedsRefresh(state.token) ? await connect() : state.token;

    if (!token) {
      return null;
    }

    try {
      let scan = state.scan;
      let manifestPreview = state.manifestPreview;

      if (!manifestPreview) {
        setState((current) => ({ ...current, status: "scanning", error: null }));
        const previewResult = await readDriveManifestPreview(token.accessToken);
        scan = previewResult.scan;
        manifestPreview = previewResult.manifestPreview;

        if (!manifestPreview) {
          setState((current) => ({
            ...current,
            status: previewResult.scan.manifestFile ? "connected" : "no-backup",
            scan,
            manifestPreview: null,
            error: previewResult.error,
          }));
          return null;
        }
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

      if (metadataRestore.issues.length) {
        throw new Error(metadataRestore.issues[0]);
      }

      await saveMetadataRestoreBundle(metadataRestore);

      setState((current) => ({
        ...current,
        status: "metadata-restored",
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
  }, [connect, state.manifestPreview, state.scan, state.token]);

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
