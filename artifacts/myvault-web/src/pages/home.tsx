import type { ElementType, ReactNode } from "react";
import { useLocation } from "wouter";
import { useListAttachments, useListFolders, useListNotes } from "@workspace/api-client-react";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  Library,
  MoreVertical,
  SquarePen,
} from "lucide-react";
import quranMedallion from "@/assets/quran-reader-medallion.png";
import { useRestoredCorpus } from "@/hooks/useRestoredCorpus";
import { useLocalCourseChanges } from "@/hooks/useLocalCourseChanges";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/providers";
import { orderByRecentActivity, recordRecentActivity } from "@/lib/recentActivity";
import { useQuranReadingPosition } from "@/hooks/useQuranReadingPosition";
import type { QuranReadingPosition } from "@/lib/quran/quranReadingState";

type DashboardCourse = {
  id: string;
  title: string;
  description: string;
  noteCount: number;
  conceptCount: number;
  updatedLabel: string;
  accent: string;
};

type DashboardDocument = {
  id: string;
  title: string;
  detail: string;
  folder: string;
};

type DashboardNote = {
  id: string;
  title: string;
  preview: string;
  folder: string;
};

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg bg-white/80 shadow-[0_4px_18px_rgba(15,23,42,0.04)]", className)}>
      {children}
    </section>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  action,
  onAction,
}: {
  icon: ElementType;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-[54px] items-center justify-between px-5">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-emerald-700" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      {action && <button type="button" onClick={onAction} className="text-xs font-bold text-emerald-800 hover:text-emerald-900">{action}</button>}
    </div>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[132px] items-center justify-center px-5 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function formatDashboardBytes(bytes: number | null | undefined) {
  if (!bytes) {
    return "Unknown size";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CourseCover({ accent, title }: { accent: string; title: string }) {
  const styles: Record<string, string> = {
    emerald: "from-emerald-950 to-emerald-700",
    amber: "from-stone-700 to-amber-700",
    sky: "from-slate-900 to-sky-900",
  };

  return (
    <div className={cn("flex h-[50px] w-[46px] shrink-0 flex-col justify-between rounded-[5px] bg-gradient-to-br p-1.5 text-white shadow-sm", styles[accent] ?? styles.emerald)}>
      <div className="h-1.5 w-5 rounded-full bg-amber-300/80" />
      <p className="text-[7px] font-bold leading-tight">{title}</p>
      <div className="h-px w-full bg-white/35" />
    </div>
  );
}

function CourseRows({ rows, onOpenCourse, onViewAll }: { rows: DashboardCourse[]; onOpenCourse: (courseId: string) => void; onViewAll: () => void }) {
  return (
    <Panel>
      <PanelHeader icon={BookOpen} title="Recent Courses" action="View all" onAction={onViewAll} />
      <div className="px-5">
        {rows.length === 0 ? <PanelEmpty>No courses yet</PanelEmpty> : null}
        {rows.map((course) => (
          <button key={course.id} type="button" data-testid={`dashboard-course-${course.id}`} onClick={() => onOpenCourse(course.id)} className="flex w-full items-center gap-3 border-b border-slate-100 py-2.5 text-left last:border-b-0">
            <CourseCover accent={course.accent} title={course.title} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{course.title}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {course.description}  •  {course.updatedLabel}
              </p>
            </div>
            <div className="hidden items-center gap-2 text-xs font-bold text-emerald-800 sm:flex">
              Continue
              <ChevronRight className="h-4 w-4" />
            </div>
          </button>
        ))}
      </div>
      <PanelFooter label="Browse all courses" onClick={onViewAll} />
    </Panel>
  );
}

function DocumentIcon({ type }: { type: "pdf" | "docx" }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-black text-white",
        type === "pdf" ? "bg-red-500" : "bg-blue-600",
      )}
    >
      {type === "pdf" ? "PDF" : "W"}
    </div>
  );
}

