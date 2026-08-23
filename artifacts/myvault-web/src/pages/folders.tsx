import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  getListFoldersQueryKey,
  getListNotesQueryKey,
  useCreateFolder,
  useCreateNote,
  useListFolders,
  useListNotes,
} from "@workspace/api-client-react";
import type { Folder, Note } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen, FolderPlus, Minimize2, MoreHorizontal, Pin, Plus, Trash2, UnfoldVertical } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentViewToggle, type ContentViewMode } from "@/components/content-view-toggle";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { StudyTree } from "@/components/study/study-tree";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { useWorkspace } from "@/lib/providers";
import { consumePendingCreate, PENDING_CREATE_EVENT } from "@/lib/navigation/pendingCreate";
import { consumePendingManage, PENDING_MANAGE_EVENT } from "@/lib/navigation/pendingManage";
import {
  removeLocalStudyFolder,
  removeLocalStudyNote,
  updateLocalStudyFolder,
  updateLocalStudyNote,
} from "@/lib/study/localStudy";
import { cn } from "@/lib/utils";

const TOP_LEVEL_VALUE = "__top__";

type ManagedStudyItem =
  | { kind: "folder"; value: Folder }
  | { kind: "note"; value: Note };

function sortedFolders(folders: Folder[]) {
  return [...folders].sort((first, second) => {
    const orderDifference = (first.orderIndex ?? 0) - (second.orderIndex ?? 0);
    return orderDifference || first.title.localeCompare(second.title);
  });
}

function rootFolders(folders: Folder[]) {
  const folderIds = new Set(folders.map((folder) => folder.id));
  return sortedFolders(folders.filter((folder) => !folder.parentId || !folderIds.has(folder.parentId)));
}

function folderOptions(folders: Folder[]) {
  const childrenByParent = new Map<string | null, Folder[]>();
  const folderIds = new Set(folders.map((folder) => folder.id));

  folders.forEach((folder) => {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  });

  const options: Array<{ folder: Folder; depth: number }> = [];
  function append(parentId: string | null, depth: number) {
    sortedFolders(childrenByParent.get(parentId) ?? []).forEach((folder) => {
      options.push({ folder, depth });
      append(folder.id, depth + 1);
    });
  }
  append(null, 0);
  return options;
}

function descendantIds(folders: Folder[], rootId: string) {
  const ids = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    folders.forEach((folder) => {
      if (folder.parentId === parentId && !ids.has(folder.id)) {
        ids.add(folder.id);
        queue.push(folder.id);
      }
    });
  }

  return ids;
}

function ancestorIds(folders: Folder[], folderId: string) {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const ids = new Set<string>();
  let current = foldersById.get(folderId);

  while (current && !ids.has(current.id)) {
    ids.add(current.id);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }

  return ids;
}

function folderSummary(folder: Folder, folders: Folder[], notes: Note[]) {
  const descendants = descendantIds(folders, folder.id);
  const includedFolderIds = new Set([folder.id, ...descendants]);
  const directFolders = folders.filter((candidate) => candidate.parentId === folder.id).length;
  const totalNotes = notes.filter((note) => note.folderId && includedFolderIds.has(note.folderId)).length;

  return { directFolders, totalNotes };
}

interface FolderVisualItemProps {
  folder: Folder;
  folders: Folder[];
  notes: Note[];
  viewMode: Exclude<ContentViewMode, "list">;
  onExpand: () => void;
  onCreate: (type: "folder" | "note") => void;
  onManage: () => void;
}

