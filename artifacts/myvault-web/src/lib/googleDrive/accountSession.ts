import { getDriveUserProfile, isGoogleDriveAuthorizationError, type DriveUserProfile } from "@/lib/googleDrive/driveClient";
import {
  getCachedGoogleDriveToken,
  hasPreviousGoogleDriveAuthorization,
  requestGoogleDriveToken,
  type GoogleDriveToken,
} from "@/lib/googleDrive/identity";
import { prepareAccountStorage } from "@/lib/restore/localRestoreStore";
import { getActiveAccountId, setActiveGoogleAccount } from "@/lib/sync/accountContext";
import { retryOnceAfterAuthFailure } from "@/lib/googleDrive/authRetry";

export type VerifiedGoogleDriveSession = {
  accountId: string;
  profile: DriveUserProfile;
  token: GoogleDriveToken;
};

const ACCOUNT_CHANGED_MESSAGE = "The Google account changed during this operation. MyVault stopped before loading or saving anything.";
let activationQueue: Promise<void> = Promise.resolve();

function assertCurrentGoogleDriveToken(token: GoogleDriveToken) {
  const currentToken = getCachedGoogleDriveToken();
  if (!currentToken || currentToken.accessToken !== token.accessToken) {
    throw new Error(ACCOUNT_CHANGED_MESSAGE);
  }
}

export function assertGoogleDriveSession(token: GoogleDriveToken, accountId: string) {
  assertCurrentGoogleDriveToken(token);
  if (getActiveAccountId() !== accountId) {
    throw new Error(ACCOUNT_CHANGED_MESSAGE);
  }
}

async function performSessionActivation(token: GoogleDriveToken): Promise<VerifiedGoogleDriveSession> {
  assertCurrentGoogleDriveToken(token);

  const profile = await getDriveUserProfile(token.accessToken);
  if (!profile?.permissionId) {
    throw new Error("Google Drive did not provide a stable account identifier. Nothing was loaded or saved.");
  }

  // A previous profile request may finish after the user selects another account.
  // Never let that stale response reactivate the earlier account namespace.
  assertCurrentGoogleDriveToken(token);
  const accountId = setActiveGoogleAccount(profile.permissionId);
  await prepareAccountStorage(accountId);
  assertGoogleDriveSession(token, accountId);
  return { accountId, profile, token };
}

export function verifyAndActivateGoogleDriveSession(token: GoogleDriveToken): Promise<VerifiedGoogleDriveSession> {
  const activation = activationQueue
    .catch(() => undefined)
    .then(() => performSessionActivation(token));
  activationQueue = activation.then(() => undefined, () => undefined);
  return activation;
}

export async function acquireVerifiedGoogleDriveSession(options: { interactive?: boolean; forceRefresh?: boolean } = {}) {
  const cached = options.forceRefresh ? null : getCachedGoogleDriveToken();
  if (!cached && options.interactive === false && !hasPreviousGoogleDriveAuthorization()) {
    throw new Error("Reconnect Google Drive to continue.");
  }
  const token = cached ?? await requestGoogleDriveToken({
    forceRefresh: options.forceRefresh ?? true,
    interactive: options.interactive,
  });
  return verifyAndActivateGoogleDriveSession(token);
}

export async function runWithVerifiedGoogleDriveSession<T>(
  operation: (session: VerifiedGoogleDriveSession) => Promise<T>,
  options: { interactive?: boolean; onRenewing?: () => void } = {},
) {
  let session: VerifiedGoogleDriveSession;
  try {
    session = await acquireVerifiedGoogleDriveSession({ interactive: options.interactive });
  } catch (error) {
    if (!isGoogleDriveAuthorizationError(error)) throw error;
    options.onRenewing?.();
    session = await acquireVerifiedGoogleDriveSession({ interactive: false, forceRefresh: true });
  }
  const result = await retryOnceAfterAuthFailure({
    session,
    operation,
    isAuthorizationError: isGoogleDriveAuthorizationError,
    renew: async () => {
      options.onRenewing?.();
      session = await acquireVerifiedGoogleDriveSession({ interactive: false, forceRefresh: true });
      return session;
    },
  });
  return { session: result.session, value: result.value };
}