function LibraryRows({ rows, onOpenDocument, onViewAll }: { rows: DashboardDocument[]; onOpenDocument: (documentId: string) => void; onViewAll: () => void }) {
  return (
    <Panel>
      <PanelHeader icon={Folder} title="Recent Library Documents" action="View all" onAction={onViewAll} />
      <div className="px-5">
        {rows.length === 0 ? <PanelEmpty>No library documents yet</PanelEmpty> : null}
        {rows.map((document, index) => (
          <div key={document.id} className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-b-0">
            <button type="button" data-testid={`dashboard-document-${document.id}`} onClick={() => onOpenDocument(document.id)} className="flex min-w-0 flex-1 items-center gap-4 py-2 text-left">
              <DocumentIcon type={index === 1 ? "docx" : "pdf"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900">{document.title}</span>
                <span className="mt-1 block text-xs font-medium text-slate-500">{document.detail}</span>
              </span>
            </button>
            <button className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <PanelFooter label="Browse library" onClick={onViewAll} />
    </Panel>
  );
}

function StudyRows({ rows, onOpenNote, onViewAll }: { rows: DashboardNote[]; onOpenNote: (noteId: string) => void; onViewAll: () => void }) {
  return (
    <Panel>
      <PanelHeader icon={SquarePen} title="Recent Study Notes" action="View all" onAction={onViewAll} />
      <div className="px-5">
        {rows.length === 0 ? <PanelEmpty>No study notes yet</PanelEmpty> : null}
        {rows.map((note) => (
          <div key={note.id} className="flex items-center gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
            <button type="button" data-testid={`dashboard-note-${note.id}`} className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => onOpenNote(note.id)}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900">{note.title}</span>
                <span className="mt-1 block truncate text-xs font-medium text-slate-500">{note.preview}</span>
              </span>
            </button>
            <button className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <PanelFooter label="Open study" onClick={onViewAll} />
    </Panel>
  );
}

function QuranPanel({ position, onOpen }: { position: QuranReadingPosition | null; onOpen: () => void }) {
  return (
    <Panel>
      <PanelHeader icon={Library} title="Quran" action="" />
      <div className="p-5 pt-4">
        <div className="flex min-h-[170px] flex-col items-center gap-5 rounded-md bg-slate-50/60 p-5 text-center sm:flex-row sm:text-left">
          <img src={quranMedallion} alt="" className="h-[116px] w-[116px] shrink-0 rounded-full object-cover" />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-950">Quran Reader</h3>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {position ? `Last read at ${position.surahNumber}:${position.ayahNumber}` : "All 114 Surahs are ready to read."}
            </p>
            <p className="mt-1 max-w-[280px] text-sm leading-5 text-slate-600">Read the complete Uthmani Hafs text and return to your exact ayah.</p>
            <button type="button" onClick={onOpen} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90">
              <BookOpen className="h-4 w-4" />
              {position ? "Continue reading" : "Open Quran"}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function PanelFooter({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex h-10 w-full items-center justify-between bg-transparent px-5 text-xs font-bold text-primary transition-colors hover:bg-transparent hover:text-primary/75">
      {label}
      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const { position: quranPosition } = useQuranReadingPosition();
  const { workspace } = useWorkspace();
  const { corpus } = useRestoredCorpus();
  const { changes: localCourseChanges } = useLocalCourseChanges();
  const { data: allNotes = [] } = useListNotes({ workspace });
  const { data: studyFolders = [] } = useListFolders({ workspace, mode: "study" });
  const { data: attachments = [] } = useListAttachments();
  const studyFolderIds = new Set(studyFolders.map((folder) => folder.id));
  const studyFolderNames = new Map(studyFolders.map((folder) => [folder.id, folder.title]));

  const combinedCourses = new Map((corpus?.courses ?? []).map((course) => [course.id, course]));
  localCourseChanges.courses.forEach((course) => combinedCourses.set(course.id, course));
  const courseSource: DashboardCourse[] = [...combinedCourses.values()].map((course, index) => {
    const localFolderIds = new Set(localCourseChanges.folders.filter((folder) => folder.courseId === course.id).map((folder) => folder.id));
    const localNoteCount = localCourseChanges.notes.filter((note) => note.folderId && localFolderIds.has(note.folderId)).length;
    const localConceptCount = localCourseChanges.concepts.filter((concept) => concept.courseId === course.id).length;
    const noteCount = course.noteCount + localNoteCount;
    const conceptCount = course.conceptCount + localConceptCount;
    return {
        id: course.id,
        title: course.title,
        description: `${noteCount} note${noteCount === 1 ? "" : "s"}`,
        noteCount,
        conceptCount,
        updatedLabel: `${conceptCount} concept${conceptCount === 1 ? "" : "s"}`,
        accent: ["emerald", "amber", "sky"][index % 3],
      };
  });
  const dashboardCourses = orderByRecentActivity(courseSource, "course").slice(0, 3);

  const documentSource: DashboardDocument[] = (attachments.length > 0 ? attachments : corpus?.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        title: attachment.name,
        detail: `${attachment.mimeType.includes("pdf") ? "PDF" : "FILE"}  •  ${formatDashboardBytes(attachment.sizeBytes)}  •  metadata restored`,
        folder: attachment.libraryFolderId ?? "Library",
      }));
  const dashboardDocuments = orderByRecentActivity(documentSource, "document").slice(0, 3);

  const noteSource: DashboardNote[] = allNotes
    .filter((note) => note.folderId && studyFolderIds.has(note.folderId))
    .map((note) => ({
        id: note.id,
        title: note.title,
        preview: note.bodyPreview ?? "Saved locally",
        folder: note.folderId ? studyFolderNames.get(note.folderId) ?? "Study" : "Study",
      }));
  const dashboardNotes = orderByRecentActivity(noteSource, "note").slice(0, 3);

  return (
    <PageContainer>
      <PageHeader title="Dashboard" description="Your recent work across the Islamic Corpus" />
      <section className="grid gap-5 lg:grid-cols-2">
        <CourseRows
          rows={dashboardCourses}
          onOpenCourse={(courseId) => {
            recordRecentActivity("course", courseId);
            navigate("/courses");
          }}
          onViewAll={() => navigate("/courses")}
        />
        <LibraryRows rows={dashboardDocuments} onOpenDocument={(documentId) => navigate(`/library/document/${documentId}`)} onViewAll={() => navigate("/library")} />
        <StudyRows rows={dashboardNotes} onOpenNote={(noteId) => navigate(`/notes/${noteId}`)} onViewAll={() => navigate("/study")} />
        <QuranPanel
          position={quranPosition}
          onOpen={() => navigate(quranPosition ? `/quran/${quranPosition.surahNumber}/${quranPosition.ayahNumber}` : "/quran")}
        />
      </section>
    </PageContainer>
  );
}
