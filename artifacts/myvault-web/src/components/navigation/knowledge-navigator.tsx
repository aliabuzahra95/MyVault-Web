import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotesQueryKey,
  useCreateNote,
  useListAttachments,
  useListFolders,
  useListNotes,
} from "@workspace/api-client-react";
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Library,
  MoreHorizontal,
  Pin,
  Plus,
  StickyNote,
  Upload,
} from "lucide-react";
import { useLocalCourseChanges } from "@/hooks/useLocalCourseChanges";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { useWorkspace } from "@/lib/providers";
import { isLocallyDeleted } from "@/lib/restore/localRestoreStore";
import {
  ancestorKeys,
  buildKnowledgeTree,
  resolveActiveNodeKey,
  type KnowledgeNode,
  type KnowledgeTreeModel,
} from "@/lib/navigation/knowledgeTree";
import { PENDING_CREATE_EVENT, queuePendingCreate } from "@/lib/navigation/pendingCreate";
import { PENDING_MANAGE_EVENT, queuePendingManage } from "@/lib/navigation/pendingManage";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EXPANDED_STORAGE_KEY = "myvault-sidebar-expanded-v1";
const TOP_LEVEL_VALUE = "__study_top_level__";

function initialExpandedKeys() {
  if (typeof sessionStorage === "undefined") return new Set<string>();
  try {
    const saved = JSON.parse(sessionStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]");
    return new Set<string>(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function nodeIcon(node: KnowledgeNode, expanded: boolean) {
  const iconClass = "h-[15px] w-[15px] shrink-0";
  if (node.kind === "section") {
    if (node.id === "study") return <BookOpen className={iconClass} />;
    if (node.id === "library") return <Library className={iconClass} />;
    if (node.id === "courses") return <GraduationCap className={iconClass} />;
    return <BookOpen className={iconClass} />;
  }
  if (node.kind === "course") return <GraduationCap className={iconClass} />;
  if (node.kind === "folder" || node.kind === "group") {
    return expanded ? <FolderOpen className={iconClass} /> : <FolderClosed className={iconClass} />;
  }
  return <FileText className={iconClass} />;
}

type TreeNodeProps = {
  nodeKey: string;
  depth: number;
  model: KnowledgeTreeModel;
  expandedKeys: Set<string>;
  activeKey: string | null;
  activeLineage: Set<string>;
  toggleExpanded: (key: string) => void;
  navigate: (href: string) => void;
  closeMobile?: () => void;
  studyAction?: ReactNode;
  createInFolder: (node: KnowledgeNode, type: "folder" | "note" | "sticky" | "upload") => void;
  manageNode: (node: KnowledgeNode) => void;
};

function FolderCreateMenu({ node, onCreate }: { node: KnowledgeNode; onCreate: TreeNodeProps["createInFolder"] }) {
  const isStudyFolder = node.key.startsWith("study:folder:");
  const isLibraryFolder = node.key.startsWith("library:folder:");
  const isCourseFolder = node.key.includes(":folder:") && node.key.startsWith("course:");

  if (!isStudyFolder && !isLibraryFolder && !isCourseFolder) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Add inside ${node.label}`}
          title={`Add inside ${node.label}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-sidebar-primary/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          data-testid={`sidebar-add-${node.key.replaceAll(":", "-")}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={6} className="w-44">
        <DropdownMenuItem onSelect={() => onCreate(node, "folder")}>
          <FolderPlus className="h-4 w-4" /> Subfolder
        </DropdownMenuItem>
        {isStudyFolder || isCourseFolder ? (
          <DropdownMenuItem onSelect={() => onCreate(node, "note")}>
            <FileText className="h-4 w-4" /> {isCourseFolder ? "Lesson note" : "Note"}
          </DropdownMenuItem>
        ) : null}
        {isCourseFolder ? (
          <DropdownMenuItem onSelect={() => onCreate(node, "sticky")}>
            <StickyNote className="h-4 w-4" /> Sticky note
          </DropdownMenuItem>
        ) : null}
        {isLibraryFolder ? (
          <DropdownMenuItem onSelect={() => onCreate(node, "upload")}>
            <Upload className="h-4 w-4" /> Upload PDF
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TreeNode = memo(function TreeNode({
  nodeKey,
  depth,
  model,
  expandedKeys,
  activeKey,
  activeLineage,
  toggleExpanded,
  navigate,
  closeMobile,
  studyAction,
  createInFolder,
  manageNode,
}: TreeNodeProps) {
  const node = model.nodes.get(nodeKey);
  if (!node) return null;
  const expanded = expandedKeys.has(node.key);
  const canExpand = node.childKeys.length > 0;
  const selected = activeKey === node.key;
  const inActivePath = activeLineage.has(node.key);
  const isSection = node.kind === "section";

  const openNewTab = () => {
    const target = new URL(node.href, window.location.origin);
    window.open(target.toString(), "_blank", "noopener,noreferrer");
  };
  const canManage = node.kind === "folder" || node.kind === "note" || node.kind === "document" || node.kind === "course";

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex h-[34px] min-w-0 items-center rounded-md pr-1 transition-colors",
              selected
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground",
              isSection && "mt-0.5 h-[38px]",
            )}
            style={{ paddingLeft: `${7 + depth * 13}px` }}
            data-testid={`sidebar-tree-${node.key.replaceAll(":", "-")}`}
          >
            {canExpand ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleExpanded(node.key);
                }}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
                aria-expanded={expanded}
                className="mr-0.5 flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
              >
                <ChevronRight className={cn("h-3.5 w-3.5", expanded && "rotate-90")} />
              </button>
            ) : (
              <span className="mr-0.5 h-6 w-5 shrink-0" />
            )}

            <Link
              href={node.href}
              onClick={closeMobile}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                selected && "font-semibold",
                isSection && "font-semibold text-sidebar-foreground",
                inActivePath && !selected && "text-sidebar-foreground",
              )}
              title={node.label}
            >
              <span className={cn(
                "text-muted-foreground transition-colors group-hover:text-sidebar-foreground",
                (selected || inActivePath) && "text-sidebar-primary",
                node.kind === "document" && "text-sky-600 dark:text-sky-400",
              )}>
                {nodeIcon(node, expanded)}
              </span>
              <span className={cn(
                "min-w-0 flex-1 truncate text-[12.5px] leading-none",
                (node.kind === "folder" || node.kind === "group" || node.kind === "course") && "font-medium text-sidebar-foreground/90",
                (node.kind === "note" || node.kind === "document") && "text-sidebar-foreground/75",
                isSection && "text-[13px] font-semibold text-sidebar-foreground",
              )}>{node.label}</span>
              {node.pinned ? <Pin className="h-3 w-3 shrink-0 text-amber-600" /> : null}
              {canExpand && !isSection ? (
                <span className="mr-1 text-[10px] tabular-nums text-muted-foreground/80">{node.childKeys.length}</span>
              ) : null}
            </Link>
            {canManage ? (
              <button
                type="button"
                aria-label={`Manage ${node.label}`}
                title={`Rename, move, or delete ${node.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  manageNode(node);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
                data-testid={`sidebar-manage-${node.key.replaceAll(":", "-")}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {node.kind === "folder" ? <FolderCreateMenu node={node} onCreate={createInFolder} /> : null}
            {node.key === "section:study" ? studyAction : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => navigate(node.href)}>
            Open
          </ContextMenuItem>
          <ContextMenuItem onSelect={openNewTab}>
            Open in new tab
            <ExternalLink className="ml-auto h-3.5 w-3.5" />
          </ContextMenuItem>
          {canExpand ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => toggleExpanded(node.key)}>
                {expanded ? "Collapse" : "Expand"}
              </ContextMenuItem>
            </>
          ) : null}
          {canManage ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => manageNode(node)}>Rename</ContextMenuItem>
              {node.kind !== "course" ? <ContextMenuItem onSelect={() => manageNode(node)}>Move</ContextMenuItem> : null}
              <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => manageNode(node)}>Delete</ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {canExpand && expanded ? node.childKeys.map((childKey) => (
        <TreeNode
          key={childKey}
          nodeKey={childKey}
          depth={depth + 1}
          model={model}
          expandedKeys={expandedKeys}
          activeKey={activeKey}
          activeLineage={activeLineage}
          toggleExpanded={toggleExpanded}
          navigate={navigate}
          closeMobile={closeMobile}
          studyAction={studyAction}
          createInFolder={createInFolder}
          manageNode={manageNode}
        />
      )) : null}
    </>
  );
});

type KnowledgeNavigatorProps = {
  closeMobile?: () => void;
  searchActive?: boolean;
  searchQuery?: string;
  closeSearch?: () => void;
};

function nodeLocation(model: KnowledgeTreeModel, node: KnowledgeNode) {
  const labels: string[] = [];
  let current = node.parentKey ? model.nodes.get(node.parentKey) : undefined;
  while (current && current.kind !== "section") {
    labels.unshift(current.label);
    current = current.parentKey ? model.nodes.get(current.parentKey) : undefined;
  }
  return labels.join(" / ");
}

export function KnowledgeNavigator({ closeMobile, searchActive = false, searchQuery = "", closeSearch }: KnowledgeNavigatorProps) {
  const { workspace } = useWorkspace();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { corpus, isLoading: corpusLoading } = useRestoredCorpus();
  const { changes: localCourseChanges, isLoading: localCourseLoading } = useLocalCourseChanges();
  const { data: folders = [], isLoading: foldersLoading } = useListFolders({ workspace });
  const { data: notes = [], isLoading: notesLoading } = useListNotes({ workspace });
  const { data: attachments = [], isLoading: attachmentsLoading } = useListAttachments();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(initialExpandedKeys);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickFolderId, setQuickFolderId] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase());

  const courseRows = useMemo(() => {
    const rows = new Map((corpus?.courses ?? []).map((course) => [course.id, course]));
    localCourseChanges.courses.forEach((course) => rows.set(course.id, course));
    return [...rows.values()].filter((course) => !isLocallyDeleted(course));
  }, [corpus?.courses, localCourseChanges.courses]);

  const knowledgeNotes = useMemo(() => {
    const rows = new Map(notes.map((note) => [note.id, note]));
    localCourseChanges.notes.forEach((note) => rows.set(note.id, note));
    return [...rows.values()].filter((note) => !isLocallyDeleted(note));
  }, [localCourseChanges.notes, notes]);

  const model = useMemo(() => buildKnowledgeTree({
    folders,
    notes: knowledgeNotes,
    attachments,
    courses: courseRows,
    courseFolderIds: corpus?.courseFolderIds ?? [],
    localCourseFolders: localCourseChanges.folders,
  }), [attachments, corpus?.courseFolderIds, courseRows, folders, knowledgeNotes, localCourseChanges.folders]);

  const activeKey = useMemo(() => resolveActiveNodeKey(model, location), [location, model]);
  const activeAncestors = useMemo(() => ancestorKeys(model, activeKey), [activeKey, model]);
  const activeLineage = useMemo(() => new Set([...activeAncestors, ...(activeKey ? [activeKey] : [])]), [activeAncestors, activeKey]);

  const activeStudyFolderId = useMemo(() => {
    const candidates = [...(activeKey ? [activeKey] : []), ...[...activeAncestors].reverse()];
    const key = candidates.find((candidate) => candidate.startsWith("study:folder:"));
    return key ? model.nodes.get(key)?.id ?? "" : "";
  }, [activeAncestors, activeKey, model]);

  const studyFolderOptions = useMemo(() => (
    [...model.studyFolderKeys.values()]
      .map((key) => {
        const node = model.nodes.get(key);
        if (!node) return null;
        const locationLabel = nodeLocation(model, node);
        return { id: node.id, label: locationLabel ? `${locationLabel} / ${node.label}` : node.label };
      })
      .filter((option): option is { id: string; label: string } => option !== null)
      .sort((first, second) => first.label.localeCompare(second.label))
  ), [model]);

  const searchGroups = useMemo(() => {
    if (!deferredSearchQuery) return [];
    const groups = [
      { label: "Study", matches: [] as KnowledgeNode[] },
      { label: "Library", matches: [] as KnowledgeNode[] },
      { label: "Courses", matches: [] as KnowledgeNode[] },
    ];

    model.nodes.forEach((node) => {
      if (node.kind === "section" || !node.label.toLocaleLowerCase().includes(deferredSearchQuery)) return;
      if (node.key.startsWith("study:")) groups[0].matches.push(node);
      else if (node.key.startsWith("library:")) groups[1].matches.push(node);
      else if (node.key.startsWith("course:") || node.kind === "course") groups[2].matches.push(node);
    });

    return groups
      .map((group) => ({ ...group, matches: group.matches.slice(0, 8) }))
      .filter((group) => group.matches.length > 0);
  }, [deferredSearchQuery, model]);

  const createNote = useCreateNote({
    mutation: {
      onSuccess: (note) => {
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
        setQuickCreateOpen(false);
        setQuickTitle("");
        navigate(`/notes/${note.id}`);
        closeMobile?.();
      },
    },
  });

  useEffect(() => {
    if (!activeKey) return;
    const activeNode = model.nodes.get(activeKey);
    setExpandedKeys((current) => {
      const required = [...activeAncestors, ...(activeNode?.childKeys.length ? [activeKey] : [])];
      const next = new Set([...current, ...required]);
      return next.size === current.size ? current : next;
    });
  }, [activeAncestors, activeKey, model]);

  useEffect(() => {
    sessionStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expandedKeys]));
  }, [expandedKeys]);

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isLoading = corpusLoading || localCourseLoading || foldersLoading || notesLoading || attachmentsLoading;

  function openQuickCreate(open: boolean) {
    setQuickCreateOpen(open);
    if (!open) {
      setQuickTitle("");
      return;
    }
    const inbox = studyFolderOptions.find((folder) => folder.label.split(" / ").at(-1)?.toLocaleLowerCase() === "inbox");
    setQuickFolderId(activeStudyFolderId || inbox?.id || TOP_LEVEL_VALUE);
  }

  function submitQuickNote() {
    if (!quickTitle.trim() || !quickFolderId) return;
    createNote.mutate({ data: { title: quickTitle.trim(), folderId: quickFolderId === TOP_LEVEL_VALUE ? null : quickFolderId } });
  }

  function createInFolder(node: KnowledgeNode, type: "folder" | "note" | "sticky" | "upload") {
    let target = "";
    let request: Parameters<typeof queuePendingCreate>[0] | null = null;
    if (node.key.startsWith("study:folder:")) {
      target = `/study?folder=${encodeURIComponent(node.id)}`;
      request = { section: "study", folderId: node.id, type };
    } else if (node.key.startsWith("library:folder:")) {
      target = `/library?folder=${encodeURIComponent(node.id)}`;
      request = { section: "library", folderId: node.id, type };
    } else {
      const courseMatch = node.key.match(/^course:([^:]+):folder:/);
      if (!courseMatch) return;
      target = `/courses/${encodeURIComponent(courseMatch[1])}`;
      request = { section: "course", courseId: courseMatch[1], folderId: node.id, type };
    }
    queuePendingCreate(request, false);
    const alreadyInSection = window.location.pathname === new URL(target, window.location.origin).pathname;
    if (!alreadyInSection) navigate(target);
    window.setTimeout(() => window.dispatchEvent(new Event(PENDING_CREATE_EVENT)), alreadyInSection ? 0 : 75);
    closeMobile?.();
  }

  function manageNode(node: KnowledgeNode) {
    let target = "";
    if (node.key.startsWith("study:")) {
      queuePendingManage({ section: "study", kind: node.kind === "folder" ? "folder" : "note", itemId: node.id }, false);
      target = node.kind === "folder" ? `/study?folder=${encodeURIComponent(node.id)}` : "/study";
    } else if (node.key.startsWith("library:")) {
      queuePendingManage({ section: "library", kind: node.kind === "folder" ? "folder" : "attachment", itemId: node.id }, false);
      target = node.kind === "folder" ? `/library?folder=${encodeURIComponent(node.id)}` : "/library";
    } else if (node.key.startsWith("course:") || node.kind === "course") {
      const courseId = node.kind === "course" ? node.id : node.key.split(":")[1] ?? node.id;
      queuePendingManage({ section: "course", kind: node.kind === "course" ? "course" : node.kind === "folder" ? "folder" : "note", itemId: node.id, courseId }, false);
      target = node.kind === "course" ? "/courses" : `/courses/${encodeURIComponent(courseId)}`;
    } else {
      return;
    }
    const alreadyInSection = window.location.pathname === new URL(target, window.location.origin).pathname;
    if (!alreadyInSection) navigate(target);
    window.setTimeout(() => window.dispatchEvent(new Event(PENDING_MANAGE_EVENT)), alreadyInSection ? 0 : 75);
    closeMobile?.();
  }

  const studyQuickCreate = (
    <Popover open={quickCreateOpen} onOpenChange={openQuickCreate}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Create Study note"
          title="New Study note"
          onClick={(event) => event.stopPropagation()}
          className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-sidebar-primary opacity-45 transition-opacity hover:bg-sidebar-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
          data-testid="sidebar-study-quick-create"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={8} className="w-80 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">New Study note</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Save it in Study or choose a folder.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sidebar-note-title" className="text-xs">Title</Label>
            <Input
              id="sidebar-note-title"
              autoFocus
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitQuickNote();
              }}
              placeholder="Note title"
              data-testid="sidebar-note-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Study folder</Label>
            <Select value={quickFolderId} onValueChange={setQuickFolderId}>
              <SelectTrigger data-testid="sidebar-note-folder">
                <SelectValue placeholder="Select a folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP_LEVEL_VALUE}>Study root</SelectItem>
                {studyFolderOptions.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => openQuickCreate(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={submitQuickNote}
              disabled={!quickTitle.trim() || !quickFolderId || createNote.isPending}
              data-testid="sidebar-create-note"
            >
              Create note
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
      <div className="mb-1 px-2 pt-1 text-[9.5px] font-bold uppercase text-sidebar-foreground/55">
        {searchActive ? "Results" : "Knowledge"}
      </div>
      {searchActive ? (
        <div className="space-y-3 pb-2" data-testid="sidebar-search-results">
          {!deferredSearchQuery ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">Search notes, folders, documents, and courses.</p>
          ) : searchGroups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matches found.</p>
          ) : searchGroups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-1 px-2 text-[9.5px] font-bold uppercase text-sidebar-foreground/55">{group.label}</h3>
              <div className="space-y-0.5">
                {group.matches.map((node) => (
                  <div key={node.key} className="group flex min-h-10 items-center rounded-md pr-1 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground">
                    <Link
                      href={node.href}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        closeSearch?.();
                        closeMobile?.();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                    >
                      <span className={cn("shrink-0 text-muted-foreground group-hover:text-sidebar-primary", node.kind === "document" && "text-sky-600 dark:text-sky-400")}>
                        {nodeIcon(node, false)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{node.label}</span>
                        {nodeLocation(model, node) ? <span className="block truncate text-[10px] text-muted-foreground">{nodeLocation(model, node)}</span> : null}
                      </span>
                    </Link>
                    {node.kind !== "group" ? (
                      <button
                        type="button"
                        aria-label={`Manage ${node.label}`}
                        title={`Rename, move, or delete ${node.label}`}
                        onClick={() => manageNode(node)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-sidebar-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : isLoading && model.nodes.size <= 4 ? (
        <div className="space-y-2 px-2 py-2" aria-label="Loading knowledge navigation">
          <div className="h-7 animate-pulse rounded-md bg-sidebar-accent/60" />
          <div className="h-7 animate-pulse rounded-md bg-sidebar-accent/45" />
          <div className="h-7 animate-pulse rounded-md bg-sidebar-accent/35" />
        </div>
      ) : model.sectionKeys.map((sectionKey) => (
        <TreeNode
          key={sectionKey}
          nodeKey={sectionKey}
          depth={0}
          model={model}
          expandedKeys={expandedKeys}
          activeKey={activeKey}
          activeLineage={activeLineage}
          toggleExpanded={toggleExpanded}
          navigate={navigate}
          closeMobile={closeMobile}
          studyAction={studyQuickCreate}
          createInFolder={createInFolder}
          manageNode={manageNode}
        />
      ))}
    </div>
  );
}
