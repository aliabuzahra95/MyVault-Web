import type { MetadataRestoreBundle } from "../../src/lib/restore/metadataRestore";

export const GOOGLE_CLIENT_ID = "disposable-client";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const token = { accessToken: "disposable-not-a-credential", expiresAt: Date.now() + 900000, scope: GOOGLE_DRIVE_SCOPE };
const session = { token, accountId: "disposable-account" };
export const hasGoogleClientId = () => true;
export const getCachedGoogleDriveToken = () => token;
export const hasPreviousGoogleDriveAuthorization = () => true;
export const isGoogleDriveInteractionRequired = () => false;
export const requestGoogleDriveToken = async () => token;
export const disconnectGoogleDrive = async () => undefined;
export const assertGoogleDriveSession = () => undefined;
export const verifyAndActivateGoogleDriveSession = async () => session;
export async function runWithVerifiedGoogleDriveSession<T>(operation: (value: typeof session) => Promise<T>) {
  return { session, value: await operation(session) };
}
export const hasPendingLocalChanges = async () => false;
export const loadLocalSyncBase = async () => null;
export const loadMetadataRestoreBundle = async () => null;
export const saveLocalSyncBase = async () => undefined;
export const getActiveAccountId = () => session.accountId;
const idle = { phase: "idle", error: null, checkedAt: null, appliedAt: null };
export const subscribeDriveRefresh = () => () => undefined;
export const getDriveRefreshStatus = () => idle;
export type Result = {
  scan: { rootFolder: { name: string }; verifiedGraph: { commitId: string; current: boolean } };
  manifestPreview: null; metadataRestore: MetadataRestoreBundle; staged: boolean; graphBackup: true; latestBackup: null;
};
export const requests: { manual: boolean; resolve: (result: Result) => void; reject: (error: Error) => void }[] = [];
export function refreshLatestDriveMetadataSafely(_token: unknown, _account: string, manual = false) {
  return new Promise<Result>((resolve, reject) => requests.push({ manual, resolve, reject }));
}
export const readVerifiedDriveBackupPreview = () => refreshLatestDriveMetadataSafely(token, session.accountId);
