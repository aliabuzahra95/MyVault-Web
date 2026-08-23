import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { getGetAttachmentQueryKey, getListAttachmentsQueryKey, useGetAttachment } from "@workspace/api-client-react";
import type { Attachment } from "@workspace/api-client-react";
import { ArrowLeft, CloudDownload, FileText, Loader2, Pin } from "lucide-react";
import { PageContainer } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadDriveFileBlob,
  downloadDriveFileJson,
  findMyVaultDriveMap,
  isGoogleDriveAuthorizationError,
} from "@/lib/googleDrive/driveClient";
import {
  clearCachedGoogleDriveToken,
  getCachedGoogleDriveToken,
  hasPreviousGoogleDriveAuthorization,
  requestGoogleDriveToken,
  type GoogleDriveToken,
} from "@/lib/googleDrive/identity";
import { cacheAttachmentManifestEntries, getAttachmentFileClaim } from "@/lib/restore/attachmentFileRestore";
import { parseDriveSyncManifest } from "@/lib/restore/driveManifestPreview";
import { recordRecentActivity } from "@/lib/recentActivity";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import {
  loadLocalAttachmentBlob,
  saveLocalAttachmentBlob,
  loadLocalPdfAnnotationChanges,
  loadLocalPdfReaderState,
  deleteLocalPdfAnnotation,
  saveLocalPdfAnnotation,
  saveLocalPdfReaderState,
  type LocalPdfAnnotationChange,
  type LocalPdfReaderState,
} from "@/lib/restore/localRestoreStore";
import type { PdfReaderProgress } from "@/components/library/pdf-document-viewer";
import type { RestoredPdfAnnotation } from "@/lib/restore/restoredCorpus";

const PdfDocumentViewer = lazy(() =>
  import("@/components/library/pdf-document-viewer").then((module) => ({ default: module.PdfDocumentViewer })),
);

type ReaderStatus = "idle" | "connecting" | "locating" | "downloading" | "ready" | "error";

const pdfSessionCache = new Map<string, Blob>();

