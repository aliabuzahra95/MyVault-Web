import { useCallback, useEffect, useState } from "react";
import type { Note } from "@workspace/api-client-react";
import {
  loadLocalCourseConcepts,
  loadLocalCourseFolders,
  loadLocalCourseStickyNotes,
  loadLocalCourses,
  loadLocalCreatedNotes,
  LOCAL_CONTENT_CHANGE_EVENT,
  LOCAL_COURSE_CHANGE_EVENT,
  type LocalCourse,
  type LocalCourseConcept,
  type LocalCourseFolder,
  type LocalCourseStickyNote,
} from "@/lib/restore/localRestoreStore";

export type LocalCourseChanges = {
  courses: LocalCourse[];
  folders: LocalCourseFolder[];
  notes: Note[];
  stickyNotes: LocalCourseStickyNote[];
  concepts: LocalCourseConcept[];
};

const EMPTY_CHANGES: LocalCourseChanges = {
  courses: [],
  folders: [],
  notes: [],
  stickyNotes: [],
  concepts: [],
};

export function useLocalCourseChanges(courseId?: string) {
  const [changes, setChanges] = useState<LocalCourseChanges>(EMPTY_CHANGES);
  const [isLoading, setIsLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    window.addEventListener(LOCAL_COURSE_CHANGE_EVENT, refresh);
    window.addEventListener(LOCAL_CONTENT_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener(LOCAL_COURSE_CHANGE_EVENT, refresh);
      window.removeEventListener(LOCAL_CONTENT_CHANGE_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void Promise.all([
      loadLocalCourses(),
      loadLocalCourseFolders(),
      loadLocalCreatedNotes(),
      loadLocalCourseStickyNotes(),
      loadLocalCourseConcepts(),
    ]).then(([courses, folders, notes, stickyNotes, concepts]) => {
      if (cancelled) return;
      setChanges({
        courses: courseId ? courses.filter((course) => course.id === courseId) : courses,
        folders: courseId ? folders.filter((folder) => folder.courseId === courseId) : folders,
        notes,
        stickyNotes: courseId ? stickyNotes.filter((stickyNote) => stickyNote.courseId === courseId) : stickyNotes,
        concepts: courseId ? concepts.filter((concept) => concept.courseId === courseId) : concepts,
      });
    }).catch(() => {
      if (!cancelled) setChanges(EMPTY_CHANGES);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [courseId, revision]);

  return { changes, isLoading, refresh };
}
