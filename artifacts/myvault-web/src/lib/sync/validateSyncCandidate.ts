import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { metadataFiles } from "@/lib/restore/driveRestoreMap";

type JsonRow = Record<string, unknown>;
type FieldKind = "string" | "nullable-string" | "number" | "nullable-number" | "boolean";

const ANDROID_ROW_FIELDS: Record<string, Record<string, FieldKind>> = {
  "courses.json": { id: "string", title: "string", rootFolderId: "nullable-string", lastOpenedNoteId: "nullable-string", createdAt: "number", updatedAt: "number" },
  "course_concept_cards.json": { id: "string", courseId: "string", term: "string", arabicTerm: "nullable-string", definition: "string", details: "nullable-string", sortOrder: "number", createdAt: "number", updatedAt: "number" },
  "course_folders.json": { id: "string", courseId: "string", title: "string", sortOrder: "number", createdAt: "number", updatedAt: "number" },
  "course_notes.json": { id: "string", courseId: "string", folderId: "nullable-string", title: "string", body: "string", sortOrder: "number", createdAt: "number", updatedAt: "number", lastOpenedAt: "nullable-number" },
  "course_sticky_notes.json": { id: "string", courseId: "string", text: "string", sortOrder: "number", createdAt: "number", updatedAt: "number" },
  "folders.json": { id: "string", parentId: "nullable-string", name: "string", description: "nullable-string", orderIndex: "number", isFavourite: "boolean", mode: "string", createdAt: "number", updatedAt: "number", deletedAt: "nullable-number" },
  "folder_sticky_notes.json": { id: "string", folderId: "string", text: "string", createdAt: "number", updatedAt: "number" },
  "notes.json": { id: "string", folderId: "nullable-string", parentNoteId: "nullable-string", title: "string", bodyPlainText: "string", isPinned: "boolean", isFolderPinned: "boolean", isFavourite: "boolean", orderIndex: "number", createdAt: "number", updatedAt: "number", deletedAt: "nullable-number" },
  "blocks.json": { id: "string", noteId: "string", type: "string", content: "string", orderIndex: "number" },
  "tags.json": { name: "string" },
  "note_tags.json": { noteId: "string", tagName: "string" },
  "note_tables.json": { id: "string", noteId: "string", rowCount: "number", columnCount: "number", cellsJson: "string", orderIndex: "number", createdAt: "number", updatedAt: "number" },
  "note_versions.json": { id: "string", noteId: "string", title: "string", bodyPlainText: "string", richTextJson: "nullable-string", richHtml: "nullable-string", wordCount: "number", characterCount: "number", createdAt: "number" },
  "attachments.json": { id: "string", noteId: "nullable-string", libraryFolderId: "nullable-string", fileName: "string", mimeType: "string", sizeBytes: "number", localPath: "nullable-string", remoteUrl: "nullable-string", isPinned: "boolean", createdAt: "number", deletedAt: "nullable-number", fileEntry: "string" },
  "pdf_reading_progress.json": { attachmentId: "string", pageIndex: "number", pageCount: "number", progressPercent: "number", lastOpenedAt: "number", updatedAt: "number" },
  "pdf_annotations.json": { id: "string", attachmentId: "string", libraryFolderId: "nullable-string", pageIndex: "number", left: "number", top: "number", right: "number", bottom: "number", color: "string", noteText: "string", annotationType: "string", textSize: "number", backgroundColor: "string", displayTitle: "nullable-string", displayFolderId: "nullable-string", createdAt: "number", updatedAt: "number" },
  "source_backlinks.json": { id: "string", noteId: "string", attachmentId: "string", annotationId: "nullable-string", pageIndex: "number", left: "number", top: "number", right: "number", bottom: "number", createdAt: "number" },
  "knowledge_tags.json": { id: "string", name: "string", createdAt: "number" },
  "knowledge_tag_links.json": { tagId: "string", targetType: "string", targetId: "string", createdAt: "number" },
};

