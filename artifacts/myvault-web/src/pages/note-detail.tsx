import { useParams, useLocation } from "wouter";
import { useGetNote, useUpdateNote, useListNoteVersions, getGetNoteQueryKey, getListNoteVersionsQueryKey } from "@workspace/api-client-react";
import type { Block } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Pin, PinOff, History, MoreHorizontal,
  Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Code, Minus, Type
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type BlockType = Block["type"];

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Text",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bullet: "Bullet list",
  numbered: "Numbered list",
  quote: "Quote",
  code: "Code",
  divider: "Divider",
};

const BLOCK_ICONS: Record<BlockType, React.ElementType> = {
  paragraph: Type,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bullet: List,
  numbered: ListOrdered,
  quote: Quote,
  code: Code,
  divider: Minus,
};

function BlockRenderer({ block, onChange, onEnter, onDelete }: {
  block: Block;
  onChange: (content: string) => void;
  onEnter: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLDivElement>(null);
  const cls = cn(
    "w-full bg-transparent outline-none resize-none border-0 text-foreground placeholder:text-muted-foreground/50",
    block.type === "heading1" && "text-2xl font-bold",
    block.type === "heading2" && "text-xl font-semibold",
    block.type === "heading3" && "text-lg font-medium",
    block.type === "paragraph" && "text-base leading-relaxed",
    block.type === "bullet" && "text-base leading-relaxed",
    block.type === "numbered" && "text-base leading-relaxed",
    block.type === "quote" && "text-base italic text-muted-foreground border-l-4 border-primary pl-4",
    block.type === "code" && "font-mono text-sm bg-muted rounded-lg p-3 text-green-600 dark:text-green-400",
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
    }
    if (e.key === "Backspace" && block.content === "") {
      e.preventDefault();
      onDelete();
    }
  };

  if (block.type === "divider") {
    return <hr className="border-border my-2" />;
  }

  const prefix = block.type === "bullet" ? "• " : block.type === "numbered" ? `${block.orderIndex + 1}. ` : "";

  return (
    <div className="flex items-start gap-2">
      {prefix && <span className="text-muted-foreground text-base pt-0.5 shrink-0 select-none">{prefix}</span>}
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        data-testid={`block-${block.id}`}
        className={cn(cls, "flex-1 min-h-[1.5rem] overflow-hidden")}
        value={block.content}
        onChange={e => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        style={{ height: "auto" }}
        placeholder={block.type === "paragraph" ? "Type something..." : BLOCK_LABELS[block.type]}
      />
    </div>
  );
}

let blockIdCounter = 50000;
function newBlockId(): string { return `local-${++blockIdCounter}`; }

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showVersions, setShowVersions] = useState(false);
  const [localBlocks, setLocalBlocks] = useState<Block[] | null>(null);
  const [titleValue, setTitleValue] = useState("");
  const [titleSaved, setTitleSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: note, isLoading } = useGetNote(id!, {
    query: {
      enabled: !!id,
      queryKey: getGetNoteQueryKey(id!),
    },
  });

  const { data: versions = [] } = useListNoteVersions(id!, {
    query: { enabled: !!id && showVersions, queryKey: getListNoteVersionsQueryKey(id!) },
  });

  const updateNote = useUpdateNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNoteQueryKey(id!) });
      },
    },
  });

  useEffect(() => {
    if (note && localBlocks === null) {
      setLocalBlocks((note as any).blocks ?? []);
      setTitleValue(note.title);
    }
  }, [note]);

  const handleTitleChange = (value: string) => {
    setTitleValue(value);
    setTitleSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNote.mutate({ id: id!, data: { title: value } });
      setTitleSaved(true);
    }, 800);
  };

  const handleBlockChange = useCallback((blockId: string, content: string) => {
    setLocalBlocks(prev => prev?.map(b => b.id === blockId ? { ...b, content } : b) ?? null);
  }, []);

  const handleBlockEnter = useCallback((blockId: string) => {
    setLocalBlocks(prev => {
      if (!prev) return prev;
      const idx = prev.findIndex(b => b.id === blockId);
      const newBlock: Block = {
        id: newBlockId(),
        noteId: id!,
        type: "paragraph",
        content: "",
        orderIndex: idx + 1,
      };
      const updated = [...prev];
      updated.splice(idx + 1, 0, newBlock);
      return updated.map((b, i) => ({ ...b, orderIndex: i }));
    });
  }, [id]);

  const handleBlockDelete = useCallback((blockId: string) => {
    setLocalBlocks(prev => {
      if (!prev || prev.length <= 1) return prev;
      return prev.filter(b => b.id !== blockId).map((b, i) => ({ ...b, orderIndex: i }));
    });
  }, []);

  const togglePin = () => {
    if (!note) return;
    updateNote.mutate({ id: id!, data: { isPinned: !note.isPinned } });
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }

  if (!note) return null;
  const blocks = localBlocks ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-2.5 flex items-center gap-2">
        <button
          data-testid="back-btn"
          onClick={() => note.folderId ? navigate(`/folders/${note.folderId}`) : navigate("/folders")}
          className="text-muted-foreground hover:text-foreground transition-colors mr-1"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 flex items-center gap-2 min-w-0">
          {(note.tagNames ?? []).map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs shrink-0">{tag}</Badge>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-2">
            {titleSaved ? `Saved ${formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}` : "Saving..."}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePin} data-testid="pin-btn">
                {note.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{note.isPinned ? "Unpin note" : "Pin note"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowVersions(true)} data-testid="history-btn">
                <History className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version history</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
        {/* Title */}
        <textarea
          data-testid="note-title"
          className="w-full text-3xl font-bold bg-transparent outline-none resize-none border-0 text-foreground placeholder:text-muted-foreground/40 mb-6 leading-tight"
          value={titleValue}
          onChange={e => {
            handleTitleChange(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          placeholder="Untitled"
          rows={1}
          style={{ height: "auto" }}
        />

        {/* Blocks */}
        <div className="space-y-1">
          {blocks.map(block => (
            <BlockRenderer
              key={block.id}
              block={block}
              onChange={content => handleBlockChange(block.id, content)}
              onEnter={() => handleBlockEnter(block.id)}
              onDelete={() => handleBlockDelete(block.id)}
            />
          ))}
          {blocks.length === 0 && (
            <button
              className="w-full text-left text-muted-foreground/50 text-base py-1 hover:text-muted-foreground transition-colors"
              onClick={() => setLocalBlocks([{ id: newBlockId(), noteId: id!, type: "paragraph", content: "", orderIndex: 0 }])}
            >
              Start writing...
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-6 py-2 flex items-center justify-between text-xs text-muted-foreground bg-background">
        <span data-testid="word-count">{note.wordCount} words · {note.characterCount} characters</span>
        <span>{format(new Date(note.updatedAt), "MMM d, yyyy")}</span>
      </div>

      {/* Version history sheet */}
      <Sheet open={showVersions} onOpenChange={setShowVersions}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved versions yet.</p>
            ) : (
              versions.map(v => (
                <div key={v.id} className="border border-border rounded-lg p-3">
                  <p className="text-sm font-medium text-foreground">{v.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(v.createdAt), "MMM d, yyyy 'at' h:mm a")} · {v.wordCount} words
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
