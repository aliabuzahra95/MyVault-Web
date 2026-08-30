import type { DriveSyncManifestEntry } from "../../src/lib/restore/driveManifestPreview";
import type { MetadataRestoreBundle, RestoredMetadataFile } from "../../src/lib/restore/metadataRestore";

function metadataFile(fileName: string, json: unknown): RestoredMetadataFile {
  const encoded = JSON.stringify(json);
  return {
    fileName,
    entryPath: `metadata/${fileName}`,
    backupEntry: fileName,
    cloudFileId: `drive-metadata-${fileName}`,
    size: new TextEncoder().encode(encoded).byteLength,
    updatedAt: 1_780_000_000_000,
    itemCount: Array.isArray(json) ? json.length : null,
    json,
  };
}

const richText = JSON.stringify({
  text: "التوكل على الله\nTrust Allah, then take the means.",
  styleMarks: [
    { start: 0, end: 15, style: "Heading2" },
    { start: 16, end: 27, style: "Bold" },
    { start: 29, end: 33, style: "ColorBlue" },
  ],
  noteLinks: [{ start: 34, end: 48, noteId: "note-hadith" }],
  androidDocumentVersion: 7,
  futureEnvelopeField: { preserve: true },
});

const jsonFiles: Record<string, unknown> = {
  "manifest.json": {
    format: "myvault-backup",
    version: 1,
    createdAt: 1_780_000_000_000,
    workspace: "all",
    androidOnlySection: { memorisationRevision: 4, preserve: true },
  },
  "settings.json": {
    theme: "system",
    workspace: "islamic_corpus",
    accentColor: "#5B8DEF",
    fontSize: "medium",
    dashboardFontSize: "medium",
    noteFontSize: "medium",
    notePreview: "off",
    defaultNoteView: "reading",
    autoTagSuggestions: true,
    securityLockEnabled: false,
    securityLockTimeoutMs: 30_000,
    quranLastReadSurah: 2,
    quranLastReadAyah: 286,
    quranBookmarkedVerses: ["2:286"],
    quranMemorizationRecords: [{ verseKey: "2:286", surahNumber: 2, ayahNumber: 286, reviewCount: 4 }],
    expandedFolderIds: ["folder-study"],
    libraryViewMode: "list",
    libraryViewModesByLocation: { root: "list" },
    futureAndroidSetting: { nested: [1, 2, 3] },
  },
  "courses.json": [
    { id: "course-fiqh", title: "فقه الصلاة", rootFolderId: "folder-course", lastOpenedNoteId: "note-tawakkul", createdAt: 50, updatedAt: 100, androidOnly: "keep" },
    { id: "course-personal", title: "Personal course", rootFolderId: "folder-personal", lastOpenedNoteId: "note-personal", createdAt: 50, updatedAt: 100, workspace: "personal" },
  ],
  "course_concept_cards.json": [
    { id: "concept-niyyah", courseId: "course-fiqh", term: "Niyyah", arabicTerm: "النية", definition: "Intention", sortOrder: 0, createdAt: 50, updatedAt: 100, futureField: 9 },
  ],
  "course_folders.json": [
    { id: "legacy-course-folder", courseId: "course-fiqh", title: "Legacy lessons", sortOrder: 0, createdAt: 50, updatedAt: 100 },
  ],
  "course_notes.json": [
    { id: "legacy-course-note", courseId: "course-fiqh", folderId: "legacy-course-folder", title: "Legacy note", body: "Preserve me", sortOrder: 0, createdAt: 50, updatedAt: 100, lastOpenedAt: 100 },
  ],
  "course_sticky_notes.json": [
    { id: "course-sticky", courseId: "course-fiqh", text: "Review باب الصلاة", sortOrder: 0, createdAt: 50, updatedAt: 100 },
  ],
  "folders.json": [
    { id: "folder-study", parentId: null, name: "Islamic Studies", description: null, orderIndex: 1, isFavourite: false, mode: "study", createdAt: 50, updatedAt: 100, deletedAt: null },
    { id: "folder-aqidah", parentId: "folder-study", name: "العقيدة", description: null, orderIndex: 0, isFavourite: true, mode: "study", createdAt: 50, updatedAt: 100, deletedAt: null, customColour: "blue" },
    { id: "folder-library", parentId: null, name: "Library", description: null, orderIndex: 2, isFavourite: false, mode: "library", createdAt: 50, updatedAt: 100, deletedAt: null },
    { id: "folder-course", parentId: null, name: "Course workspace", description: null, orderIndex: 3, isFavourite: false, mode: "course:course-fiqh", createdAt: 50, updatedAt: 100, deletedAt: null },
    { id: "folder-personal", parentId: null, name: "Private journal", description: null, orderIndex: 4, isFavourite: false, mode: "personal", createdAt: 50, updatedAt: 100, deletedAt: null, privateField: "must survive" },
    { id: "folder-deleted", parentId: null, name: "Old folder", description: null, orderIndex: 5, isFavourite: false, mode: "study", createdAt: 40, updatedAt: 90, deletedAt: 90 },
  ],
  "folder_sticky_notes.json": [
    { id: "folder-sticky", folderId: "folder-aqidah", text: "Pinned reminder", createdAt: 50, updatedAt: 100, futureColour: "violet" },
  ],
  "notes.json": [
    { id: "note-tawakkul", folderId: "folder-aqidah", parentNoteId: null, title: "التوكل - Tawakkul", bodyPlainText: "التوكل على الله", isPinned: true, isFolderPinned: false, isFavourite: true, orderIndex: 0, createdAt: 50, updatedAt: 100, deletedAt: null, unknownAndroidFlag: "keep" },
    { id: "note-hadith", folderId: "folder-study", parentNoteId: null, title: "Hadith on reliance", bodyPlainText: "Tie it and trust Allah", isPinned: false, isFolderPinned: false, isFavourite: false, orderIndex: 1, createdAt: 50, updatedAt: 100, deletedAt: null },
    { id: "note-personal", folderId: "folder-personal", parentNoteId: null, title: "Private health note", bodyPlainText: "Never expose this in Islamic Corpus", isPinned: false, isFolderPinned: false, isFavourite: false, orderIndex: 0, createdAt: 50, updatedAt: 100, deletedAt: null, personalOnlyPayload: { private: true } },
    { id: "note-deleted", folderId: "folder-study", parentNoteId: null, title: "Deleted note", bodyPlainText: "Tombstone", isPinned: false, isFolderPinned: false, isFavourite: false, orderIndex: 2, createdAt: 40, updatedAt: 90, deletedAt: 90 },
  ],
  "blocks.json": [
    { id: "block-rich", noteId: "note-tawakkul", type: "rich_text", content: richText, orderIndex: 0, androidBlockField: { preserve: true } },
    { id: "block-hadith", noteId: "note-hadith", type: "paragraph", content: "Tie it and trust Allah", orderIndex: 0 },
    { id: "block-personal", noteId: "note-personal", type: "paragraph", content: "Private", orderIndex: 0 },
  ],
  "tags.json": [
    { name: "aqidah", unknown: "preserve" },
    { name: "حديث" },
  ],
  "note_tags.json": [
    { noteId: "note-tawakkul", tagName: "aqidah" },
    { noteId: "note-hadith", tagName: "حديث" },
  ],
  "note_tables.json": [
    { id: "table-proof", noteId: "note-tawakkul", rowCount: 2, columnCount: 2, cellsJson: JSON.stringify([["دليل", "Evidence"], ["3:159", "Then rely upon Allah"]]), orderIndex: 0, createdAt: 50, updatedAt: 100, unknownTableField: true },
  ],
  "note_versions.json": [
    { id: "version-tawakkul-1", noteId: "note-tawakkul", title: "التوكل - Tawakkul", bodyPlainText: "التوكل على الله", richTextJson: richText, richHtml: null, wordCount: 7, characterCount: 48, createdAt: 90, deviceId: "android-device" },
  ],
  "attachments.json": [
    { id: "pdf-aqidah", noteId: "", libraryFolderId: "folder-library", fileName: "العقيدة.pdf", mimeType: "application/pdf", sizeBytes: 4096, localPath: "/android/files/pdf-aqidah", remoteUrl: null, isPinned: true, createdAt: 50, deletedAt: null, fileEntry: "files/pdf-aqidah", androidDocumentMetadata: { importedBy: "picker" } },
    { id: "pdf-personal", noteId: "note-personal", libraryFolderId: "folder-personal", fileName: "private.pdf", mimeType: "application/pdf", sizeBytes: 2048, localPath: "/android/files/pdf-personal", remoteUrl: null, isPinned: false, createdAt: 50, deletedAt: null, fileEntry: "files/pdf-personal" },
  ],
  "pdf_reading_progress.json": [
    { attachmentId: "pdf-aqidah", pageIndex: 12, pageCount: 30, progressPercent: 0.42, lastOpenedAt: 100, updatedAt: 100, scrollOffset: 0.318 },
    { attachmentId: "pdf-personal", pageIndex: 2, pageCount: 20, progressPercent: 0.1, lastOpenedAt: 100, updatedAt: 100 },
  ],
  "pdf_annotations.json": [
    { id: "annotation-highlight", attachmentId: "pdf-aqidah", libraryFolderId: "folder-library", pageIndex: 12, left: 61.4, top: 132.7, right: 505.9, bottom: 158.1, color: "yellow", noteText: "مهم", annotationType: "highlight", textSize: 16, backgroundColor: "none", displayTitle: "Exact geometry", displayFolderId: "folder-library", createdAt: 90, updatedAt: 100, futureGeometry: { quadPoints: [1.1, 2.2, 3.3, 4.4] } },
    { id: "annotation-personal", attachmentId: "pdf-personal", libraryFolderId: "folder-personal", pageIndex: 2, left: 0, top: 0, right: 0, bottom: 0, color: "yellow", noteText: "Private", annotationType: "page_note", textSize: 16, backgroundColor: "none", displayTitle: null, displayFolderId: "folder-personal", createdAt: 90, updatedAt: 100 },
  ],
  "pdf_annotation_geometry.json": [
    { annotationId: "annotation-highlight", orderIndex: 0, pageIndex: 12, left: 61.4, top: 132.7, right: 260.2, bottom: 145.4, futureGeometryField: true },
    { annotationId: "annotation-highlight", orderIndex: 1, pageIndex: 12, left: 80.1, top: 146.2, right: 505.9, bottom: 158.1 },
  ],
  "source_backlinks.json": [
    { id: "backlink-one", noteId: "note-tawakkul", attachmentId: "pdf-aqidah", annotationId: "annotation-highlight", pageIndex: 12, left: 61.4, top: 132.7, right: 505.9, bottom: 158.1, createdAt: 100, unknownBacklinkField: "keep" },
  ],
  "knowledge_tags.json": [
    { id: "knowledge-tawheed", name: "Tawheed", createdAt: 50, description: "Core belief", unknown: 11 },
  ],
  "knowledge_tag_links.json": [
    { tagId: "knowledge-tawheed", targetType: "note", targetId: "note-tawakkul", createdAt: 100 },
  ],
  "ai_conversations.json": [{ id: "conversation-1", noteId: "note-tawakkul", title: "Explain tawakkul", model: "legacy" }],
  "ai_messages.json": [{ id: "message-1", conversationId: "conversation-1", role: "assistant", content: "Preserved AI history" }],
  "home_chat_history.json": [{ id: "home-chat-1", role: "user", content: "Find evidence", unknown: true }],
};

