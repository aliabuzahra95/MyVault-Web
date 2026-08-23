import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  getListAttachmentsQueryKey,
  getListFoldersQueryKey,
  useCreateFolder,
  useListAttachments,
  useListFolders,
} from "@workspace/api-client-react";
import type { Attachment, Folder } from "@workspace/api-client-react";
import { BookOpen, FileText, FolderPlus, Minimize2, MoreHorizontal, Pin, Search, Trash2, UnfoldVertical, Upload } from "lucide-react";
import { ContentViewToggle, type ContentViewMode } from "@/components/content-view-toggle";
import { LibraryTree } from "@/components/library/library-tree";
import { PageContainer, PageHeader } from "@/components/page-layout";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createLocalLibraryPdf,
  removeLocalLibraryAttachment,
  removeLocalLibraryFolder,
  updateLocalLibraryAttachment,
  updateLocalLibraryFolder,
} from "@/lib/library/localLibrary";
import { useWorkspace } from "@/lib/providers";
import { consumePendingCreate, PENDING_CREATE_EVENT } from "@/lib/navigation/pendingCreate";
import { consumePendingManage, PENDING_MANAGE_EVENT } from "@/lib/navigation/pendingManage";
import { cn } from "@/lib/utils";

const ROOT_FOLDER_VALUE = "__root__";
const UNFILED_VALUE = "__unfiled__";

type ManagedLibraryItem =
  | { kind: "folder"; value: Folder }
  | { kind: "attachment"; value: Attachment };

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
  const options: Array<{ folder: Folder; depth: number }> = [];

  function addChildren(parentId: string | null, depth: number) {
    sortedFolders(folders.filter((folder) => (folder.parentId ?? null) === parentId)).forEach((folder) => {
      options.push({ folder, depth });
      addChildren(folder.id, depth + 1);
    });
  }

  const folderIds = new Set(folders.map((folder) => folder.id));
  sortedFolders(folders.filter((folder) => !folder.parentId || !folderIds.has(folder.parentId))).forEach((folder) => {
    options.push({ folder, depth: 0 });
    addChildren(folder.id, 1);
  });

  return options;
}

function descendantFolderIds(folders: Folder[], folderId: string) {
  const result = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    folders.forEach((folder) => {
      if (folder.parentId === currentId && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
    });
  }
  return result;
}

