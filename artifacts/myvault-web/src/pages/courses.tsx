import { useEffect, useState } from "react";
import { BookOpen, FileText, Layers3, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { cn } from "@/lib/utils";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { useLocalCourseChanges } from "@/hooks/useLocalCourseChanges";
import { recordRecentActivity } from "@/lib/recentActivity";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { consumePendingManage, PENDING_MANAGE_EVENT } from "@/lib/navigation/pendingManage";
import {
  clearLocalNoteDraft,
  isLocallyDeleted,
  saveLocalCourse,
  saveLocalCourseConcept,
  saveLocalCourseFolder,
  saveLocalCourseStickyNote,
  saveLocalCreatedNote,
  type LocalCourse,
  type LocalCourseFolder,
} from "@/lib/restore/localRestoreStore";

function localId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `web-${prefix}-${crypto.randomUUID()}`
    : `web-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeById<T extends { id: string }>(base: T[], local: T[]) {
  const merged = new Map(base.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].filter((item) => !isLocallyDeleted(item));
}

function descendantFolderIds(folders: Array<{ id: string; parentId?: string | null }>, rootFolderId: string | null) {
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

const accentStyles: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
};

export default function CoursesPage() {
  const [, navigate] = useLocation();
  const { corpus } = useRestoredCorpus();
  const { changes: localChanges, refresh: refreshLocalChanges } = useLocalCourseChanges();
  const [createOpen, setCreateOpen] = useState(false);
  const [courseTitle, setCourseTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [managedCourse, setManagedCourse] = useState<LocalCourse | null>(null);
  const [managedTitle, setManagedTitle] = useState("");
  const [manageError, setManageError] = useState<string | null>(null);
  const restoredFolders = corpus?.folders ?? [];
  const courses = mergeById(corpus?.courses ?? [], localChanges.courses);
  const courseRows = courses.map((course, index) => {
        const courseLocalFolders = localChanges.folders.filter((folder) => folder.courseId === course.id);
        const folderIds = descendantFolderIds([...restoredFolders, ...courseLocalFolders], course.rootFolderId);
        courseLocalFolders.forEach((folder) => folderIds.add(folder.id));
        const localNoteCount = localChanges.notes.filter((note) => note.folderId && folderIds.has(note.folderId)).length;
        const noteCount = course.noteCount + localNoteCount;
        const conceptCount = course.conceptCount + localChanges.concepts.filter((concept) => concept.courseId === course.id).length;
        const stickyNoteCount = course.stickyNoteCount + localChanges.stickyNotes.filter((stickyNote) => stickyNote.courseId === course.id).length;
        return {
          value: course,
          id: course.id,
          title: course.title,
          description: `${noteCount} note${noteCount === 1 ? "" : "s"}`,
          noteCount,
          conceptCount,
          updatedLabel: `${stickyNoteCount} sticky note${stickyNoteCount === 1 ? "" : "s"}`,
          accent: ["emerald", "amber", "sky"][index % 3],
        };
      });

  function openManageCourse(course: (typeof courses)[number]) {
    setManagedCourse({
      schemaVersion: 1,
      id: course.id,
      title: course.title,
      rootFolderId: course.rootFolderId,
      lastOpenedNoteId: course.lastOpenedNoteId,
      noteCount: course.noteCount,
      conceptCount: course.conceptCount,
      stickyNoteCount: course.stickyNoteCount,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      pendingDriveSync: true,
      deletedAt: null,
    });
    setManagedTitle(course.title);
    setManageError(null);
  }

  useEffect(() => {
    const openPendingManage = () => {
      const request = consumePendingManage("course");
      if (!request || request.kind !== "course") return;
      const course = courses.find((candidate) => candidate.id === request.itemId);
      if (course) openManageCourse(course);
    };
    window.addEventListener(PENDING_MANAGE_EVENT, openPendingManage);
    return () => window.removeEventListener(PENDING_MANAGE_EVENT, openPendingManage);
  }, [courses]);

  async function saveManagedCourse() {
    if (!managedCourse || !managedTitle.trim() || isSaving) return;
    setIsSaving(true);
    setManageError(null);
    try {
      await saveLocalCourse({ ...managedCourse, title: managedTitle.trim(), updatedAt: Date.now(), deletedAt: null });
      refreshLocalChanges();
      setManagedCourse(null);
      toast.success("Course renamed");
    } catch {
      setManageError("This course could not be renamed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteManagedCourse() {
    if (!managedCourse || isSaving) return;
    if (!window.confirm(`Delete “${managedCourse.title}” and remove it from this website?`)) return;
    setIsSaving(true);
    setManageError(null);
    try {
      const now = Date.now();
      const allFolders = [
        ...(corpus?.folders ?? []),
        ...localChanges.folders,
      ];
      const courseFolderIds = descendantFolderIds(allFolders, managedCourse.rootFolderId);
      localChanges.folders.filter((folder) => folder.courseId === managedCourse.id).forEach((folder) => courseFolderIds.add(folder.id));
      const courseFolders = allFolders.filter((folder) => courseFolderIds.has(folder.id));
      const courseNotes = [...(corpus?.notes ?? []), ...localChanges.notes]
        .filter((note, index, notes) => note.folderId && courseFolderIds.has(note.folderId) && notes.findLastIndex((candidate) => candidate.id === note.id) === index);
      const courseStickyNotes = [
        ...(corpus?.folderStickyNotes ?? []).map((sticky) => ({ ...sticky, courseId: managedCourse.id })),
        ...localChanges.stickyNotes,
      ].filter((sticky, index, notes) => courseFolderIds.has(sticky.folderId) && notes.findLastIndex((candidate) => candidate.id === sticky.id) === index);
      const courseConcepts = [...(corpus?.courseConceptCards ?? []), ...localChanges.concepts]
        .filter((concept, index, concepts) => concept.courseId === managedCourse.id && concepts.findLastIndex((candidate) => candidate.id === concept.id) === index);

      await Promise.all([
        saveLocalCourse({ ...managedCourse, updatedAt: now, deletedAt: now }),
        ...courseFolders.map((folder) => saveLocalCourseFolder({
          schemaVersion: 1,
          id: folder.id,
          courseId: managedCourse.id,
          parentId: folder.parentId ?? null,
          mode: `course:${managedCourse.id}`,
          title: folder.title,
          description: folder.description ?? null,
          orderIndex: folder.orderIndex ?? 0,
          createdAt: folder.createdAt,
          updatedAt: now,
          pendingDriveSync: true,
          deletedAt: now,
        })),
        ...courseNotes.map(async (note) => {
          await saveLocalCreatedNote({ ...note, updatedAt: now, deletedAt: now } as typeof note);
          await clearLocalNoteDraft(note.id);
        }),
        ...courseStickyNotes.map((sticky) => saveLocalCourseStickyNote({ schemaVersion: 1, ...sticky, updatedAt: now, pendingDriveSync: true, deletedAt: now })),
        ...courseConcepts.map((concept) => saveLocalCourseConcept({ schemaVersion: 1, ...concept, updatedAt: now, pendingDriveSync: true, deletedAt: now })),
      ]);
      refreshLocalChanges();
      setManagedCourse(null);
      toast.success("Course deleted locally");
    } catch {
      setManageError("This course could not be deleted.");
    } finally {
      setIsSaving(false);
    }
  }

  const createCourse = async () => {
    const title = courseTitle.trim();
    if (!title || isSaving) return;
    setIsSaving(true);
    try {
      const now = Date.now();
      const courseId = localId("course");
      const rootFolderId = localId("course-root");
      const rootFolder: LocalCourseFolder = {
        schemaVersion: 1,
        id: rootFolderId,
        courseId,
        parentId: null,
        mode: `course:${courseId}`,
        title,
        description: null,
        orderIndex: 0,
        createdAt: now,
        updatedAt: now,
        pendingDriveSync: true,
      };
      const course: LocalCourse = {
        schemaVersion: 1,
        id: courseId,
        title,
        rootFolderId,
        lastOpenedNoteId: null,
        noteCount: 0,
        conceptCount: 0,
        stickyNoteCount: 0,
        createdAt: now,
        updatedAt: now,
        pendingDriveSync: true,
      };
      await saveLocalCourseFolder(rootFolder);
      await saveLocalCourse(course);
      setCreateOpen(false);
      setCourseTitle("");
      toast.success("Course created");
      navigate(`/courses/${courseId}`);
    } catch {
      toast.error("Could not create this course.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Courses"
        description="Course folders, notes, sticky notes, and concept cards from MyVault."
        actions={<Button size="sm" onClick={() => setCreateOpen(true)} data-testid="new-course"><Plus className="h-4 w-4" /> New course</Button>}
      />

      <section className="grid gap-4 lg:grid-cols-3">
        {courseRows.map((course) => (
          <ContextMenu key={course.id}>
            <ContextMenuTrigger asChild>
              <article className="relative rounded-lg bg-card/75 p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-colors hover:bg-card">
                <button
                  type="button"
                  data-testid={`course-card-${course.id}`}
                  onClick={() => {
                    recordRecentActivity("course", course.id);
                    navigate(`/courses/${course.id}`);
                  }}
                  className="absolute inset-0 rounded-lg"
                  aria-label={`Open ${course.title}`}
                />
            <div className="flex items-start justify-between gap-3">
              <div className={cn("rounded-md border px-2.5 py-1 text-xs font-semibold", accentStyles[course.accent])}>
                {course.updatedLabel}
              </div>
              <button type="button" onClick={() => openManageCourse(course.value)} aria-label={`Manage ${course.title}`} className="relative z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
            </div>
            <h2 className="mt-5 text-lg font-semibold text-foreground">{course.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{course.description}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Notes
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{course.noteCount}</p>
              </div>
              <div className="rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers3 className="h-3.5 w-3.5" />
                  Concepts
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{course.conceptCount}</p>
              </div>
            </div>
              </article>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onSelect={() => navigate(`/courses/${course.id}`)}>Open</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => openManageCourse(course.value)}>Rename</ContextMenuItem>
              <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => openManageCourse(course.value)}>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </section>

      {courseRows.length === 0 ? (
        <section className="rounded-lg bg-white/65 p-8 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h2 className="mt-4 text-sm font-semibold text-foreground">No courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create your first course to organise lesson notes and concepts.</p>
          <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New course</Button>
        </section>
      ) : null}

      <Dialog open={createOpen} onOpenChange={(open) => !isSaving && setCreateOpen(open)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New course</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void createCourse(); }}>
            <div>
              <Label htmlFor="new-course-title">Course name</Label>
              <Input
                id="new-course-title"
                data-testid="new-course-title"
                value={courseTitle}
                onChange={(event) => setCourseTitle(event.target.value)}
                placeholder="Umdat al-Fiqh"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" disabled={!courseTitle.trim() || isSaving}>{isSaving ? "Creating..." : "Create course"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={managedCourse !== null} onOpenChange={(open) => !open && !isSaving && setManagedCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage course</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="managed-course-title">Course name</Label>
              <Input id="managed-course-title" value={managedTitle} onChange={(event) => setManagedTitle(event.target.value)} autoFocus />
            </div>
            {manageError ? <p role="alert" className="text-sm text-destructive">{manageError}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => void deleteManagedCourse()} disabled={isSaving} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setManagedCourse(null)} disabled={isSaving}>Cancel</Button>
                <Button type="button" onClick={() => void saveManagedCourse()} disabled={!managedTitle.trim() || isSaving}>{isSaving ? "Saving..." : "Save changes"}</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </PageContainer>
  );
}
