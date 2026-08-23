import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, BookOpen, FileText, FolderPlus, Lightbulb, Minimize2, MoreHorizontal, Plus, Pin, Play, StickyNote, Trash2, UnfoldVertical } from "lucide-react";
import type { Folder, Note } from "@workspace/api-client-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { StudyTree } from "@/components/study/study-tree";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useLocalCourseChanges } from "@/hooks/useLocalCourseChanges";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { recordRecentActivity } from "@/lib/recentActivity";
import { consumePendingCreate, PENDING_CREATE_EVENT } from "@/lib/navigation/pendingCreate";
import { consumePendingManage, PENDING_MANAGE_EVENT } from "@/lib/navigation/pendingManage";
import {
  clearLocalNoteDraft,
  saveLocalCourseConcept,
  saveLocalCourseFolder,
  saveLocalCourseStickyNote,
  saveLocalCreatedNote,
  isLocallyDeleted,
  type LocalCourseConcept,
  type LocalCourseFolder,
  type LocalCourseStickyNote,
} from "@/lib/restore/localRestoreStore";

type CourseCreateType = "folder" | "note" | "sticky" | "concept";
type ManagedCourseItem =
  | { kind: "folder"; value: Folder }
  | { kind: "note"; value: Note }
  | { kind: "sticky"; value: LocalCourseStickyNote }
  | { kind: "concept"; value: LocalCourseConcept };

const TOP_LEVEL_VALUE = "__course_top_level__";

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `web-${crypto.randomUUID()}`
    : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeById<T extends { id: string }>(base: T[], local: T[]) {
  const merged = new Map(base.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].filter((item) => !isLocallyDeleted(item));
}

