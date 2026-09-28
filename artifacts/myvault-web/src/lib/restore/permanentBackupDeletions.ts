import { createBackupDelta, type BackupRecordChange } from "./incrementalBackup";

const overlayTargets: Record<string, { entityType: string; stores: string[] }> = {
  "notes.json": { entityType: "note", stores: ["note-drafts", "created-notes"] },
  "folders.json": { entityType: "folder", stores: ["created-folders"] },
  "attachments.json": { entityType: "attachment", stores: ["created-attachments", "attachment-blobs"] },
  "pdf_annotations.json": { entityType: "pdf-annotation", stores: ["pdf-annotation-changes"] },
  "pdf_reading_progress.json": { entityType: "pdf-reading-progress", stores: ["pdf-reader-state"] },
  "courses.json": { entityType: "course", stores: ["created-courses"] },
  "course_folders.json": { entityType: "course-folder", stores: ["created-course-folders"] },
  "course_sticky_notes.json": { entityType: "course-sticky-note", stores: ["created-course-sticky-notes"] },
  "course_concept_cards.json": { entityType: "course-concept", stores: ["created-course-concepts"] },
};

export function permanentBackupOverlayDeletes(changes: BackupRecordChange[]) {
  if (!changes.length) return [];
  createBackupDelta("validation-checkpoint", "validation-checkpoint", "validation-delta", changes);
  if (changes.some((change) => change.operation !== "delete")) throw new Error("Permanent deletion list contains an upsert.");
  return changes.flatMap((change) => {
    const target = overlayTargets[change.file];
    return target ? [{ ...target, entityId: change.key[0] }] : [];
  });
}
