import { useListAttachments } from "@workspace/api-client-react";
import type { Attachment } from "@workspace/api-client-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Pin, FileText, BookOpen, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const progress = attachment.readingProgressPercent;
  return (
    <div
      data-testid={`attachment-card-${attachment.id}`}
      className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        {attachment.isPinned && <Pin className="w-3.5 h-3.5 text-primary mt-1" />}
      </div>
      <h3 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors mb-1">
        {attachment.name}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        PDF {attachment.sizeBytes ? `· ${formatBytes(attachment.sizeBytes)}` : ""}
      </p>

      {progress !== null && progress !== undefined && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Reading progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="bg-primary rounded-full h-1.5 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        {formatDistanceToNow(new Date(attachment.updatedAt), { addSuffix: true })}
      </p>
    </div>
  );
}

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [showPinned, setShowPinned] = useState(false);

  const { data: attachments = [], isLoading } = useListAttachments(
    showPinned ? { isPinned: true } : {},
  );

  const filtered = attachments.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{attachments.length} documents</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="library-search"
            className="pl-9"
            placeholder="Search documents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant={showPinned ? "default" : "outline"}
          size="sm"
          onClick={() => setShowPinned(p => !p)}
          data-testid="filter-pinned"
        >
          <Pin className="w-3.5 h-3.5 mr-1.5" /> Pinned
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No documents found</p>
          <p className="text-xs mt-1">
            {search ? "Try a different search term" : "Add PDFs to your library to see them here"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(a => <AttachmentCard key={a.id} attachment={a} />)}
        </div>
      )}
    </div>
  );
}
