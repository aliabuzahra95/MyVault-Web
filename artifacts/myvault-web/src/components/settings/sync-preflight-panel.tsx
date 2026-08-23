import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileCheck2, Loader2, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { runSyncPreflight, type SyncPreflight } from "@/lib/sync/syncPreflight";
import {
  writeWebsiteChangesToDrive,
  type DriveWriteBackProgress,
  type DriveWriteBackResult,
} from "@/lib/sync/driveWriteBack";
import { requestGoogleDriveToken } from "@/lib/googleDrive/identity";

const CHANGE_LABELS: Array<[keyof SyncPreflight["counts"], string]> = [
  ["noteDrafts", "Edited notes"],
  ["createdNotes", "New notes"],
  ["createdFolders", "New folders"],
  ["createdAttachments", "New PDFs"],
  ["pdfReaderStates", "Reading positions"],
  ["pdfAnnotationChanges", "PDF annotations"],
  ["courses", "New courses"],
  ["courseFolders", "Course folders"],
  ["courseStickyNotes", "Course sticky notes"],
  ["courseConcepts", "Course concepts"],
];

function downloadReport(preflight: SyncPreflight) {
  const { preparedFiles: _preparedFiles, ...report } = preflight;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `myvault-sync-preflight-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SyncPreflightPanel() {
  const [preflight, setPreflight] = useState<SyncPreflight | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadConfirmation, setShowUploadConfirmation] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<DriveWriteBackProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<DriveWriteBackResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const checkCompatibility = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      setPreflight(await runSyncPreflight());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The compatibility check could not be completed.");
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkCompatibility();
  }, [checkCompatibility]);

  const uploadToDrive = async () => {
    setShowUploadConfirmation(false);
    setUploadError(null);
    setUploadResult(null);
    setUploadProgress({ phase: "checking", completedFiles: 0, totalFiles: 0, currentFileName: null });
    try {
      const token = await requestGoogleDriveToken({ interactive: true });
      const result = await writeWebsiteChangesToDrive({
        accessToken: token.accessToken,
        onProgress: setUploadProgress,
      });
      setUploadResult(result);
      await checkCompatibility();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "The Google Drive backup could not be completed.");
      setUploadProgress(null);
    }
  };

  const status = preflight?.status;
  const StatusIcon = status === "ready" || status === "initial_backup" ? CheckCircle2 : status === "blocked" ? AlertCircle : FileCheck2;
  const activeCounts = preflight ? CHANGE_LABELS.filter(([key]) => preflight.counts[key] > 0) : [];
  const isUploading = uploadProgress !== null && uploadProgress.phase !== "complete";

  return (
    <section aria-labelledby="sync-preflight-title" data-testid="sync-preflight-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="sync-preflight-title" className="text-sm font-semibold text-foreground">Website changes</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
              <ShieldCheck className="h-3 w-3" /> Android protected
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Review website edits before merging them into the latest Android-compatible Google Drive backup.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void checkCompatibility()}
          disabled={isChecking}
          data-testid="run-sync-preflight"
        >
          {isChecking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {isChecking ? "Checking" : "Check again"}
        </Button>
      </div>

      <div className="mt-5 rounded-lg bg-card/65 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        {isChecking && !preflight ? (
          <div className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Inspecting local changes and restored metadata…
          </div>
        ) : error ? (
          <div className="flex min-h-24 items-start gap-3" role="alert">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div><p className="text-sm font-semibold text-foreground">Compatibility check failed</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div>
          </div>
        ) : preflight ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  status === "ready" || status === "initial_backup" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : status === "blocked" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                )}>
                  <StatusIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground" data-testid="sync-preflight-status">
                    {status === "ready"
                      ? "Compatible with the Android backup"
                      : status === "initial_backup"
                        ? "Ready to create your first backup"
                      : status === "blocked"
                        ? "Needs attention before sync"
                        : status === "local_only"
                          ? "Website changes saved on this computer"
                          : "No website changes waiting"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {status === "ready"
                      ? `${preflight.totalPendingChanges} website change${preflight.totalPendingChanges === 1 ? "" : "s"} can be merged without replacing untouched Android data.`
                      : status === "initial_backup"
                        ? `${preflight.totalPendingChanges} website change${preflight.totalPendingChanges === 1 ? "" : "s"} will become this account's first Android-compatible MyVault backup.`
                      : status === "blocked"
                        ? "Nothing has been uploaded. Resolve the items below and run the check again."
                        : status === "local_only"
                          ? "No Android backup is currently restored in this browser. Your work remains local and nothing has been uploaded."
                          : "Your restored Android metadata has no pending web edits to merge."}
                  </p>
                </div>
              </div>
              {status === "ready" || status === "initial_backup" || status === "blocked" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => downloadReport(preflight)} data-testid="download-sync-report">
                  <Download /> Download report
                </Button>
              ) : null}
            </div>

            {activeCounts.length ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/45 pt-4 sm:grid-cols-3 lg:grid-cols-5">
                {activeCounts.map(([key, label]) => (
                  <div key={key}>
                    <p className="text-lg font-semibold text-foreground">{preflight.counts[key]}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {preflight.blockers.length ? (
              <div className="space-y-2" data-testid="sync-preflight-blockers">
                {preflight.blockers.map((blocker) => (
                  <div key={blocker} className="flex items-start gap-2 rounded-md bg-destructive/7 px-3 py-2 text-sm text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> {blocker}
                  </div>
                ))}
              </div>
            ) : null}

            {preflight.touchedFiles.length ? (
              <div className="border-t border-border/45 pt-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Dry-run merge</p>
                  <p className="text-xs text-muted-foreground" data-testid="preserved-file-count">
                    {preflight.preservedMetadataFiles} of {preflight.sourceMetadataFiles} restored metadata files remain untouched
                  </p>
                </div>
                <div className="mt-3 divide-y divide-border/35">
                  {preflight.touchedFiles.map((file) => (
                    <div key={file.fileName} className="flex min-h-10 items-center justify-between gap-4 py-2 text-sm" data-testid={`sync-file-${file.fileName}`}>
                      <span className="font-medium text-foreground">{file.fileName}</span>
                      <span className="text-right text-xs text-muted-foreground">
                        {file.changedRows ? `${file.changedRows} updated` : ""}
                        {file.changedRows && file.addedRows ? ", " : ""}
                        {file.addedRows ? `${file.addedRows} added` : ""}
                        {(file.changedRows || file.addedRows) && file.removedRows ? ", " : ""}
                        {file.removedRows ? `${file.removedRows} removed` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {preflight.warnings.length ? (
              <div className="space-y-2 border-t border-border/45 pt-4">
                {preflight.warnings.map((warning) => <p key={warning} className="text-xs leading-5 text-muted-foreground">{warning}</p>)}
              </div>
            ) : null}

            <div className="border-t border-border/45 pt-4" data-testid="drive-write-back">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <UploadCloud className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {status === "initial_backup" ? "Create the first Google Drive backup" : status === "local_only" ? "No website changes to back up" : "Back up website changes to Google Drive"}
                    </p>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                      {status === "initial_backup"
                        ? "This Google account does not need an Android backup first. MyVault Web will create the compatible Drive folders, metadata, and manifest for you."
                        : status === "local_only"
                          ? "Create a note, folder, course, or PDF first. Then this account can create its first Google Drive backup."
                        : "MyVault checks the latest Android cloud version again, uploads changed files first, and switches the Drive manifest only after every upload succeeds."}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowUploadConfirmation(true)}
                  disabled={(status !== "ready" && status !== "initial_backup") || isUploading}
                  data-testid="backup-to-google-drive"
                >
                  {isUploading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
                  {isUploading ? "Backing up" : status === "initial_backup" ? "Create first backup" : "Back up to Drive"}
                </Button>
              </div>

              {isUploading && uploadProgress ? (
                <div className="mt-4" aria-live="polite" data-testid="drive-write-progress">
                  <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <span className="truncate">
                      {uploadProgress.phase === "checking" ? "Checking the latest Android backup"
                        : uploadProgress.phase === "preparing" ? "Preparing website changes"
                          : uploadProgress.phase === "committing" ? "Committing the new Drive version"
                            : `Uploading ${uploadProgress.currentFileName ?? "file"}`}
                    </span>
                    {uploadProgress.totalFiles ? <span className="shrink-0">{uploadProgress.completedFiles} of {uploadProgress.totalFiles}</span> : null}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${uploadProgress.totalFiles ? Math.max(4, (uploadProgress.completedFiles / uploadProgress.totalFiles) * 100) : 4}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {uploadResult?.status === "uploaded" ? (
                <div className="mt-4 flex items-start gap-2 rounded-md bg-emerald-500/8 px-3 py-2 text-xs leading-5 text-foreground" role="status" data-testid="drive-write-complete">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                  <span>
                    Google Drive backup complete. Uploaded {uploadResult.uploadedMetadataFiles} metadata file{uploadResult.uploadedMetadataFiles === 1 ? "" : "s"}
                    {uploadResult.uploadedAttachmentFiles ? ` and ${uploadResult.uploadedAttachmentFiles} PDF file${uploadResult.uploadedAttachmentFiles === 1 ? "" : "s"}` : ""}.
                    {!uploadResult.localStateUpdated ? " Drive is safe, but refresh this website and restore the latest metadata before editing again." : " Android can now restore this cloud version."}
                  </span>
                </div>
              ) : null}

              {uploadError ? (
                <div className="mt-4 flex flex-col gap-3 rounded-md bg-destructive/7 px-3 py-3 text-xs leading-5 text-foreground sm:flex-row sm:items-start sm:justify-between" role="alert" data-testid="drive-write-error">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>{uploadError}</span>
                  </div>
                  {uploadError.includes("newer Google Drive backup") ? (
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => { window.location.href = "/settings#google-drive"; }}>
                      Restore latest
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {status !== "local_only" ? (
              <p className="border-t border-border/45 pt-4 text-xs leading-5 text-muted-foreground">
                Restored cloud version {preflight.sourceCloudVersion ?? "not available"}. Upload is manual and never runs silently in the background.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <AlertDialog open={showUploadConfirmation} onOpenChange={setShowUploadConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{status === "initial_backup" ? "Create your first MyVault backup?" : "Back up website changes to Google Drive?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {status === "initial_backup"
                ? "This will create a new Android-compatible MyVault backup in the connected Google Drive. It will stop if another MyVault backup appears before the upload finishes."
                : "Android remains the source of truth. MyVault will stop before uploading if Android has created a newer backup, and the current Drive manifest will not change unless every staged upload succeeds."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void uploadToDrive()} data-testid="confirm-drive-write-back">
              {status === "initial_backup" ? "Create backup" : "Back up to Drive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
