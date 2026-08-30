import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Cloud,
  HardDrive,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGoogleDriveConnection } from "@/hooks/useGoogleDriveConnection";
import { useGoogleDriveProfile } from "@/hooks/useGoogleDriveProfile";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { formatBytes } from "@/lib/restore/driveManifestPreview";
import { clearRecentActivity } from "@/lib/recentActivity";

function clearUnscopedAccountViewState() {
  clearRecentActivity();
  Object.keys(localStorage)
    .filter((key) => key.startsWith("myvault-pdf-reader-state:"))
    .forEach((key) => localStorage.removeItem(key));
}

function formatBackupDate(value: string | number | null | undefined) {
  if (value == null) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function GoogleDrivePanel() {
  const drive = useGoogleDriveConnection();
  const profile = useGoogleDriveProfile();
  const { corpus } = useRestoredCorpus();
  const [showSwitchConfirmation, setShowSwitchConfirmation] = useState(false);
  const [showDisconnectConfirmation, setShowDisconnectConfirmation] = useState(false);
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const hasToken = Boolean(drive.token && drive.accountId);
  const preview = drive.manifestPreview;
  const hasNoBackup = drive.status === "no-backup" || Boolean(drive.scan && !drive.scan.manifestFile);
  const hasIncompleteBackup = Boolean(drive.scan?.manifestFile && !drive.scan.ready);
  const restoredMatchesPreview = Boolean(
    preview && drive.metadataRestore?.cloudVersion === preview.manifest.cloudVersion,
  );
  const backupModifiedAt = drive.scan?.manifestFile?.modifiedTime
    ?? (preview?.manifest.cloudVersion ? preview.manifest.cloudVersion : null);
  const accountName = profile?.displayName?.trim()
    || profile?.emailAddress?.split("@")[0]?.trim()
    || "Google Drive account";
  const verifiedAccountLabel = profile?.emailAddress?.trim() || accountName;
  // accountId is only set after the Drive profile has been verified by the
  // active session. Do not block restore on the separate display-profile
  // request, which can finish later or fail independently.
  const canConfirmRestore = Boolean(drive.accountId);
  const reconnectRequired = drive.status === "reauth-required";
  const checkingConnection = drive.status === "initializing" || drive.status === "renewing";

  const restoredCounts = useMemo(() => {
    if (drive.metadataRestore) return drive.metadataRestore.counts;
    if (!corpus) return null;
    return {
      courses: corpus.courses.length,
      folders: corpus.folders.length,
      notes: corpus.notes.length,
      blocks: 0,
      attachments: corpus.attachments.length,
      tags: corpus.tags.length,
      stickyNotes: corpus.folderStickyNotes.length + corpus.courses.reduce((total, course) => total + course.stickyNoteCount, 0),
      pdfAnnotations: corpus.pdfAnnotations.length,
    };
  }, [corpus, drive.metadataRestore]);

  async function switchAccount() {
    setIsSwitching(true);
    try {
      const token = await drive.chooseAnotherAccount();
      if (!token) return;
      clearUnscopedAccountViewState();
      setShowSwitchConfirmation(false);
    } finally {
      setIsSwitching(false);
    }
  }

  async function disconnect() {
    setIsDisconnecting(true);
    try {
      await drive.disconnect();
      setShowDisconnectConfirmation(false);
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function restoreConfirmedAccount() {
    setShowRestoreConfirmation(false);
    await drive.restoreMetadata();
  }

  return (
    <section id="google-drive" aria-labelledby="google-drive-title">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="google-drive-title" className="text-sm font-semibold text-foreground">Google Drive</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Restore your Android MyVault backup or change the connected Google account.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {hasToken ? "Connected" : checkingConnection ? "Checking" : reconnectRequired ? "Reconnect required" : "Not connected"}
        </span>
      </div>

      <div className="rounded-lg bg-card/70 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {hasToken ? <UserRound className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {hasToken ? accountName : "Connect Google Drive"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {hasToken ? (profile?.emailAddress || "Account connected") : "Choose the account containing your MyVault backup."}
              </p>
            </div>
          </div>

          {hasToken ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSwitchConfirmation(true)}>
                <RefreshCw /> Use another account
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowDisconnectConfirmation(true)}>
                <LogOut />
                Disconnect
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" onClick={() => void drive.connect()} disabled={drive.isBusy || !drive.isConfigured}>
              {drive.isBusy ? <Loader2 className="animate-spin" /> : <Cloud />}
              {checkingConnection ? "Checking Google Drive" : reconnectRequired ? "Reconnect Google Drive" : "Connect Google Drive"}
            </Button>
          )}
        </div>

        {drive.error && !hasNoBackup ? (
          <p className="mt-4 rounded-md bg-destructive/8 px-3 py-2 text-sm text-foreground" role="alert">
            {drive.error}
          </p>
        ) : null}

        {hasToken ? (
          <div className="mt-5 border-t border-border/45 pt-5">
            {preview ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex items-start gap-2.5">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div><p className="text-xs text-muted-foreground">Last modified</p><p className="mt-1 text-sm font-medium text-foreground">{formatBackupDate(backupModifiedAt)}</p></div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div><p className="text-xs text-muted-foreground">Backup size</p><p className="mt-1 text-sm font-medium text-foreground">{formatBytes(preview.totalBytes)}</p></div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div><p className="text-xs text-muted-foreground">Contents</p><p className="mt-1 text-sm font-medium text-foreground">{preview.counts.metadataEntries} data files, {preview.counts.fileEntries} documents</p></div>
                  </div>
                </div>

                {restoredCounts ? (
                  <div className="mt-5 grid grid-cols-2 gap-3 rounded-md bg-muted/55 p-4 sm:grid-cols-4">
                    {[
                      ["Courses", restoredCounts.courses],
                      ["Library files", restoredCounts.attachments],
                      ["Study notes", restoredCounts.notes],
                      ["Sticky notes", restoredCounts.stickyNotes],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-lg font-semibold text-foreground">{value}</p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {restoredMatchesPreview ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"><CheckCircle2 className="h-4 w-4" /> Restore complete</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => void drive.prepareRestorePreview()} disabled={drive.isBusy}>
                        {drive.isBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check for newer backup
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" onClick={() => setShowRestoreConfirmation(true)} disabled={drive.isBusy || !canConfirmRestore}>
                      {drive.isBusy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restore now
                    </Button>
                  )}
                </div>
              </>
            ) : hasNoBackup ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">No MyVault backup in this account</p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                    This is a fresh Google account. You can use MyVault normally; website changes stay on this computer until this account has its first Drive backup.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void drive.restoreMetadata()} disabled={drive.isBusy}>
                  {drive.isBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Check again
                </Button>
              </div>
            ) : hasIncompleteBackup ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Incomplete MyVault backup</p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Run a fresh Google Drive backup from MyVault Android, then check this account again.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void drive.restoreMetadata()} disabled={drive.isBusy}>
                  {drive.isBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Check again
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Restore from Google Drive</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">MyVault will find this account's latest Android backup and restore its courses, Study notes, and Library records.</p>
                </div>
                <Button type="button" size="sm" onClick={() => setShowRestoreConfirmation(true)} disabled={drive.isBusy || !canConfirmRestore} data-testid="restore-from-google-drive">
                  {drive.isBusy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  {drive.isBusy ? "Restoring" : "Restore from Drive"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <AlertDialog open={showRestoreConfirmation} onOpenChange={setShowRestoreConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from {verifiedAccountLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              MyVault verified this Google account before reading its backup. The restored workspace in this browser will be replaced with this account&apos;s latest Android backup. Nothing in Google Drive will be changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restoreConfirmedAccount()} disabled={!canConfirmRestore}>
              <RotateCcw /> Restore this account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showSwitchConfirmation} onOpenChange={setShowSwitchConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use another Google account?</AlertDialogTitle>
            <AlertDialogDescription>
              MyVault will verify the other account before reading its Drive. This account's local browser vault remains stored and will be available again when you reconnect it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSwitching}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void switchAccount()} disabled={isSwitching}>
              {isSwitching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Choose account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDisconnectConfirmation} onOpenChange={setShowDisconnectConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Drive?</AlertDialogTitle>
            <AlertDialogDescription>
              MyVault will stop using this Google Drive account. Its local browser vault remains on this device, and nothing in Google Drive will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disconnect()} disabled={isDisconnecting}>
              {isDisconnecting ? <Loader2 className="animate-spin" /> : <LogOut />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
