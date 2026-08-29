import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Highlighter, Loader2, Maximize2, MessageSquarePlus, MessageSquareText, Pencil, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RestoredPdfAnnotation } from "@/lib/restore/restoredCorpus";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfDocumentViewerProps = {
  attachmentId: string;
  fileUrl: string;
  fileName: string;
  initialPageIndex?: number;
  initialZoom?: number;
  annotations?: RestoredPdfAnnotation[];
  onReadingProgressChange?: (progress: PdfReaderProgress) => void;
  libraryFolderId?: string | null;
  onUpsertAnnotation?: (annotation: RestoredPdfAnnotation) => void | Promise<void>;
  onDeleteAnnotation?: (annotationId: string) => void | Promise<void>;
};

export type PdfReaderProgress = {
  pageIndex: number;
  pageCount: number;
  progressPercent: number;
  zoom: number;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.2;
const PDF_READER_STATE_KEY = "myvault-pdf-reader-state";
const PAGE_RENDER_RADIUS = 2;
const MAX_REMEMBERED_PAGE_SIZES = 24;
const DEFAULT_PAGE_ASPECT_RATIO = 1.414;

type StoredReaderState = {
  pageNumber: number;
  zoom: number;
};

type HighlightDrag = {
  pageIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type AnnotationEditorState = {
  mode: "create-page-note" | "edit";
  pageIndex: number;
  annotation: RestoredPdfAnnotation | null;
};

function scrollPdfPageIntoView(viewport: HTMLDivElement | null, page: HTMLDivElement | undefined, behavior: ScrollBehavior) {
  if (!viewport || !page) return;
  const viewportBounds = viewport.getBoundingClientRect();
  const pageBounds = page.getBoundingClientRect();
  viewport.scrollTo({
    top: Math.max(0, viewport.scrollTop + pageBounds.top - viewportBounds.top - 28),
    behavior,
  });
}

const ANNOTATION_COLORS = ["yellow", "blue", "green", "red"] as const;

function annotationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getStoredReaderState(attachmentId: string, fileName: string): StoredReaderState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(`${PDF_READER_STATE_KEY}:${attachmentId}`)
      ?? localStorage.getItem(`${PDF_READER_STATE_KEY}:${fileName}`);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredReaderState;
    if (!Number.isFinite(parsed.pageNumber) || !Number.isFinite(parsed.zoom)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function annotationColor(color: string, alpha: number) {
  const colors: Record<string, string> = {
    yellow: `rgba(250, 204, 21, ${alpha})`,
    blue: `rgba(59, 130, 246, ${alpha})`,
    green: `rgba(34, 197, 94, ${alpha})`,
    red: `rgba(239, 68, 68, ${alpha})`,
    black: `rgba(15, 23, 42, ${Math.min(alpha + 0.15, 0.72)})`,
    white: `rgba(255, 255, 255, ${Math.min(alpha + 0.3, 0.95)})`,
  };
  return colors[color] ?? colors.yellow;
}

function annotationTypeLabel(annotation: RestoredPdfAnnotation) {
  if (annotation.annotationType === "page_note") return "Page note";
  if (annotation.annotationType === "text_box") return "Text annotation";
  return "Highlight";
}

const PdfPageAnnotations = memo(function PdfPageAnnotations({ annotations, pageWidth, sourceWidth, sourceHeight }: {
  annotations: RestoredPdfAnnotation[];
  pageWidth: number;
  sourceWidth: number;
  sourceHeight: number;
}) {
  if (!sourceWidth || !sourceHeight || annotations.length === 0) return null;
  const pageHeight = pageWidth * (sourceHeight / sourceWidth);
  const positionedAnnotations = annotations.filter((annotation) => annotation.annotationType !== "page_note");
  const pageNotes = annotations.filter((annotation) => annotation.annotationType === "page_note");

  return (
    <div className="pointer-events-none absolute left-0 top-0 z-10 overflow-hidden" style={{ width: pageWidth, height: pageHeight }} aria-hidden="true">
      {positionedAnnotations.map((annotation) => {
        const normalized = annotation.right <= 1.2 && annotation.bottom <= 1.2;
        const scaleX = normalized ? pageWidth : pageWidth / sourceWidth;
        const scaleY = normalized ? pageHeight : pageHeight / sourceHeight;
        const left = annotation.left * scaleX;
        const top = annotation.top * scaleY;
        const width = Math.max((annotation.right - annotation.left) * scaleX, 2);
        const height = Math.max((annotation.bottom - annotation.top) * scaleY, 2);
        const isTextBox = annotation.annotationType === "text_box";
        return (
          <div
            key={annotation.id}
            data-testid={`pdf-annotation-overlay-${annotation.id}`}
            className={isTextBox ? "overflow-hidden rounded-sm border border-slate-500/20 px-1.5 py-1 leading-tight text-slate-950 shadow-sm" : "rounded-[2px] mix-blend-multiply"}
            style={{
              position: "absolute",
              left,
              top,
              width,
              height,
              backgroundColor: isTextBox
                ? annotation.backgroundColor === "none" ? "rgba(255,255,255,0.92)" : annotationColor(annotation.backgroundColor, 0.82)
                : annotationColor(annotation.color, 0.34),
              fontSize: isTextBox ? Math.max(8, annotation.textSize * (pageWidth / sourceWidth)) : undefined,
            }}
          >
            {isTextBox ? annotation.noteText : null}
          </div>
        );
      })}
      {pageNotes.length > 0 ? (
        <span className="absolute right-3 top-3 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full bg-primary px-2 text-[10px] font-semibold text-primary-foreground shadow-sm">
          <MessageSquareText className="h-3.5 w-3.5" /> {pageNotes.length}
        </span>
      ) : null}
    </div>
  );
}, (previous, next) => (
  previous.pageWidth === next.pageWidth
  && previous.sourceWidth === next.sourceWidth
  && previous.sourceHeight === next.sourceHeight
  && previous.annotations.length === next.annotations.length
  && previous.annotations.every((annotation, index) => annotation === next.annotations[index])
));

function IconAction({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="h-8 w-8 text-slate-600 hover:bg-slate-200/70 hover:text-slate-950"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type LoadedPdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
};

type LoadedPdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<LoadedPdfPage>;
};

const StablePdfCanvasPage = memo(function StablePdfCanvasPage({
  pageNumber,
  pageWidth,
  estimatedPageHeight,
  onPageLoad,
}: {
  pageNumber: number;
  pageWidth: number;
  estimatedPageHeight: number;
  onPageLoad: (pageNumber: number, page: LoadedPdfPage) => void;
}) {
  return (
    <Page
      pageNumber={pageNumber}
      width={pageWidth}
      renderAnnotationLayer
      renderTextLayer
      onLoadSuccess={(page) => onPageLoad(pageNumber, page)}
      loading={<div className="animate-pulse bg-white shadow-sm" style={{ width: pageWidth, height: estimatedPageHeight }} />}
      className="overflow-hidden bg-white shadow-[0_8px_30px_rgba(15,23,42,0.14)]"
    />
  );
});

export function PdfDocumentViewer({
  attachmentId,
  fileUrl,
  fileName,
  initialPageIndex = 0,
  initialZoom = 1,
  annotations = [],
  onReadingProgressChange,
  libraryFolderId = null,
  onUpsertAnnotation,
  onDeleteAnnotation,
}: PdfDocumentViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const zoomCommitTimeout = useRef<number | null>(null);
  const restoredPage = useRef(1);
  const programmaticTargetPage = useRef<number | null>(null);
  const currentPageRef = useRef(1);
  const pageSizesRef = useRef<Record<number, { width: number; height: number }>>({});
  const numPagesRef = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(annotations.length > 0);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState<(typeof ANNOTATION_COLORS)[number]>("yellow");
  const [highlightDrag, setHighlightDrag] = useState<HighlightDrag | null>(null);
  const [annotationEditor, setAnnotationEditor] = useState<AnnotationEditorState | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorText, setEditorText] = useState("");
  const [editorColor, setEditorColor] = useState("yellow");
  const [editorBackgroundColor, setEditorBackgroundColor] = useState("none");
  const [editorTextSize, setEditorTextSize] = useState(16);
  const [deleteCandidate, setDeleteCandidate] = useState<RestoredPdfAnnotation | null>(null);
  const [annotationSaveState, setAnnotationSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  currentPageRef.current = pageNumber;

  const clearProgrammaticTargetWhenMeasured = useCallback((targetPage: number) => {
    const firstPage = Math.max(1, targetPage - PAGE_RENDER_RADIUS);
    const lastPage = Math.min(numPagesRef.current, targetPage + PAGE_RENDER_RADIUS);
    for (let page = firstPage; page <= lastPage; page += 1) {
      if (!pageSizesRef.current[page]) return;
    }
    requestAnimationFrame(() => {
      scrollPdfPageIntoView(viewportRef.current, pageRefs.current.get(targetPage), "auto");
      requestAnimationFrame(() => {
        if (programmaticTargetPage.current === targetPage) programmaticTargetPage.current = null;
      });
    });
  }, []);

  const settleProgrammaticPage = useCallback((targetPage: number) => {
    programmaticTargetPage.current = targetPage;
    requestAnimationFrame(() => {
      scrollPdfPageIntoView(viewportRef.current, pageRefs.current.get(targetPage), "auto");
    });
    clearProgrammaticTargetWhenMeasured(targetPage);
  }, [clearProgrammaticTargetWhenMeasured]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateWidth = () => setViewportWidth(Math.max(viewport.clientWidth, 320));
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    const storedState = getStoredReaderState(attachmentId, fileName);
    setNumPages(0);
    restoredPage.current = Math.max(1, storedState?.pageNumber ?? initialPageIndex + 1);
    setPageNumber(restoredPage.current);
    setPageInput(String(restoredPage.current));
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, storedState?.zoom ?? initialZoom)));
    setPreviewZoom(null);
    setError(null);
    setPageSizes({});
    pageSizesRef.current = {};
    numPagesRef.current = 0;
    setHighlightMode(false);
    setHighlightDrag(null);
    setAnnotationEditor(null);
    setDeleteCandidate(null);
    setAnnotationSaveState("idle");
    pageRefs.current.clear();
    programmaticTargetPage.current = null;
  }, [attachmentId, fileName, fileUrl, initialPageIndex, initialZoom]);

  useEffect(() => {
    if (!numPages || typeof localStorage === "undefined") return;
    localStorage.setItem(`${PDF_READER_STATE_KEY}:${attachmentId}`, JSON.stringify({ pageNumber, zoom } satisfies StoredReaderState));
    onReadingProgressChange?.({
      pageIndex: pageNumber - 1,
      pageCount: numPages,
      progressPercent: Math.max(0, Math.min(100, (pageNumber / numPages) * 100)),
      zoom,
    });
  }, [attachmentId, numPages, onReadingProgressChange, pageNumber, zoom]);

  useEffect(() => {
    if (!numPages) return;
    const initialPage = Math.max(1, Math.min(restoredPage.current, numPages));
    settleProgrammaticPage(initialPage);
    const frame = requestAnimationFrame(() => {
      setPageNumber(initialPage);
      setPageInput(String(initialPage));
      settleProgrammaticPage(initialPage);
    });
    return () => cancelAnimationFrame(frame);
  }, [fileUrl, numPages, settleProgrammaticPage]);

  useEffect(() => () => {
    if (zoomCommitTimeout.current !== null) window.clearTimeout(zoomCommitTimeout.current);
  }, []);

  useEffect(() => {
    if (annotationSaveState !== "saved") return;
    const timeout = window.setTimeout(() => setAnnotationSaveState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [annotationSaveState]);

  const setPage = (nextPage: number, behavior: ScrollBehavior = "smooth") => {
    const boundedPage = Math.max(1, Math.min(nextPage, numPages || 1));
    settleProgrammaticPage(boundedPage);
    setPageNumber(boundedPage);
    setPageInput(String(boundedPage));
    scrollPdfPageIntoView(viewportRef.current, pageRefs.current.get(boundedPage), behavior);
  };

  const commitPageInput = () => {
    const requestedPage = Number.parseInt(pageInput, 10);
    setPage(Number.isFinite(requestedPage) ? requestedPage : pageNumber, "auto");
  };

  const fitWidth = Math.max(280, Math.min((viewportWidth || 900) - 48, 980));
  const pageWidth = Math.round(fitWidth * zoom);
  const displayedZoom = previewZoom ?? zoom;
  const pages = useMemo(() => Array.from({ length: numPages }, (_, index) => index + 1), [numPages]);
  const renderedPages = useMemo(() => {
    const active = new Set<number>();
    for (let page = Math.max(1, pageNumber - PAGE_RENDER_RADIUS); page <= Math.min(numPages, pageNumber + PAGE_RENDER_RADIUS); page += 1) {
      active.add(page);
    }
    return active;
  }, [numPages, pageNumber]);
  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, RestoredPdfAnnotation[]>();
    annotations.forEach((annotation) => {
      const pageAnnotations = grouped.get(annotation.pageIndex) ?? [];
      pageAnnotations.push(annotation);
      grouped.set(annotation.pageIndex, pageAnnotations);
    });
    return grouped;
  }, [annotations]);
  const sortedAnnotations = useMemo(
    () => annotations.toSorted((first, second) => first.pageIndex - second.pageIndex || first.createdAt - second.createdAt),
    [annotations],
  );
  const handlePageLoad = useCallback((page: number, pdfPage: LoadedPdfPage) => {
    const viewport = pdfPage.getViewport({ scale: 1 });
    const previous = pageSizesRef.current[page];
    if (previous?.width !== viewport.width || previous.height !== viewport.height) {
      const next = { ...pageSizesRef.current, [page]: { width: viewport.width, height: viewport.height } };
      const rememberedPages = Object.keys(next).map(Number);
      if (rememberedPages.length > MAX_REMEMBERED_PAGE_SIZES) {
        const farthest = rememberedPages
          .filter((candidate) => candidate !== page)
          .sort((first, second) => Math.abs(second - page) - Math.abs(first - page))[0];
        if (farthest !== undefined) delete next[farthest];
      }
      pageSizesRef.current = next;
      setPageSizes(next);
    }
    const targetPage = programmaticTargetPage.current;
    if (targetPage !== null) {
      requestAnimationFrame(() => scrollPdfPageIntoView(viewportRef.current, pageRefs.current.get(targetPage), "auto"));
      clearProgrammaticTargetWhenMeasured(targetPage);
    }
  }, [clearProgrammaticTargetWhenMeasured]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !numPages || typeof IntersectionObserver === "undefined") return;
    const intersecting = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const page = Number((entry.target as HTMLElement).dataset.pdfPage);
        if (!Number.isFinite(page)) return;
        if (entry.isIntersecting) intersecting.add(page);
        else intersecting.delete(page);
      });
      if (intersecting.size === 0) return;
      const viewportTop = viewport.getBoundingClientRect().top + 28;
      const targetPage = programmaticTargetPage.current;
      if (targetPage !== null) {
        const targetElement = pageRefs.current.get(targetPage);
        if (!targetElement || Math.abs(targetElement.getBoundingClientRect().top - viewportTop) > viewport.clientHeight) return;
        currentPageRef.current = targetPage;
        setPageNumber(targetPage);
        setPageInput(String(targetPage));
        return;
      }
      let closestPage = currentPageRef.current;
      let closestDistance = Number.POSITIVE_INFINITY;
      intersecting.forEach((candidatePage) => {
        const element = pageRefs.current.get(candidatePage);
        if (!element) return;
        const distance = Math.abs(element.getBoundingClientRect().top - viewportTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = candidatePage;
        }
      });
      if (closestPage !== currentPageRef.current) {
        currentPageRef.current = closestPage;
        setPageNumber(closestPage);
        setPageInput(String(closestPage));
      }
    }, { root: viewport, rootMargin: "100% 0px", threshold: 0 });
    pageRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [numPages]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, displayedZoom + direction * 0.06));
    setPreviewZoom(nextZoom);
    if (zoomCommitTimeout.current !== null) window.clearTimeout(zoomCommitTimeout.current);
    zoomCommitTimeout.current = window.setTimeout(() => {
      setZoom(nextZoom);
      setPreviewZoom(null);
      zoomCommitTimeout.current = null;
    }, 140);
  };

  const commitZoom = (nextZoom: number) => {
    if (zoomCommitTimeout.current !== null) window.clearTimeout(zoomCommitTimeout.current);
    zoomCommitTimeout.current = null;
    setPreviewZoom(null);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)));
  };

  const persistAnnotation = async (annotation: RestoredPdfAnnotation) => {
    if (!onUpsertAnnotation) return false;
    setAnnotationSaveState("saving");
    try {
      await onUpsertAnnotation(annotation);
      setShowAnnotationPanel(true);
      setAnnotationSaveState("saved");
      return true;
    } catch {
      setAnnotationSaveState("error");
      return false;
    }
  };

  const openAnnotationEditor = (state: AnnotationEditorState) => {
    const annotation = state.annotation;
    setEditorTitle(annotation?.displayTitle ?? "");
    setEditorText(annotation?.noteText ?? "");
    setEditorColor(annotation?.color ?? "yellow");
    setEditorBackgroundColor(annotation?.backgroundColor ?? "none");
    setEditorTextSize(annotation?.textSize ?? 16);
    setAnnotationEditor(state);
  };

  const saveAnnotationEditor = async () => {
    if (!annotationEditor) return;
    const now = Date.now();
    const existing = annotationEditor.annotation;
    const annotationType = annotationEditor.mode === "create-page-note" ? "page_note" : existing?.annotationType ?? "page_note";
    if (annotationType !== "highlight" && !editorText.trim()) return;
    const nextAnnotation: RestoredPdfAnnotation = {
      id: existing?.id ?? annotationId(),
      attachmentId,
      libraryFolderId: existing?.libraryFolderId ?? libraryFolderId,
      pageIndex: annotationEditor.pageIndex,
      left: existing?.left ?? 0,
      top: existing?.top ?? 0,
      right: existing?.right ?? 0,
      bottom: existing?.bottom ?? 0,
      color: editorColor,
      noteText: editorText.trim() || null,
      annotationType,
      textSize: Math.max(10, Math.min(36, editorTextSize)),
      backgroundColor: annotationType === "text_box" ? editorBackgroundColor : existing?.backgroundColor ?? "none",
      displayTitle: editorTitle.trim() || null,
      displayFolderId: existing?.displayFolderId ?? libraryFolderId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (await persistAnnotation(nextAnnotation)) setAnnotationEditor(null);
  };

  const confirmDeleteAnnotation = async () => {
    if (!deleteCandidate || !onDeleteAnnotation) return;
    const annotationIdToDelete = deleteCandidate.id;
    setDeleteCandidate(null);
    setAnnotationSaveState("saving");
    try {
      await onDeleteAnnotation(annotationIdToDelete);
      setAnnotationSaveState("saved");
    } catch {
      setAnnotationSaveState("error");
    }
  };

  const pointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };

  const beginHighlight = (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => {
    if (!highlightMode || event.button !== 0) return;
    const point = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setPageNumber(pageIndex + 1);
    setPageInput(String(pageIndex + 1));
    setHighlightDrag({ pageIndex, startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  };

  const moveHighlight = (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => {
    if (!highlightDrag || highlightDrag.pageIndex !== pageIndex) return;
    const point = pointerPosition(event);
    setHighlightDrag((current) => current && current.pageIndex === pageIndex
      ? { ...current, currentX: point.x, currentY: point.y }
      : current);
  };

  const finishHighlight = async (event: React.PointerEvent<HTMLDivElement>, pageIndex: number, sourceWidth: number, sourceHeight: number) => {
    if (!highlightDrag || highlightDrag.pageIndex !== pageIndex) return;
    const point = pointerPosition(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const left = Math.min(highlightDrag.startX, point.x);
    const top = Math.min(highlightDrag.startY, point.y);
    const right = Math.max(highlightDrag.startX, point.x);
    const bottom = Math.max(highlightDrag.startY, point.y);
    setHighlightDrag(null);
    if (right - left < 6 || bottom - top < 6) return;

    const pageHeight = pageWidth * (sourceHeight / sourceWidth);
    const scaleX = sourceWidth / pageWidth;
    const scaleY = sourceHeight / pageHeight;
    const now = Date.now();
    await persistAnnotation({
      id: annotationId(),
      attachmentId,
      libraryFolderId,
      pageIndex,
      left: left * scaleX,
      top: top * scaleY,
      right: right * scaleX,
      bottom: bottom * scaleY,
      color: highlightColor,
      noteText: null,
      annotationType: "highlight",
      textSize: 16,
      backgroundColor: "none",
      displayTitle: null,
      displayFolderId: libraryFolderId,
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <section className="relative flex h-[calc(100vh-150px)] min-h-[620px] flex-col overflow-hidden rounded-lg bg-slate-100 shadow-[0_1px_3px_rgba(15,23,42,0.08)]" data-testid="pdf-reader">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 bg-white/95 px-3 shadow-[0_1px_0_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <IconAction label="Previous page" disabled={pageNumber <= 1} onClick={() => setPage(pageNumber - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconAction>
          <div className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
            <input
              aria-label="Page number"
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitPageInput();
                  event.currentTarget.blur();
                }
              }}
              className="h-7 w-10 rounded-md border border-slate-200 bg-white text-center text-xs font-medium text-slate-700 outline-none focus:border-primary"
            />
            <span aria-label={`${numPages || 0} total pages`}>of {numPages || "-"}</span>
          </div>
          <IconAction label="Next page" disabled={!numPages || pageNumber >= numPages} onClick={() => setPage(pageNumber + 1)}>
            <ChevronRight className="h-4 w-4" />
          </IconAction>
        </div>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {onUpsertAnnotation ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-testid="pdf-highlight-tool"
                  aria-label="Draw highlight"
                  aria-pressed={highlightMode}
                  onClick={() => {
                    setHighlightMode((current) => !current);
                    setHighlightDrag(null);
                  }}
                  className={highlightMode ? "h-8 w-8 shrink-0 bg-primary/10 text-primary hover:bg-primary/15" : "h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-200/70 hover:text-slate-950"}
                >
                  <Highlighter className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{highlightMode ? "Stop drawing highlights" : "Draw highlight"}</TooltipContent>
            </Tooltip>
          ) : null}
          {highlightMode ? (
            <div className="flex shrink-0 items-center gap-1 px-1" aria-label="Highlight colour">
              {ANNOTATION_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  data-testid={`pdf-highlight-color-${color}`}
                  aria-label={`${color} highlight`}
                  aria-pressed={highlightColor === color}
                  onClick={() => setHighlightColor(color)}
                  className={`h-4 w-4 rounded-full border-2 transition-transform ${highlightColor === color ? "scale-110 border-slate-700" : "border-white shadow-[0_0_0_1px_rgba(100,116,139,0.28)]"}`}
                  style={{ backgroundColor: annotationColor(color, 0.9) }}
                />
              ))}
            </div>
          ) : null}
          {onUpsertAnnotation ? (
            <IconAction label="Add page note" onClick={() => openAnnotationEditor({ mode: "create-page-note", pageIndex: pageNumber - 1, annotation: null })}>
              <MessageSquarePlus className="h-4 w-4" />
            </IconAction>
          ) : null}
          {annotations.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="pdf-annotations-toggle"
                  aria-pressed={showAnnotationPanel}
                  onClick={() => setShowAnnotationPanel((current) => !current)}
                  className={showAnnotationPanel ? "h-8 gap-1.5 bg-primary/10 px-2 text-primary hover:bg-primary/15" : "h-8 gap-1.5 px-2 text-slate-600 hover:bg-slate-200/70 hover:text-slate-950"}
                >
                  <MessageSquareText className="h-4 w-4" />
                  <span className="text-xs font-semibold">{annotations.length}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showAnnotationPanel ? "Hide annotation panel" : "Show annotation panel"}</TooltipContent>
            </Tooltip>
          ) : null}
          {annotationSaveState !== "idle" ? (
            <span className={`shrink-0 px-1 text-[11px] font-medium ${annotationSaveState === "error" ? "text-red-600" : "text-slate-500"}`} data-testid="pdf-annotation-save-state">
              {annotationSaveState === "saving" ? "Saving..." : annotationSaveState === "saved" ? "Saved locally" : "Save failed"}
            </span>
          ) : null}
          <IconAction label="Zoom out" disabled={displayedZoom <= MIN_ZOOM} onClick={() => commitZoom(zoom - ZOOM_STEP)}>
            <ZoomOut className="h-4 w-4" />
          </IconAction>
          <span className="w-11 text-center text-xs font-medium tabular-nums text-slate-500" data-testid="pdf-zoom-label">{Math.round(displayedZoom * 100)}%</span>
          <IconAction label="Zoom in" disabled={displayedZoom >= MAX_ZOOM} onClick={() => commitZoom(zoom + ZOOM_STEP)}>
            <ZoomIn className="h-4 w-4" />
          </IconAction>
          <IconAction label="Fit to width" onClick={() => commitZoom(1)}>
            <Maximize2 className="h-4 w-4" />
          </IconAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild className="h-8 w-8 text-slate-600 hover:bg-slate-200/70 hover:text-slate-950">
                <a href={fileUrl} download={fileName} aria-label="Download PDF"><Download className="h-4 w-4" /></a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download PDF</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-7"
          data-testid="pdf-scroll-viewport"
          onWheel={handleWheel}
        >
          {error ? (
            <div className="mx-auto mt-20 max-w-md rounded-lg bg-white px-6 py-8 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-800">This PDF could not be displayed.</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
            </div>
          ) : (
            <div
              className="origin-top will-change-transform"
              style={{ transform: previewZoom === null ? undefined : `scale(${previewZoom / zoom})` }}
            >
              <Document
                key={fileUrl}
                file={fileUrl}
                onLoadSuccess={(document: LoadedPdfDocument) => {
                  void document.getPage(1)
                    .then((firstPage) => {
                      handlePageLoad(1, firstPage);
                      numPagesRef.current = document.numPages;
                      setNumPages(document.numPages);
                    })
                    .catch((cause) => setError(cause instanceof Error ? cause.message : "The first PDF page could not be read."));
                }}
                onLoadError={(cause) => setError(cause.message || "The document appears to be damaged or unsupported.")}
                loading={<div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
                className="mx-auto flex w-max flex-col gap-6"
              >
              {pages.map((page) => {
                const sourceSize = pageSizes[page];
                const closestKnownSize = sourceSize
                  ?? pageSizes[1];
                const estimatedPageHeight = closestKnownSize
                  ? pageWidth * (closestKnownSize.height / closestKnownSize.width)
                  : pageWidth * DEFAULT_PAGE_ASPECT_RATIO;
                const pageAnnotations = annotationsByPage.get(page - 1) ?? [];
                const shouldRender = renderedPages.has(page);
                return (
                  <div
                    key={page}
                    ref={(element) => {
                      if (element) pageRefs.current.set(page, element);
                      else pageRefs.current.delete(page);
                    }}
                    data-pdf-page={page}
                    data-pdf-page-rendered={shouldRender ? "true" : "false"}
                    className="relative scroll-mt-7"
                    style={{ width: pageWidth, minHeight: estimatedPageHeight + 24 }}
                  >
                    {shouldRender ? (
                      <StablePdfCanvasPage pageNumber={page} pageWidth={pageWidth} estimatedPageHeight={estimatedPageHeight} onPageLoad={handlePageLoad} />
                    ) : (
                      <div
                        className="bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)]"
                        style={{ width: pageWidth, height: estimatedPageHeight }}
                        aria-hidden="true"
                      />
                    )}
                    {shouldRender && sourceSize ? (
                      <PdfPageAnnotations annotations={pageAnnotations} pageWidth={pageWidth} sourceWidth={sourceSize.width} sourceHeight={sourceSize.height} />
                    ) : null}
                    {shouldRender && highlightMode && sourceSize ? (
                      <div
                        data-testid={`pdf-highlight-layer-${page}`}
                        className="absolute left-0 top-0 z-20 cursor-crosshair touch-none"
                        style={{ width: pageWidth, height: pageWidth * (sourceSize.height / sourceSize.width) }}
                        onPointerDown={(event) => beginHighlight(event, page - 1)}
                        onPointerMove={(event) => moveHighlight(event, page - 1)}
                        onPointerUp={(event) => void finishHighlight(event, page - 1, sourceSize.width, sourceSize.height)}
                        onPointerCancel={() => setHighlightDrag(null)}
                      >
                        {highlightDrag?.pageIndex === page - 1 ? (
                          <span
                            data-testid="pdf-highlight-preview"
                            className="absolute rounded-[2px] mix-blend-multiply"
                            style={{
                              left: Math.min(highlightDrag.startX, highlightDrag.currentX),
                              top: Math.min(highlightDrag.startY, highlightDrag.currentY),
                              width: Math.abs(highlightDrag.currentX - highlightDrag.startX),
                              height: Math.abs(highlightDrag.currentY - highlightDrag.startY),
                              backgroundColor: annotationColor(highlightColor, 0.34),
                            }}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <p className="pt-2 text-center text-[11px] font-medium tabular-nums text-slate-400">{page}</p>
                  </div>
                );
              })}
              </Document>
            </div>
          )}
        </div>

        {showAnnotationPanel && annotations.length > 0 ? (
          <aside className="absolute bottom-0 right-0 top-12 z-30 w-72 shrink-0 overflow-y-auto border-l border-border/60 bg-card/95 px-4 py-5 shadow-[-8px_0_24px_rgba(15,23,42,0.08)] backdrop-blur-sm" data-testid="pdf-annotations-panel">
            <div className="flex items-center gap-2">
              <Highlighter className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Annotations</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{annotations.length} in this document</p>
            <div className="mt-4 space-y-2">
              {sortedAnnotations.map((annotation) => (
                <div key={annotation.id} className="group relative rounded-md bg-background/70 transition-colors hover:bg-background">
                  <button
                    type="button"
                    data-testid={`pdf-annotation-${annotation.id}`}
                    onClick={() => setPage(annotation.pageIndex + 1)}
                    className="block w-full px-3 py-2.5 pr-16 text-left"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">{annotation.displayTitle || annotationTypeLabel(annotation)}</span>
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">Page {annotation.pageIndex + 1}</span>
                    </span>
                    {annotation.noteText ? <span className="mt-1.5 line-clamp-3 block text-xs leading-5 text-muted-foreground">{annotation.noteText}</span> : null}
                  </button>
                  {onUpsertAnnotation ? (
                    <button
                      type="button"
                      aria-label={`Edit ${annotation.displayTitle || annotationTypeLabel(annotation)}`}
                      data-testid={`pdf-annotation-edit-${annotation.id}`}
                      onClick={() => openAnnotationEditor({ mode: "edit", pageIndex: annotation.pageIndex, annotation })}
                      className="absolute right-8 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {onDeleteAnnotation ? (
                    <button
                      type="button"
                      aria-label={`Delete ${annotation.displayTitle || annotationTypeLabel(annotation)}`}
                      data-testid={`pdf-annotation-delete-${annotation.id}`}
                      onClick={() => setDeleteCandidate(annotation)}
                      className="absolute right-1 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-red-50 hover:text-red-700 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={Boolean(annotationEditor)} onOpenChange={(open) => { if (!open) setAnnotationEditor(null); }}>
        <DialogContent className="max-w-md bg-card shadow-xl">
          <DialogHeader>
            <DialogTitle>{annotationEditor?.mode === "create-page-note" ? "Page note" : annotationEditor?.annotation ? annotationTypeLabel(annotationEditor.annotation) : "Annotation"}</DialogTitle>
            <DialogDescription>Page {(annotationEditor?.pageIndex ?? 0) + 1}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <label htmlFor="pdf-annotation-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">Title</label>
              <Input id="pdf-annotation-title" value={editorTitle} onChange={(event) => setEditorTitle(event.target.value)} placeholder="Optional title" />
            </div>
            <div>
              <label htmlFor="pdf-annotation-text" className="mb-1.5 block text-xs font-medium text-muted-foreground">Note</label>
              <Textarea id="pdf-annotation-text" data-testid="pdf-annotation-text" value={editorText} onChange={(event) => setEditorText(event.target.value)} rows={5} autoFocus placeholder="Write a note..." />
            </div>
            {annotationEditor?.mode === "edit" && annotationEditor.annotation?.annotationType !== "page_note" ? (
              <div>
                <span className="mb-2 block text-xs font-medium text-muted-foreground">Colour</span>
                <div className="flex items-center gap-2">
                  {ANNOTATION_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`${color} annotation`}
                      aria-pressed={editorColor === color}
                      onClick={() => setEditorColor(color)}
                      className={`h-6 w-6 rounded-full border-2 ${editorColor === color ? "border-foreground" : "border-transparent shadow-[0_0_0_1px_hsl(var(--border))]"}`}
                      style={{ backgroundColor: annotationColor(color, 0.9) }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {annotationEditor?.annotation?.annotationType === "text_box" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pdf-annotation-size" className="mb-1.5 block text-xs font-medium text-muted-foreground">Text size</label>
                  <Input id="pdf-annotation-size" type="number" min={10} max={36} value={editorTextSize} onChange={(event) => setEditorTextSize(Number(event.target.value))} />
                </div>
                <div>
                  <label htmlFor="pdf-annotation-background" className="mb-1.5 block text-xs font-medium text-muted-foreground">Background</label>
                  <select id="pdf-annotation-background" value={editorBackgroundColor} onChange={(event) => setEditorBackgroundColor(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="none">None</option>
                    <option value="white">White</option>
                    <option value="yellow">Yellow</option>
                    <option value="blue">Blue</option>
                    <option value="green">Green</option>
                  </select>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAnnotationEditor(null)}>Cancel</Button>
            <Button
              type="button"
              data-testid="pdf-annotation-save"
              disabled={((annotationEditor?.mode === "create-page-note" || annotationEditor?.annotation?.annotationType !== "highlight") && !editorText.trim()) || annotationSaveState === "saving"}
              onClick={() => void saveAnnotationEditor()}
            >
              {annotationSaveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open) setDeleteCandidate(null); }}>
        <AlertDialogContent className="bg-card shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete annotation?</AlertDialogTitle>
            <AlertDialogDescription>This removes it from your local MyVault Web changes. The PDF file itself will not be modified.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="pdf-annotation-confirm-delete" onClick={() => void confirmDeleteAnnotation()} className="bg-red-600 text-white hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
