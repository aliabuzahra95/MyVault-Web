import type { Attachment, Folder } from "@workspace/api-client-react";
import { ChevronRight, FileText, FolderClosed, FolderOpen, FolderPlus, MoreHorizontal, Pin, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentType(attachment: Attachment) {
  const extension = attachment.name.split(".").pop();
  if (extension && extension !== attachment.name) return extension.toUpperCase();
  if (attachment.mimeType.includes("pdf")) return "PDF";
  return "Document";
}

function sortedFolders(folders: Folder[]) {
  return [...folders].sort((first, second) => {
    const orderDifference = (first.orderIndex ?? 0) - (second.orderIndex ?? 0);
    return orderDifference || first.title.localeCompare(second.title);
  });
}

function sortedDocuments(attachments: Attachment[]) {
  return [...attachments].sort((first, second) => {
    if (first.isPinned !== second.isPinned) return first.isPinned ? -1 : 1;
    return second.updatedAt - first.updatedAt;
  });
}

function descendantFolderIds(folders: Folder[], folderId: string) {
  const ids = new Set([folderId]);
  const queue = [folderId];

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

interface DocumentRowProps {
  attachment: Attachment;
  depth: number;
  onOpen: () => void;
  onManage: () => void;
}

function DocumentRow({ attachment, depth, onOpen, onManage }: DocumentRowProps) {
  const progress = Math.max(0, Math.min(attachment.readingProgressPercent ?? 0, 100));
  const canManage = true;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex min-h-12 w-full min-w-0 items-center rounded-md pr-2 transition-colors hover:bg-white/70"
          style={{ paddingLeft: `${Math.min(depth, 7) * 22 + 40}px` }}
        >
      <button
        type="button"
        onClick={onOpen}
        data-testid={`library-document-${attachment.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <FileText className="h-4 w-4 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-slate-700 group-hover:text-slate-950">{attachment.name}</span>
            {attachment.isPinned ? <Pin className="h-3 w-3 shrink-0 text-amber-600" /> : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">
            {documentType(attachment)} · {formatBytes(attachment.sizeBytes)}
          </span>
        </span>
        {attachment.readingProgressPercent != null ? (
          <span className="hidden w-24 shrink-0 sm:block">
            <span className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-200/70">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </span>
          </span>
        ) : null}
      </button>
      {canManage ? (
        <button
          type="button"
          onClick={onManage}
          data-testid={`manage-library-document-${attachment.id}`}
          aria-label={`Manage ${attachment.name}`}
          className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-70 hover:bg-white hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        {canManage ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onManage}>Rename</ContextMenuItem>
            <ContextMenuItem onSelect={onManage}>Move</ContextMenuItem>
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onManage}>Delete</ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FolderNodeProps {
  folder: Folder;
  folders: Folder[];
  attachments: Attachment[];
  expandedFolderIds: Set<string>;
  depth: number;
  onToggleFolder: (folderId: string) => void;
  onOpenDocument: (attachmentId: string) => void;
  onManageFolder: (folder: Folder) => void;
  onManageDocument: (attachment: Attachment) => void;
  onCreateInFolder: (folderId: string, type: "folder" | "upload") => void;
}

function FolderNode({
  folder,
  folders,
  attachments,
  expandedFolderIds,
  depth,
  onToggleFolder,
  onOpenDocument,
  onManageFolder,
  onManageDocument,
  onCreateInFolder,
}: FolderNodeProps) {
  const expanded = expandedFolderIds.has(folder.id);
  const children = sortedFolders(folders.filter((candidate) => candidate.parentId === folder.id));
  const documents = sortedDocuments(attachments.filter((attachment) => attachment.libraryFolderId === folder.id));
  const includedFolderIds = descendantFolderIds(folders, folder.id);
  const documentCount = attachments.filter((attachment) => attachment.libraryFolderId && includedFolderIds.has(attachment.libraryFolderId)).length;

  return (
    <div role="treeitem" aria-expanded={expanded}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg pr-3 text-left transition-colors",
              depth === 0 ? "bg-white/75 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-white" : "hover:bg-white/60",
            )}
            style={{ paddingLeft: `${Math.min(depth, 7) * 22 + 14}px` }}
          >
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          data-testid={`library-folder-${folder.id}`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-400", expanded && "rotate-90")} />
          {expanded ? <FolderOpen className="h-[18px] w-[18px] shrink-0 text-primary" /> : <FolderClosed className="h-[18px] w-[18px] shrink-0 text-primary" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700 group-hover:text-slate-950">{folder.title}</span>
          {folder.description ? <span className="hidden max-w-52 truncate text-xs text-slate-400 lg:block">{folder.description}</span> : null}
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-medium text-slate-500">{documentCount}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Add inside ${folder.title}`}
              title={`Add inside ${folder.title}`}
              data-testid={`add-to-library-folder-${folder.id}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onCreateInFolder(folder.id, "folder")}>
              <FolderPlus className="h-4 w-4" /> Subfolder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreateInFolder(folder.id, "upload")}>
              <Upload className="h-4 w-4" /> Upload PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {
          <button
            type="button"
            onClick={() => onManageFolder(folder)}
            data-testid={`manage-library-folder-${folder.id}`}
            aria-label={`Manage ${folder.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-70 hover:bg-white hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => onToggleFolder(folder.id)}>{expanded ? "Collapse" : "Open"}</ContextMenuItem>
          {
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onManageFolder(folder)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => onManageFolder(folder)}>Move</ContextMenuItem>
              <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onManageFolder(folder)}>Delete</ContextMenuItem>
            </>
          }
        </ContextMenuContent>
      </ContextMenu>

      {expanded ? (
        <div
          role="group"
          className={cn(
            depth === 0 && "mt-1",
            "space-y-1",
          )}
        >
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              folders={folders}
              attachments={attachments}
              expandedFolderIds={expandedFolderIds}
              depth={depth + 1}
              onToggleFolder={onToggleFolder}
              onOpenDocument={onOpenDocument}
              onManageFolder={onManageFolder}
              onManageDocument={onManageDocument}
              onCreateInFolder={onCreateInFolder}
            />
          ))}
          {documents.map((attachment) => (
            <DocumentRow key={attachment.id} attachment={attachment} depth={depth + 1} onOpen={() => onOpenDocument(attachment.id)} onManage={() => onManageDocument(attachment)} />
          ))}
          {children.length === 0 && documents.length === 0 ? (
            <p className="py-3 text-xs text-slate-400" style={{ paddingLeft: `${Math.min(depth + 1, 7) * 22 + 40}px` }}>This folder is empty.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface LibraryTreeProps {
  roots: Folder[];
  folders: Folder[];
  attachments: Attachment[];
  expandedFolderIds: Set<string>;
  onToggleFolder: (folderId: string) => void;
  onOpenDocument: (attachmentId: string) => void;
  onManageFolder: (folder: Folder) => void;
  onManageDocument: (attachment: Attachment) => void;
  onCreateInFolder: (folderId: string, type: "folder" | "upload") => void;
}

export function LibraryTree({ roots, folders, attachments, expandedFolderIds, onToggleFolder, onOpenDocument, onManageFolder, onManageDocument, onCreateInFolder }: LibraryTreeProps) {
  const unfiled = sortedDocuments(attachments.filter((attachment) => !attachment.libraryFolderId || !folders.some((folder) => folder.id === attachment.libraryFolderId)));

  return (
    <div role="tree" aria-label="Library folders" className="space-y-2">
      {roots.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          folders={folders}
          attachments={attachments}
          expandedFolderIds={expandedFolderIds}
          depth={0}
          onToggleFolder={onToggleFolder}
          onOpenDocument={onOpenDocument}
          onManageFolder={onManageFolder}
          onManageDocument={onManageDocument}
          onCreateInFolder={onCreateInFolder}
        />
      ))}
      {unfiled.length > 0 ? (
        <section className="pt-3" aria-label="Unfiled documents">
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase text-slate-400">Unfiled</p>
          {unfiled.map((attachment) => (
            <DocumentRow key={attachment.id} attachment={attachment} depth={0} onOpen={() => onOpenDocument(attachment.id)} onManage={() => onManageDocument(attachment)} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
