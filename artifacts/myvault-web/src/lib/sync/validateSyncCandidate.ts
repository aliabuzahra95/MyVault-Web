import type { MetadataRestoreBundle } from "@/lib/restore/metadataRestore";
import { metadataFiles } from "@/lib/restore/driveRestoreMap";

type JsonRow = Record<string, unknown>;
type FieldKind = "string" | "nullable-string" | "number" | "nullable-number" | "boolean";
type FieldRule = { kind: FieldKind; required: boolean };

const required = (kind: FieldKind): FieldRule => ({ kind, required: true });
const optional = (kind: FieldKind): FieldRule => ({ kind, required: false });

// Required fields mirror Android's get* restore calls. Fields restored through
// opt* are optional because JSONObject.put(key, null) omits the key entirely.
const ANDROID_ROW_FIELDS: Record<string, Record<string, FieldRule>> = {
  "courses.json": { id: required("string"), title: required("string"), rootFolderId: optional("nullable-string"), lastOpenedNoteId: optional("nullable-string"), createdAt: required("number"), updatedAt: required("number") },
  "course_concept_cards.json": { id: required("string"), courseId: required("string"), term: required("string"), arabicTerm: optional("nullable-string"), definition: optional("string"), details: optional("nullable-string"), sortOrder: optional("number"), createdAt: required("number"), updatedAt: required("number") },
  "course_folders.json": { id: required("string"), courseId: required("string"), title: required("string"), sortOrder: optional("number"), createdAt: required("number"), updatedAt: required("number") },
  "course_notes.json": { id: required("string"), courseId: required("string"), folderId: required("string"), title: required("string"), body: optional("string"), sortOrder: optional("number"), createdAt: required("number"), updatedAt: required("number"), lastOpenedAt: optional("nullable-number") },
  "course_sticky_notes.json": { id: required("string"), courseId: required("string"), text: required("string"), sortOrder: optional("number"), createdAt: required("number"), updatedAt: required("number") },
  "folders.json": { id: required("string"), parentId: optional("nullable-string"), name: required("string"), description: optional("nullable-string"), orderIndex: required("number"), isFavourite: required("boolean"), mode: optional("string"), createdAt: required("number"), updatedAt: required("number"), deletedAt: optional("nullable-number"), colorKey: optional("nullable-string") },
  "folder_sticky_notes.json": { id: required("string"), folderId: required("string"), text: required("string"), createdAt: required("number"), updatedAt: required("number") },
  "notes.json": { id: required("string"), folderId: optional("nullable-string"), parentNoteId: optional("nullable-string"), title: required("string"), bodyPlainText: required("string"), isPinned: required("boolean"), isFolderPinned: optional("boolean"), isFavourite: required("boolean"), orderIndex: optional("number"), createdAt: required("number"), updatedAt: required("number"), deletedAt: optional("nullable-number") },
  "blocks.json": { id: required("string"), noteId: required("string"), type: required("string"), content: required("string"), orderIndex: required("number") },
  "tags.json": { name: required("string") },
  "note_tags.json": { noteId: required("string"), tagName: required("string") },
  "note_tables.json": { id: required("string"), noteId: required("string"), rowCount: required("number"), columnCount: required("number"), cellsJson: required("string"), orderIndex: required("number"), createdAt: required("number"), updatedAt: required("number") },
  "note_versions.json": { id: required("string"), noteId: required("string"), title: optional("string"), bodyPlainText: optional("string"), richTextJson: optional("nullable-string"), richHtml: optional("nullable-string"), wordCount: optional("number"), characterCount: optional("number"), createdAt: optional("number") },
  "attachments.json": { id: required("string"), noteId: optional("nullable-string"), libraryFolderId: optional("nullable-string"), fileName: required("string"), mimeType: required("string"), sizeBytes: required("number"), localPath: optional("nullable-string"), remoteUrl: optional("nullable-string"), isPinned: optional("boolean"), createdAt: required("number"), deletedAt: optional("nullable-number"), fileEntry: optional("string") },
  "pdf_reading_progress.json": { attachmentId: required("string"), pageIndex: required("number"), pageCount: required("number"), progressPercent: optional("number"), lastOpenedAt: required("number"), updatedAt: required("number") },
  "pdf_annotations.json": { id: required("string"), attachmentId: required("string"), libraryFolderId: optional("nullable-string"), pageIndex: required("number"), left: required("number"), top: required("number"), right: required("number"), bottom: required("number"), color: required("string"), noteText: optional("nullable-string"), selectedText: optional("nullable-string"), annotationType: optional("string"), textSize: optional("number"), backgroundColor: optional("string"), displayTitle: optional("nullable-string"), displayFolderId: optional("nullable-string"), createdAt: required("number"), updatedAt: required("number") },
  "pdf_annotation_geometry.json": { annotationId: required("string"), orderIndex: required("number"), pageIndex: required("number"), left: required("number"), top: required("number"), right: required("number"), bottom: required("number") },
  "source_backlinks.json": { id: required("string"), noteId: required("string"), attachmentId: required("string"), annotationId: optional("nullable-string"), pageIndex: required("number"), left: optional("nullable-number"), top: optional("nullable-number"), right: optional("nullable-number"), bottom: optional("nullable-number"), createdAt: required("number") },
  "knowledge_tags.json": { id: required("string"), name: required("string"), createdAt: required("number") },
  "knowledge_tag_links.json": { tagId: required("string"), targetType: required("string"), targetId: required("string"), createdAt: required("number") },
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
      for (const [field, rule] of Object.entries(fields)) {
        const present = Object.prototype.hasOwnProperty.call(value, field);
        if ((!present && rule.required) || (present && !matchesKind(value[field], rule.kind))) {
          issues.push(`${fileName} row ${index + 1} has an invalid${rule.required ? " or missing" : ""} ${field}.`);
        }
      }
    });
  }
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

  // Android validates references against the complete backup, including
  // deleted/tombstoned entities needed by Recently Deleted and history.
  const folders = rowsFor(bundle, "folders.json");
  const notes = rowsFor(bundle, "notes.json");
  const blocks = rowsFor(bundle, "blocks.json");
  const attachments = rowsFor(bundle, "attachments.json");
  const annotations = rowsFor(bundle, "pdf_annotations.json");
  const courses = rowsFor(bundle, "courses.json");
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
  const geometryKeys = new Set<string>();
  rowsFor(bundle, "pdf_annotation_geometry.json").forEach((row) => {
    const annotationId = stringValue(row, "annotationId");
    const orderIndex = row.orderIndex;
    if (!annotationIds.has(annotationId)) issues.push(`PDF annotation geometry refers to missing annotation ${annotationId}.`);
    const key = `${annotationId}:${String(orderIndex)}`;
    if (geometryKeys.has(key)) issues.push(`PDF annotation geometry contains duplicate segment ${key}.`);
    geometryKeys.add(key);
  });
  rowsFor(bundle, "pdf_reading_progress.json").forEach((row) => {
    const attachmentId = stringValue(row, "attachmentId");
    if (!attachmentId || !attachmentIds.has(attachmentId)) issues.push("PDF reading progress refers to a missing attachment.");
  });
  rowsFor(bundle, "folder_sticky_notes.json").forEach((row) => {
    if (!folderIds.has(stringValue(row, "folderId"))) issues.push(`Folder sticky note ${stringValue(row, "id")} refers to a missing folder.`);
  });
  rowsFor(bundle, "course_concept_cards.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Course concept ${stringValue(row, "id")} refers to a missing course.`);
  });
  const legacyCourseFolderIds = new Set(rowsFor(bundle, "course_folders.json").map((row) => stringValue(row, "id")));
  rowsFor(bundle, "course_folders.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Legacy course folder ${stringValue(row, "id")} refers to a missing course.`);
  });
  rowsFor(bundle, "course_notes.json").forEach((row) => {
    const courseId = stringValue(row, "courseId");
    const folderId = stringValue(row, "folderId");
    if (!courseIds.has(courseId)) issues.push(`Legacy course note ${stringValue(row, "id")} refers to a missing course.`);
    if (folderId && !legacyCourseFolderIds.has(folderId)) issues.push(`Legacy course note ${stringValue(row, "id")} refers to a missing course folder.`);
  });
  rowsFor(bundle, "course_sticky_notes.json").forEach((row) => {
    if (!courseIds.has(stringValue(row, "courseId"))) issues.push(`Legacy course sticky note ${stringValue(row, "id")} refers to a missing course.`);
  });
  rowsFor(bundle, "note_tables.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Note table ${stringValue(row, "id")} refers to a missing note.`);
  });
  rowsFor(bundle, "note_versions.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Note version ${stringValue(row, "id")} refers to a missing note.`);
  });
  const tagNames = new Set(rowsFor(bundle, "tags.json").map((row) => stringValue(row, "name")));
  rowsFor(bundle, "note_tags.json").forEach((row) => {
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push("A note tag refers to a missing note.");
    if (!tagNames.has(stringValue(row, "tagName"))) issues.push("A note tag refers to a missing tag.");
  });
  rowsFor(bundle, "source_backlinks.json").forEach((row) => {
    const annotationId = stringValue(row, "annotationId");
    if (!noteIds.has(stringValue(row, "noteId"))) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing note.`);
    if (!attachmentIds.has(stringValue(row, "attachmentId"))) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing attachment.`);
    if (annotationId && !annotationIds.has(annotationId)) issues.push(`Source backlink ${stringValue(row, "id")} refers to a missing annotation.`);
  });
  const knowledgeTagIds = new Set(rowsFor(bundle, "knowledge_tags.json").map((row) => stringValue(row, "id")));
  rowsFor(bundle, "knowledge_tag_links.json").forEach((row) => {
    const targetType = stringValue(row, "targetType");
    const targetId = stringValue(row, "targetId");
    if (!knowledgeTagIds.has(stringValue(row, "tagId"))) issues.push("A knowledge-tag link refers to a missing knowledge tag.");
    if (targetType === "note" && !noteIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing note.");
    if (targetType === "attachment" && !attachmentIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing attachment.");
    if (targetType === "annotation" && !annotationIds.has(targetId)) issues.push("A knowledge-tag link refers to a missing annotation.");
  });

  return { valid: issues.length === 0, issues };
}
