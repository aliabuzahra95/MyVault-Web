import { useState } from "react";
import { useLocation } from "wouter";
import { useListTags, useListNotes, getListNotesQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, FileText, ArrowLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function TagsPage() {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [, navigate] = useLocation();

  const { data: tags = [], isLoading } = useListTags();
  const { data: allNotes = [] } = useListNotes(
    {},
    { query: { queryKey: getListNotesQueryKey({}) } }
  );

  const filteredNotes = selectedTag
    ? allNotes.filter(n => (n.tagNames ?? []).includes(selectedTag))
    : [];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {selectedTag ? (
        <>
          <button
            data-testid="back-to-tags"
            onClick={() => setSelectedTag(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All Tags
          </button>
          <div className="flex items-center gap-2 mb-6">
            <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
              #{selectedTag}
            </div>
            <span className="text-sm text-muted-foreground">{filteredNotes.length} notes</span>
          </div>
          <div className="space-y-1">
            {filteredNotes.map(note => (
              <button
                key={note.id}
                data-testid={`tagged-note-${note.id}`}
                onClick={() => navigate(`/notes/${note.id}`)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-muted transition-all group border border-transparent hover:border-border"
              >
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{note.title}</p>
                  {note.bodyPreview && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{note.bodyPreview}</p>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">Tags</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{tags.length} tags across your notes</p>
          </div>

          {isLoading ? (
            <div className="flex flex-wrap gap-2">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-9 w-20" />)}
            </div>
          ) : tags.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Tag className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No tags yet</p>
              <p className="text-xs mt-1">Add tags to your notes to organize them</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.name}
                  data-testid={`tag-chip-${tag.name}`}
                  onClick={() => setSelectedTag(tag.name)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-card border border-card-border rounded-full hover:border-primary/60 hover:bg-primary/5 transition-all text-sm font-medium text-foreground"
                >
                  <span className="text-primary">#</span>
                  {tag.name}
                  <span className="text-xs text-muted-foreground ml-1 bg-muted px-1.5 py-0.5 rounded-full">
                    {tag.noteCount}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
