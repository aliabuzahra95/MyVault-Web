import { useState } from "react";
import { useListKnowledgeTags, useListKnowledgeTagLinks, useCreateKnowledgeTag, getListKnowledgeTagsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Network, FileText, BookOpen, Plus, ArrowLeft, Link2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { allNotes, attachments } from "@/mocks/data";

function LinkedItemRow({ link }: { link: { tagId: string; targetType: string; targetId: string; createdAt: number } }) {
  const [, navigate] = useLocation();
  const note = link.targetType === "note" ? allNotes.find(n => n.id === link.targetId) : null;
  const attachment = link.targetType === "attachment" ? attachments.find(a => a.id === link.targetId) : null;
  const item = note ?? attachment;
  if (!item) return null;
  const title = note ? note.title : (attachment as any).name;

  return (
    <button
      data-testid={`kt-link-${link.targetId}`}
      onClick={() => note ? navigate(`/notes/${note.id}`) : navigate("/library")}
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted transition-all group border border-transparent hover:border-border"
    >
      {link.targetType === "note"
        ? <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        : <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{title}</p>
        <p className="text-xs text-muted-foreground capitalize">{link.targetType}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDistanceToNow(new Date(link.createdAt), { addSuffix: true })}
      </span>
    </button>
  );
}

function KnowledgeTagLinks({ tagId }: { tagId: string }) {
  const { data: links = [], isLoading } = useListKnowledgeTagLinks(tagId);
  if (isLoading) return <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (links.length === 0) return <p className="text-sm text-muted-foreground px-4">No linked items yet.</p>;
  return (
    <div className="space-y-0.5">
      {links.map((link, i) => <LinkedItemRow key={i} link={link} />)}
    </div>
  );
}

export default function KnowledgeTagsPage() {
  const [selectedTag, setSelectedTag] = useState<{ id: string; name: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const queryClient = useQueryClient();

  const { data: tags = [], isLoading } = useListKnowledgeTags();
  const createTag = useCreateKnowledgeTag({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKnowledgeTagsQueryKey() });
        setShowNew(false);
        setNewName("");
      },
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {selectedTag ? (
        <>
          <button
            data-testid="back-to-kt"
            onClick={() => setSelectedTag(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Knowledge Tags
          </button>
          <div className="flex items-center gap-2 mb-6">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm font-medium">
              <Network className="w-3.5 h-3.5" />
              {selectedTag.name}
            </div>
          </div>
          <KnowledgeTagLinks tagId={selectedTag.id} />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Knowledge Tags</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Semantic links across your vault</p>
            </div>
            <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-kt-btn">
              <Plus className="w-4 h-4 mr-1.5" /> New Tag
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : tags.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No knowledge tags yet</p>
              <p className="text-xs mt-1">Create semantic tags to link related content across your vault</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  data-testid={`kt-card-${tag.id}`}
                  onClick={() => setSelectedTag({ id: tag.id, name: tag.name })}
                  className="w-full text-left flex items-center gap-3 px-4 py-3.5 bg-card border border-card-border rounded-xl hover:border-primary/40 transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Network className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{tag.name}</p>
                    <p className="text-xs text-muted-foreground">{tag.linkCount} linked items</p>
                  </div>
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Knowledge Tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="kt-name">Name</Label>
              <Input
                id="kt-name"
                data-testid="input-kt-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Tawakkul, Gratitude, Learning..."
                onKeyDown={e => {
                  if (e.key === "Enter" && newName.trim())
                    createTag.mutate({ data: { name: newName.trim() } });
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button
                data-testid="button-create-kt"
                disabled={!newName.trim() || createTag.isPending}
                onClick={() => createTag.mutate({ data: { name: newName.trim() } })}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