function pdfSessionCacheKey(attachment: Attachment) {
  return attachment.id;
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryDocumentPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: attachment, isLoading } = useGetAttachment(id);
  const { corpus, isLoading: restoredCorpusLoading } = useRestoredCorpus();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [initialReaderState, setInitialReaderState] = useState<LocalPdfReaderState | null>(null);
  const [readerStateLoaded, setReaderStateLoaded] = useState(false);
  const [annotationChanges, setAnnotationChanges] = useState<LocalPdfAnnotationChange[]>([]);
  const [annotationChangesLoaded, setAnnotationChangesLoaded] = useState(false);
  const checkedLocalAttachmentId = useRef<string | null>(null);
  const activeAttachmentId = useRef(id);
  const progressWriteQueue = useRef(Promise.resolve());
  const annotationWriteQueue = useRef(Promise.resolve());

  activeAttachmentId.current = id;

  useEffect(() => {
    setFileUrl(null);
    setStatus("idle");
    setError(null);
    setInitialReaderState(null);
    setReaderStateLoaded(false);
    setAnnotationChanges([]);
    setAnnotationChangesLoaded(false);
    checkedLocalAttachmentId.current = null;
    progressWriteQueue.current = Promise.resolve();
    annotationWriteQueue.current = Promise.resolve();
  }, [id]);

  useEffect(() => {
    if (attachment?.id === id) recordRecentActivity("document", attachment.id);
  }, [attachment?.id, id]);

  useEffect(() => {
    if (!id || restoredCorpusLoading) return;
    let cancelled = false;
    setReaderStateLoaded(false);
    void loadLocalPdfReaderState(id)
      .then((localState) => {
        if (cancelled) return;
        if (localState) {
          setInitialReaderState(localState);
          return;
        }
        const restoredState = corpus?.pdfReadingProgress[id];
        setInitialReaderState(restoredState ? {
          schemaVersion: 1,
          attachmentId: id,
          pageIndex: restoredState.pageIndex,
          pageCount: restoredState.pageCount,
          progressPercent: restoredState.progressPercent,
          zoom: 1,
          lastOpenedAt: restoredState.lastOpenedAt,
          updatedAt: restoredState.updatedAt,
          pendingDriveSync: true,
        } : null);
      })
      .finally(() => {
        if (!cancelled) setReaderStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [corpus, id, restoredCorpusLoading]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setAnnotationChangesLoaded(false);
    void loadLocalPdfAnnotationChanges(id)
      .then((changes) => {
        if (!cancelled) setAnnotationChanges(changes);
      })
      .finally(() => {
        if (!cancelled) setAnnotationChangesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const annotations = useMemo(() => {
    const merged = new Map(
      (corpus?.pdfAnnotations ?? [])
        .filter((annotation) => annotation.attachmentId === id)
        .map((annotation) => [annotation.id, annotation]),
    );
    annotationChanges.forEach((change) => {
      if (change.operation === "delete") merged.delete(change.id);
      else if (change.annotation) merged.set(change.id, change.annotation);
    });
    return [...merged.values()];
  }, [annotationChanges, corpus?.pdfAnnotations, id]);

  const handleUpsertAnnotation = useCallback((annotation: RestoredPdfAnnotation) => {
    const change: LocalPdfAnnotationChange = {
      schemaVersion: 1,
      id: annotation.id,
      attachmentId: annotation.attachmentId,
      operation: "upsert",
      annotation,
      savedAt: Date.now(),
      pendingDriveSync: true,
    };
    const write = annotationWriteQueue.current
      .catch(() => undefined)
      .then(() => saveLocalPdfAnnotation(annotation));
    annotationWriteQueue.current = write.catch(() => undefined);
    return write.then(() => {
      setAnnotationChanges((current) => [...current.filter((item) => item.id !== annotation.id), change]);
    });
  }, []);

  const handleDeleteAnnotation = useCallback((annotationId: string) => {
    const change: LocalPdfAnnotationChange = {
      schemaVersion: 1,
      id: annotationId,
      attachmentId: id,
      operation: "delete",
      annotation: null,
      savedAt: Date.now(),
      pendingDriveSync: true,
    };
    const write = annotationWriteQueue.current
      .catch(() => undefined)
      .then(() => deleteLocalPdfAnnotation(annotationId, id));
    annotationWriteQueue.current = write.catch(() => undefined);
    return write.then(() => {
      setAnnotationChanges((current) => [...current.filter((item) => item.id !== annotationId), change]);
    });
  }, [id]);

  const handleReadingProgressChange = useCallback((readerProgress: PdfReaderProgress) => {
    if (!id) return;
    const now = Date.now();
    const nextReaderState: LocalPdfReaderState = {
      schemaVersion: 1,
      attachmentId: id,
      pageIndex: readerProgress.pageIndex,
      pageCount: readerProgress.pageCount,
      progressPercent: readerProgress.progressPercent,
      zoom: readerProgress.zoom,
      lastOpenedAt: now,
      updatedAt: now,
      pendingDriveSync: true,
    };
    progressWriteQueue.current = progressWriteQueue.current
      .catch(() => undefined)
      .then(() => saveLocalPdfReaderState(nextReaderState));

    const applyProgress = (current: Attachment | undefined) => current
      ? { ...current, readingProgressPercent: readerProgress.progressPercent, updatedAt: now }
      : current;
    queryClient.setQueryData(getGetAttachmentQueryKey(id), applyProgress);
    queryClient.setQueriesData<Attachment[]>({ queryKey: getListAttachmentsQueryKey() }, (current) => (
      current?.map((item) => item.id === id ? applyProgress(item)! : item)
    ));
  }, [id, queryClient]);

  const openDriveFile = useCallback(async (token: GoogleDriveToken) => {
    if (!attachment || attachment.id !== id) return;
    const requestedAttachmentId = attachment.id;
    setError(null);
    setStatus("locating");

    try {
      const claim = await getAttachmentFileClaim(requestedAttachmentId);
      if (activeAttachmentId.current !== requestedAttachmentId) return;
      if (!claim) {
        throw new Error("This document was listed in the backup, but its actual file was not included by Android MyVault.");
      }

      let manifestEntry = claim.manifestEntry;
      if (!manifestEntry) {
        const scan = await findMyVaultDriveMap(token.accessToken);
        if (!scan.manifestFile) throw new Error("The MyVault sync manifest could not be found in Google Drive.");
        const rawManifest = await downloadDriveFileJson<unknown>(token.accessToken, scan.manifestFile.id);
        const parsed = parseDriveSyncManifest(rawManifest);
        if (!parsed.manifest) throw new Error(parsed.issues[0] ?? "The MyVault sync manifest could not be read.");
        const fileEntries = parsed.manifest.entries.filter((entry) => entry.kind === "file");
        await cacheAttachmentManifestEntries(fileEntries);
        if (activeAttachmentId.current !== requestedAttachmentId) return;
        manifestEntry = fileEntries.find((entry) => entry.backupEntry === claim.backupEntry) ?? null;
      }

      if (!manifestEntry?.cloudFileId) throw new Error("Google Drive does not contain the restored file for this document.");
      setStatus("downloading");
      const blob = await downloadDriveFileBlob(token.accessToken, manifestEntry.cloudFileId, attachment.mimeType);
      pdfSessionCache.set(pdfSessionCacheKey(attachment), blob);
      void saveLocalAttachmentBlob(attachment.id, blob).catch(() => undefined);
      const nextUrl = URL.createObjectURL(blob);
      if (activeAttachmentId.current !== requestedAttachmentId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      setFileUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus("ready");
    } catch (cause) {
      if (activeAttachmentId.current !== requestedAttachmentId) return;
      if (isGoogleDriveAuthorizationError(cause)) clearCachedGoogleDriveToken();
      setStatus("error");
      setError(isGoogleDriveAuthorizationError(cause)
        ? "Your Google Drive session expired. Reconnect once to continue."
        : cause instanceof Error ? cause.message : "The document could not be restored from Google Drive.");
    }
  }, [attachment, id]);

  const connectAndOpen = useCallback(async (interactive = true) => {
    const requestedAttachmentId = id;
    setStatus("connecting");
    setError(null);
    try {
      const token = await requestGoogleDriveToken({ interactive });
      if (activeAttachmentId.current !== requestedAttachmentId) return;
      await openDriveFile(token);
    } catch (cause) {
      if (activeAttachmentId.current !== requestedAttachmentId) return;
      setStatus("error");
      setError(interactive
        ? cause instanceof Error ? cause.message : "Google Drive sign-in did not finish."
        : "Google Drive needs to be reconnected once before this document can open.");
    }
  }, [id, openDriveFile]);

  useEffect(() => {
    if (!attachment || attachment.id !== id || status !== "idle" || checkedLocalAttachmentId.current === attachment.id) return;
    checkedLocalAttachmentId.current = attachment.id;
    let cancelled = false;

    const cachedBlob = pdfSessionCache.get(pdfSessionCacheKey(attachment));
    if (cachedBlob) {
      const nextUrl = URL.createObjectURL(cachedBlob);
      setFileUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    void loadLocalAttachmentBlob(attachment.id)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          pdfSessionCache.set(pdfSessionCacheKey(attachment), blob);
          const nextUrl = URL.createObjectURL(blob);
          setFileUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return nextUrl;
          });
          setStatus("ready");
          return;
        }

        const token = getCachedGoogleDriveToken();
        if (token) {
          void openDriveFile(token);
        } else if (hasPreviousGoogleDriveAuthorization()) {
          void connectAndOpen(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError("The browser could not read this locally stored document.");
      });

    return () => {
      cancelled = true;
    };
  }, [attachment, connectAndOpen, id, openDriveFile, status]);

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  if (isLoading) {
    return <PageContainer><Skeleton className="h-10 w-72" /><Skeleton className="mt-8 h-[70vh] w-full rounded-lg" /></PageContainer>;
  }

  if (!attachment || attachment.id !== id) {
    return <PageContainer><p className="text-sm text-slate-500">This document could not be found.</p></PageContainer>;
  }

  const progress = Math.max(0, Math.min(attachment.readingProgressPercent ?? 0, 100));
  const isPdf = attachment.mimeType.includes("pdf") || attachment.name.toLowerCase().endsWith(".pdf");
  const isBusy = status === "connecting" || status === "locating" || status === "downloading";
  const statusLabel = status === "connecting" ? "Connecting to Google Drive..." : status === "locating" ? "Finding this file..." : "Downloading the document...";

  return (
    <PageContainer className="pb-4">
      <header className="mb-7 flex min-w-0 items-start gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/library")} aria-label="Back to Library" className="mt-0.5 shrink-0 text-slate-500">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-slate-950">{attachment.name}</h1>
            {attachment.isPinned ? <Pin className="h-4 w-4 shrink-0 text-amber-600" /> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">{attachment.mimeType} · {formatBytes(attachment.sizeBytes)}</p>
        </div>
      </header>

      {fileUrl && isPdf && readerStateLoaded && annotationChangesLoaded ? (
        <Suspense fallback={<Skeleton className="h-[calc(100vh-150px)] min-h-[620px] w-full rounded-lg" />}>
          <PdfDocumentViewer
            key={attachment.id}
            attachmentId={attachment.id}
            fileUrl={fileUrl}
            fileName={attachment.name}
            initialPageIndex={initialReaderState?.pageIndex ?? 0}
            initialZoom={initialReaderState?.zoom ?? 1}
            annotations={annotations}
            libraryFolderId={attachment.libraryFolderId}
            onReadingProgressChange={handleReadingProgressChange}
            onUpsertAnnotation={handleUpsertAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
          />
        </Suspense>
      ) : fileUrl && isPdf ? (
        <Skeleton className="h-[calc(100vh-150px)] min-h-[620px] w-full rounded-lg" />
      ) : fileUrl ? (
        <section className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg bg-white/70 px-6 text-center">
          <FileText className="h-10 w-10 text-sky-700" />
          <h2 className="mt-4 text-base font-semibold text-slate-800">Document restored</h2>
          <a href={fileUrl} download={attachment.name} className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white">Download document</a>
        </section>
      ) : (
        <section className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg bg-white/70 px-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><FileText className="h-7 w-7" /></span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">{isBusy ? statusLabel : error ? "Reconnect Google Drive" : "Connect Google Drive"}</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
            {error ?? "MyVault will download only this file and keep the rest of your Library in Google Drive until you open it."}
          </p>
          {isBusy ? <Loader2 className="mt-5 h-5 w-5 animate-spin text-primary" /> : (
            <Button type="button" onClick={() => void connectAndOpen(true)} className="mt-5"><CloudDownload className="h-4 w-4" /> {error ? "Reconnect and open" : "Connect and open"}</Button>
          )}
          {attachment.readingProgressPercent != null ? (
            <div className="mt-7 w-full max-w-sm">
              <div className="flex items-center justify-between text-xs text-slate-400"><span>Restored reading progress</span><span>{Math.round(progress)}%</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
            </div>
          ) : null}
        </section>
      )}
    </PageContainer>
  );
}
