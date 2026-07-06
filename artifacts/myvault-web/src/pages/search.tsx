import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useSearch, getSearchQueryKey } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/providers";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, FileText, BookOpen, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark>
      : part
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [, navigate] = useLocation();
  const { workspace } = useWorkspace();
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

  const handleChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  };

  const { data: results, isLoading } = useSearch(
    { q: debouncedQuery, workspace },
    { query: { enabled: debouncedQuery.length > 1, queryKey: getSearchQueryKey({ q: debouncedQuery, workspace }) } }
  );

  const notes = results?.items.filter(i => i.type === "note") ?? [];
  const attachments = results?.items.filter(i => i.type === "attachment") ?? [];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground mb-6">Search</h1>

      {/* Search bar */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          data-testid="search-input"
          className="pl-12 h-12 text-base"
          placeholder="Search notes, folders, documents..."
          value={query}
          onChange={e => handleChange(e.target.value)}
          autoFocus
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && debouncedQuery.length <= 1 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Type at least 2 characters to search</p>
        </div>
      )}

      {/* No results */}
      {!isLoading && debouncedQuery.length > 1 && results?.items.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm font-medium">No results for "{debouncedQuery}"</p>
          <p className="text-xs mt-1">Try a different search term</p>
        </div>
      )}

      {/* Results */}
      {!isLoading && results && results.items.length > 0 && (
        <div className="space-y-6">
          {notes.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Notes ({notes.length})
              </h2>
              <div className="space-y-1">
                {notes.map(item => (
                  <button
                    key={item.id}
                    data-testid={`search-result-${item.id}`}
                    onClick={() => navigate(`/notes/${item.id}`)}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-muted transition-all group border border-transparent hover:border-border"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {highlight(item.title, debouncedQuery)}
                      </p>
                      {item.snippet && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {highlight(item.snippet, debouncedQuery)}
                        </p>
                      )}
                      {item.folderTitle && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5">{item.folderTitle}</p>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-opacity" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {attachments.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Documents ({attachments.length})
              </h2>
              <div className="space-y-1">
                {attachments.map(item => (
                  <button
                    key={item.id}
                    data-testid={`search-result-${item.id}`}
                    onClick={() => navigate("/library")}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-muted transition-all group border border-transparent hover:border-border"
                  >
                    <BookOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {highlight(item.title, debouncedQuery)}
                      </p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-opacity" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
