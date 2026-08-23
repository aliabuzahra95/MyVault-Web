import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetFolderQueryKey,
  getListFoldersQueryKey,
  getListNotesQueryKey,
  useCreateFolder,
  useCreateNote,
  useGetFolder,
  useListFolders,
  useListNotes,
} from "@workspace/api-client-react";
import type { Folder, Note } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderClosed,
  FolderOpen,
  Pin,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentViewToggle, type ContentViewMode } from "@/components/content-view-toggle";
import { PageContainer } from "@/components/page-layout";
import { useWorkspace } from "@/lib/providers";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return formatDistanceToNow(date, { addSuffix: true });
}

function sortedFolders(folders: Folder[]) {
  return [...folders].sort((first, second) => {
    const orderDifference = (first.orderIndex ?? 0) - (second.orderIndex ?? 0);
    return orderDifference || first.title.localeCompare(second.title);
  });
}

function sortedNotes(notes: Note[]) {
  return [...notes].sort((first, second) => {
    if (Boolean(first.isPinned) !== Boolean(second.isPinned)) return first.isPinned ? -1 : 1;
    const orderDifference = (first.orderIndex ?? 0) - (second.orderIndex ?? 0);
    return orderDifference || second.updatedAt - first.updatedAt;
  });
}

function breadcrumbFolders(folder: Folder | undefined, folders: Folder[]) {
  if (!folder) return [];
  const byId = new Map(folders.map((candidate) => [candidate.id, candidate]));
  const path: Folder[] = [];
  const visited = new Set<string>();
  let current: Folder | undefined = folder;

  while (current && !visited.has(current.id)) {
    path.unshift(current);
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path;
}

function initialVisualViewMode(): Exclude<ContentViewMode, "list"> {
  return localStorage.getItem("myvault-study-view") === "icon" ? "icon" : "grid";
}

interface SubfolderItemProps {
  folder: Folder;
  viewMode: ContentViewMode;
  onOpen: () => void;
}

function SubfolderItem({ folder, viewMode, onOpen }: SubfolderItemProps) {
  const noteLabel = `${folder.noteCount ?? 0} ${(folder.noteCount ?? 0) === 1 ? "note" : "notes"}`;

  if (viewMode === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`subfolder-${folder.id}`}
        className="group mb-1 flex min-h-16 w-full items-center gap-4 rounded-lg bg-card/45 px-3 py-3 text-left transition-colors hover:bg-card"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FolderClosed className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground group-hover:text-primary">{folder.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{noteLabel}</span>
        </span>
        {folder.description && (
          <span className="hidden max-w-72 truncate text-xs text-muted-foreground xl:block">{folder.description}</span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  if (viewMode === "icon") {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`subfolder-${folder.id}`}
        className="group flex min-h-28 min-w-0 flex-col items-center justify-center rounded-lg bg-card/40 px-3 py-3 text-center transition-all hover:bg-card hover:shadow-sm"
      >
        <FolderClosed className="mb-3 h-10 w-10 text-primary" strokeWidth={1.5} />
        <span className="w-full truncate text-sm font-medium text-foreground group-hover:text-primary">{folder.title}</span>
        <span className="mt-1 text-xs text-muted-foreground">{noteLabel}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`subfolder-${folder.id}`}
      className="group flex min-h-28 min-w-0 flex-col rounded-lg bg-card/75 p-3.5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FolderClosed className="h-5 w-5" />
        </span>
        <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <span className="w-full truncate text-sm font-semibold text-foreground group-hover:text-primary">{folder.title}</span>
      <span className="mt-1 text-xs text-muted-foreground">{noteLabel}</span>
    </button>
  );
}

interface NoteItemProps {
  note: Note;
  viewMode: ContentViewMode;
  onOpen: () => void;
}

function NoteItem({ note, viewMode, onOpen }: NoteItemProps) {
  if (viewMode === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`note-row-${note.id}`}
        className="group mb-1 flex min-h-20 w-full items-start gap-4 rounded-lg bg-card/35 px-3 py-3 text-left transition-colors hover:bg-card"
      >
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
          <FileText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{note.title}</span>
            {note.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </span>
          <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">{note.bodyPreview || "No preview available"}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
          <Clock className="h-3.5 w-3.5" /> {formatUpdatedAt(note.updatedAt)}
        </span>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  if (viewMode === "icon") {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`note-row-${note.id}`}
        className="group relative flex min-h-28 min-w-0 flex-col items-center justify-center rounded-lg bg-card/35 px-3 py-3 text-center transition-colors hover:bg-card hover:shadow-sm"
      >
        {note.isPinned && <Pin className="absolute right-3 top-3 h-3.5 w-3.5 text-primary" />}
        <FileText className="mb-3 h-9 w-9 text-muted-foreground group-hover:text-primary" strokeWidth={1.5} />
        <span className="w-full truncate text-sm font-medium text-foreground group-hover:text-primary">{note.title}</span>
        <span className="mt-1 text-xs text-muted-foreground">{note.wordCount ?? 0} words</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`note-row-${note.id}`}
      className="group flex min-h-36 min-w-0 flex-col rounded-lg bg-card/70 p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
          <FileText className="h-5 w-5" />
        </span>
        {note.isPinned && <Pin className="mt-1 h-3.5 w-3.5 text-primary" />}
      </div>
      <span className="w-full truncate text-sm font-semibold text-foreground group-hover:text-primary">{note.title}</span>
      <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note.bodyPreview || "No preview available"}</span>
      <span className="mt-auto pt-3 text-xs text-muted-foreground">{formatUpdatedAt(note.updatedAt)}</span>
    </button>
  );
}

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { workspace } = useWorkspace();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [viewMode, setViewModeState] = useState<Exclude<ContentViewMode, "list">>(initialVisualViewMode);
  const [newItemType, setNewItemType] = useState<"folder" | "note" | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const { data: folder, isLoading: folderLoading } = useGetFolder(id!, {
    query: { enabled: Boolean(id), queryKey: getGetFolderQueryKey(id!) },
  });
  const { data: allFolders = [], isLoading: foldersLoading } = useListFolders({ workspace, mode: "study" });
  const { data: notes = [], isLoading: notesLoading } = useListNotes(
    { folderId: id },
    { query: { enabled: Boolean(id), queryKey: getListNotesQueryKey({ folderId: id }) } },
  );

  const subfolders = sortedFolders(allFolders.filter((candidate) => candidate.parentId === id));
  const orderedNotes = sortedNotes(notes);
  const breadcrumbs = breadcrumbFolders(folder, allFolders);
  const isLoading = folderLoading || foldersLoading || notesLoading;
  const totalWords = notes.reduce((total, note) => total + (note.wordCount ?? 0), 0);

  const createFolder = useCreateFolder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey({ workspace, mode: "study" }) });
        closeDialog();
      },
    },
  });

  const createNote = useCreateNote({
    mutation: {
      onSuccess: (note) => {
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey({ folderId: id }) });
        closeDialog();
        navigate(`/notes/${note.id}`);
      },
    },
  });

  function openDialog(type: "folder" | "note") {
    setNewTitle("");
    setNewItemType(type);
  }

  function setViewMode(value: ContentViewMode) {
    localStorage.setItem("myvault-study-view", value);
    if (value === "list") {
      navigate(`/study?folder=${encodeURIComponent(id ?? "")}`);
      return;
    }
    setViewModeState(value);
  }

  function closeDialog() {
    setNewItemType(null);
    setNewTitle("");
  }

  function submitItem() {
    if (!id || !newTitle.trim() || !newItemType) return;
    if (newItemType === "folder") {
      createFolder.mutate({ data: { title: newTitle.trim(), parentId: id, workspace, mode: "study" } });
      return;
    }
    createNote.mutate({ data: { title: newTitle.trim(), folderId: id } });
  }

  const folderLayoutClassName = cn(
    viewMode === "grid" && "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
    viewMode === "icon" && "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5",
  );
  const noteLayoutClassName = cn(
    viewMode === "grid" && "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
    viewMode === "icon" && "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5",
  );

  return (
    <PageContainer>
      <nav aria-label="Study folder path" className="mb-4 flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
        <button
          type="button"
          data-testid="back-to-folders"
          onClick={() => navigate("/study")}
          className="flex shrink-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Study
        </button>
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.id} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            {index === breadcrumbs.length - 1 ? (
              <span className="truncate font-medium text-foreground">{crumb.title}</span>
            ) : (
              <button
                type="button"
                onClick={() => navigate(`/study/${crumb.id}`)}
                className="max-w-40 truncate text-muted-foreground hover:text-foreground"
              >
                {crumb.title}
              </button>
            )}
          </span>
        ))}
      </nav>

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {folderLoading ? (
          <div>
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-2 h-4 w-80 max-w-full" />
          </div>
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-foreground" data-testid="folder-title">
              {folder?.title || "Study folder"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {folder?.description || `${subfolders.length} folders · ${notes.length} notes`}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ContentViewToggle value={viewMode} onChange={setViewMode} />
          <Button variant="outline" size="sm" onClick={() => openDialog("folder")} data-testid="new-subfolder-btn">
            <FolderClosed className="h-4 w-4" /> New Folder
          </Button>
          <Button size="sm" onClick={() => openDialog("note")} data-testid="new-note-btn">
            <Plus className="h-4 w-4" /> New Note
          </Button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_270px]">
        <main className="min-w-0 space-y-10">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36" />)}
            </div>
          ) : (
            <>
              <section aria-labelledby="subfolders-heading">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 id="subfolders-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FolderOpen className="h-4 w-4 text-primary" /> Folders
                  </h2>
                  <span className="text-xs text-muted-foreground">{subfolders.length}</span>
                </div>
                {subfolders.length > 0 ? (
                  <div className={folderLayoutClassName}>
                    {subfolders.map((subfolder) => (
                      <SubfolderItem
                        key={subfolder.id}
                        folder={subfolder}
                        viewMode={viewMode}
                        onOpen={() => navigate(`/study/${subfolder.id}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-24 items-center justify-center rounded-lg bg-muted/25 px-4 text-center text-xs text-muted-foreground">
                    No subfolders in this folder
                  </div>
                )}
              </section>

              <section aria-labelledby="notes-heading">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 id="notes-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-primary" /> Notes
                  </h2>
                  <span className="text-xs text-muted-foreground">{notes.length}</span>
                </div>
                {orderedNotes.length > 0 ? (
                  <div className={noteLayoutClassName}>
                    {orderedNotes.map((note) => (
                      <NoteItem
                        key={note.id}
                        note={note}
                        viewMode={viewMode}
                        onOpen={() => navigate(`/notes/${note.id}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-36 flex-col items-center justify-center rounded-lg bg-muted/25 px-4 text-center text-muted-foreground">
                    <FileText className="mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm font-medium text-foreground">No notes in this folder</p>
                    <p className="mt-1 text-xs">Create a note here when you are ready.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </main>

        <aside className="self-start rounded-lg bg-card/45 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.035)]">
          <h2 className="text-sm font-semibold text-foreground">Folder details</h2>
          <dl className="mt-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Subfolders</dt>
              <dd className="text-sm font-semibold text-foreground">{subfolders.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Notes</dt>
              <dd className="text-sm font-semibold text-foreground">{notes.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Pinned notes</dt>
              <dd className="text-sm font-semibold text-foreground">{notes.filter((note) => note.isPinned).length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Words</dt>
              <dd className="text-sm font-semibold text-foreground">{totalWords.toLocaleString()}</dd>
            </div>
          </dl>

          {folder && (
            <div className="mt-7 rounded-md bg-background/65 px-3 py-2.5">
              <h3 className="text-xs font-semibold text-foreground">Updated</h3>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> {formatUpdatedAt(folder.updatedAt)}
              </p>
            </div>
          )}
        </aside>
      </div>

      <Dialog open={newItemType !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newItemType === "folder" ? "New Folder" : "New Note"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-item-title">{newItemType === "folder" ? "Name" : "Title"}</Label>
              <Input
                id="new-item-title"
                data-testid="input-new-item-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={newItemType === "folder" ? "Folder name" : "Note title"}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitItem();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                data-testid="button-create-item"
                disabled={!newTitle.trim() || createFolder.isPending || createNote.isPending}
                onClick={submitItem}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