function ancestorFolderIds(folders: Folder[], folderId: string) {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const result = new Set<string>();
  let current = foldersById.get(folderId);
  while (current && !result.has(current.id)) {
    result.add(current.id);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return result;
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initialViewMode(): ContentViewMode {
  const saved = localStorage.getItem("myvault-library-view");
  return saved === "grid" || saved === "icon" || saved === "list" ? saved : "list";
}

function DocumentCard({ attachment, compact, onOpen, onManage }: { attachment: Attachment; compact: boolean; onOpen: () => void; onManage: () => void }) {
  const progress = Math.max(0, Math.min(attachment.readingProgressPercent ?? 0, 100));
  const canManage = true;
  return (
    <div
      className={cn(
        "group relative min-w-0 bg-white/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]",
        compact ? "min-h-32 rounded-lg" : "min-h-48 rounded-lg",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid={`library-card-${attachment.id}`}
        className={cn("h-full w-full text-left", compact ? "flex min-h-32 flex-col items-center justify-center px-3 py-4 text-center" : "min-h-48 p-4")}
      >
        <span className={cn("flex items-center", compact ? "flex-col" : "justify-between")}>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <FileText className="h-5 w-5" />
          </span>
          {attachment.isPinned ? <Pin className={cn("h-3.5 w-3.5 text-amber-600", compact && "mt-2")} /> : null}
        </span>
        <span className={cn("block w-full truncate text-sm font-semibold text-slate-800 group-hover:text-slate-950", compact ? "mt-3" : "mt-5")}>{attachment.name}</span>
        <span className="mt-1 block text-xs text-slate-400">{formatBytes(attachment.sizeBytes)}</span>
        {!compact && attachment.readingProgressPercent != null ? (
          <span className="mt-5 block">
            <span className="flex items-center justify-between text-[11px] text-slate-400"><span>Reading progress</span><span>{Math.round(progress)}%</span></span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></span>
          </span>
        ) : null}
      </button>
      {canManage ? (
        <button
          type="button"
          onClick={onManage}
          data-testid={`manage-library-card-${attachment.id}`}
          aria-label={`Manage ${attachment.name}`}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-white/75 text-slate-500 opacity-80 hover:bg-white hover:text-slate-800 group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export default function LibraryPage() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showPinned, setShowPinned] = useState(false);
  const [viewMode, setViewModeState] = useState<ContentViewMode>(initialViewMode);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [dialogType, setDialogType] = useState<"folder" | "upload" | null>(null);
  const [newFolderTitle, setNewFolderTitle] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState(ROOT_FOLDER_VALUE);
  const [uploadFolderId, setUploadFolderId] = useState(UNFILED_VALUE);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [managedItem, setManagedItem] = useState<ManagedLibraryItem | null>(null);
  const [managedName, setManagedName] = useState("");
  const [managedLocationId, setManagedLocationId] = useState(ROOT_FOLDER_VALUE);
  const [manageError, setManageError] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const { data: folders = [], isLoading: foldersLoading } = useListFolders({ workspace, mode: "library" });
  const { data: attachments = [], isLoading: attachmentsLoading } = useListAttachments(showPinned ? { isPinned: true } : {});
  const isLoading = foldersLoading || attachmentsLoading;

  const filteredAttachments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? attachments.filter((attachment) => attachment.name.toLowerCase().includes(query)) : attachments;
  }, [attachments, search]);

  const roots = rootFolders(folders);
  const libraryFolderOptions = folderOptions(folders);
  const managedFolderExcludedIds = managedItem?.kind === "folder"
    ? new Set([managedItem.value.id, ...descendantFolderIds(folders, managedItem.value.id)])
    : new Set<string>();
  const managedLocationOptions = libraryFolderOptions.filter(({ folder }) => !managedFolderExcludedIds.has(folder.id));
  const managedFolderIsEmpty = managedItem?.kind !== "folder" || (
    !folders.some((folder) => folder.parentId === managedItem.value.id)
    && !attachments.some((attachment) => attachment.libraryFolderId === managedItem.value.id)
  );
  const pinnedDocuments = attachments.filter((attachment) => attachment.isPinned);
  const recentDocuments = [...attachments].sort((first, second) => second.updatedAt - first.updatedAt).slice(0, 5);
  const activeFolderId = useMemo(() => {
    const folderId = new URLSearchParams(location.split("?")[1] ?? "").get("folder");
    return folderId && folders.some((folder) => folder.id === folderId) ? folderId : null;
  }, [folders, location]);

  useEffect(() => {
    const query = location.split("?")[1] ?? "";
    const folderId = new URLSearchParams(query).get("folder");
    if (!folderId || folders.length === 0) return;
    setExpandedFolderIds((current) => {
      const next = new Set([...current, ...ancestorFolderIds(folders, folderId)]);
      return next.size === current.size ? current : next;
    });
    setViewModeState("list");
    localStorage.setItem("myvault-library-view", "list");

  }, [folders, location, navigate]);

  useEffect(() => {
    if (folders.length === 0) return;
    const openPendingCreate = () => {
      const request = consumePendingCreate("library");
      if (!request || !folders.some((folder) => folder.id === request.folderId)) return;
      if (request.type === "folder") openFolderCreateDialog(request.folderId);
      else if (request.type === "upload") openUploadDialog(request.folderId);
    };
    window.addEventListener(PENDING_CREATE_EVENT, openPendingCreate);
    return () => window.removeEventListener(PENDING_CREATE_EVENT, openPendingCreate);
  }, [folders]);

  useEffect(() => {
    if (folders.length === 0 && attachments.length === 0) return;
    const openPendingManage = () => {
      const request = consumePendingManage("library");
      if (!request) return;
      if (request.kind === "folder") {
        const folder = folders.find((item) => item.id === request.itemId);
        if (folder) openManageFolder(folder);
      } else if (request.kind === "attachment") {
        const attachment = attachments.find((item) => item.id === request.itemId);
        if (attachment) openManageAttachment(attachment);
      }
    };
    window.addEventListener(PENDING_MANAGE_EVENT, openPendingManage);
    return () => window.removeEventListener(PENDING_MANAGE_EVENT, openPendingManage);
  }, [attachments, folders]);

  function setViewMode(value: ContentViewMode) {
    setViewModeState(value);
    localStorage.setItem("myvault-library-view", value);
  }

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function closeDialog() {
    setDialogType(null);
    setNewFolderTitle("");
    setNewFolderParentId(ROOT_FOLDER_VALUE);
    setUploadFolderId(UNFILED_VALUE);
    setUploadFile(null);
    setUploadError(null);
  }

  function openFolderCreateDialog(parentId?: string) {
    setDialogType("folder");
    setNewFolderTitle("");
    setNewFolderParentId(parentId ?? activeFolderId ?? ROOT_FOLDER_VALUE);
  }

  function openUploadDialog(folderId?: string) {
    setDialogType("upload");
    setUploadFolderId(folderId ?? activeFolderId ?? UNFILED_VALUE);
    setUploadFile(null);
    setUploadError(null);
  }

  const createFolder = useCreateFolder({
    mutation: {
      onSuccess: (folder) => {
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
        if (folder.parentId) {
          setExpandedFolderIds((current) => new Set([...current, folder.parentId!]));
        }
        closeDialog();
      },
    },
  });

  function submitFolder() {
    if (!newFolderTitle.trim()) return;
    createFolder.mutate({
      data: {
        title: newFolderTitle.trim(),
        parentId: newFolderParentId === ROOT_FOLDER_VALUE ? null : newFolderParentId,
        workspace,
        mode: "library",
      },
    });
  }

  async function submitUpload() {
    if (!uploadFile || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const attachment = await createLocalLibraryPdf(
        uploadFile,
        uploadFolderId === UNFILED_VALUE ? null : uploadFolderId,
      );
      await queryClient.invalidateQueries({ queryKey: getListAttachmentsQueryKey() });
      closeDialog();
      navigate(`/library/document/${attachment.id}`);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "The PDF could not be added.");
    } finally {
      setIsUploading(false);
    }
  }

  function openManageFolder(folder: Folder) {
    setManagedItem({ kind: "folder", value: folder });
    setManagedName(folder.title);
    setManagedLocationId(folder.parentId ?? ROOT_FOLDER_VALUE);
    setManageError(null);
  }

  function openManageAttachment(attachment: Attachment) {
    setManagedItem({ kind: "attachment", value: attachment });
    setManagedName(attachment.name);
    setManagedLocationId(attachment.libraryFolderId ?? UNFILED_VALUE);
    setManageError(null);
  }

  function closeManageDialog() {
    setManagedItem(null);
    setManagedName("");
    setManagedLocationId(ROOT_FOLDER_VALUE);
    setManageError(null);
    setShowDeleteConfirmation(false);
  }

  async function refreshLibraryItems() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAttachmentsQueryKey() }),
    ]);
  }

  async function saveManagedItem() {
    if (!managedItem || !managedName.trim() || isManaging) return;
    setIsManaging(true);
    setManageError(null);
    try {
      if (managedItem.kind === "folder") {
        await updateLocalLibraryFolder(
          managedItem.value,
          managedName,
          managedLocationId === ROOT_FOLDER_VALUE ? null : managedLocationId,
        );
      } else {
        await updateLocalLibraryAttachment(
          managedItem.value,
          managedName,
          managedLocationId === UNFILED_VALUE ? null : managedLocationId,
        );
      }
      await refreshLibraryItems();
      closeManageDialog();
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : "The item could not be updated.");
    } finally {
      setIsManaging(false);
    }
  }

  async function deleteManagedItem() {
    if (!managedItem || isManaging) return;
    setIsManaging(true);
    setManageError(null);
    try {
      if (managedItem.kind === "folder") {
        if (!managedFolderIsEmpty) throw new Error("Move or delete this folder's contents before deleting the folder.");
        await removeLocalLibraryFolder(managedItem.value);
        setExpandedFolderIds((current) => {
          const next = new Set(current);
          next.delete(managedItem.value.id);
          return next;
        });
      } else {
        await removeLocalLibraryAttachment(managedItem.value);
      }
      await refreshLibraryItems();
      closeManageDialog();
    } catch (cause) {
      setShowDeleteConfirmation(false);
      setManageError(cause instanceof Error ? cause.message : "The item could not be deleted.");
    } finally {
      setIsManaging(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Library"
        description={`${folders.length} folders · ${attachments.length} documents`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <ContentViewToggle value={viewMode} onChange={setViewMode} />
            <Button type="button" variant="outline" size="sm" onClick={() => openFolderCreateDialog()} data-testid="new-library-folder-btn">
              <FolderPlus className="h-4 w-4" /> New Folder
            </Button>
            <Button type="button" size="sm" onClick={() => openUploadDialog()} data-testid="upload-pdf-btn">
              <Upload className="h-4 w-4" /> Upload PDF
            </Button>
          </div>
        )}
      />

      <div className="mb-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input data-testid="library-search" className="border-0 bg-white/75 pl-9 shadow-[0_1px_3px_rgba(15,23,42,0.06)]" placeholder="Search documents..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Button variant={showPinned ? "default" : "ghost"} size="sm" onClick={() => setShowPinned((current) => !current)} data-testid="filter-pinned" className={cn(!showPinned && "bg-white/45 text-slate-600 hover:bg-white/75")}>
          <Pin className="h-3.5 w-3.5" /> Pinned
        </Button>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[minmax(0,1fr)_310px]">
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Library tree</h2>
              <p className="mt-0.5 text-xs text-slate-400">{roots.length} top-level folders</p>
            </div>
            {viewMode === "list" && roots.length > 0 ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setExpandedFolderIds(new Set(folders.map((folder) => folder.id)))} className="text-slate-500 hover:text-slate-900"><UnfoldVertical className="h-4 w-4" /> Expand all</Button>
                <Button variant="ghost" size="sm" onClick={() => setExpandedFolderIds(new Set())} className="text-slate-500 hover:text-slate-900"><Minimize2 className="h-4 w-4" /> Collapse all</Button>
              </div>
            ) : null}
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 rounded-lg" />)}</div>
          ) : viewMode === "list" ? (
            roots.length > 0 || filteredAttachments.length > 0 ? (
              <LibraryTree
                roots={roots}
                folders={folders}
                attachments={filteredAttachments}
                expandedFolderIds={expandedFolderIds}
                onToggleFolder={toggleFolder}
                onOpenDocument={(attachmentId) => navigate(`/library/document/${attachmentId}`)}
                onManageFolder={openManageFolder}
                onManageDocument={openManageAttachment}
                onCreateInFolder={(folderId, type) => {
                  setExpandedFolderIds((current) => new Set([...current, folderId]));
                  if (type === "folder") openFolderCreateDialog(folderId);
                  else openUploadDialog(folderId);
                }}
              />
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-white/55 text-center"><BookOpen className="mb-3 h-10 w-10 text-slate-300" /><p className="text-sm font-medium text-slate-700">No library items found</p><p className="mt-1 text-xs text-slate-400">Restored folders and documents will appear here.</p></div>
            )
          ) : filteredAttachments.length > 0 ? (
            <div className={cn("grid gap-4", viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5")}>
              {filteredAttachments.map((attachment) => (
                <DocumentCard
                  key={attachment.id}
                  attachment={attachment}
                  compact={viewMode === "icon"}
                  onOpen={() => navigate(`/library/document/${attachment.id}`)}
                  onManage={() => openManageAttachment(attachment)}
                />
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-slate-400">No documents match this view.</p>
          )}
        </main>

        <aside className="min-w-0 space-y-8">
          <section aria-labelledby="library-glance-heading">
            <h2 id="library-glance-heading" className="text-sm font-semibold text-slate-800">At a glance</h2>
            <div className="mt-4 grid grid-cols-3 gap-5">
              <div><p className="text-xl font-semibold text-slate-900">{folders.length}</p><p className="mt-1 text-[11px] text-slate-400">Folders</p></div>
              <div><p className="text-xl font-semibold text-slate-900">{attachments.length}</p><p className="mt-1 text-[11px] text-slate-400">Documents</p></div>
              <div><p className="text-xl font-semibold text-slate-900">{pinnedDocuments.length}</p><p className="mt-1 text-[11px] text-slate-400">Pinned</p></div>
            </div>
          </section>
          {pinnedDocuments.length > 0 ? <section><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Pin className="h-4 w-4 text-amber-600" /> Pinned</h2><div className="mt-2 space-y-1">{pinnedDocuments.slice(0, 3).map((attachment) => <button key={attachment.id} type="button" onClick={() => navigate(`/library/document/${attachment.id}`)} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-white/70"><span className="block truncate text-sm font-medium text-slate-700">{attachment.name}</span></button>)}</div></section> : null}
          <section><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileText className="h-4 w-4 text-primary" /> Recent documents</h2><div className="mt-2 space-y-1">{recentDocuments.map((attachment) => <button key={attachment.id} type="button" onClick={() => navigate(`/library/document/${attachment.id}`)} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-white/70"><span className="block truncate text-sm font-medium text-slate-700">{attachment.name}</span><span className="mt-1 block text-xs text-slate-400">{formatBytes(attachment.sizeBytes)}</span></button>)}</div></section>
        </aside>
      </div>

      <Dialog open={dialogType === "folder"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Library Folder</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-library-folder-title">Name</Label>
              <Input
                id="new-library-folder-title"
                data-testid="input-library-folder-title"
                value={newFolderTitle}
                onChange={(event) => setNewFolderTitle(event.target.value)}
                placeholder="Folder name"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitFolder();
                }}
              />
            </div>
            <div>
              <Label htmlFor="new-library-folder-parent">Location</Label>
              <Select value={newFolderParentId} onValueChange={setNewFolderParentId}>
                <SelectTrigger id="new-library-folder-parent" data-testid="select-library-parent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_FOLDER_VALUE}>Top level</SelectItem>
                  {libraryFolderOptions.map(({ folder, depth }) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      <span style={{ paddingLeft: `${depth * 12}px` }}>{folder.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="button" data-testid="button-create-library-folder" disabled={!newFolderTitle.trim() || createFolder.isPending} onClick={submitFolder}>
                {createFolder.isPending ? "Creating..." : "Create Folder"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogType === "upload"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload PDF</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="library-pdf-file">PDF document</Label>
              <Input
                id="library-pdf-file"
                data-testid="input-library-pdf"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setUploadFile(event.target.files?.[0] ?? null);
                  setUploadError(null);
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">The PDF will be stored in this browser and will not be uploaded to Google Drive yet.</p>
            </div>
            <div>
              <Label htmlFor="library-upload-folder">Folder</Label>
              <Select value={uploadFolderId} onValueChange={setUploadFolderId}>
                <SelectTrigger id="library-upload-folder" data-testid="select-upload-folder"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNFILED_VALUE}>Unfiled</SelectItem>
                  {libraryFolderOptions.map(({ folder, depth }) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      <span style={{ paddingLeft: `${depth * 12}px` }}>{folder.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {uploadError ? <p role="alert" className="text-sm text-destructive">{uploadError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="button" data-testid="button-upload-library-pdf" disabled={!uploadFile || isUploading} onClick={() => void submitUpload()}>
                {isUploading ? "Adding PDF..." : "Add to Library"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={managedItem !== null} onOpenChange={(open) => !open && closeManageDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{managedItem?.kind === "folder" ? "Manage Folder" : "Manage PDF"}</DialogTitle>
          </DialogHeader>
          {managedItem ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="managed-library-name">Name</Label>
                <Input
                  id="managed-library-name"
                  data-testid="input-managed-library-name"
                  value={managedName}
                  onChange={(event) => setManagedName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveManagedItem();
                  }}
                />
              </div>
              <div>
                <Label htmlFor="managed-library-location">Location</Label>
                <Select value={managedLocationId} onValueChange={setManagedLocationId}>
                  <SelectTrigger id="managed-library-location" data-testid="select-managed-library-location"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={managedItem.kind === "folder" ? ROOT_FOLDER_VALUE : UNFILED_VALUE}>
                      {managedItem.kind === "folder" ? "Top level" : "Unfiled"}
                    </SelectItem>
                    {managedLocationOptions.map(({ folder, depth }) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        <span style={{ paddingLeft: `${depth * 12}px` }}>{folder.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {managedItem.kind === "folder" && !managedFolderIsEmpty ? (
                <p className="text-xs leading-5 text-muted-foreground">This folder contains other items. Move or delete them before deleting the folder.</p>
              ) : null}
              {manageError ? <p role="alert" className="text-sm text-destructive">{manageError}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="button-delete-managed-library-item"
                  disabled={isManaging || !managedFolderIsEmpty}
                  onClick={() => setShowDeleteConfirmation(true)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={closeManageDialog}>Cancel</Button>
                  <Button
                    type="button"
                    data-testid="button-save-managed-library-item"
                    disabled={!managedName.trim() || isManaging}
                    onClick={() => void saveManagedItem()}
                  >
                    {isManaging ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent className="z-[60]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {managedItem?.kind === "folder" ? "folder" : "PDF"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {managedItem?.kind === "folder"
                ? "This removes the empty folder from this browser."
                : "This permanently removes the uploaded PDF and its stored file from this browser."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-library-item"
              onClick={() => void deleteManagedItem()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
