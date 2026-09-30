import type { GraphStatus } from "./backupGraph";

export type WebLatestBackupNotice = {
  status: "NEWER" | "LOCAL_CHANGES" | "BLOCKED";
  remoteCommitId: string | null;
  message: string;
};

export function decideLatestBackupNotice(
  graphStatus: GraphStatus,
  remoteTip: string | null,
  hasPendingLocalChanges: boolean,
  lastNotifiedRemoteCommitId: string | null,
): WebLatestBackupNotice | null {
  if (graphStatus === "ALREADY_CURRENT") return null;
  if (graphStatus === "DESCENDANTS" || graphStatus === "SINGLE_TIP") {
    if (!remoteTip || remoteTip === lastNotifiedRemoteCommitId) return null;
    return hasPendingLocalChanges
      ? { status: "LOCAL_CHANGES", remoteCommitId: remoteTip,
          message: "A newer backup is available, but this browser has local changes that must be backed up or resolved first." }
      : { status: "NEWER", remoteCommitId: remoteTip,
          message: "A newer MyVault backup is available from Google Drive." };
  }
  if (graphStatus === "FORK") return { status: "BLOCKED", remoteCommitId: null,
    message: "Fork detected. MyVault cannot safely choose a backup branch." };
  if (graphStatus === "UNSUPPORTED") return { status: "BLOCKED", remoteCommitId: null,
    message: "This backup requires a newer MyVault backup reader." };
  return { status: "BLOCKED", remoteCommitId: null,
    message: "The Drive backup history could not be verified safely. Nothing was restored." };
}

export const latestBackupNoticeStorageKey = (accountId: string, lineageId: string) =>
  `myvault:latest-backup-notice:${accountId}:${lineageId}`;

export function loadLastNotifiedGraphTip(accountId: string, lineageId: string): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(latestBackupNoticeStorageKey(accountId, lineageId));
}

export function markGraphTipNotified(accountId: string, lineageId: string, commitId: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(latestBackupNoticeStorageKey(accountId, lineageId), commitId);
}
