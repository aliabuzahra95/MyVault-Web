import { formatDistanceToNow } from "date-fns";
import { ChevronRight, FileText, Folder, FolderPlus, MoreHorizontal, Pin, Plus, StickyNote } from "lucide-react";
import type { Folder as FolderRecord, Note } from "@workspace/api-client-react";
import type { RestoredFolderStickyNote } from "@/lib/restore/restoredCorpus";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type StudyFolderCreateType = "folder" | "note" | "sticky";

interface StudyTreeProps {
  roots: FolderRecord[];
  folders: FolderRecord[];
  notes: Note[];
  rootNotes?: Note[];
  stickyNotes: RestoredFolderStickyNote[];
  expandedFolderIds: Set<string>;
  onToggleFolder: (folderId: string) => void;
  onOpenNote: (noteId: string) => void;
  onCreateInFolder?: (folderId: string, type: StudyFolderCreateType) => void;
  onManageFolder?: (folder: FolderRecord) => void;
  onManageNote?: (note: Note) => void;
  onDeleteFolder?: (folder: FolderRecord) => void;
  onDeleteNote?: (note: Note) => void;
  onManageSticky?: (stickyNote: RestoredFolderStickyNote) => void;
  onDeleteSticky?: (stickyNote: RestoredFolderStickyNote) => void;
  allowStickyNotes?: boolean;
}

interface FolderBranchProps extends Omit<StudyTreeProps, "roots"> {
  folder: FolderRecord;
  depth: number;
  childrenByParent: Map<string, FolderRecord[]>;
  notesByFolder: Map<string, Note[]>;
  stickyNotesByFolder: Map<string, RestoredFolderStickyNote[]>;
}

function safeUpdatedLabel(updatedAt: number) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "Recently";
  return formatDistanceToNow(date, { addSuffix: true });
}

function totalItemsForFolder(
  folderId: string,
  childrenByParent: Map<string, FolderRecord[]>,
  notesByFolder: Map<string, Note[]>,
  stickyNotesByFolder: Map<string, RestoredFolderStickyNote[]>,
  visited = new Set<string>(),
): number {
  if (visited.has(folderId)) return 0;
  visited.add(folderId);

  const directItems = (notesByFolder.get(folderId)?.length ?? 0) + (stickyNotesByFolder.get(folderId)?.length ?? 0);
  return directItems + (childrenByParent.get(folderId) ?? []).reduce(
    (total, child) => total + totalItemsForFolder(child.id, childrenByParent, notesByFolder, stickyNotesByFolder, visited),
    0,
  );
}

