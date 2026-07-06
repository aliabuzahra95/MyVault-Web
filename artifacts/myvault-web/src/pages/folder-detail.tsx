import { useParams, useLocation } from "wouter";
import { useGetFolder, useListNotes, useCreateNote, getListNotesQueryKey, getGetFolderQueryKey, getListNotesQueryKey as notesKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pin, FileText, Plus, ArrowLeft, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Note } from "@workspace/api-client-react";

function NoteRow({ note, onClick }: { note: Note; onClick: () => void }) {
  return (
    <button
      data-testid={`note-row-${note.id}`}
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3.5 hover:bg-muted rounded-xl transition-all group border border-transparent hover:border-border"
    >
      <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">{note.title}</span>
          {note.isPinned && <Pin className="w-3 h-3 text-primary shrink-0" />}
        </div>
        {note.bodyPreview && (
          <p className="text-xs text-muted-foreground line-clamp-1">{note.bodyPreview}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {(note.tagNames ?? []).slice(0, 3).map(t => (
            <span key={t} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t}</span>
          ))}
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data: folder, isLoading: folderLoading } = useGetFolder(id!, {
    query: { enabled: !!id, queryKey: getGetFolderQueryKey(id!) },
  });
  const { data: notes = [], isLoading: notesLoading } = useListNotes(
    { folderId: id },
    { query: { enabled: !!id, queryKey: getListNotesQueryKey({ folderId: id }) } }
  );

  const createNote = useCreateNote({
    mutation: {
      onSuccess: (note) => {
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey({ folderId: id }) });
        setShowNew(false);
        setNewTitle("");
        navigate(`/notes/${note.id}`);
      },
    },
  });

  const pinned = notes.filter(n => n.isPinned);
  const unpinned = notes.filter(n => !n.isPinned);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <button
        data-testid="back-to-folders"
        onClick={() => navigate("/folders")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Folders
      </button>

      {/* Header */}
      {folderLoading ? (
        <Skeleton className="h-8 w-48 mb-1" />
      ) : (
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground" data-testid="folder-title">{folder?.title}</h1>
          {folder?.description && (
            <p className="text-sm text-muted-foreground mt-1">{folder.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">{notes.length} notes</p>
        </div>
      )}

      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-note-btn">
          <Plus className="w-4 h-4 mr-1.5" /> New Note
        </Button>
      </div>

      {notesLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No notes in this folder</p>
          <p className="text-xs mt-1">Create your first note to get started</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {pinned.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 mb-1 flex items-center gap-1"><Pin className="w-3 h-3" /> Pinned</p>
              {pinned.map(note => <NoteRow key={note.id} note={note} onClick={() => navigate(`/notes/${note.id}`)} />)}
            </div>
          )}
          {unpinned.length > 0 && (
            <div>
              {pinned.length > 0 && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 mb-1 mt-4">All Notes</p>}
              {unpinned.map(note => <NoteRow key={note.id} note={note} onClick={() => navigate(`/notes/${note.id}`)} />)}
            </div>
          )}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="note-title">Title</Label>
              <Input
                id="note-title"
                data-testid="input-note-title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Note title"
                onKeyDown={e => {
                  if (e.key === "Enter" && newTitle.trim())
                    createNote.mutate({ data: { title: newTitle.trim(), folderId: id } });
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button
                data-testid="button-create-note"
                disabled={!newTitle.trim() || createNote.isPending}
                onClick={() => createNote.mutate({ data: { title: newTitle.trim(), folderId: id } })}
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
