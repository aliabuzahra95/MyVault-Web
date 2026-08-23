import type {
  Attachment,
  Block,
  Folder,
  HomeSnapshot,
  KnowledgeTag,
  KnowledgeTagLink,
  Note,
  NoteDetail,
  NoteVersion,
  SearchResults,
  Tag,
} from "@workspace/api-client-react";
import { loadMetadataRestoreBundle } from "@/lib/restore/localRestoreStore";
import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { extractVaultPlainText } from "@/lib/restore/vaultRichText";

export type RestoredCourse = {
  id: string;
  title: string;
  rootFolderId: string | null;
  lastOpenedNoteId: string | null;
  noteCount: number;
  conceptCount: number;
  stickyNoteCount: number;
  createdAt: number;
  updatedAt: number;
};

export type RestoredCourseConceptCard = {
  id: string;
  courseId: string;
  term: string;
  arabicTerm: string | null;
  definition: string;
  details: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type RestoredFolderStickyNote = {
  id: string;
  folderId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type RestoredPdfReadingProgress = {
  attachmentId: string;
  pageIndex: number;
  pageCount: number;
  progressPercent: number;
  lastOpenedAt: number;
  updatedAt: number;
};

export type RestoredPdfAnnotation = {
  id: string;
  attachmentId: string;
  libraryFolderId: string | null;
  pageIndex: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  color: string;
  noteText: string | null;
  annotationType: "highlight" | "text_box" | "page_note";
  textSize: number;
  backgroundColor: string;
  displayTitle: string | null;
  displayFolderId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type RestoredCorpus = {
  restoredAt: string;
  cloudVersion: number;
  courses: RestoredCourse[];
  courseConceptCards: RestoredCourseConceptCard[];
  courseFolderIds: string[];
  folderStickyNotes: RestoredFolderStickyNote[];
  folders: Folder[];
  notes: Note[];
  noteDetails: Record<string, NoteDetail>;
  noteVersions: Record<string, NoteVersion[]>;
  attachments: Attachment[];
  pdfReadingProgress: Record<string, RestoredPdfReadingProgress>;
  pdfAnnotations: RestoredPdfAnnotation[];
  tags: Tag[];
  knowledgeTags: KnowledgeTag[];
  knowledgeTagLinks: Record<string, KnowledgeTagLink[]>;
  homeSnapshot: HomeSnapshot;
  searchResults: SearchResults;
};

type JsonRecord = Record<string, unknown>;

const WORKSPACE = "islamic_corpus";
const ISLAMIC_STUDY_MODE = "study";
const ISLAMIC_LIBRARY_MODE = "library";
const BLOCK_TYPES = new Set(["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered", "quote", "divider", "code"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonArray(bundle: MetadataRestoreBundle, fileName: string): JsonRecord[] {
  const file = bundle.files.find((candidate) => candidate.fileName === fileName);
  return Array.isArray(file?.json) ? file.json.filter(isRecord) : [];
}

function stringValue(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function nullableString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(record: JsonRecord, key: string, fallback = 0) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function valueForKeys(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function stringValueForKeys(record: JsonRecord, keys: string[], fallback = "") {
  const value = valueForKeys(record, keys);
  return typeof value === "string" ? value : fallback;
}

function nullableStringForKeys(record: JsonRecord, keys: string[]) {
  const value = valueForKeys(record, keys);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValueForKeys(record: JsonRecord, keys: string[], fallback = 0) {
  const value = valueForKeys(record, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(record: JsonRecord, key: string, fallback = false) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function isDeleted(record: JsonRecord) {
  return record.deletedAt !== null && record.deletedAt !== undefined;
}

function filterBundleRows(
  bundle: MetadataRestoreBundle,
  visibleRowsByFile: Map<string, JsonRecord[]>,
): MetadataRestoreBundle {
  return {
    ...bundle,
    files: bundle.files.map((file) => {
      const visibleRows = visibleRowsByFile.get(file.fileName);
      return visibleRows
        ? { ...file, json: visibleRows, itemCount: visibleRows.length }
        : file;
    }),
  };
}

/**
 * Builds a display-only Islamic Corpus view of a complete Android backup.
 * The original restore bundle remains untouched and is still used for Drive write-back.
 */
export function projectIslamicCorpusBundle(bundle: MetadataRestoreBundle): MetadataRestoreBundle {
  const activeFolderRows = jsonArray(bundle, "folders.json").filter((row) => !isDeleted(row));
  const visibleFolderRows = activeFolderRows.filter((row) => {
    const mode = stringValue(row, "mode", ISLAMIC_STUDY_MODE).toLowerCase();
    return mode === ISLAMIC_STUDY_MODE || mode === ISLAMIC_LIBRARY_MODE;
  });
  const studyFolderIds = new Set(
    visibleFolderRows
      .filter((row) => stringValue(row, "mode", ISLAMIC_STUDY_MODE).toLowerCase() === ISLAMIC_STUDY_MODE)
      .map((row) => stringValue(row, "id"))
      .filter(Boolean),
  );
  const libraryFolderIds = new Set(
    visibleFolderRows
      .filter((row) => stringValue(row, "mode").toLowerCase() === ISLAMIC_LIBRARY_MODE)
      .map((row) => stringValue(row, "id"))
      .filter(Boolean),
  );

  const visibleNoteRows = jsonArray(bundle, "notes.json").filter((row) => {
    if (isDeleted(row)) return false;
    const folderId = nullableString(row, "folderId");
    // Android keeps Personal root notes inside a Personal Inbox. A null folder is the Islamic Study root.
    return folderId === null || studyFolderIds.has(folderId);
  });
  const noteIds = new Set(visibleNoteRows.map((row) => stringValue(row, "id")).filter(Boolean));

  const visibleAttachmentRows = jsonArray(bundle, "attachments.json").filter((row) => {
    if (isDeleted(row)) return false;
    const libraryFolderId = nullableString(row, "libraryFolderId");
    if (libraryFolderId) return libraryFolderIds.has(libraryFolderId);
    const noteId = nullableString(row, "noteId");
    // Standalone files with no folder belong to the Islamic Library root.
    return noteId === null || noteIds.has(noteId);
  });
  const attachmentIds = new Set(visibleAttachmentRows.map((row) => stringValue(row, "id")).filter(Boolean));

  const visibleAnnotationRows = jsonArray(bundle, "pdf_annotations.json")
    .filter((row) => attachmentIds.has(stringValueForKeys(row, ["attachmentId", "attachment_id"])));
  const annotationIds = new Set(visibleAnnotationRows.map((row) => stringValue(row, "id")).filter(Boolean));

  const visibleCourseRows = jsonArray(bundle, "courses.json").filter((row) => {
    if (isDeleted(row)) return false;
    const rootFolderId = nullableString(row, "rootFolderId");
    return rootFolderId === null || studyFolderIds.has(rootFolderId);
  });
  const courseIds = new Set(visibleCourseRows.map((row) => stringValue(row, "id")).filter(Boolean));
  const legacyCourseFolderRows = jsonArray(bundle, "course_folders.json")
    .filter((row) => courseIds.has(stringValue(row, "courseId")));
  const legacyCourseFolderIds = new Set(legacyCourseFolderRows.map((row) => stringValue(row, "id")).filter(Boolean));

  const visibleNoteTagRows = jsonArray(bundle, "note_tags.json")
    .filter((row) => noteIds.has(stringValue(row, "noteId")));
  const visibleTagNames = new Set(visibleNoteTagRows.map((row) => stringValue(row, "tagName")).filter(Boolean));

  const visibleKnowledgeLinkRows = jsonArray(bundle, "knowledge_tag_links.json").filter((row) => {
    const targetId = stringValue(row, "targetId");
    switch (stringValue(row, "targetType")) {
      case "note": return noteIds.has(targetId);
      case "attachment": return attachmentIds.has(targetId);
      case "annotation": return annotationIds.has(targetId);
      default: return false;
    }
  });
  const visibleKnowledgeTagIds = new Set(visibleKnowledgeLinkRows.map((row) => stringValue(row, "tagId")).filter(Boolean));

  const rows = new Map<string, JsonRecord[]>([
    ["folders.json", visibleFolderRows],
    ["folder_sticky_notes.json", jsonArray(bundle, "folder_sticky_notes.json").filter((row) => studyFolderIds.has(stringValue(row, "folderId")))],
    ["notes.json", visibleNoteRows],
    ["blocks.json", jsonArray(bundle, "blocks.json").filter((row) => noteIds.has(stringValue(row, "noteId")))],
    ["note_tables.json", jsonArray(bundle, "note_tables.json").filter((row) => noteIds.has(stringValue(row, "noteId")))],
    ["note_versions.json", jsonArray(bundle, "note_versions.json").filter((row) => noteIds.has(stringValue(row, "noteId")))],
    ["note_tags.json", visibleNoteTagRows],
    ["tags.json", jsonArray(bundle, "tags.json").filter((row) => visibleTagNames.has(stringValue(row, "name")))],
    ["attachments.json", visibleAttachmentRows],
    ["pdf_reading_progress.json", jsonArray(bundle, "pdf_reading_progress.json").filter((row) => attachmentIds.has(stringValueForKeys(row, ["attachmentId", "attachment_id"])))],
    ["pdf_annotations.json", visibleAnnotationRows],
    ["source_backlinks.json", jsonArray(bundle, "source_backlinks.json").filter((row) => {
      const annotationId = nullableString(row, "annotationId");
      return noteIds.has(stringValue(row, "noteId"))
        && attachmentIds.has(stringValue(row, "attachmentId"))
        && (annotationId === null || annotationIds.has(annotationId));
    })],
    ["knowledge_tag_links.json", visibleKnowledgeLinkRows],
    ["knowledge_tags.json", jsonArray(bundle, "knowledge_tags.json").filter((row) => visibleKnowledgeTagIds.has(stringValue(row, "id")))],
    ["courses.json", visibleCourseRows],
    ["course_concept_cards.json", jsonArray(bundle, "course_concept_cards.json").filter((row) => courseIds.has(stringValue(row, "courseId")))],
    ["course_folders.json", legacyCourseFolderRows],
    ["course_notes.json", jsonArray(bundle, "course_notes.json").filter((row) => courseIds.has(stringValue(row, "courseId")) && legacyCourseFolderIds.has(stringValue(row, "folderId")))],
    ["course_sticky_notes.json", jsonArray(bundle, "course_sticky_notes.json").filter((row) => courseIds.has(stringValue(row, "courseId")))],
  ]);

  return filterBundleRows(bundle, rows);
}

function textPreview(value: string, limit = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}...` : normalized;
}

function wordCount(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function descendantFolderIds(folders: Folder[], rootFolderId: string | null) {
  if (!rootFolderId) {
    return new Set<string>();
  }

  const childrenByParent = new Map<string, string[]>();
  folders.forEach((folder) => {
    if (folder.parentId) {
      childrenByParent.set(folder.parentId, [...(childrenByParent.get(folder.parentId) ?? []), folder.id]);
    }
  });

  const ids = new Set<string>([rootFolderId]);
  const queue = [rootFolderId];
  while (queue.length) {
    const current = queue.shift()!;
    (childrenByParent.get(current) ?? []).forEach((childId) => {
      if (!ids.has(childId)) {
        ids.add(childId);
        queue.push(childId);
      }
    });
  }

  return ids;
}

function buildTagNamesByNote(noteTagRows: JsonRecord[]) {
  const tagsByNote = new Map<string, string[]>();
  noteTagRows.forEach((row) => {
    const noteId = stringValue(row, "noteId");
    const tagName = stringValue(row, "tagName");
    if (!noteId || !tagName) {
      return;
    }

    tagsByNote.set(noteId, [...(tagsByNote.get(noteId) ?? []), tagName]);
  });
  return tagsByNote;
}

function buildPdfReadingProgress(progressRows: JsonRecord[]) {
  return Object.fromEntries(
    progressRows.flatMap((row) => {
      const attachmentId = stringValueForKeys(row, ["attachmentId", "attachment_id"]);
      if (!attachmentId) return [];
      const storedProgress = numberValueForKeys(row, ["progressPercent", "progress_percent"]);
      const progress: RestoredPdfReadingProgress = {
        attachmentId,
        pageIndex: Math.max(0, Math.trunc(numberValueForKeys(row, ["pageIndex", "page_index"]))),
        pageCount: Math.max(0, Math.trunc(numberValueForKeys(row, ["pageCount", "page_count"]))),
        progressPercent: Math.max(0, Math.min(100, storedProgress <= 1 ? storedProgress * 100 : storedProgress)),
        lastOpenedAt: numberValueForKeys(row, ["lastOpenedAt", "last_opened_at"]),
        updatedAt: numberValueForKeys(row, ["updatedAt", "updated_at"]),
      };
      return [[attachmentId, progress] as const];
    }),
  ) as Record<string, RestoredPdfReadingProgress>;
}

function buildPdfAnnotations(rows: JsonRecord[]) {
  const allowedTypes = new Set<RestoredPdfAnnotation["annotationType"]>(["highlight", "text_box", "page_note"]);
  return rows.flatMap((row) => {
    const id = stringValue(row, "id");
    const attachmentId = stringValueForKeys(row, ["attachmentId", "attachment_id"]);
    const rawType = stringValueForKeys(row, ["annotationType", "annotation_type"], "highlight");
    if (!id || !attachmentId || !allowedTypes.has(rawType as RestoredPdfAnnotation["annotationType"])) return [];

    const annotationType = rawType as RestoredPdfAnnotation["annotationType"];
    const annotation: RestoredPdfAnnotation = {
      id,
      attachmentId,
      libraryFolderId: nullableStringForKeys(row, ["libraryFolderId", "library_folder_id"]),
      pageIndex: Math.max(0, Math.trunc(numberValueForKeys(row, ["pageIndex", "page_index"]))),
      left: numberValue(row, "left"),
      top: numberValue(row, "top"),
      right: numberValue(row, "right"),
      bottom: numberValue(row, "bottom"),
      color: stringValue(row, "color", "yellow").toLowerCase(),
      noteText: nullableStringForKeys(row, ["noteText", "note_text"]),
      annotationType,
      textSize: numberValueForKeys(row, ["textSize", "text_size"], 16),
      backgroundColor: stringValueForKeys(row, ["backgroundColor", "background_color"], "none").toLowerCase(),
      displayTitle: nullableStringForKeys(row, ["displayTitle", "display_title"]),
      displayFolderId: nullableStringForKeys(row, ["displayFolderId", "display_folder_id"]),
      createdAt: numberValueForKeys(row, ["createdAt", "created_at"]),
      updatedAt: numberValueForKeys(row, ["updatedAt", "updated_at"]),
    };

    if (annotationType === "page_note") return annotation.noteText ? [annotation] : [];
    const hasValidBounds = annotation.right > annotation.left && annotation.bottom > annotation.top;
    return hasValidBounds ? [annotation] : [];
  });
}

function buildFolders(bundle: MetadataRestoreBundle, notesByFolderCount: Map<string, number>): Folder[] {
  return jsonArray(bundle, "folders.json")
    .filter((row) => !isDeleted(row))
    .map((row) => {
      const id = stringValue(row, "id");
      return {
        id,
        parentId: nullableString(row, "parentId"),
        title: stringValue(row, "name", "Untitled folder"),
        description: nullableString(row, "description"),
        mode: stringValue(row, "mode", "study").toLowerCase() === "library" ? "library" : "study",
        workspace: WORKSPACE,
        orderIndex: numberValue(row, "orderIndex"),
        noteCount: notesByFolderCount.get(id) ?? 0,
        createdAt: numberValue(row, "createdAt", Date.now()),
        updatedAt: numberValue(row, "updatedAt", numberValue(row, "createdAt", Date.now())),
      };
    });
}

function buildNotes(bundle: MetadataRestoreBundle, tagNamesByNote: Map<string, string[]>): Note[] {
  return jsonArray(bundle, "notes.json")
    .filter((row) => !isDeleted(row))
    .map((row) => {
      const storedBody = stringValue(row, "bodyPlainText");
      const bodyPlainText = extractVaultPlainText(storedBody);
      return {
        id: stringValue(row, "id"),
        folderId: nullableString(row, "folderId"),
        parentNoteId: nullableString(row, "parentNoteId"),
        title: stringValue(row, "title", "Untitled note"),
        bodyPreview: textPreview(bodyPlainText),
        wordCount: wordCount(bodyPlainText),
        characterCount: bodyPlainText.length,
        isPinned: booleanValue(row, "isPinned"),
        isFolderPinned: booleanValue(row, "isFolderPinned"),
        orderIndex: numberValue(row, "orderIndex"),
        tagNames: tagNamesByNote.get(stringValue(row, "id")) ?? [],
        createdAt: numberValue(row, "createdAt", Date.now()),
        updatedAt: numberValue(row, "updatedAt", numberValue(row, "createdAt", Date.now())),
      };
    });
}

function buildBlocks(bundle: MetadataRestoreBundle) {
  const blocksByNote = new Map<string, Block[]>();
  jsonArray(bundle, "blocks.json").forEach((row) => {
    const type = stringValue(row, "type", "paragraph");
    const noteId = stringValue(row, "noteId");
    if (!noteId) {
      return;
    }

    const block: Block = {
      id: stringValue(row, "id"),
      noteId,
      type: BLOCK_TYPES.has(type) ? (type as Block["type"]) : "paragraph",
      content: extractVaultPlainText(stringValue(row, "content")),
      orderIndex: numberValue(row, "orderIndex"),
    };
    blocksByNote.set(noteId, [...(blocksByNote.get(noteId) ?? []), block]);
  });

  blocksByNote.forEach((blocks, noteId) => {
    blocksByNote.set(noteId, blocks.toSorted((first, second) => first.orderIndex - second.orderIndex));
  });

  return blocksByNote;
}

function buildAttachments(bundle: MetadataRestoreBundle, progressByAttachment: Map<string, number>): Attachment[] {
  return jsonArray(bundle, "attachments.json")
    .filter((row) => !isDeleted(row))
    .map((row) => {
      const createdAt = numberValue(row, "createdAt", Date.now());
      return {
        id: stringValue(row, "id"),
        noteId: nullableString(row, "noteId"),
        libraryFolderId: nullableString(row, "libraryFolderId"),
        name: stringValue(row, "fileName", "Untitled file"),
        mimeType: stringValue(row, "mimeType", "application/octet-stream"),
        sizeBytes: numberValue(row, "sizeBytes", 0),
        isPinned: booleanValue(row, "isPinned"),
        readingProgressPercent: progressByAttachment.get(stringValue(row, "id")) ?? null,
        createdAt,
        updatedAt: createdAt,
      };
    });
}

function buildFolderStickyNotes(bundle: MetadataRestoreBundle): RestoredFolderStickyNote[] {
  return jsonArray(bundle, "folder_sticky_notes.json")
    .filter((row) => !isDeleted(row))
    .map((row) => ({
      id: stringValue(row, "id"),
      folderId: stringValue(row, "folderId"),
      text: stringValue(row, "text"),
      createdAt: numberValue(row, "createdAt", Date.now()),
      updatedAt: numberValue(row, "updatedAt", numberValue(row, "createdAt", Date.now())),
    }))
    .filter((stickyNote) => stickyNote.id && stickyNote.folderId && stickyNote.text);
}

function buildCourseConceptCards(bundle: MetadataRestoreBundle): RestoredCourseConceptCard[] {
  return jsonArray(bundle, "course_concept_cards.json")
    .filter((row) => !isDeleted(row) && stringValue(row, "id") && stringValue(row, "courseId"))
    .map((row) => ({
      id: stringValue(row, "id"),
      courseId: stringValue(row, "courseId"),
      term: stringValue(row, "term", "Untitled concept"),
      arabicTerm: nullableString(row, "arabicTerm"),
      definition: stringValue(row, "definition"),
      details: nullableString(row, "details"),
      sortOrder: numberValue(row, "sortOrder"),
      createdAt: numberValue(row, "createdAt", Date.now()),
      updatedAt: numberValue(row, "updatedAt", numberValue(row, "createdAt", Date.now())),
    }));
}

function buildCourses(
  bundle: MetadataRestoreBundle,
  folders: Folder[],
  notes: Note[],
  folderStickyNotes: RestoredFolderStickyNote[],
  concepts: RestoredCourseConceptCard[],
): RestoredCourse[] {
  const stickyNotes = jsonArray(bundle, "course_sticky_notes.json");

  return jsonArray(bundle, "courses.json").filter((row) => !isDeleted(row)).map((row) => {
    const id = stringValue(row, "id");
    const rootFolderId = nullableString(row, "rootFolderId");
    const courseFolderIds = descendantFolderIds(folders, rootFolderId);
    return {
      id,
      title: stringValue(row, "title", "Untitled course"),
      rootFolderId,
      lastOpenedNoteId: nullableString(row, "lastOpenedNoteId"),
      noteCount: notes.filter((note) => note.folderId && courseFolderIds.has(note.folderId)).length,
      conceptCount: concepts.filter((concept) => concept.courseId === id).length,
      stickyNoteCount: folderStickyNotes.filter((sticky) => courseFolderIds.has(sticky.folderId)).length
        + stickyNotes.filter((sticky) => stringValue(sticky, "courseId") === id).length,
      createdAt: numberValue(row, "createdAt", Date.now()),
      updatedAt: numberValue(row, "updatedAt", numberValue(row, "createdAt", Date.now())),
    };
  });
}

function buildTags(tagRows: JsonRecord[], noteTagRows: JsonRecord[]): Tag[] {
  return tagRows.map((row) => {
    const name = stringValue(row, "name");
    return {
      name,
      noteCount: noteTagRows.filter((noteTag) => stringValue(noteTag, "tagName") === name).length,
    };
  });
}

function buildKnowledgeTags(bundle: MetadataRestoreBundle): { tags: KnowledgeTag[]; links: Record<string, KnowledgeTagLink[]> } {
  const links: Record<string, KnowledgeTagLink[]> = {};
  jsonArray(bundle, "knowledge_tag_links.json").forEach((row) => {
    const tagId = stringValue(row, "tagId");
    const link: KnowledgeTagLink = {
      tagId,
      targetType: stringValue(row, "targetType") as KnowledgeTagLink["targetType"],
      targetId: stringValue(row, "targetId"),
      createdAt: numberValue(row, "createdAt", Date.now()),
    };
    links[tagId] = [...(links[tagId] ?? []), link];
  });

  const tags = jsonArray(bundle, "knowledge_tags.json").map((row) => {
    const id = stringValue(row, "id");
    return {
      id,
      name: stringValue(row, "name", "Untitled tag"),
      linkCount: links[id]?.length ?? 0,
      createdAt: numberValue(row, "createdAt", Date.now()),
    };
  });

  return { tags, links };
}

export function buildRestoredCorpus(bundle: MetadataRestoreBundle): RestoredCorpus {
  const corpusBundle = projectIslamicCorpusBundle(bundle);
  const noteRows = jsonArray(corpusBundle, "notes.json");
  const storedBodyByNote = new Map(
    noteRows.flatMap((row) => {
      const id = stringValue(row, "id");
      const storedBody = stringValue(row, "bodyPlainText");
      return id && storedBody ? [[id, storedBody] as const] : [];
    }),
  );
  const noteTagRows = jsonArray(corpusBundle, "note_tags.json");
  const storedRichTextByNote = new Map(
    jsonArray(corpusBundle, "blocks.json").flatMap((row) => {
      const noteId = stringValue(row, "noteId");
      const content = stringValue(row, "content");
      return noteId && stringValue(row, "type") === "rich_text" && content
        ? [[noteId, content] as const]
        : [];
    }),
  );
  const tagNamesByNote = buildTagNamesByNote(noteTagRows);
  const notes = buildNotes(corpusBundle, tagNamesByNote);
  const notesByFolderCount = notes.reduce((counts, note) => {
    if (note.folderId) {
      counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());
  const folders = buildFolders(corpusBundle, notesByFolderCount);
  const blocksByNote = buildBlocks(corpusBundle);
  const pdfReadingProgress = buildPdfReadingProgress(jsonArray(corpusBundle, "pdf_reading_progress.json"));
  const progressByAttachment = new Map(Object.values(pdfReadingProgress).map((progress) => [progress.attachmentId, progress.progressPercent]));
  const pdfAnnotations = buildPdfAnnotations(jsonArray(corpusBundle, "pdf_annotations.json"));
  const attachments = buildAttachments(corpusBundle, progressByAttachment);
  const folderStickyNotes = buildFolderStickyNotes(corpusBundle);
  const courseConceptCards = buildCourseConceptCards(corpusBundle);
  const courses = buildCourses(corpusBundle, folders, notes, folderStickyNotes, courseConceptCards);
  const courseFolderIds = [...new Set(courses.flatMap((course) => [...descendantFolderIds(folders, course.rootFolderId)]))];
  const tags = buildTags(jsonArray(corpusBundle, "tags.json"), noteTagRows);
  const knowledge = buildKnowledgeTags(corpusBundle);
  const noteDetails = Object.fromEntries(
    notes.map((note) => [
      note.id,
      {
        ...note,
        richTextJson: storedRichTextByNote.get(note.id) ?? storedBodyByNote.get(note.id) ?? null,
        blocks: blocksByNote.get(note.id) ?? [],
      },
    ]),
  );
  const noteVersions = jsonArray(corpusBundle, "note_versions.json").reduce<Record<string, NoteVersion[]>>((versionsByNote, row) => {
    const version = {
      id: stringValue(row, "id"),
      noteId: stringValue(row, "noteId"),
      title: stringValue(row, "title", "Untitled note"),
      bodyPlainText: stringValue(row, "bodyPlainText"),
      wordCount: numberValue(row, "wordCount", wordCount(stringValue(row, "bodyPlainText"))),
      characterCount: numberValue(row, "characterCount", stringValue(row, "bodyPlainText").length),
      createdAt: numberValue(row, "createdAt", Date.now()),
    };
    versionsByNote[version.noteId] = [...(versionsByNote[version.noteId] ?? []), version];
    return versionsByNote;
  }, {});
  const sortedNotes = notes.toSorted((first, second) => second.updatedAt - first.updatedAt);
  const recentFolders = folders.toSorted((first, second) => second.updatedAt - first.updatedAt).slice(0, 4);
  const allSearchItems: SearchResults["items"] = [
    ...notes.map((note) => ({
      type: "note" as const,
      id: note.id,
      title: note.title,
      snippet: note.bodyPreview ?? null,
      folderId: note.folderId ?? null,
      folderTitle: folders.find((folder) => folder.id === note.folderId)?.title ?? null,
      updatedAt: note.updatedAt,
    })),
    ...attachments.map((attachment) => ({
      type: "attachment" as const,
      id: attachment.id,
      title: attachment.name,
      snippet: null,
      folderId: attachment.libraryFolderId ?? null,
      folderTitle: folders.find((folder) => folder.id === attachment.libraryFolderId)?.title ?? null,
      updatedAt: attachment.updatedAt,
    })),
  ];

  return {
    restoredAt: bundle.restoredAt,
    cloudVersion: bundle.cloudVersion,
    courses,
    courseConceptCards,
    courseFolderIds,
    folderStickyNotes,
    folders,
    notes,
    noteDetails,
    noteVersions,
    attachments,
    pdfReadingProgress,
    pdfAnnotations,
    tags,
    knowledgeTags: knowledge.tags,
    knowledgeTagLinks: knowledge.links,
    homeSnapshot: {
      recentNotes: sortedNotes.slice(0, 5),
      pinnedNotes: notes.filter((note) => note.isPinned).slice(0, 5),
      recentFolders,
      stats: {
        totalNotes: notes.length,
        totalFolders: folders.length,
        totalAttachments: attachments.length,
        totalTags: tags.length + knowledge.tags.length,
        totalWordCount: notes.reduce((total, note) => total + (note.wordCount ?? 0), 0),
      },
    },
    searchResults: {
      query: "",
      items: allSearchItems,
    },
  };
}

export async function loadRestoredCorpus() {
  const bundle = await loadMetadataRestoreBundle();
  return bundle ? buildRestoredCorpus(bundle) : null;
}