function isRow(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFor(bundle: MetadataRestoreBundle, fileName: string) {
  const json = bundle.files.find((file) => file.fileName === fileName)?.json;
  return Array.isArray(json) ? json.filter(isRow) : [];
}

function stringValue(row: JsonRow, key: string) {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function matchesKind(value: unknown, kind: FieldKind) {
  if (kind === "string") return typeof value === "string";
  if (kind === "nullable-string") return value === null || typeof value === "string";
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (kind === "nullable-number") return value === null || (typeof value === "number" && Number.isFinite(value));
  return typeof value === "boolean";
}

function validateAndroidRowShapes(bundle: MetadataRestoreBundle, issues: string[]) {
  for (const [fileName, fields] of Object.entries(ANDROID_ROW_FIELDS)) {
    const file = bundle.files.find((candidate) => candidate.fileName === fileName);
    if (!file) continue;
    if (!Array.isArray(file.json)) {
      issues.push(`${fileName} must contain an array.`);
      continue;
    }
    file.json.forEach((value, index) => {
      if (!isRow(value)) {
        issues.push(`${fileName} row ${index + 1} is not an object.`);
        return;
      }
      for (const [field, kind] of Object.entries(fields)) {
        if (!Object.prototype.hasOwnProperty.call(value, field) || !matchesKind(value[field], kind)) {
          issues.push(`${fileName} row ${index + 1} has an invalid or missing ${field}.`);
        }
      }
    });
  }
}

function activeRows(bundle: MetadataRestoreBundle, fileName: string) {
  return rowsFor(bundle, fileName).filter((row) => typeof row.deletedAt !== "number");
}

function stableIds(rows: JsonRow[], label: string, issues: string[]) {
  const ids = new Set<string>();
  rows.forEach((row) => {
    const id = stringValue(row, "id");
    if (!id) issues.push(`${label} contains a row without a stable id.`);
    else if (ids.has(id)) issues.push(`${label} contains duplicate id ${id}.`);
    else ids.add(id);
  });
  return ids;
}

export function validateSyncCandidate(bundle: MetadataRestoreBundle) {
  const issues: string[] = [];
  const fileNames = new Set(bundle.files.map((file) => file.fileName));
  metadataFiles
    .filter((file) => file.required && !fileNames.has(file.fileName))
    .forEach((file) => issues.push(`Required metadata is missing: ${file.fileName}.`));

  const internalManifest = bundle.files.find((file) => file.fileName === "manifest.json")?.json;
  if (!isRow(internalManifest) || internalManifest.format !== "myvault-backup" || internalManifest.version !== 1) {
    issues.push("manifest.json is not a MyVault backup version 1 envelope.");
  }
  validateAndroidRowShapes(bundle, issues);

  const folders = activeRows(bundle, "folders.json");
  const notes = activeRows(bundle, "notes.json");
  const blocks = activeRows(bundle, "blocks.json");
  const attachments = activeRows(bundle, "attachments.json");
  const annotations = activeRows(bundle, "pdf_annotations.json");
  const courses = activeRows(bundle, "courses.json");
  stableIds(rowsFor(bundle, "folders.json"), "folders.json", issues);
  stableIds(rowsFor(bundle, "notes.json"), "notes.json", issues);
  stableIds(rowsFor(bundle, "attachments.json"), "attachments.json", issues);
  stableIds(rowsFor(bundle, "blocks.json"), "blocks.json", issues);
  stableIds(rowsFor(bundle, "pdf_annotations.json"), "pdf_annotations.json", issues);
  stableIds(rowsFor(bundle, "courses.json"), "courses.json", issues);
  const folderIds = new Set(folders.map((row) => stringValue(row, "id")));
  const noteIds = new Set(notes.map((row) => stringValue(row, "id")));
  const attachmentIds = new Set(attachments.map((row) => stringValue(row, "id")));
  const annotationIds = new Set(annotations.map((row) => stringValue(row, "id")));
  const courseIds = new Set(courses.map((row) => stringValue(row, "id")));

  folders.forEach((row) => {
    const parentId = stringValue(row, "parentId");
    if (parentId && !folderIds.has(parentId)) issues.push(`Folder ${stringValue(row, "id")} refers to missing parent ${parentId}.`);
  });
  notes.forEach((row) => {
    const folderId = stringValue(row, "folderId");
    const parentNoteId = stringValue(row, "parentNoteId");
    if (folderId && !folderIds.has(folderId)) issues.push(`Note ${stringValue(row, "id")} refers to missing folder ${folderId}.`);
    if (parentNoteId && !noteIds.has(parentNoteId)) issues.push(`Note ${stringValue(row, "id")} refers to missing parent note ${parentNoteId}.`);
  });
  blocks.forEach((row) => {
    const noteId = stringValue(row, "noteId");
    if (!noteId || !noteIds.has(noteId)) issues.push(`Block ${stringValue(row, "id")} refers to a missing note.`);
  });
  attachments.forEach((row) => {
    const noteId = stringValue(row, "noteId");
    const folderId = stringValue(row, "libraryFolderId");
    if (noteId && !noteIds.has(noteId)) issues.push(`Attachment ${stringValue(row, "id")} refers to missing note ${noteId}.`);
    if (folderId && !folderIds.has(folderId)) issues.push(`Attachment ${stringValue(row, "id")} refers to missing folder ${folderId}.`);
  });
  annotations.forEach((row) => {
    const attachmentId = stringValue(row, "attachmentId");
    if (!attachmentId || !attachmentIds.has(attachmentId)) issues.push(`PDF annotation ${stringValue(row, "id")} refers to a missing attachment.`);
  });
  activeRows(bundle, "pdf_reading_progress.json").forEach((row) => {
    const attachmentId = stringValue(row, "attachmentId");
    if (!attachmentId || !attachmentIds.has(attachmentId)) issues.push("PDF reading progress refers to a missing attachment.");
  });
  activeRows(bundle, "folder_sticky_notes.json").forEach((row) => {
    if (!folderIds.has(stringValue(row, "folderId"))) issues.push(`Folder sticky note ${stringValue(row, "id")} refers to a missing folder.`);
  });
  activeRows(bundle, "course_concept_cards.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Course concept ${stringValue(row, "id")} refers to a missing course.`);
  });
  const legacyCourseFolderIds = new Set(activeRows(bundle, "course_folders.json").map((row) => stringValue(row, "id")));
  activeRows(bundle, "course_folders.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Legacy course folder ${stringValue(row, "id")} refers to a missing course.`);
  });
  activeRows(bundle, "course_notes.json").forEach((row) => {
    const courseId = stringValue(row, "courseId");
    const folderId = stringValue(row, "folderId");
    if (!courseIds.has(courseId)) issues.push(`Legacy course note ${stringValue(row, "id")} refers to a missing course.`);
    if (folderId && !legacyCourseFolderIds.has(folderId)) issues.push(`Legacy course note ${stringValue(row, "id")} refers to a missing course folder.`);
  });
  activeRows(bundle, "course_sticky_notes.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Legacy course sticky note ${stringValue(row, "id")} refers to a missing course.`);
  });
  activeRows(bundle, "note_tables.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Note table ${stringValue(row, "id")} refers to a missing note.`);
  });
  activeRows(bundle, "note_versions.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Note version ${stringValue(row, "id")} refers to a missing note.`);
  });
  const tagNames = new Set(activeRows(bundle, "tags.json").map((row) => stringValue(row, "name")));
  activeRows(bundle, "note_tags.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push("A note tag refers to a missing note.");
    if (!tagNames.has(stringValue(row, "tagName"))) issues.push("A note tag refers to a missing tag.");
  });
  activeRows(bundle, "source_backlinks.json").forEach((row) => {
    const annotationId = stringValue(row, "annotationId");
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing note.`);
    if (!attachmentIds.has(stringValue(row, "attachmentId"))) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing attachment.`);
    if (annotationId && !annotationIds.has(annotationId)) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing annotation.`);
  });
  const knowledgeTagIds = new Set(activeRows(bundle, "knowledge_tags.json").map((row) => stringValue(row, "id")));
  activeRows(bundle, "knowledge_tag_links.json").forEach((row) => {
    const targetType = stringValue(row, "targetType");
    const targetId = stringValue(row, "targetId");
    if (!knowledgeTagIds.has(stringValue(row, "tagId"))) issues.push("A knowledge-tag link refers to a missing knowledge tag.");
    if (targetType === "note" && !noteIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing note.");
    if (targetType === "attachment" && !attachmentIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing attachment.");
    if (targetType === "annotation" && !annotationIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing annotation.");
  });

  return { valid: issues.length === 0, issues };
}