function FolderBranch({
  folder,
  depth,
  folders,
  notes,
  stickyNotes,
  expandedFolderIds,
  onToggleFolder,
  onOpenNote,
  onCreateInFolder,
  onManageFolder,
  onManageNote,
  onDeleteFolder,
  onDeleteNote,
  onManageSticky,
  onDeleteSticky,
  allowStickyNotes,
  childrenByParent,
  notesByFolder,
  stickyNotesByFolder,
}: FolderBranchProps) {
  const childFolders = childrenByParent.get(folder.id) ?? [];
  const childNotes = notesByFolder.get(folder.id) ?? [];
  const childStickyNotes = stickyNotesByFolder.get(folder.id) ?? [];
  const isExpanded = expandedFolderIds.has(folder.id);
  const hasContents = childFolders.length + childNotes.length + childStickyNotes.length > 0;
  const totalItems = totalItemsForFolder(folder.id, childrenByParent, notesByFolder, stickyNotesByFolder);
  const indent = Math.min(depth * 22, 132);

  return (
    <div role="treeitem" aria-expanded={hasContents ? isExpanded : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex min-h-12 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
              depth === 0
                ? "bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:bg-white"
                : "hover:bg-white/75",
            )}
            style={{ paddingLeft: `${12 + indent}px` }}
          >
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          data-testid={`tree-folder-${folder.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400">
            {hasContents ? (
              <ChevronRight className={cn("h-4 w-4", isExpanded && "rotate-90")} />
            ) : (
              <span className="h-4 w-4" />
            )}
          </span>
          <Folder className={cn("h-[19px] w-[19px] shrink-0", depth === 0 ? "text-primary" : "text-slate-500")} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 group-hover:text-slate-950">
            {folder.title}
          </span>
          {folder.description && depth === 0 && (
            <span className="hidden max-w-64 truncate text-xs text-slate-400 xl:block">{folder.description}</span>
          )}
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {totalItems}
          </span>
        </button>
        {onCreateInFolder ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Add inside ${folder.title}`}
                title={`Add inside ${folder.title}`}
                data-testid={`add-to-folder-${folder.id}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onCreateInFolder(folder.id, "folder")}>
                <FolderPlus className="h-4 w-4" /> Subfolder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreateInFolder(folder.id, "note")}>
                <FileText className="h-4 w-4" /> Note
              </DropdownMenuItem>
              {allowStickyNotes ? (
                <DropdownMenuItem onSelect={() => onCreateInFolder(folder.id, "sticky")}>
                  <StickyNote className="h-4 w-4" /> Sticky note
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onManageFolder ? (
          <button
            type="button"
            onClick={() => onManageFolder(folder)}
            aria-label={`Manage ${folder.title}`}
            data-testid={`manage-study-folder-${folder.id}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => onToggleFolder(folder.id)}>{isExpanded ? "Collapse" : "Open"}</ContextMenuItem>
          {onManageFolder ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onManageFolder(folder)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => onManageFolder(folder)}>Move</ContextMenuItem>
              <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteFolder?.(folder)}>Delete</ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && hasContents && (
        <div role="group" className="mt-1 space-y-0.5">
          {childFolders.map((childFolder) => (
            <FolderBranch
              key={childFolder.id}
              folder={childFolder}
              depth={depth + 1}
              folders={folders}
              notes={notes}
              stickyNotes={stickyNotes}
              expandedFolderIds={expandedFolderIds}
              onToggleFolder={onToggleFolder}
              onOpenNote={onOpenNote}
              onCreateInFolder={onCreateInFolder}
              onManageFolder={onManageFolder}
              onManageNote={onManageNote}
              onDeleteFolder={onDeleteFolder}
              onDeleteNote={onDeleteNote}
              onManageSticky={onManageSticky}
              onDeleteSticky={onDeleteSticky}
              allowStickyNotes={allowStickyNotes}
              childrenByParent={childrenByParent}
              notesByFolder={notesByFolder}
              stickyNotesByFolder={stickyNotesByFolder}
            />
          ))}

          {childStickyNotes.map((stickyNote) => (
            <ContextMenu key={stickyNote.id}>
              <ContextMenuTrigger asChild>
                <div
                  data-testid={`tree-sticky-${stickyNote.id}`}
                  className="group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-amber-50/60"
                  style={{ paddingLeft: `${51 + Math.min((depth + 1) * 22, 132)}px` }}
                >
                  <StickyNote className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{stickyNote.text}</span>
                  <span className="hidden shrink-0 text-[11px] text-slate-400 sm:block">Sticky note</span>
                  {onManageSticky ? (
                    <button type="button" onClick={() => onManageSticky(stickyNote)} aria-label="Manage sticky note" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuItem onSelect={() => onManageSticky?.(stickyNote)}>Edit or move</ContextMenuItem>
                <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteSticky?.(stickyNote)}>Delete</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}

          {childNotes.map((note) => (
            <ContextMenu key={note.id}>
              <ContextMenuTrigger asChild>
                <div className="group flex min-h-11 w-full items-center rounded-lg pr-2 transition-colors hover:bg-white/80">
                  <button
                    type="button"
                    onClick={() => onOpenNote(note.id)}
                    data-testid={`tree-note-${note.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    style={{ paddingLeft: `${51 + Math.min((depth + 1) * 22, 132)}px` }}
                  >
                    {note.isPinned ? <Pin className="h-4 w-4 shrink-0 text-sky-600" /> : <FileText className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-primary" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 group-hover:text-slate-950">{note.title}</span>
                    <span className="hidden max-w-52 truncate text-xs text-slate-400 xl:block">{note.bodyPreview}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{safeUpdatedLabel(note.updatedAt)}</span>
                  </button>
                  {onManageNote ? (
                    <button type="button" onClick={() => onManageNote(note)} aria-label={`Manage ${note.title}`} data-testid={`manage-study-note-${note.id}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuItem onSelect={() => onOpenNote(note.id)}>Open</ContextMenuItem>
                {onManageNote ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onManageNote(note)}>Rename</ContextMenuItem>
                    <ContextMenuItem onSelect={() => onManageNote(note)}>Move</ContextMenuItem>
                    <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteNote?.(note)}>Delete</ContextMenuItem>
                  </>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudyTree({
  roots,
  folders,
  notes,
  rootNotes = [],
  stickyNotes,
  expandedFolderIds,
  onToggleFolder,
  onOpenNote,
  onCreateInFolder,
  onManageFolder,
  onManageNote,
  onDeleteFolder,
  onDeleteNote,
  onManageSticky,
  onDeleteSticky,
  allowStickyNotes,
}: StudyTreeProps) {
  const childrenByParent = new Map<string, FolderRecord[]>();
  const notesByFolder = new Map<string, Note[]>();
  const stickyNotesByFolder = new Map<string, RestoredFolderStickyNote[]>();

  folders.forEach((folder) => {
    if (!folder.parentId) return;
    childrenByParent.set(folder.parentId, [...(childrenByParent.get(folder.parentId) ?? []), folder]);
  });
  childrenByParent.forEach((children, parentId) => {
    childrenByParent.set(parentId, [...children].sort((first, second) => (first.orderIndex ?? 0) - (second.orderIndex ?? 0)));
  });

  notes.forEach((note) => {
    if (!note.folderId) return;
    notesByFolder.set(note.folderId, [...(notesByFolder.get(note.folderId) ?? []), note]);
  });
  notesByFolder.forEach((folderNotes, folderId) => {
    notesByFolder.set(folderId, [...folderNotes].sort((first, second) => {
      if (Boolean(first.isPinned) !== Boolean(second.isPinned)) return first.isPinned ? -1 : 1;
      return (first.orderIndex ?? 0) - (second.orderIndex ?? 0);
    }));
  });

  stickyNotes.forEach((stickyNote) => {
    stickyNotesByFolder.set(stickyNote.folderId, [...(stickyNotesByFolder.get(stickyNote.folderId) ?? []), stickyNote]);
  });

  return (
    <div role="tree" aria-label="Study folders" className="space-y-2">
      {rootNotes.map((note) => (
        <ContextMenu key={note.id}>
          <ContextMenuTrigger asChild>
            <div className="group flex min-h-11 w-full items-center rounded-lg px-3 transition-colors hover:bg-white/80">
              <button type="button" onClick={() => onOpenNote(note.id)} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left" data-testid={`tree-note-${note.id}`}>
                {note.isPinned ? <Pin className="h-4 w-4 shrink-0 text-sky-600" /> : <FileText className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-primary" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 group-hover:text-slate-950">{note.title}</span>
                <span className="hidden max-w-52 truncate text-xs text-slate-400 xl:block">{note.bodyPreview}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{safeUpdatedLabel(note.updatedAt)}</span>
              </button>
              {onManageNote ? (
                <button type="button" onClick={() => onManageNote(note)} aria-label={`Manage ${note.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onSelect={() => onOpenNote(note.id)}>Open</ContextMenuItem>
            {onManageNote ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onManageNote(note)}>Rename</ContextMenuItem>
                <ContextMenuItem onSelect={() => onManageNote(note)}>Move</ContextMenuItem>
                <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteNote?.(note)}>Delete</ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ))}
      {roots.map((folder) => (
        <FolderBranch
          key={folder.id}
          folder={folder}
          depth={0}
          folders={folders}
          notes={notes}
          stickyNotes={stickyNotes}
          expandedFolderIds={expandedFolderIds}
          onToggleFolder={onToggleFolder}
          onOpenNote={onOpenNote}
          onCreateInFolder={onCreateInFolder}
          onManageFolder={onManageFolder}
          onManageNote={onManageNote}
          onDeleteFolder={onDeleteFolder}
          onDeleteNote={onDeleteNote}
          onManageSticky={onManageSticky}
          onDeleteSticky={onDeleteSticky}
          allowStickyNotes={allowStickyNotes}
          childrenByParent={childrenByParent}
          notesByFolder={notesByFolder}
          stickyNotesByFolder={stickyNotesByFolder}
        />
      ))}
    </div>
  );
}