function FolderVisualItem({ folder, folders, notes, viewMode, onExpand, onCreate, onManage }: FolderVisualItemProps) {
  const summary = folderSummary(folder, folders, notes);
  const description = [
    `${summary.directFolders} ${summary.directFolders === 1 ? "folder" : "folders"}`,
    `${summary.totalNotes} ${summary.totalNotes === 1 ? "note" : "notes"}`,
  ].join(" · ");

  if (viewMode === "icon") {
    return (
      <div className="group relative min-w-0">
        <button
          type="button"
          onClick={onExpand}
          data-testid={`folder-node-${folder.id}`}
          className="flex min-h-32 w-full min-w-0 flex-col items-center justify-center rounded-lg bg-white/70 px-3 py-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]"
        >
          <FolderClosed className="mb-3 h-9 w-9 text-primary" strokeWidth={1.5} />
          <span className="w-full truncate text-sm font-semibold text-slate-800 group-hover:text-slate-950">{folder.title}</span>
          <span className="mt-1 text-xs text-slate-400">{summary.totalNotes} notes</span>
        </button>
        <button
          type="button"
          aria-label={`Manage ${folder.title}`}
          title={`Rename, move, or delete ${folder.title}`}
          onClick={onManage}
          className="absolute right-11 top-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 opacity-70 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <FolderAddMenu folder={folder} onCreate={onCreate} />
      </div>
    );
  }

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onExpand}
        data-testid={`folder-node-${folder.id}`}
        className="flex min-h-36 w-full min-w-0 flex-col rounded-lg bg-white/85 p-4 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
            <FolderClosed className="h-5 w-5" />
          </span>
          <ChevronRight className="mt-1 mr-7 h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <span className="w-full truncate text-sm font-semibold text-slate-800 group-hover:text-slate-950">{folder.title}</span>
        <span className="mt-1 text-xs text-slate-400">{description}</span>
      </button>
      <button
        type="button"
        aria-label={`Manage ${folder.title}`}
        title={`Rename, move, or delete ${folder.title}`}
        onClick={onManage}
        className="absolute right-11 top-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 opacity-70 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <FolderAddMenu folder={folder} onCreate={onCreate} />
    </div>
  );
}