function descendantFolderIds(folders: Folder[], rootFolderId: string | null) {
  if (!rootFolderId) return new Set<string>();
  const ids = new Set([rootFolderId]);
  const queue = [rootFolderId];
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

function ancestorFolderIds(folders: Folder[], folderId: string, rootFolderId: string | null) {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const ids = new Set<string>();
  let current = foldersById.get(folderId);
  while (current && current.id !== rootFolderId && !ids.has(current.id)) {
    ids.add(current.id);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return ids;
}

function sortFolders(folders: Folder[]) {
  return folders.toSorted((first, second) => (first.orderIndex ?? 0) - (second.orderIndex ?? 0) || first.title.localeCompare(second.title));
}

function sortNotes(notes: Note[]) {
  return notes.toSorted((first, second) => {
    if (Boolean(first.isPinned) !== Boolean(second.isPinned)) return first.isPinned ? -1 : 1;
    return (first.orderIndex ?? 0) - (second.orderIndex ?? 0) || first.title.localeCompare(second.title);
  });
}

function selectableFolders(folders: Folder[], rootFolderId: string | null) {
  const childrenByParent = new Map<string | null, Folder[]>();
  const folderIds = new Set(folders.map((folder) => folder.id));
  folders.forEach((folder) => {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });

  const options: Array<{ folder: Folder; depth: number }> = [];
  const visited = new Set<string>();
  function append(parentId: string | null, depth: number) {
    sortFolders(childrenByParent.get(parentId) ?? []).forEach((folder) => {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      options.push({ folder, depth });
      append(folder.id, depth + 1);
    });
  }

  if (rootFolderId && folderIds.has(rootFolderId)) {
    const rootFolder = folders.find((folder) => folder.id === rootFolderId)!;
    options.push({ folder: rootFolder, depth: 0 });
    visited.add(rootFolder.id);
    append(rootFolder.id, 1);
  } else {
    append(null, 0);
  }
  return options;
}

function formatUpdatedAt(updatedAt: number) {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "Recently" : formatDistanceToNow(date, { addSuffix: true });
}

function RootNoteRow({ note, onOpen, onManage }: { note: Note; onOpen: () => void; onManage: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex min-h-12 w-full items-center rounded-lg pr-2 transition-colors hover:bg-card/80">
          <button type="button" onClick={onOpen} data-testid={`course-note-${note.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
            {note.isPinned ? <Pin className="h-4 w-4 shrink-0 text-primary" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{note.title}</span>
            <span className="hidden max-w-64 truncate text-xs text-muted-foreground lg:block">{note.bodyPreview}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{formatUpdatedAt(note.updatedAt)}</span>
          </button>
          <button type="button" onClick={onManage} aria-label={`Manage ${note.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onManage}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onManage}>Move</ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onManage}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function CourseDetailPage() {
  const { courseId = "" } = useParams<{ courseId: string }>();
  const [location, navigate] = useLocation();
  const { corpus, isLoading } = useRestoredCorpus();
  const { changes: localChanges, isLoading: localChangesLoading, refresh: refreshLocalChanges } = useLocalCourseChanges(courseId);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [createType, setCreateType] = useState<CourseCreateType | null>(null);
  const [targetFolderId, setTargetFolderId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [arabicTerm, setArabicTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [details, setDetails] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [managedItem, setManagedItem] = useState<ManagedCourseItem | null>(null);
  const [managedName, setManagedName] = useState("");
  const [managedDetails, setManagedDetails] = useState("");
  const [managedLocationId, setManagedLocationId] = useState("");
  const [manageError, setManageError] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);
  const allCourses = useMemo(
    () => mergeById(corpus?.courses ?? [], localChanges.courses),
    [corpus?.courses, localChanges.courses],
  );
  const course = allCourses.find((candidate) => candidate.id === courseId) ?? null;

  const courseData = useMemo(() => {
    if (!course) return null;
    const corpusFolders = corpus?.folders ?? [];
    const restoredFolderIds = descendantFolderIds(corpusFolders, course.rootFolderId);
    const restoredFolders = corpusFolders.filter((folder) => restoredFolderIds.has(folder.id));
    const localFolders: Folder[] = localChanges.folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parentId,
      title: folder.title,
      description: folder.description,
      mode: "study",
      workspace: "islamic_corpus",
      orderIndex: folder.orderIndex,
      noteCount: 0,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }));
    const folders = sortFolders(mergeById(restoredFolders, localFolders));
    const folderIds = new Set(folders.map((folder) => folder.id));
    const rootFolder = course.rootFolderId ? folders.find((folder) => folder.id === course.rootFolderId) ?? null : null;
    const materialRoots = sortFolders(folders.filter((folder) => rootFolder
      ? folder.parentId === rootFolder.id
      : !folder.parentId || !folderIds.has(folder.parentId)));
    const restoredNotes = (corpus?.notes ?? []).filter((note) => note.folderId && folderIds.has(note.folderId));
    const localNotes = localChanges.notes.filter((note) => note.folderId && folderIds.has(note.folderId));
    const notes = sortNotes(mergeById(restoredNotes, localNotes));
    const directNotes = notes.filter((note) => note.folderId === rootFolder?.id);
    const stickyNotes = mergeById(
      (corpus?.folderStickyNotes ?? []).filter((stickyNote) => folderIds.has(stickyNote.folderId)),
      localChanges.stickyNotes,
    );
    const directStickyNotes = stickyNotes.filter((stickyNote) => stickyNote.folderId === rootFolder?.id);
    const concepts = mergeById(
      (corpus?.courseConceptCards ?? []).filter((concept) => concept.courseId === course.id),
      localChanges.concepts,
    )
      .toSorted((first, second) => first.sortOrder - second.sortOrder || first.term.localeCompare(second.term));
    const continueNote = notes.find((note) => note.id === course.lastOpenedNoteId) ?? notes.toSorted((first, second) => second.updatedAt - first.updatedAt)[0] ?? null;
    return { folders, rootFolder, materialRoots, notes, directNotes, stickyNotes, directStickyNotes, concepts, continueNote };
  }, [corpus, course, localChanges]);
  const materialRootIdKey = courseData?.materialRoots.map((folder) => folder.id).join("|") ?? "";

  useEffect(() => {
    if (!courseId) return;
    recordRecentActivity("course", courseId);
    setExpandedFolderIds(new Set(materialRootIdKey ? materialRootIdKey.split("|") : []));
  }, [courseId, materialRootIdKey]);

  useEffect(() => {
    const query = location.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    const folderId = params.get("folder");
    if (!folderId || !courseData || !course) return;
    setExpandedFolderIds((current) => {
      const next = new Set([
        ...current,
        ...ancestorFolderIds(courseData.folders, folderId, course.rootFolderId),
      ]);
      return next.size === current.size ? current : next;
    });

  }, [course, courseData, location]);

  useEffect(() => {
    if (!courseData || !course) return;
    const openPendingCreate = () => {
      const request = consumePendingCreate("course", course.id);
      if (!request || !courseData.folders.some((folder) => folder.id === request.folderId)) return;
      if (request.type !== "folder" && request.type !== "note" && request.type !== "sticky") return;
      setCreateType(request.type);
      setTargetFolderId(request.folderId);
      setTitle("");
      setDescription("");
      setArabicTerm("");
      setDefinition("");
      setDetails("");
    };
    window.addEventListener(PENDING_CREATE_EVENT, openPendingCreate);
    return () => window.removeEventListener(PENDING_CREATE_EVENT, openPendingCreate);
  }, [course, courseData]);

  useEffect(() => {
    if (!courseData || !course) return;
    const openPendingManage = () => {
      const request = consumePendingManage("course");
      if (!request || request.courseId !== course.id) return;
      if (request.kind === "folder") {
        const folder = courseData.folders.find((candidate) => candidate.id === request.itemId);
        if (folder) openManageFolder(folder);
      } else if (request.kind === "note") {
        const note = courseData.notes.find((candidate) => candidate.id === request.itemId);
        if (note) openManageNote(note);
      } else if (request.kind === "sticky") {
        const stickyNote = courseData.stickyNotes.find((candidate) => candidate.id === request.itemId);
        if (stickyNote) openManageSticky(stickyNote);
      } else if (request.kind === "concept") {
        const concept = courseData.concepts.find((candidate) => candidate.id === request.itemId);
        if (concept) openManageConcept(concept);
      }
    };
    window.addEventListener(PENDING_MANAGE_EVENT, openPendingManage);
    return () => window.removeEventListener(PENDING_MANAGE_EVENT, openPendingManage);
  }, [course, courseData]);

  if (isLoading || localChangesLoading) {
    return <PageContainer><Skeleton className="h-8 w-80" /><Skeleton className="mt-8 h-20 w-full rounded-lg" /><Skeleton className="mt-6 h-[55vh] w-full rounded-lg" /></PageContainer>;
  }

  if (!course || !courseData) {
    return (
      <PageContainer>
        <Button variant="ghost" onClick={() => navigate("/courses")}><ArrowLeft className="h-4 w-4" /> Courses</Button>
        <div className="mt-16 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h1 className="mt-4 text-base font-semibold text-foreground">Course not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">This course is not available in the current workspace.</p>
        </div>
      </PageContainer>
    );
  }

  const activeCourse = course;
  const activeCourseData = courseData;
  const folderChoices = selectableFolders(courseData.folders, course.rootFolderId);

  const openCreateDialog = (type: CourseCreateType, folderId?: string) => {
    const defaultFolderId = courseData.rootFolder?.id ?? courseData.materialRoots[0]?.id ?? "";
    setCreateType(type);
    setTargetFolderId(folderId ?? (type === "folder" ? defaultFolderId || TOP_LEVEL_VALUE : defaultFolderId));
    setTitle("");
    setDescription("");
    setArabicTerm("");
    setDefinition("");
    setDetails("");
  };

  const closeCreateDialog = () => {
    if (isSaving) return;
    setCreateType(null);
    setTargetFolderId("");
  };

  const submitCreatedItem = async () => {
    if (!createType || !course) return;
    const cleanTitle = title.trim();
    const cleanTargetFolderId = targetFolderId === TOP_LEVEL_VALUE ? null : targetFolderId || null;
    if ((createType === "folder" || createType === "note") && !cleanTitle) return;
    if ((createType === "note" || createType === "sticky") && !cleanTargetFolderId) return;
    if (createType === "sticky" && !description.trim()) return;
    if (createType === "concept" && !cleanTitle) return;

    setIsSaving(true);
    try {
      const now = Date.now();
      if (createType === "folder") {
        const siblingCount = courseData.folders.filter((folder) => folder.parentId === cleanTargetFolderId).length;
        const folder: LocalCourseFolder = {
          schemaVersion: 1,
          id: localId(),
          courseId: course.id,
          parentId: cleanTargetFolderId,
          mode: `course:${course.id}`,
          title: cleanTitle,
          description: description.trim() || null,
          orderIndex: siblingCount,
          createdAt: now,
          updatedAt: now,
          pendingDriveSync: true,
        };
        await saveLocalCourseFolder(folder);
        if (folder.parentId) setExpandedFolderIds((current) => new Set([...current, folder.parentId!]));
        refreshLocalChanges();
        toast.success("Folder saved locally", { description: "It is waiting for a future Google Drive sync." });
      } else if (createType === "note") {
        const note: Note = {
          id: localId(),
          folderId: cleanTargetFolderId,
          parentNoteId: null,
          title: cleanTitle,
          bodyPreview: "",
          wordCount: 0,
          characterCount: 0,
          isPinned: false,
          isFolderPinned: false,
          orderIndex: courseData.notes.filter((noteItem) => noteItem.folderId === cleanTargetFolderId).length,
          tagNames: [],
          createdAt: now,
          updatedAt: now,
        };
        await saveLocalCreatedNote(note);
        setCreateType(null);
        navigate(`/courses/${course.id}/notes/${note.id}`);
        return;
      } else if (createType === "sticky") {
        const stickyNote: LocalCourseStickyNote = {
          schemaVersion: 1,
          id: localId(),
          courseId: course.id,
          folderId: cleanTargetFolderId!,
          text: description.trim(),
          createdAt: now,
          updatedAt: now,
          pendingDriveSync: true,
        };
        await saveLocalCourseStickyNote(stickyNote);
        setExpandedFolderIds((current) => new Set([...current, stickyNote.folderId]));
        refreshLocalChanges();
        toast.success("Sticky note saved locally", { description: "It is waiting for a future Google Drive sync." });
      } else {
        const concept: LocalCourseConcept = {
          schemaVersion: 1,
          id: localId(),
          courseId: course.id,
          term: cleanTitle,
          arabicTerm: arabicTerm.trim() || null,
          definition: definition.trim(),
          details: details.trim() || null,
          sortOrder: courseData.concepts.length,
          createdAt: now,
          updatedAt: now,
          pendingDriveSync: true,
        };
        await saveLocalCourseConcept(concept);
        refreshLocalChanges();
        toast.success("Concept card saved locally", { description: "It is waiting for a future Google Drive sync." });
      }
      setCreateType(null);
    } catch {
      toast.error("Could not save this course item locally.");
    } finally {
      setIsSaving(false);
    }
  };

  const canCreate = createType === "folder" || createType === "note"
    ? Boolean(title.trim()) && (createType === "folder" || Boolean(targetFolderId))
    : createType === "sticky"
      ? Boolean(targetFolderId && description.trim())
      : createType === "concept"
        ? Boolean(title.trim())
        : false;

  const openNote = (noteId: string) => {
    recordRecentActivity("course", activeCourse.id);
    navigate(`/courses/${activeCourse.id}/notes/${noteId}`);
  };

  function openManageFolder(folder: Folder) {
    setManagedItem({ kind: "folder", value: folder });
    setManagedName(folder.title);
    setManagedDetails(folder.description ?? "");
    setManagedLocationId(folder.parentId ?? TOP_LEVEL_VALUE);
    setManageError(null);
  }

  function openManageNote(note: Note) {
    setManagedItem({ kind: "note", value: note });
    setManagedName(note.title);
    setManagedDetails("");
    setManagedLocationId(note.folderId ?? activeCourseData.rootFolder?.id ?? "");
    setManageError(null);
  }

  function openManageSticky(stickyNote: { id: string; folderId: string; text: string; createdAt: number; updatedAt: number }) {
    setManagedItem({
      kind: "sticky",
      value: {
        schemaVersion: 1,
        id: stickyNote.id,
        courseId: activeCourse.id,
        folderId: stickyNote.folderId,
        text: stickyNote.text,
        createdAt: stickyNote.createdAt,
        updatedAt: stickyNote.updatedAt,
        pendingDriveSync: true,
      },
    });
    setManagedName(stickyNote.text);
    setManagedDetails("");
    setManagedLocationId(stickyNote.folderId);
    setManageError(null);
  }

  function openManageConcept(concept: { id: string; courseId: string; term: string; arabicTerm: string | null; definition: string; details: string | null; sortOrder: number; createdAt: number; updatedAt: number }) {
    setManagedItem({ kind: "concept", value: { schemaVersion: 1, ...concept, pendingDriveSync: true } });
    setManagedName(concept.term);
    setManagedDetails(concept.definition);
    setManagedLocationId("");
    setManageError(null);
  }

  function closeManageDialog() {
    if (isManaging) return;
    setManagedItem(null);
    setManagedName("");
    setManagedDetails("");
    setManagedLocationId("");
    setManageError(null);
  }

  async function saveManagedItem() {
    if (!managedItem || !managedName.trim() || isManaging) return;
    setIsManaging(true);
    setManageError(null);
    try {
      const now = Date.now();
      if (managedItem.kind === "folder") {
        const folder = managedItem.value;
        const parentId = managedLocationId === TOP_LEVEL_VALUE ? null : managedLocationId || null;
        const invalidParentIds = descendantFolderIds(activeCourseData.folders, folder.id);
        if (parentId && invalidParentIds.has(parentId)) throw new Error("A folder cannot be moved inside itself.");
        await saveLocalCourseFolder({
          schemaVersion: 1,
          id: folder.id,
          courseId: activeCourse.id,
          parentId,
          mode: `course:${activeCourse.id}`,
          title: managedName.trim(),
          description: managedDetails.trim() || null,
          orderIndex: folder.orderIndex ?? 0,
          createdAt: folder.createdAt,
          updatedAt: now,
          pendingDriveSync: true,
          deletedAt: null,
        });
      } else if (managedItem.kind === "note") {
        if (!managedLocationId) throw new Error("Choose a folder for this note.");
        await saveLocalCreatedNote({
          ...managedItem.value,
          title: managedName.trim(),
          folderId: managedLocationId,
          updatedAt: now,
          deletedAt: null,
        } as Note);
      } else if (managedItem.kind === "sticky") {
        if (!managedLocationId) throw new Error("Choose a folder for this sticky note.");
        await saveLocalCourseStickyNote({
          ...managedItem.value,
          folderId: managedLocationId,
          text: managedName.trim(),
          updatedAt: now,
          deletedAt: null,
        });
      } else {
        await saveLocalCourseConcept({
          ...managedItem.value,
          term: managedName.trim(),
          definition: managedDetails.trim(),
          updatedAt: now,
          deletedAt: null,
        });
      }
      refreshLocalChanges();
      setManagedItem(null);
      setManagedName("");
      setManagedDetails("");
      setManagedLocationId("");
      toast.success("Changes saved locally");
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : "This item could not be updated.");
    } finally {
      setIsManaging(false);
    }
  }

  async function deleteManagedItem() {
    if (!managedItem || isManaging) return;
    if (!window.confirm(`Delete ${managedItem.kind === "sticky" ? "this sticky note" : `“${managedName}”`}?`)) return;
    setIsManaging(true);
    setManageError(null);
    try {
      const now = Date.now();
      if (managedItem.kind === "folder") {
        const folder = managedItem.value;
        const hasChildren = activeCourseData.folders.some((candidate) => candidate.parentId === folder.id)
          || activeCourseData.notes.some((note) => note.folderId === folder.id)
          || activeCourseData.stickyNotes.some((stickyNote) => stickyNote.folderId === folder.id);
        if (hasChildren) throw new Error("Move or delete this folder's contents before deleting it.");
        if (folder.id === activeCourse.rootFolderId) throw new Error("The main course folder cannot be deleted.");
        await saveLocalCourseFolder({
          schemaVersion: 1,
          id: folder.id,
          courseId: activeCourse.id,
          parentId: folder.parentId ?? null,
          mode: `course:${activeCourse.id}`,
          title: folder.title,
          description: folder.description ?? null,
          orderIndex: folder.orderIndex ?? 0,
          createdAt: folder.createdAt,
          updatedAt: now,
          pendingDriveSync: true,
          deletedAt: now,
        });
      } else if (managedItem.kind === "note") {
        await saveLocalCreatedNote({ ...managedItem.value, updatedAt: now, deletedAt: now } as Note);
        await clearLocalNoteDraft(managedItem.value.id);
      } else if (managedItem.kind === "sticky") {
        await saveLocalCourseStickyNote({ ...managedItem.value, updatedAt: now, deletedAt: now });
      } else {
        await saveLocalCourseConcept({ ...managedItem.value, updatedAt: now, deletedAt: now });
      }
      refreshLocalChanges();
      setManagedItem(null);
      setManagedName("");
      setManagedDetails("");
      setManagedLocationId("");
      toast.success("Item deleted locally");
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : "This item could not be deleted.");
    } finally {
      setIsManaging(false);
    }
  }

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const hasMaterials = courseData.materialRoots.length > 0 || courseData.directNotes.length > 0 || courseData.directStickyNotes.length > 0;

  return (
    <PageContainer>
      <Button variant="ghost" size="sm" onClick={() => navigate("/courses")} className="mb-4 -ml-2 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Courses
      </Button>
      <PageHeader
        title={course.title}
        description={`${Math.max(courseData.folders.length - (courseData.rootFolder ? 1 : 0), 0)} folders · ${courseData.notes.length} notes · ${courseData.concepts.length} concepts`}
        actions={(
          <div className="flex items-center gap-2">
            {allCourses.length > 1 ? (
              <select
                aria-label="Switch course"
                value={course.id}
                onChange={(event) => navigate(`/courses/${event.target.value}`)}
                className="h-9 max-w-56 rounded-md bg-card px-3 text-sm font-medium text-foreground shadow-[0_1px_3px_rgba(15,23,42,0.06)] outline-none focus:ring-2 focus:ring-primary/30"
              >
                {allCourses.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
              </select>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" data-testid="course-add-menu"><Plus className="h-4 w-4" /> Add</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => openCreateDialog("folder")} data-testid="add-course-folder">
                  <FolderPlus className="h-4 w-4" /> Folder
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openCreateDialog("note")} disabled={folderChoices.length === 0} data-testid="add-course-note">
                  <FileText className="h-4 w-4" /> Lesson note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openCreateDialog("sticky")} disabled={folderChoices.length === 0} data-testid="add-course-sticky">
                  <StickyNote className="h-4 w-4" /> Sticky note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openCreateDialog("concept")} data-testid="add-course-concept">
                  <Lightbulb className="h-4 w-4" /> Concept card
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      />

      {courseData.continueNote ? (
        <button
          type="button"
          onClick={() => openNote(courseData.continueNote!.id)}
          data-testid="course-continue-note"
          className="mb-8 flex w-full items-center gap-4 rounded-lg bg-primary/[0.07] px-4 py-3 text-left transition-colors hover:bg-primary/[0.11]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Play className="ml-0.5 h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted-foreground">Continue lesson</span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">{courseData.continueNote.title}</span>
          </span>
        </button>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Course materials</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{courseData.materialRoots.length} top-level folders</p>
            </div>
            {courseData.materialRoots.length > 0 ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setExpandedFolderIds(new Set(courseData.folders.map((folder) => folder.id)))} className="text-muted-foreground">
                  <UnfoldVertical className="h-4 w-4" /> Expand all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExpandedFolderIds(new Set())} className="text-muted-foreground">
                  <Minimize2 className="h-4 w-4" /> Collapse all
                </Button>
              </div>
            ) : null}
          </div>

          {!hasMaterials ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-lg bg-card/40 text-center">
              <BookOpen className="h-9 w-9 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium text-foreground">No course materials yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Use Add to create a folder, lesson note, sticky note, or concept card.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {courseData.directStickyNotes.map((stickyNote) => (
                <div key={stickyNote.id} className="group flex min-h-12 items-center gap-3 rounded-lg bg-amber-50/55 px-3 py-2 dark:bg-amber-950/20">
                  <StickyNote className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1 text-sm text-foreground">{stickyNote.text}</span>
                  <span className="text-[11px] text-muted-foreground">Sticky note</span>
                  <button type="button" onClick={() => openManageSticky(stickyNote)} aria-label="Manage sticky note" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                </div>
              ))}
              {courseData.directNotes.map((note) => <RootNoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} onManage={() => openManageNote(note)} />)}
              <StudyTree
                roots={courseData.materialRoots}
                folders={courseData.folders}
                notes={courseData.notes}
                stickyNotes={courseData.stickyNotes}
                expandedFolderIds={expandedFolderIds}
                onToggleFolder={toggleFolder}
                onOpenNote={openNote}
                onManageFolder={openManageFolder}
                onManageNote={openManageNote}
                onDeleteFolder={openManageFolder}
                onDeleteNote={openManageNote}
                onManageSticky={openManageSticky}
                onDeleteSticky={openManageSticky}
                allowStickyNotes
                onCreateInFolder={(folderId, type) => {
                  openCreateDialog(type, folderId);
                  setExpandedFolderIds((current) => new Set([...current, folderId]));
                }}
              />
            </div>
          )}
        </main>

        <aside className="min-w-0">
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-foreground">Concept cards</h2>
            <span className="ml-auto text-xs text-muted-foreground">{courseData.concepts.length}</span>
          </div>
          {courseData.concepts.length === 0 ? (
            <p className="rounded-lg bg-card/35 px-4 py-6 text-sm text-muted-foreground">No concept cards in this course.</p>
          ) : (
            <div className="space-y-3">
              {courseData.concepts.map((concept) => (
                <article key={concept.id} data-testid={`course-concept-${concept.id}`} className="rounded-lg bg-card/65 p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{concept.term}</h3>
                    <div className="flex items-center gap-1">
                      {concept.arabicTerm ? <span lang="ar" dir="rtl" className="shrink-0 text-sm text-primary">{concept.arabicTerm}</span> : null}
                      <button type="button" onClick={() => openManageConcept(concept)} aria-label={`Manage ${concept.term}`} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {concept.definition ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{concept.definition}</p> : null}
                  {concept.details ? <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground/80">{concept.details}</p> : null}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      <Dialog open={createType !== null} onOpenChange={(open) => !open && closeCreateDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createType === "folder" ? "New Course Folder"
                : createType === "note" ? "New Lesson Note"
                  : createType === "sticky" ? "New Sticky Note"
                    : "New Concept Card"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreatedItem();
            }}
          >
            {(createType === "folder" || createType === "note") ? (
              <div>
                <Label htmlFor="course-item-title">{createType === "folder" ? "Folder name" : "Note title"}</Label>
                <Input
                  id="course-item-title"
                  data-testid="course-item-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={createType === "folder" ? "Book of Zakah" : "Lesson title"}
                  autoFocus
                />
              </div>
            ) : null}

            {createType === "concept" ? (
              <>
                <div>
                  <Label htmlFor="course-concept-term">Term</Label>
                  <Input id="course-concept-term" data-testid="course-concept-term" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Key term" autoFocus />
                </div>
                <div>
                  <Label htmlFor="course-concept-arabic">Arabic term <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="course-concept-arabic" data-testid="course-concept-arabic" dir="rtl" value={arabicTerm} onChange={(event) => setArabicTerm(event.target.value)} placeholder="Arabic term" />
                </div>
                <div>
                  <Label htmlFor="course-concept-definition">Definition</Label>
                  <Textarea id="course-concept-definition" data-testid="course-concept-definition" value={definition} onChange={(event) => setDefinition(event.target.value)} placeholder="A concise definition" rows={3} />
                </div>
                <div>
                  <Label htmlFor="course-concept-details">Details <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Textarea id="course-concept-details" data-testid="course-concept-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Additional explanation" rows={3} />
                </div>
              </>
            ) : null}

            {createType === "sticky" ? (
              <div>
                <Label htmlFor="course-sticky-text">Sticky note</Label>
                <Textarea id="course-sticky-text" data-testid="course-sticky-text" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Reminder or course note" rows={4} autoFocus />
              </div>
            ) : null}

            {createType === "folder" ? (
              <div>
                <Label htmlFor="course-folder-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="course-folder-description" data-testid="course-folder-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this folder contains" />
              </div>
            ) : null}

            {(createType === "folder" || createType === "note" || createType === "sticky") ? (
              <div>
                <Label htmlFor="course-target-folder">{createType === "folder" ? "Parent folder" : "Folder"}</Label>
                <select
                  id="course-target-folder"
                  data-testid="course-target-folder"
                  value={targetFolderId}
                  onChange={(event) => setTargetFolderId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {createType === "folder" && !courseData.rootFolder ? <option value={TOP_LEVEL_VALUE}>Course top level</option> : null}
                  {folderChoices.map(({ folder, depth }) => (
                    <option key={folder.id} value={folder.id}>
                      {`${"  ".repeat(depth)}${folder.id === courseData.rootFolder?.id ? `${course.title} (course root)` : folder.title}`}
                    </option>
                  ))}
                </select>
                {(createType === "note" || createType === "sticky") && folderChoices.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Create a course folder first.</p>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={closeCreateDialog} disabled={isSaving}>Cancel</Button>
              <Button type="submit" data-testid="create-course-item" disabled={!canCreate || isSaving}>
                {isSaving ? "Saving..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={managedItem !== null} onOpenChange={(open) => !open && closeManageDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage {managedItem?.kind === "sticky" ? "Sticky Note" : managedItem?.kind === "concept" ? "Concept Card" : managedItem?.kind === "note" ? "Lesson Note" : "Course Folder"}</DialogTitle></DialogHeader>
          {managedItem ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="managed-course-item-name">{managedItem.kind === "sticky" ? "Text" : managedItem.kind === "concept" ? "Term" : "Name"}</Label>
                {managedItem.kind === "sticky" ? (
                  <Textarea id="managed-course-item-name" value={managedName} onChange={(event) => setManagedName(event.target.value)} rows={4} />
                ) : (
                  <Input id="managed-course-item-name" value={managedName} onChange={(event) => setManagedName(event.target.value)} autoFocus />
                )}
              </div>
              {(managedItem.kind === "folder" || managedItem.kind === "concept") ? (
                <div>
                  <Label htmlFor="managed-course-item-details">{managedItem.kind === "folder" ? "Description" : "Definition"}</Label>
                  <Textarea id="managed-course-item-details" value={managedDetails} onChange={(event) => setManagedDetails(event.target.value)} rows={3} />
                </div>
              ) : null}
              {(managedItem.kind === "folder" || managedItem.kind === "note" || managedItem.kind === "sticky") ? (
                <div>
                  <Label htmlFor="managed-course-item-location">{managedItem.kind === "folder" ? "Parent folder" : "Folder"}</Label>
                  <select id="managed-course-item-location" value={managedLocationId} onChange={(event) => setManagedLocationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                    {managedItem.kind === "folder" && !courseData.rootFolder ? <option value={TOP_LEVEL_VALUE}>Course top level</option> : null}
                    {folderChoices
                      .filter(({ folder }) => managedItem.kind !== "folder" || !descendantFolderIds(courseData.folders, managedItem.value.id).has(folder.id))
                      .map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${"  ".repeat(depth)}${folder.id === courseData.rootFolder?.id ? `${course.title} (course root)` : folder.title}`}</option>)}
                  </select>
                </div>
              ) : null}
              {manageError ? <p role="alert" className="text-sm text-destructive">{manageError}</p> : null}
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button type="button" variant="ghost" onClick={() => void deleteManagedItem()} disabled={isManaging} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={closeManageDialog} disabled={isManaging}>Cancel</Button>
                  <Button type="button" onClick={() => void saveManagedItem()} disabled={!managedName.trim() || isManaging}>{isManaging ? "Saving..." : "Save changes"}</Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