const fileEntries: DriveSyncManifestEntry[] = [
  { path: "files/pdf-aqidah", fileName: "العقيدة.pdf", backupEntry: "files/pdf-aqidah", kind: "file", sha256: "a".repeat(64), size: 4096, cloudFileId: "drive-pdf-aqidah", updatedAt: 1_780_000_000_000 },
  { path: "files/pdf-personal", fileName: "private.pdf", backupEntry: "files/pdf-personal", kind: "file", sha256: "b".repeat(64), size: 2048, cloudFileId: "drive-pdf-personal", updatedAt: 1_780_000_000_000 },
];

export function representativeAndroidBackup(): MetadataRestoreBundle {
  const files = Object.entries(jsonFiles).map(([fileName, json]) => metadataFile(fileName, structuredClone(json)));
  return {
    schemaVersion: 1,
    restoredAt: "2026-08-23T00:00:00.000Z",
    cloudVersion: 1_780_000_000_000,
    driveEntryCount: files.length + fileEntries.length,
    metadataFileCount: files.length,
    metadataBytes: files.reduce((total, file) => total + file.size, 0),
    files,
    fileEntries: structuredClone(fileEntries),
    counts: { courses: 2, folders: 6, notes: 4, blocks: 3, attachments: 2, tags: 2, stickyNotes: 2, pdfAnnotations: 2 },
    groupSummaries: [],
    issues: [],
  };
}
