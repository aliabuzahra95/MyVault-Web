import type { Attachment, Folder, Note } from "@workspace/api-client-react";
import type { RestoredCourse } from "@/lib/restore/restoredCorpus";
import { isLocallyDeleted, type LocalCourseFolder } from "@/lib/restore/localRestoreStore";

export type KnowledgeNodeKind = "section" | "course" | "folder" | "note" | "document" | "group";

export type KnowledgeNode = {
  key: string;
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  href: string;
  parentKey: string | null;
  childKeys: string[];
  pinned?: boolean;
};

export type KnowledgeTreeModel = {
  nodes: Map<string, KnowledgeNode>;
  sectionKeys: string[];
  studyFolderKeys: Map<string, string>;
  libraryFolderKeys: Map<string, string>;
  courseFolderKeys: Map<string, string>;
  noteKeys: Map<string, string[]>;
  documentKeys: Map<string, string>;
  courseKeys: Map<string, string>;
};

type BuildKnowledgeTreeOptions = {
  folders: Folder[];
  notes: Note[];
  attachments: Attachment[];
  courses: Array<Pick<RestoredCourse, "id" | "title" | "rootFolderId">>;
  courseFolderIds: string[];
  localCourseFolders: LocalCourseFolder[];
};

const STUDY_SECTION_KEY = "section:study";
const LIBRARY_SECTION_KEY = "section:library";
const COURSES_SECTION_KEY = "section:courses";
const QURAN_SECTION_KEY = "section:quran";

function byPositionThenTitle<T extends { orderIndex?: number; title: string }>(first: T, second: T) {
  return (first.orderIndex ?? 0) - (second.orderIndex ?? 0) || first.title.localeCompare(second.title);
}

function byPinnedThenPosition(first: Note, second: Note) {
  if (Boolean(first.isPinned) !== Boolean(second.isPinned)) return first.isPinned ? -1 : 1;
  return byPositionThenTitle(first, second);
}

function mergeById<T extends { id: string }>(...groups: T[][]) {
  const merged = new Map<string, T>();
  groups.flat().forEach((item) => merged.set(item.id, item));
  return [...merged.values()].filter((item) => !isLocallyDeleted(item));
}

function rootFolders(folders: Folder[]) {
  const ids = new Set(folders.map((folder) => folder.id));
  return folders.filter((folder) => !folder.parentId || !ids.has(folder.parentId)).sort(byPositionThenTitle);
}

function childFolders(folders: Folder[]) {
  const children = new Map<string, Folder[]>();
  folders.forEach((folder) => {
    if (!folder.parentId) return;
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  });
  children.forEach((items) => items.sort(byPositionThenTitle));
  return children;
}

function itemsByFolder<T extends { id: string }>(items: T[], folderId: (item: T) => string | null | undefined) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    const id = folderId(item);
    if (!id) return;
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  });
  return grouped;
}

function descendantIds(folders: Folder[], rootId: string | null) {
  if (!rootId) return new Set<string>();
  const children = childFolders(folders);
  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    (children.get(current) ?? []).forEach((folder) => {
      if (ids.has(folder.id)) return;
      ids.add(folder.id);
      queue.push(folder.id);
    });
  }
  return ids;
}

