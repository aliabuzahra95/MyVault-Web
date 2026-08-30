export const driveRootFolder = "MyVault";

export const driveLayout = [
  {
    path: "MyVault/metadata",
    purpose: "Small JSON files for folders, notes, courses, settings, annotations, and relationships.",
  },
  {
    path: "MyVault/files",
    purpose: "Large Library files such as PDFs, images, documents, and other imported attachments.",
  },
  {
    path: "MyVault/manifests",
    purpose: "The Drive sync manifest that tells the web app what to download.",
  },
  {
    path: "MyVault/backups",
    purpose: "Reserved Android backup area for full backup packages.",
  },
] as const;

export const driveManifest = {
  fileName: "sync_manifest.json",
  folder: "MyVault/manifests",
  schemaVersion: 1,
  storage: "google-drive-api",
  requiredFields: ["schemaVersion", "cloudVersion", "storage", "layout", "entries"],
  entryFields: ["path", "fileName", "backupEntry", "kind", "sha256", "size", "cloudFileId", "updatedAt"],
} as const;

export const metadataFiles = [
  { fileName: "manifest.json", group: "Core", required: true, purpose: "Backup identity. Must say format myvault-backup and version 1." },
  { fileName: "settings.json", group: "Core", required: false, purpose: "Theme, workspace, Quran reader state, Library view settings, and restore preferences." },
  { fileName: "courses.json", group: "Courses", required: false, purpose: "Course shells and their linked root folders." },
  { fileName: "course_concept_cards.json", group: "Courses", required: false, purpose: "Course concept cards and definitions." },
  { fileName: "course_folders.json", group: "Courses", required: false, purpose: "Legacy course folders." },
  { fileName: "course_notes.json", group: "Courses", required: false, purpose: "Legacy course notes." },
  { fileName: "course_sticky_notes.json", group: "Courses", required: false, purpose: "Legacy course sticky notes." },
  { fileName: "folders.json", group: "Study", required: true, purpose: "Study, Library, and course folders, including hierarchy and mode." },
  { fileName: "folder_sticky_notes.json", group: "Study", required: false, purpose: "Sticky notes attached to folders." },
  { fileName: "notes.json", group: "Study", required: true, purpose: "Notes, folder links, titles, plain text, pins, order, and deleted state." },
  { fileName: "blocks.json", group: "Study", required: true, purpose: "Structured note blocks." },
  { fileName: "tags.json", group: "Study", required: true, purpose: "Tag names." },
  { fileName: "note_tags.json", group: "Study", required: true, purpose: "Links between notes and tags." },
  { fileName: "note_tables.json", group: "Study", required: true, purpose: "Tables embedded in notes." },
  { fileName: "note_versions.json", group: "Study", required: false, purpose: "Saved note history." },
  { fileName: "attachments.json", group: "Library", required: true, purpose: "Library file metadata and fileEntry pointers." },
  { fileName: "pdf_reading_progress.json", group: "Library", required: false, purpose: "PDF page and progress state." },
  { fileName: "pdf_annotations.json", group: "Library", required: false, purpose: "PDF highlights, page notes, text boxes, and display locations." },
  { fileName: "pdf_annotation_geometry.json", group: "Library", required: false, purpose: "Ordered multi-rectangle geometry for selected-text PDF annotations." },
  { fileName: "source_backlinks.json", group: "Library", required: false, purpose: "Links from notes back to source PDF regions." },
  { fileName: "knowledge_tags.json", group: "Knowledge", required: false, purpose: "Knowledge tag definitions." },
  { fileName: "knowledge_tag_links.json", group: "Knowledge", required: false, purpose: "Links from knowledge tags to notes, attachments, and annotations." },
  { fileName: "ai_conversations.json", group: "AI", required: false, purpose: "Existing note-level AI conversation shells." },
  { fileName: "ai_messages.json", group: "AI", required: false, purpose: "Existing note-level AI messages." },
  { fileName: "home_chat_history.json", group: "AI", required: false, purpose: "Ask MyVault home chat history." },
] as const;

// Current Android backups write every group above except the three legacy AI
// history files. Existing backups may still contain those files and the web
// must preserve them, but a new web-first backup must not invent them.
export const androidMetadataFiles = metadataFiles.filter(({ group }) => group !== "AI");

export const restoreDataGroups = [
  {
    label: "Courses",
    files: ["courses.json", "course_concept_cards.json", "course_folders.json", "course_notes.json", "course_sticky_notes.json"],
  },
  {
    label: "Library",
    files: ["attachments.json", "pdf_reading_progress.json", "pdf_annotations.json", "pdf_annotation_geometry.json", "source_backlinks.json"],
  },
  {
    label: "Study",
    files: ["folders.json", "folder_sticky_notes.json", "notes.json", "blocks.json", "tags.json", "note_tags.json", "note_tables.json", "note_versions.json"],
  },
  {
    label: "Knowledge",
    files: ["knowledge_tags.json", "knowledge_tag_links.json"],
  },
  {
    label: "AI history",
    files: ["ai_conversations.json", "ai_messages.json", "home_chat_history.json"],
  },
] as const;

export const restorePipeline = [
  "Connect Google Drive with the same Drive scope Android uses.",
  "Find MyVault/manifests/sync_manifest.json.",
  "Validate schemaVersion, storage, cloudVersion, and entries.",
  "Download metadata entries from MyVault/metadata.",
  "Download file entries from MyVault/files only when needed.",
  "Validate internal manifest.json as myvault-backup version 1.",
  "Build a read-only preview for Courses, Library, Study, and Quran state.",
] as const;
