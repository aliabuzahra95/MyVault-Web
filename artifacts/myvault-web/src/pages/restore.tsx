import type { ElementType } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudUpload,
  Database,
  Download,
  FileArchive,
  FileCheck2,
  FileBox,
  FileText,
  Folder,
  GraduationCap,
  HardDrive,
  Library,
  ListChecks,
  Loader2,
  Play,
  SearchCheck,
  ShieldCheck,
  Wifi,
  XCircle,
} from "lucide-react";
import { restorePreview, restoreSteps } from "@/mocks/islamicWeb";
import { driveLayout, driveManifest, metadataFiles, restoreDataGroups } from "@/lib/restore/driveRestoreMap";
import type { MyVaultDriveScan } from "@/lib/googleDrive/driveClient";
import { useGoogleDriveConnection, type GoogleDriveConnectionStatus } from "@/hooks/useGoogleDriveConnection";
import { formatBytes, type DriveManifestPreview } from "@/lib/restore/driveManifestPreview";
import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { googleOAuthSetup } from "@/lib/googleDrive/oauthSetup";
import { cn } from "@/lib/utils";

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 text-slate-600" />
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

type RestoreStepState = "complete" | "active" | "waiting";

function RestoreStage({ index, label, state }: { index: number; label: string; state: RestoreStepState }) {
  const active = state === "active";
  const complete = state === "complete";

  return (
    <div
      className={cn(
        "min-h-[112px] rounded-md border p-4",
        active || complete ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-600",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold">{index + 1}</span>
        {complete ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        ) : active ? (
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-slate-300" />
        )}
      </div>
      <p className="mt-5 text-sm font-bold leading-5">{label}</p>
    </div>
  );
}

function RestoreMapPreview() {
  return (
    <section id="restore-map" className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950">Drive map</h2>
            <p className="mt-1 text-sm text-slate-500">{driveManifest.fileName} is the table of contents.</p>
          </div>
          <Folder className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="space-y-3">
          {driveLayout.map((item) => (
            <div key={item.path} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-sm font-bold text-slate-900">{item.path}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.purpose}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950">Metadata groups</h2>
            <p className="mt-1 text-sm text-slate-500">{metadataFiles.length} JSON files are expected from Android export.</p>
          </div>
          <ListChecks className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {restoreDataGroups.map((group) => (
            <div key={group.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-sm font-bold text-slate-900">{group.label}</p>
              <p className="mt-1 text-xs text-slate-500">{group.files.length} metadata file(s)</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function getPrimaryActionLabel(status: GoogleDriveConnectionStatus, hasToken: boolean, hasScan: boolean) {
  if (status === "setup-needed") {
    return "Google Setup Needed";
  }

  if (status === "connecting") {
    return "Connecting...";
  }

  if (status === "scanning") {
    return "Scanning Drive...";
  }

  if (status === "reading-manifest") {
    return "Reading Manifest...";
  }

  if (status === "restoring-metadata") {
    return "Restoring Metadata...";
  }

  if (status === "preview-ready") {
    return "Refresh Restore Preview";
  }

  if (status === "metadata-restored") {
    return "Refresh Drive Scan";
  }

  if (hasScan) {
    return "Read Restore Manifest";
  }

  if (hasToken) {
    return "Prepare Restore Preview";
  }

  return "Connect & Scan Drive";
}

function getConnectionBadge(status: GoogleDriveConnectionStatus) {
  switch (status) {
    case "setup-needed":
      return { label: "Setup needed", className: "border-amber-200 bg-amber-50 text-amber-700" };
    case "connecting":
    case "scanning":
    case "reading-manifest":
      return { label: "Working", className: "border-sky-200 bg-sky-50 text-sky-700" };
    case "connected":
      return { label: "Connected", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "no-backup":
      return { label: "No backup found", className: "border-slate-200 bg-slate-50 text-slate-600" };
    case "ready":
      return { label: "Manifest found", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "preview-ready":
      return { label: "Preview ready", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "restoring-metadata":
      return { label: "Restoring", className: "border-sky-200 bg-sky-50 text-sky-700" };
    case "metadata-restored":
      return { label: "Metadata restored", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "error":
      return { label: "Needs attention", className: "border-red-200 bg-red-50 text-red-700" };
    case "idle":
      return { label: "Not connected", className: "border-slate-200 bg-slate-50 text-slate-600" };
  }
}

function getRestoreStageStates(
  status: GoogleDriveConnectionStatus,
  hasToken: boolean,
  scan: MyVaultDriveScan | null,
  manifestPreview: DriveManifestPreview | null,
  metadataRestore: MetadataRestoreBundle | null,
): RestoreStepState[] {
  const states: RestoreStepState[] = ["active", "waiting", "waiting", "waiting", "waiting"];

  if (hasToken || status === "ready") {
    states[0] = "complete";
    states[1] = "active";
  }

  if (status === "scanning") {
    states[0] = "complete";
    states[1] = "active";
  }

  if (scan?.manifestFile) {
    states[0] = "complete";
    states[1] = "complete";
    states[2] = "active";
  }

  if (status === "reading-manifest") {
    states[0] = "complete";
    states[1] = "complete";
    states[2] = "active";
  }

  if (manifestPreview) {
    states[0] = "complete";
    states[1] = "complete";
    states[2] = "active";
  }

  if (status === "restoring-metadata") {
    states[0] = "complete";
    states[1] = "complete";
    states[2] = "active";
  }

  if (metadataRestore || status === "metadata-restored") {
    states[0] = "complete";
    states[1] = "complete";
    states[2] = "complete";
    states[3] = "active";
  }

  return states;
}

function formatDriveDate(value?: string) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function DriveScanRow({
  icon: Icon,
  label,
  value,
  detail,
  state,
}: {
  icon: ElementType;
  label: string;
  value: string;
  detail: string;
  state: "found" | "missing" | "waiting" | "active";
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            state === "found" && "bg-emerald-50 text-emerald-700",
            state === "missing" && "bg-amber-50 text-amber-700",
            state === "active" && "bg-sky-50 text-sky-700",
            state === "waiting" && "bg-white text-slate-500",
          )}
        >
          <Icon className={cn("h-4 w-4", state === "active" && "animate-pulse")} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 break-words text-sm font-bold text-slate-950">{value}</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-500">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function DriveConnectionPanel({
  status,
  isConfigured,
  hasToken,
  scan,
  error,
  driveScope,
}: {
  status: GoogleDriveConnectionStatus;
  isConfigured: boolean;
  hasToken: boolean;
  scan: MyVaultDriveScan | null;
  error: string | null;
  driveScope: string;
}) {
  const badge = getConnectionBadge(status);
  const rootFound = scan?.rootFolder !== undefined ? scan.rootFolder !== null : false;
  const manifestFound = scan?.manifestFile !== undefined ? scan.manifestFile !== null : false;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-base font-bold text-slate-950">Google Drive connection</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            This checks your Drive map first. Downloading and restoring the actual data comes after this is proven.
          </p>
        </div>
        <span className={cn("inline-flex h-8 items-center rounded-md border px-3 text-xs font-bold", badge.className)}>{badge.label}</span>
      </div>

      {error && (
        <div className="mt-5 flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isConfigured && (
        <div className="mt-5 rounded-md border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-bold text-emerald-950">OAuth setup values</p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-emerald-900">
                Create a Google Cloud OAuth client with these values, then paste the client ID into the local environment file.
              </p>
            </div>
            <a
              href="https://console.developers.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50"
            >
              Open Google Clients
            </a>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-emerald-100 bg-white px-3 py-3">
              <p className="text-xs font-semibold text-emerald-700">Project found in Android app</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-950">{googleOAuthSetup.detectedAndroidProjectId}</p>
            </div>
            <div className="rounded-md border border-emerald-100 bg-white px-3 py-3">
              <p className="text-xs font-semibold text-emerald-700">Application type</p>
              <p className="mt-1 text-sm font-bold text-slate-950">{googleOAuthSetup.clientType}</p>
            </div>
            <div className="rounded-md border border-emerald-100 bg-white px-3 py-3 md:col-span-2">
              <p className="text-xs font-semibold text-emerald-700">Authorized JavaScript origins</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-950">{googleOAuthSetup.localOrigins.join("  |  ")}</p>
            </div>
            <div className="rounded-md border border-emerald-100 bg-white px-3 py-3 md:col-span-2">
              <p className="text-xs font-semibold text-emerald-700">Where the client ID goes</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-950">
                {googleOAuthSetup.clientIdEnvName} in {googleOAuthSetup.clientIdEnvFile}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DriveScanRow
          icon={ShieldCheck}
          label="Web setup"
          value={isConfigured ? "Client ID loaded" : "Client ID missing"}
          detail={isConfigured ? "The browser can ask Google for Drive permission." : "Add the Google client ID before sign-in can open."}
          state={isConfigured ? "found" : "missing"}
        />
        <DriveScanRow
          icon={Wifi}
          label="Google session"
          value={hasToken ? "Connected for this session" : "Not connected"}
          detail={hasToken ? `Drive scope: ${driveScope}` : "The token is requested only after you press the restore button."}
          state={status === "connecting" ? "active" : hasToken ? "found" : "waiting"}
        />
        <DriveScanRow
          icon={Folder}
          label="MyVault folder"
          value={rootFound ? "MyVault found" : scan ? "MyVault missing" : "Not scanned yet"}
          detail={rootFound ? "The website can see the root Drive folder." : "This will look for the Android MyVault folder."}
          state={status === "scanning" ? "active" : rootFound ? "found" : scan ? "missing" : "waiting"}
        />
        <DriveScanRow
          icon={Database}
          label="Sync manifest"
          value={manifestFound ? driveManifest.fileName : scan ? "Manifest missing" : "Not scanned yet"}
          detail={manifestFound ? `Modified ${formatDriveDate(scan?.manifestFile?.modifiedTime)}` : "This file tells the website what to restore."}
          state={status === "scanning" ? "active" : manifestFound ? "found" : scan ? "missing" : "waiting"}
        />
      </div>

      {scan?.missingPaths.length ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-bold text-slate-900">Still missing from the Drive map</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">{scan.missingPaths.join(", ")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PreviewStat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ElementType;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{label}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function ManifestPreviewPanel({
  status,
  manifestPreview,
}: {
  status: GoogleDriveConnectionStatus;
  manifestPreview: DriveManifestPreview | null;
}) {
  const waiting = !manifestPreview;
  const waitingText =
    status === "reading-manifest"
      ? "Reading the Drive manifest now."
      : "Once Google Drive is connected, this section will show the restore preview from sync_manifest.json.";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-base font-bold text-slate-950">Manifest preview</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            This is the restore table of contents. It is checked before any metadata or Library files are restored.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-8 items-center rounded-md border px-3 text-xs font-bold",
            manifestPreview ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          {manifestPreview ? "Loaded" : "Waiting"}
        </span>
      </div>

      {waiting ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
          <div className="flex items-start gap-3">
            <FileCheck2 className={cn("mt-0.5 h-5 w-5 shrink-0 text-slate-500", status === "reading-manifest" && "animate-pulse text-sky-700")} />
            <div>
              <p className="text-sm font-bold text-slate-900">No manifest preview yet</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">{waitingText}</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <PreviewStat
              icon={ListChecks}
              label="Metadata entries"
              value={String(manifestPreview.counts.metadataEntries)}
              detail={`${manifestPreview.counts.requiredMetadataPresent}/${manifestPreview.counts.requiredMetadataTotal} required files present`}
            />
            <PreviewStat
              icon={Download}
              label="Library file entries"
              value={String(manifestPreview.counts.fileEntries)}
              detail={`${formatBytes(manifestPreview.fileBytes)} expected from Drive`}
            />
            <PreviewStat
              icon={HardDrive}
              label="Total restore size"
              value={formatBytes(manifestPreview.totalBytes)}
              detail={`${manifestPreview.counts.totalEntries} total manifest entries`}
            />
            <PreviewStat
              icon={Clock3}
              label="Cloud version"
              value={String(manifestPreview.manifest.cloudVersion)}
              detail="Android writes this when Drive sync completes"
            />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {manifestPreview.groups.map((group) => (
              <div key={group.label} className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-950">{group.label}</p>
                  <span
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-bold",
                      group.missing.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
                    )}
                  >
                    {group.present}/{group.total}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {group.missing.length === 0 ? "Ready in the manifest." : `Missing: ${group.missing.slice(0, 3).join(", ")}${group.missing.length > 3 ? "..." : ""}`}
                </p>
              </div>
            ))}
          </div>

          {manifestPreview.missingRequiredMetadata.length || manifestPreview.issues.length ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
                <div>
                  <p className="text-sm font-bold text-amber-950">Review before restore</p>
                  <p className="mt-1 text-sm leading-6 text-amber-900">
                    {[...manifestPreview.missingRequiredMetadata.map((file) => `Missing required metadata: ${file}`), ...manifestPreview.issues].slice(0, 4).join(" ")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function MetadataCountCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: ElementType;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{label}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function MetadataRestorePanel({
  status,
  manifestPreview,
  metadataRestore,
  isBusy,
  onRestore,
}: {
  status: GoogleDriveConnectionStatus;
  manifestPreview: DriveManifestPreview | null;
  metadataRestore: MetadataRestoreBundle | null;
  isBusy: boolean;
  onRestore: () => void;
}) {
  const isRestoring = status === "restoring-metadata";
  const requiredMissing = manifestPreview ? manifestPreview.missingRequiredMetadata.length > 0 : false;
  const canRestore = Boolean(manifestPreview) && !requiredMissing && !isBusy;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-base font-bold text-slate-950">Metadata restore</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            This downloads the small JSON files first. It does not change Drive and it does not download the large Library files yet.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-8 items-center rounded-md border px-3 text-xs font-bold",
            metadataRestore ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          {metadataRestore ? "Restored locally" : manifestPreview ? "Ready" : "Waiting"}
        </span>
      </div>

      {!manifestPreview ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
            <div>
              <p className="text-sm font-bold text-slate-900">Restore preview first</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">Press the Google Drive restore button above so the website can read the manifest.</p>
            </div>
          </div>
        </div>
      ) : metadataRestore ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetadataCountCard icon={GraduationCap} label="Courses" value={metadataRestore.counts.courses} detail="From courses.json" />
            <MetadataCountCard icon={Folder} label="Folders" value={metadataRestore.counts.folders} detail="Study, Library, and course folders" />
            <MetadataCountCard icon={FileText} label="Notes" value={metadataRestore.counts.notes} detail={`${metadataRestore.counts.blocks} note blocks restored`} />
            <MetadataCountCard icon={FileBox} label="Attachments" value={metadataRestore.counts.attachments} detail="Metadata only; large files come later" />
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="text-sm font-bold text-emerald-950">Metadata restored to this browser</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-900">
                    Restored {metadataRestore.metadataFileCount} metadata files on {formatDriveDate(metadataRestore.restoredAt)}.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-emerald-900">
                    You can now open Dashboard, Courses, Library, or Study to see restored metadata. Large Library files still need the next restore step.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metadataRestore.groupSummaries.map((group) => (
                <div key={group.label} className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <p className="text-xs font-semibold text-slate-500">{group.label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-950">
                    {group.filesRestored} file(s), {group.itemCount} item(s)
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-emerald-950">The preview is ready. Now restore the metadata.</p>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                This will copy courses, folders, notes, tags, attachment records, PDF progress, and annotation records into the web app storage on this computer.
              </p>
              {requiredMissing ? (
                <p className="mt-2 text-sm font-semibold text-amber-800">A required metadata file is missing, so restore is paused until the manifest is complete.</p>
              ) : null}
            </div>
            <button
              className={cn(
                "inline-flex h-11 shrink-0 items-center justify-center gap-3 rounded-md px-5 text-sm font-bold text-white shadow-[0_10px_18px_rgba(6,95,70,0.18)] transition",
                canRestore ? "bg-emerald-800 hover:bg-emerald-900" : "cursor-not-allowed bg-slate-400 shadow-none",
              )}
              disabled={!canRestore}
              onClick={onRestore}
            >
              {isRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isRestoring ? "Restoring metadata..." : "Restore Metadata to This Browser"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function RestorePage() {
  const driveConnection = useGoogleDriveConnection();
  const hasToken = driveConnection.token !== null;
  const stageStates = getRestoreStageStates(driveConnection.status, hasToken, driveConnection.scan, driveConnection.manifestPreview, driveConnection.metadataRestore);
  const actionLabel = getPrimaryActionLabel(driveConnection.status, hasToken, driveConnection.scan !== null);
  const previewCards = driveConnection.metadataRestore
    ? [
        { label: "Courses", value: driveConnection.metadataRestore.counts.courses, icon: GraduationCap },
        { label: "Library files", value: driveConnection.metadataRestore.counts.attachments, icon: Library },
        { label: "Study notes", value: driveConnection.metadataRestore.counts.notes, icon: FileText },
        { label: "Sticky notes", value: driveConnection.metadataRestore.counts.stickyNotes, icon: FileCheck2 },
      ]
    : restorePreview;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-5 py-6 md:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
        <div className="grid gap-7 lg:grid-cols-[1fr_0.75fr]">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <div className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
              <CloudUpload className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-normal text-emerald-700">Google Drive restore</p>
              <h1 className="mt-2 text-[28px] font-bold tracking-normal text-slate-950">Ready to restore</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                The first real bridge between your Android MyVault Islamic Corpus and this web app starts here.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-3 rounded-md px-6 text-sm font-bold text-white shadow-[0_10px_18px_rgba(6,95,70,0.22)] transition",
                    driveConnection.isConfigured ? "bg-emerald-800 hover:bg-emerald-900" : "cursor-not-allowed bg-slate-400 shadow-none",
                  )}
                  disabled={driveConnection.isBusy || !driveConnection.isConfigured}
                  onClick={() => void driveConnection.prepareRestorePreview()}
                >
                  {driveConnection.isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasToken ? (
                    <SearchCheck className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {actionLabel}
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-3 rounded-md border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => document.getElementById("restore-map")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <FileArchive className="h-4 w-4" />
                  View Backup Details
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3 lg:grid-cols-1">
            <SummaryRow icon={Clock3} label="Last modified" value="8 Jul 2025, 6:42 PM" />
            <SummaryRow icon={HardDrive} label="Backup size" value="2.48 GB" />
            <SummaryRow icon={FileBox} label="Contents" value="Courses, Library, Study, Quran" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {previewCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Icon className="h-5 w-5" />
            </div>
            <p className="mt-5 text-3xl font-bold text-slate-950">{value}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <DriveConnectionPanel
        status={driveConnection.status}
        isConfigured={driveConnection.isConfigured}
        hasToken={hasToken}
        scan={driveConnection.scan}
        error={driveConnection.error}
        driveScope={driveConnection.driveScope}
      />

      <ManifestPreviewPanel status={driveConnection.status} manifestPreview={driveConnection.manifestPreview} />

      <MetadataRestorePanel
        status={driveConnection.status}
        manifestPreview={driveConnection.manifestPreview}
        metadataRestore={driveConnection.metadataRestore}
        isBusy={driveConnection.isBusy}
        onRestore={() => void driveConnection.restoreMetadata()}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-950">Restore process</h2>
            <p className="mt-1 text-sm text-slate-500">
              Read-only first, then review before anything writes back. Google may ask you to sign in again only when refreshing Drive.
            </p>
          </div>
          <GraduationCap className="hidden h-5 w-5 text-emerald-700 sm:block" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {restoreSteps.map((step, index) => (
            <RestoreStage key={step.id} index={index} label={step.label} state={stageStates[index] ?? "waiting"} />
          ))}
        </div>
      </section>

      <RestoreMapPreview />

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          { title: "Backup package", text: "Reads the Android backup structure and restores the corpus in a controlled order.", icon: FileArchive },
          { title: "Download queue", text: "Library files will be checked before they are stored in the web app.", icon: Download },
          { title: "Read-only review", text: "The website will not push changes back to Drive until restore is proven safe.", icon: ShieldCheck },
        ].map(({ title, text, icon: Icon }) => (
          <div key={title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_6px_20px_rgba(15,23,42,0.035)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-bold text-slate-950">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
