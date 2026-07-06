import { useLocation } from "wouter";
import { useGetHomeSnapshot, useListFolders } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/providers";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Pin, FileText, FolderOpen, BookOpen, Hash, AlignLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-xl font-semibold text-foreground leading-tight">{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function NoteCard({ note, onClick }: { note: { id: string; title: string; bodyPreview?: string | null; updatedAt: number; isPinned: boolean; tagNames: string[] }; onClick: () => void }) {
  return (
    <button
      data-testid={`note-card-${note.id}`}
      onClick={onClick}
      className="w-full text-left bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="font-medium text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">{note.title}</h3>
        {note.isPinned && <Pin className="w-3 h-3 text-primary shrink-0 mt-0.5" />}
      </div>
      {note.bodyPreview && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{note.bodyPreview}</p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {note.tagNames.slice(0, 2).map(tag => (
            <span key={tag} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
        </span>
      </div>
    </button>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const { workspace } = useWorkspace();

  const { data: snapshot, isLoading } = useGetHomeSnapshot({ workspace });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  const { recentNotes = [], pinnedNotes = [], stats, recentFolders = [] } = snapshot ?? {};

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground" data-testid="home-greeting">{greeting}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {workspace === "islamic_corpus" ? "Continuing your Islamic corpus study" : "Your personal knowledge vault"}
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Notes" value={stats.totalNotes ?? 0} icon={FileText} />
          <StatCard label="Folders" value={stats.totalFolders ?? 0} icon={FolderOpen} />
          <StatCard label="Documents" value={stats.totalAttachments ?? 0} icon={BookOpen} />
          <StatCard label="Words" value={stats.totalWordCount ?? 0} icon={AlignLeft} />
        </div>
      )}

      {/* Pinned notes */}
      {pinnedNotes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5 text-primary" /> Pinned
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pinnedNotes.map(note => (
              <NoteCard key={note.id} note={{ ...note, isPinned: note.isPinned ?? false, tagNames: note.tagNames ?? [] }} onClick={() => navigate(`/notes/${note.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Recent notes */}
      {recentNotes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Recent Notes</h2>
            <button
              data-testid="view-all-folders"
              onClick={() => navigate("/folders")}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              All folders <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentNotes.map(note => (
              <NoteCard key={note.id} note={{ ...note, isPinned: note.isPinned ?? false, tagNames: note.tagNames ?? [] }} onClick={() => navigate(`/notes/${note.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Recent folders */}
      {recentFolders && recentFolders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Recent Folders</h2>
          <div className="flex flex-wrap gap-2">
            {recentFolders.map(folder => (
              <button
                key={folder.id}
                data-testid={`folder-chip-${folder.id}`}
                onClick={() => navigate(`/folders/${folder.id}`)}
                className="flex items-center gap-2 px-3 py-2 bg-card border border-card-border rounded-lg hover:border-primary/40 transition-all text-sm"
              >
                <FolderOpen className="w-3.5 h-3.5 text-primary" />
                <span className="text-foreground font-medium">{folder.title}</span>
                <span className="text-xs text-muted-foreground">{folder.noteCount}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