function FolderAddMenu({ folder, onCreate }: { folder: Folder; onCreate: (type: "folder" | "note") => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Add inside ${folder.title}`}
          title={`Add inside ${folder.title}`}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shadow-sm transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onCreate("folder")}>
          <FolderPlus className="h-4 w-4" /> Subfolder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreate("note")}>
          <FileText className="h-4 w-4" /> Note
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialViewMode(): ContentViewMode {
  const saved = localStorage.getItem("myvault-study-view");
  return saved === "grid" || saved === "icon" || saved === "list" ? saved : "list";
}

export default function FoldersPage() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { corpus, isLoading: restoredCorpusLoading } = useRestoredCorpus();
  const [viewMode, setViewModeState] = useState<ContentViewMode>(initialViewMode);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [newItemType, setNewItemType] = useState<"folder" | "note" | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newItemFolderId, setNewItemFolderId] = useState("");
  const [managedItem, setManagedItem] = useState<ManagedStudyItem | null>(null);
  const [managedTitle, setManagedTitle] = useState("");
  const [managedFolderId, setManagedFolderId] = useState(TOP_LEVEL_VALUE);
  const [manageError, setManageError] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const { data: restoredStudyFolders = [], isLoading: foldersLoading } = useListFolders({ workspace, mode: "study" });
  const { data: allNotes = [], isLoading: notesLoading } = useListNotes({ workspace });
  const courseFolderIds = new Set(corpus?.courseFolderIds ?? []);
  const folders = restoredStudyFolders.filter((folder) => !courseFolderIds.has(folder.id));
  const studyFolderIds = new Set(folders.map((folder) => folder.id));
  const notes = allNotes.filter((note) => !note.folderId || studyFolderIds.has(note.folderId));
  const rootNotes = notes.filter((note) => !note.folderId);
  const stickyNotes = (corpus?.folderStickyNotes ?? []).filter((stickyNote) => studyFolderIds.has(stickyNote.folderId));
  const roots = rootFolders(folders);
  const noteFolderOptions = folderOptions(folders);
  const managedExcludedFolderIds = managedItem?.kind === "folder"
    ? new Set([managedItem.value.id, ...descendantIds(folders, managedItem.value.id)])
    : new Set<string>();
  const managedFolderOptions = noteFolderOptions.filter(({ folder }) => !managedExcludedFolderIds.has(folder.id));
  const managedFolderIsEmpty = managedItem?.kind !== "folder" || (
    !folders.some((folder) => folder.parentId === managedItem.value.id)
    && !notes.some((note) => note.folderId === managedItem.value.id)
  );
  const isLoading = foldersLoading || notesLoading || restoredCorpusLoading;

  useEffect(() => {
    const folderId = new URLSearchParams(window.location.search).get("folder");
    if (!folderId || folders.length === 0) return;

    setExpandedFolderIds((current) => {
      const next = new Set([...current, ...ancestorIds(folders, folderId)]);
      return next.size === current.size ? current : next;
    });
    setViewModeState("list");
    localStorage.setItem("myvault-study-view", "list");

  }, [folders]);

  useEffect(() => {
    if (folders.length === 0 && notes.length === 0) return;
    const openPendingManage = () => {
      const request = consumePendingManage("study");
      if (!request) return;
      if (request.kind === "folder") {
        const folder = folders.find((item) => item.id === request.itemId);
        if (folder) openManageFolder(folder);
      } else if (request.kind === "note") {
        const note = notes.find((item) => item.id === request.itemId);
        if (note) openManageNote(note);
      }
    };
    window.addEventListener(PENDING_MANAGE_EVENT, openPendingManage);
    return () => window.removeEventListener(PENDING_MANAGE_EVENT, openPendingManage);
  }, [folders, notes]);

  useEffect(() => {
    if (folders.length === 0) return;
    const openPendingCreate = () => {
      const request = consumePendingCreate("study");
      if (!request || !folders.some((folder) => folder.id === request.folderId)) return;
      if (request.type === "folder" || request.type === "note") openDialog(request.type, request.folderId);
    };
    window.addEventListener(PENDING_CREATE_EVENT, openPendingCreate);
    return () => window.removeEventListener(PENDING_CREATE_EVENT, openPendingCreate);
  }, [folders]);

  const createFolder = useCreateFolder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
        closeDialog();
      },
    },
  });

  const createNote = useCreateNote({
    mutation: {
      onSuccess: (note) => {
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
        closeDialog();
        navigate(`/notes/${note.id}`);
      },
    },
  });

  function setViewMode(value: ContentViewMode) {
    setViewModeState(value);
    localStorage.setItem("myvault-study-view", value);
  }

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function openFolderFromVisualView(folderId: string) {
    navigate(`/study/${folderId}`);
  }

  function openDialog(type: "folder" | "note", folderId?: string) {
    setNewItemType(type);
    setNewTitle("");
    if (folderId) {
      setNewItemFolderId(folderId);
    } else if (type === "note") {
      const inbox = folders.find((folder) => folder.title.trim().toLowerCase() === "inbox");
      setNewItemFolderId(inbox?.id ?? roots[0]?.id ?? TOP_LEVEL_VALUE);
    } else {
      setNewItemFolderId("");
    }
  }

  function closeDialog() {
    setNewItemType(null);
    setNewTitle("");
    setNewItemFolderId("");
  }

  function submitItem() {
    if (!newTitle.trim() || !newItemType) return;
    if (newItemType === "folder") {
      createFolder.mutate({ data: { title: newTitle.trim(), parentId: newItemFolderId || null, workspace, mode: "study" } });
      return;
    }
    createNote.mutate({ data: { title: newTitle.trim(), folderId: newItemFolderId === TOP_LEVEL_VALUE ? null : newItemFolderId } });
  }

  function openManageFolder(folder: Folder) {
    setManagedItem({ kind: "folder", value: folder });
    setManagedTitle(folder.title);
    setManagedFolderId(folder.parentId ?? TOP_LEVEL_VALUE);
    setManageError(null);
  }

  function openManageNote(note: Note) {
    setManagedItem({ kind: "note", value: note });
    setManagedTitle(note.title);
    setManagedFolderId(note.folderId ?? TOP_LEVEL_VALUE);
    setManageError(null);
  }

  function closeManageDialog() {
    setManagedItem(null);
    setManagedTitle("");
    setManagedFolderId(TOP_LEVEL_VALUE);
    setManageError(null);
    setShowDeleteConfirmation(false);
  }

  async function refreshStudyItems() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() }),
    ]);
  }

  async function saveManagedItem() {
    if (!managedItem || !managedTitle.trim() || isManaging) return;
    setIsManaging(true);
    setManageError(null);
    try {
      if (managedItem.kind === "folder") {
        await updateLocalStudyFolder(
          managedItem.value,
          managedTitle,
          managedFolderId === TOP_LEVEL_VALUE ? null : managedFolderId,
        );
      } else {
        await updateLocalStudyNote(managedItem.value, managedTitle, managedFolderId === TOP_LEVEL_VALUE ? null : managedFolderId);
      }
      await refreshStudyItems();
      closeManageDialog();
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : "The item could not be updated.");
    } finally {
      setIsManaging(false);
    }
  }

  function requestDelete(item: ManagedStudyItem) {
    if (item.kind === "folder") openManageFolder(item.value);
    else openManageNote(item.value);
    setShowDeleteConfirmation(true);
  }

  async function deleteManagedItem() {
    if (!managedItem || isManaging) return;
    setIsManaging(true);
    setManageError(null);
    try {
      if (managedItem.kind === "folder") {
        if (!managedFolderIsEmpty) throw new Error("Move or delete this folder's contents before deleting it.");
        await removeLocalStudyFolder(managedItem.value);
      } else {
        await removeLocalStudyNote(managedItem.value);
      }
      await refreshStudyItems();
      closeManageDialog();
    } catch (cause) {
      setShowDeleteConfirmation(false);
      setManageError(cause instanceof Error ? cause.message : "The item could not be deleted.");
    } finally {
      setIsManaging(false);
    }
  }

  const pinnedNotes = notes.filter((note) => note.isPinned);
  const recentNotes = [...notes].sort((first, second) => second.updatedAt - first.updatedAt).slice(0, 5);
  const visualLayoutClassName = cn(
    viewMode === "grid" && "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
    viewMode === "icon" && "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5",
  );

  return (
    <PageContainer>
      <PageHeader
        title="Study"
        description={`${folders.length} folders · ${notes.length} notes`}
        actions={(
          <div className="flex items-center gap-3">
          <ContentViewToggle value={viewMode} onChange={setViewMode} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" data-testid="study-add-menu" className="border-0 shadow-[0_4px_14px_rgba(15,23,42,0.12)]">
                <Plus className="h-4 w-4" /> Add <ChevronDown className="h-3.5 w-3.5 opacity-75" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => openDialog("folder")} data-testid="new-folder-btn">
                <FolderPlus className="h-4 w-4" /> Folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog("note")} data-testid="new-note-btn">
                <FileText className="h-4 w-4" /> Note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}
      />

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[minmax(0,1fr)_310px]">
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Knowledge tree</h2>
              <p className="mt-0.5 text-xs text-slate-400">{roots.length} top-level folders</p>
            </div>
            {viewMode === "list" && roots.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedFolderIds(new Set(folders.map((folder) => folder.id)))}
                  className="text-slate-500 hover:text-slate-900"
                >
                  <UnfoldVertical className="h-4 w-4" /> Expand all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedFolderIds(new Set())}
                  className="text-slate-500 hover:text-slate-900"
                >
                  <Minimize2 className="h-4 w-4" /> Collapse all
                </Button>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 rounded-lg" />)}
            </div>
          ) : roots.length === 0 && rootNotes.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-white/60 text-center text-slate-400">
              <FolderOpen className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm font-medium text-slate-700">No study folders yet</p>
              <p className="mt-1 text-xs">Restored folders and notes will appear here</p>
            </div>
          ) : viewMode === "list" ? (
            <StudyTree
              roots={roots}
              folders={folders}
              notes={notes}
              rootNotes={rootNotes}
              stickyNotes={stickyNotes}
              expandedFolderIds={expandedFolderIds}
              onToggleFolder={toggleFolder}
              onOpenNote={(noteId) => navigate(`/notes/${noteId}`)}
              onCreateInFolder={(folderId, type) => {
                if (type === "folder" || type === "note") openDialog(type, folderId);
              }}
              onManageFolder={openManageFolder}
              onManageNote={openManageNote}
              onDeleteFolder={(folder) => requestDelete({ kind: "folder", value: folder })}
              onDeleteNote={(note) => requestDelete({ kind: "note", value: note })}
            />
          ) : (
            <div className={visualLayoutClassName}>
              {roots.map((folder) => (
                <FolderVisualItem
                  key={folder.id}
                  folder={folder}
                  folders={folders}
                  notes={notes}
                  viewMode={viewMode}
                  onExpand={() => openFolderFromVisualView(folder.id)}
                  onCreate={(type) => openDialog(type, folder.id)}
                  onManage={() => openManageFolder(folder)}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="min-w-0 space-y-8">
          <section aria-labelledby="study-glance-heading">
            <h2 id="study-glance-heading" className="text-sm font-semibold text-slate-800">At a glance</h2>
            <div className="mt-4 grid grid-cols-3 gap-5">
              <div>
                <p className="text-xl font-semibold text-slate-900">{roots.length}</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">Top level</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-900">{Math.max(folders.length - roots.length, 0)}</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">Nested</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-900">{notes.length}</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">Notes</p>
              </div>
            </div>
          </section>

          {pinnedNotes.length > 0 && (
            <section aria-labelledby="pinned-notes-heading">
              <h2 id="pinned-notes-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Pin className="h-4 w-4 text-sky-600" /> Pinned
              </h2>
              <div className="mt-2 space-y-1">
                {pinnedNotes.slice(0, 3).map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => navigate(`/notes/${note.id}`)}
                    className="block w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/80"
                  >
                    <span className="block truncate text-sm font-medium text-slate-700 hover:text-slate-950">{note.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="recent-notes-heading">
            <h2 id="recent-notes-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileText className="h-4 w-4 text-primary" /> Recent notes
            </h2>
            <div className="mt-2 space-y-1">
              {recentNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => navigate(`/notes/${note.id}`)}
                  className="block w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/80"
                >
                  <span className="block truncate text-sm font-medium text-slate-700 hover:text-slate-950">{note.title}</span>
                  <span className="mt-1 block truncate text-xs text-slate-400">{note.bodyPreview || "No preview available"}</span>
                </button>
              ))}
              {!isLoading && recentNotes.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-400">No notes to show yet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <Dialog open={newItemType !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newItemType === "note" ? "New Note" : "New Folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-item-title">{newItemType === "note" ? "Title" : "Name"}</Label>
              <Input
                id="new-item-title"
                data-testid="input-new-item-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={newItemType === "note" ? "Note title" : "Folder name"}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitItem();
                }}
              />
            </div>
            {newItemType && (
              <div>
                <Label htmlFor="new-note-folder">Location</Label>
                {noteFolderOptions.length > 0 || newItemType === "note" ? (
                  <Select value={newItemFolderId || "__top__"} onValueChange={(value) => setNewItemFolderId(value === "__top__" ? "" : value)}>
                    <SelectTrigger id="new-note-folder" data-testid="select-new-note-folder">
                      <SelectValue placeholder="Choose a folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__top__">{newItemType === "note" ? "Study root" : "Top level"}</SelectItem>
                      {noteFolderOptions.map(({ folder, depth }) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          <span style={{ paddingLeft: `${depth * 12}px` }}>{folder.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">This folder will be created at the top level.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                data-testid="button-create-item"
                disabled={
                  !newTitle.trim()
                  || createFolder.isPending
                  || createNote.isPending
                }
                onClick={submitItem}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={managedItem !== null && !showDeleteConfirmation} onOpenChange={(open) => !open && closeManageDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{managedItem?.kind === "folder" ? "Manage Folder" : "Manage Note"}</DialogTitle>
          </DialogHeader>
          {managedItem ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="managed-study-title">Name</Label>
                <Input id="managed-study-title" value={managedTitle} onChange={(event) => setManagedTitle(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="managed-study-location">Location</Label>
                <Select value={managedFolderId} onValueChange={setManagedFolderId}>
                  <SelectTrigger id="managed-study-location"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TOP_LEVEL_VALUE}>{managedItem.kind === "note" ? "Study root" : "Top level"}</SelectItem>
                    {managedFolderOptions.map(({ folder, depth }) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        <span style={{ paddingLeft: `${depth * 12}px` }}>{folder.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {managedItem.kind === "folder" && !managedFolderIsEmpty ? (
                <p className="text-xs text-muted-foreground">This folder must be empty before it can be deleted.</p>
              ) : null}
              {manageError ? <p role="alert" className="text-sm text-destructive">{manageError}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isManaging || !managedFolderIsEmpty}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDeleteConfirmation(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={closeManageDialog}>Cancel</Button>
                  <Button type="button" disabled={!managedTitle.trim() || isManaging} onClick={() => void saveManagedItem()}>
                    {isManaging ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {managedItem?.kind === "folder" ? "folder" : "note"}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the web-created item from this browser.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteManagedItem()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
