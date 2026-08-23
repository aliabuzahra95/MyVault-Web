import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { NoteVersion } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  History,
  Pin,
  PinOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VaultRichTextDocument } from "@/lib/restore/vaultRichText";

const MyVaultRichTextEditor = lazy(() => import("@/components/note/myvault-rich-text-editor").then((module) => ({
  default: module.MyVaultRichTextEditor,
})));

export type NoteSaveStatus = "loading" | "available" | "saving" | "saved" | "error" | "conflict";

type NoteWorkspaceProps = {
  noteId: string;
  title: string;
  onTitleChange: (title: string) => void;
  document: VaultRichTextDocument;
  onDocumentChange: (document: VaultRichTextDocument) => void;
  saveStatus: NoteSaveStatus;
  savedAt: number | null;
  sourceUpdatedAt: number;
  isPinned: boolean;
  onTogglePin: () => void;
  onBack: () => void;
  tagNames: string[];
  versions: NoteVersion[];
};

const saveLabels: Record<NoteSaveStatus, string> = {
  loading: "Loading local copy...",
  available: "Available locally",
  saving: "Saving locally...",
  saved: "Saved locally",
  error: "Local save failed",
  conflict: "Local changes need review",
};

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function NoteWorkspace({
  noteId,
  title,
  onTitleChange,
  document,
  onDocumentChange,
  saveStatus,
  savedAt,
  sourceUpdatedAt,
  isPinned,
  onTogglePin,
  onBack,
  tagNames,
  versions,
}: NoteWorkspaceProps) {
  const [showVersions, setShowVersions] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const wordCount = countWords(document.text);

  useLayoutEffect(() => {
    if (!titleRef.current) return;
    titleRef.current.style.height = "auto";
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
  }, [title]);

  return (
    <div className="min-h-full" data-testid="universal-note-workspace">
      <header className="sticky top-0 z-20 border-b border-border/55 bg-background/95 backdrop-blur-sm">
        <div className="flex h-[52px] w-full max-w-[1240px] items-center gap-3 px-5 md:px-8 lg:px-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-950"
                onClick={onBack}
                data-testid="back-btn"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back</TooltipContent>
          </Tooltip>

          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{title || "Untitled"}</span>

          <span
            className={cn(
              "hidden items-center gap-1.5 text-xs sm:flex",
              saveStatus === "error" || saveStatus === "conflict" ? "text-amber-700" : "text-slate-500",
            )}
            aria-live="polite"
            data-testid="save-status"
          >
            {saveStatus === "saved" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
            {(saveStatus === "error" || saveStatus === "conflict") && <AlertCircle className="h-3.5 w-3.5" />}
            {saveLabels[saveStatus]}
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePin} data-testid="pin-btn">
                {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isPinned ? "Unpin note" : "Pin note"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowVersions(true)} data-testid="history-btn">
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version history</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="w-full max-w-[1240px] px-5 pb-20 pt-8 md:px-8 lg:px-10">
        <section className="mb-5">
          <textarea
            ref={titleRef}
            data-testid="note-title"
            className="w-full resize-none overflow-hidden border-0 bg-transparent text-3xl font-bold leading-tight text-slate-950 outline-none placeholder:text-slate-400 md:text-[34px]"
            value={title}
            onChange={(event) => {
              onTitleChange(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${event.target.scrollHeight}px`;
            }}
            placeholder="Untitled"
            rows={1}
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
            <span data-testid="word-count">{wordCount} words · {document.text.length} characters</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300" />
            <span>Edited {format(new Date(savedAt ?? sourceUpdatedAt), "MMM d, yyyy")}</span>
            <span className="flex items-center gap-1.5 sm:hidden" aria-live="polite">
              {saveStatus === "saved" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
              {saveLabels[saveStatus]}
            </span>
            {tagNames.map((tag) => (
              <Badge key={tag} variant="secondary" className="h-5 px-2 text-[10px] font-medium">{tag}</Badge>
            ))}
          </div>
        </section>

        <article className="min-w-0 pb-16">
          <Suspense fallback={<div className="min-h-[30rem] max-w-[760px] animate-pulse bg-slate-100/45" />}>
            <MyVaultRichTextEditor key={noteId} document={document} onChange={onDocumentChange} />
          </Suspense>
        </article>
      </main>

      <Sheet open={showVersions} onOpenChange={setShowVersions}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved versions yet.</p>
            ) : (
              versions.map((version) => (
                <div key={version.id} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{version.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format(new Date(version.createdAt), "MMM d, yyyy 'at' h:mm a")} · {version.wordCount} words
                  </p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