export function buildKnowledgeTree({
  folders,
  notes,
  attachments,
  courses,
  courseFolderIds,
  localCourseFolders,
}: BuildKnowledgeTreeOptions): KnowledgeTreeModel {
  const nodes = new Map<string, KnowledgeNode>();
  const studyFolderKeys = new Map<string, string>();
  const libraryFolderKeys = new Map<string, string>();
  const courseFolderKeys = new Map<string, string>();
  const noteKeys = new Map<string, string[]>();
  const documentKeys = new Map<string, string>();
  const courseKeys = new Map<string, string>();

  function addNode(node: KnowledgeNode) {
    nodes.set(node.key, node);
    if (node.parentKey) {
      const parent = nodes.get(node.parentKey);
      if (parent && !parent.childKeys.includes(node.key)) parent.childKeys.push(node.key);
    }
  }

  function addNote(note: Note, parentKey: string, href: string, keyPrefix: string) {
    const key = `${keyPrefix}:note:${note.id}`;
    addNode({
      key,
      id: note.id,
      kind: "note",
      label: note.title,
      href,
      parentKey,
      childKeys: [],
      pinned: note.isPinned,
    });
    noteKeys.set(note.id, [...(noteKeys.get(note.id) ?? []), key]);
    return key;
  }

  function addDocument(attachment: Attachment, parentKey: string) {
    const key = `library:document:${attachment.id}`;
    addNode({
      key,
      id: attachment.id,
      kind: "document",
      label: attachment.name,
      href: `/library/document/${attachment.id}`,
      parentKey,
      childKeys: [],
      pinned: attachment.isPinned,
    });
    documentKeys.set(attachment.id, key);
    return key;
  }

  addNode({ key: STUDY_SECTION_KEY, id: "study", kind: "section", label: "Study", href: "/study", parentKey: null, childKeys: [] });
  addNode({ key: LIBRARY_SECTION_KEY, id: "library", kind: "section", label: "Library", href: "/library", parentKey: null, childKeys: [] });
  addNode({ key: COURSES_SECTION_KEY, id: "courses", kind: "section", label: "Courses", href: "/courses", parentKey: null, childKeys: [] });
  addNode({ key: QURAN_SECTION_KEY, id: "quran", kind: "section", label: "Quran", href: "/quran", parentKey: null, childKeys: [] });

  const restoredCourseIds = new Set(courseFolderIds);
  const studyFolders = folders.filter((folder) => folder.mode === "study" && !restoredCourseIds.has(folder.id));
  const studyIds = new Set(studyFolders.map((folder) => folder.id));
  const studyChildren = childFolders(studyFolders);
  const studyNotes = notes.filter((note) => note.folderId && studyIds.has(note.folderId));
  const studyNotesByFolder = itemsByFolder(studyNotes, (note) => note.folderId);

  function addStudyFolder(folder: Folder, parentKey: string, visited: Set<string>) {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const key = `study:folder:${folder.id}`;
    addNode({ key, id: folder.id, kind: "folder", label: folder.title, href: `/study/${folder.id}`, parentKey, childKeys: [] });
    studyFolderKeys.set(folder.id, key);
    (studyChildren.get(folder.id) ?? []).forEach((child) => addStudyFolder(child, key, visited));
    [...(studyNotesByFolder.get(folder.id) ?? [])].sort(byPinnedThenPosition).forEach((note) => addNote(note, key, `/notes/${note.id}`, "study"));
  }

  const visitedStudyFolders = new Set<string>();
  rootFolders(studyFolders).forEach((folder) => addStudyFolder(folder, STUDY_SECTION_KEY, visitedStudyFolders));
  studyFolders.filter((folder) => !visitedStudyFolders.has(folder.id)).sort(byPositionThenTitle).forEach((folder) => addStudyFolder(folder, STUDY_SECTION_KEY, visitedStudyFolders));

  const unfiledStudyNotes = notes.filter((note) => !note.folderId);
  if (unfiledStudyNotes.length > 0) {
    const key = "study:group:unfiled";
    addNode({ key, id: "unfiled-study", kind: "group", label: "Unfiled notes", href: "/study", parentKey: STUDY_SECTION_KEY, childKeys: [] });
    [...unfiledStudyNotes].sort(byPinnedThenPosition).forEach((note) => addNote(note, key, `/notes/${note.id}`, "study"));
  }

  const libraryFolders = folders.filter((folder) => folder.mode === "library");
  const libraryIds = new Set(libraryFolders.map((folder) => folder.id));
  const libraryChildren = childFolders(libraryFolders);
  const documentsByFolder = itemsByFolder(attachments, (attachment) => attachment.libraryFolderId);

  function addLibraryFolder(folder: Folder, parentKey: string, visited: Set<string>) {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const key = `library:folder:${folder.id}`;
    addNode({ key, id: folder.id, kind: "folder", label: folder.title, href: `/library?folder=${encodeURIComponent(folder.id)}`, parentKey, childKeys: [] });
    libraryFolderKeys.set(folder.id, key);
    (libraryChildren.get(folder.id) ?? []).forEach((child) => addLibraryFolder(child, key, visited));
    [...(documentsByFolder.get(folder.id) ?? [])].sort((first, second) => first.name.localeCompare(second.name)).forEach((attachment) => addDocument(attachment, key));
  }

  const visitedLibraryFolders = new Set<string>();
  rootFolders(libraryFolders).forEach((folder) => addLibraryFolder(folder, LIBRARY_SECTION_KEY, visitedLibraryFolders));
  libraryFolders.filter((folder) => !visitedLibraryFolders.has(folder.id)).sort(byPositionThenTitle).forEach((folder) => addLibraryFolder(folder, LIBRARY_SECTION_KEY, visitedLibraryFolders));

  const unfiledDocuments = attachments.filter((attachment) => !attachment.libraryFolderId || !libraryIds.has(attachment.libraryFolderId));
  if (unfiledDocuments.length > 0) {
    const key = "library:group:unfiled";
    addNode({ key, id: "unfiled-library", kind: "group", label: "Unfiled documents", href: "/library", parentKey: LIBRARY_SECTION_KEY, childKeys: [] });
    [...unfiledDocuments].sort((first, second) => first.name.localeCompare(second.name)).forEach((attachment) => addDocument(attachment, key));
  }

  const allLocalCourseFolders: Folder[] = localCourseFolders.map((folder) => ({
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
  const allFolders = mergeById(folders, allLocalCourseFolders);

  courses.forEach((course) => {
    const courseKey = `course:${course.id}`;
    addNode({ key: courseKey, id: course.id, kind: "course", label: course.title, href: `/courses/${course.id}`, parentKey: COURSES_SECTION_KEY, childKeys: [] });
    courseKeys.set(course.id, courseKey);

    const restoredIds = descendantIds(allFolders, course.rootFolderId);
    const localIds = new Set(localCourseFolders.filter((folder) => folder.courseId === course.id).map((folder) => folder.id));
    const ids = new Set([...restoredIds, ...localIds]);
    const courseFolders = allFolders.filter((folder) => ids.has(folder.id));
    const courseFolderIdsSet = new Set(courseFolders.map((folder) => folder.id));
    const courseChildren = childFolders(courseFolders);
    const rootFolder = course.rootFolderId ? courseFolders.find((folder) => folder.id === course.rootFolderId) ?? null : null;
    const materialRoots = courseFolders.filter((folder) => rootFolder
      ? folder.parentId === rootFolder.id || (!folder.parentId && folder.id !== rootFolder.id)
      : !folder.parentId || !courseFolderIdsSet.has(folder.parentId)).sort(byPositionThenTitle);
    const courseNotes = notes.filter((note) => note.folderId && (
      courseFolderIdsSet.has(note.folderId) || note.folderId === course.rootFolderId
    ));
    const courseNotesByFolder = itemsByFolder(courseNotes, (note) => note.folderId);

    function addCourseFolder(folder: Folder, parentKey: string, visited: Set<string>) {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      const key = `course:${course.id}:folder:${folder.id}`;
      addNode({
        key,
        id: folder.id,
        kind: "folder",
        label: folder.title,
        href: `/courses/${course.id}?folder=${encodeURIComponent(folder.id)}`,
        parentKey,
        childKeys: [],
      });
      courseFolderKeys.set(`${course.id}:${folder.id}`, key);
      (courseChildren.get(folder.id) ?? []).forEach((child) => addCourseFolder(child, key, visited));
      [...(courseNotesByFolder.get(folder.id) ?? [])].sort(byPinnedThenPosition).forEach((note) => addNote(note, key, `/courses/${course.id}/notes/${note.id}`, `course:${course.id}`));
    }

    const visitedCourseFolders = new Set<string>(rootFolder ? [rootFolder.id] : []);
    materialRoots.forEach((folder) => addCourseFolder(folder, courseKey, visitedCourseFolders));
    courseFolders.filter((folder) => !visitedCourseFolders.has(folder.id)).sort(byPositionThenTitle).forEach((folder) => addCourseFolder(folder, courseKey, visitedCourseFolders));
    const rootNoteFolderId = rootFolder?.id ?? course.rootFolderId;
    if (rootNoteFolderId) {
      [...(courseNotesByFolder.get(rootNoteFolderId) ?? [])].sort(byPinnedThenPosition).forEach((note) => addNote(note, courseKey, `/courses/${course.id}/notes/${note.id}`, `course:${course.id}`));
    }
  });

  return {
    nodes,
    sectionKeys: [STUDY_SECTION_KEY, LIBRARY_SECTION_KEY, COURSES_SECTION_KEY, QURAN_SECTION_KEY],
    studyFolderKeys,
    libraryFolderKeys,
    courseFolderKeys,
    noteKeys,
    documentKeys,
    courseKeys,
  };
}

export function resolveActiveNodeKey(model: KnowledgeTreeModel, location: string) {
  const [path, query = ""] = location.split("?");
  const search = new URLSearchParams(query);
  const folderId = search.get("folder");

  const courseNoteMatch = path.match(/^\/courses\/([^/]+)\/notes\/([^/]+)$/);
  if (courseNoteMatch) {
    const [, courseId, noteId] = courseNoteMatch;
    return model.noteKeys.get(noteId)?.find((key) => key.startsWith(`course:${courseId}:`)) ?? model.courseKeys.get(courseId) ?? null;
  }

  const noteMatch = path.match(/^\/notes\/([^/]+)$/);
  if (noteMatch) return model.noteKeys.get(noteMatch[1])?.[0] ?? null;

  const documentMatch = path.match(/^\/library\/document\/([^/]+)$/);
  if (documentMatch) return model.documentKeys.get(documentMatch[1]) ?? LIBRARY_SECTION_KEY;

  const studyFolderMatch = path.match(/^\/(?:study|folders)\/([^/]+)$/);
  if (studyFolderMatch) return model.studyFolderKeys.get(studyFolderMatch[1]) ?? STUDY_SECTION_KEY;

  const courseMatch = path.match(/^\/courses\/([^/]+)$/);
  if (courseMatch) {
    if (folderId) return model.courseFolderKeys.get(`${courseMatch[1]}:${folderId}`) ?? model.courseKeys.get(courseMatch[1]) ?? COURSES_SECTION_KEY;
    return model.courseKeys.get(courseMatch[1]) ?? COURSES_SECTION_KEY;
  }

  if (path === "/study" || path === "/folders") {
    return folderId ? model.studyFolderKeys.get(folderId) ?? STUDY_SECTION_KEY : STUDY_SECTION_KEY;
  }
  if (path === "/library") {
    return folderId ? model.libraryFolderKeys.get(folderId) ?? LIBRARY_SECTION_KEY : LIBRARY_SECTION_KEY;
  }
  if (path === "/courses") return COURSES_SECTION_KEY;
  if (path === "/quran") return QURAN_SECTION_KEY;
  return null;
}

export function ancestorKeys(model: KnowledgeTreeModel, key: string | null) {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = key ? model.nodes.get(key) : undefined;
  while (current?.parentKey && !visited.has(current.parentKey)) {
    visited.add(current.parentKey);
    ancestors.unshift(current.parentKey);
    current = model.nodes.get(current.parentKey);
  }
  return ancestors;
}
