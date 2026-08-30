# Android Backup Contract for MyVault Web

Status: authoritative Web-side map of the existing Android contract. Android remains unchanged.

## Sources

- Android writer/parser: `BackupRepository.kt`
- Drive manifest/upload: `GoogleDriveIncrementalSyncRepository.kt`
- Android reference commit: `5a872867cb0491b3cd1b306448ea75594f1670fa`
- Contract version: internal backup `format = myvault-backup`, `version = 1`; Drive manifest `schemaVersion = 1`

## Drive and integrity contract

- Layout is unchanged: `MyVault/metadata`, `MyVault/files`, `MyVault/manifests`, `MyVault/backups`.
- `sync_manifest.json` uses `storage = google-drive-api` and records `path`, `fileName`, `backupEntry`, `kind`, `sha256`, `size`, `cloudFileId`, and `updatedAt`.
- Metadata objects are compact JSON encoded as UTF-8. Attachment objects are raw file bytes.
- `size` is the exact uploaded file byte count (`File.length()`), not JavaScript character count.
- `sha256` is calculated over those exact bytes.
- The current Drive metadata/object contract has no encryption envelope. No encryption behavior was added, removed, or changed by Web.
- A Drive listing's `size` is advisory because listing metadata can be stale. Downloaded SHA-256 is authoritative. A downloaded-size mismatch is accepted only when the manifest SHA-256 matches exactly; without a checksum, exact size remains mandatory.
- Unknown additive JSON fields are accepted and retained in the staged bundle.

## Required and optional field rule

Android `get*` calls define required values. Android `opt*` calls define optional values with Android-owned defaults. Kotlin nullable values passed to `JSONObject.put` can be omitted from serialized JSON, so Web must accept both an absent key and an explicit JSON `null` where Android supports null.

## Metadata inventory

| File | Android-required fields | Optional, nullable, or defaulted fields | Notes |
|---|---|---|---|
| `manifest.json` | `format`, `version` | `createdAt`, unknown additive fields | Must be `myvault-backup` v1. |
| `settings.json` | nonblank `theme`, nonblank `workspace` when present | `schemaVersion` defaults 1; all display, security, Qur'an, Memorise, expansion, and Library mode keys use Android defaults | Theme V2 is additive; unknown settings are preserved. Material You remains device-local. |
| `courses.json` | `id`, `title`, `createdAt`, `updatedAt` | `rootFolderId`, `lastOpenedNoteId` | Nullable keys may be absent. |
| `course_concept_cards.json` | `id`, `courseId`, `term`, `createdAt`, `updatedAt` | `arabicTerm`, `definition` default empty, `details`, `sortOrder` default 0 | Field is plural `details`; absent details is valid. |
| `course_folders.json` | `id`, `courseId`, `title`, `createdAt`, `updatedAt` | `sortOrder` default 0 | Legacy-compatible collection. |
| `course_notes.json` | `id`, `courseId`, `folderId`, `title`, `createdAt`, `updatedAt` | `body` default empty, `sortOrder` default 0, `lastOpenedAt` | Legacy-compatible collection. |
| `course_sticky_notes.json` | `id`, `courseId`, `text`, `createdAt`, `updatedAt` | `sortOrder` default 0 | Sticky-note model remains distinct. |
| `folders.json` | `id`, `name`, `orderIndex`, `isFavourite`, `createdAt`, `updatedAt` | `parentId`, `description`, `mode` default `study`, `deletedAt`, `colorKey` | IDs include active and tombstoned folders. |
| `folder_sticky_notes.json` | `id`, `folderId`, `text`, `createdAt`, `updatedAt` | additive unknown fields | Folder sticky-note model remains distinct. |
| `notes.json` | `id`, `title`, `bodyPlainText`, `isPinned`, `isFavourite`, `createdAt`, `updatedAt` | `folderId`, `parentNoteId`, `isFolderPinned` default false, `orderIndex` default 0, `deletedAt` | Workspace pin and folder pin remain separate. |
| `blocks.json` | `id`, `noteId`, `type`, `content`, `orderIndex` | additive rich-text envelope fields inside `content` | `content` is a string and may contain Android/Web rich-text JSON. |
| `tags.json` | `name` | additive unknown fields | Tag identity is the name. |
| `note_tags.json` | `noteId`, `tagName` | additive unknown fields | Cross-reference collection. |
| `note_tables.json` | `id`, `noteId`, `rowCount`, `columnCount`, `cellsJson`, `orderIndex`, `createdAt`, `updatedAt` | additive unknown fields | `cellsJson` remains an encoded JSON string. |
| `note_versions.json` | `id`, `noteId` | title/body/rich text/rich HTML/counts/timestamp use Android defaults | Older sparse history rows are valid. |
| `attachments.json` | `id`, `fileName`, `mimeType`, `sizeBytes`, `createdAt` | `noteId`, `libraryFolderId`, `localPath`, `remoteUrl`, `isPinned` default false, `deletedAt`, `fileEntry` | `fileEntry` may be absent/empty if no backed-up file exists. |
| `pdf_reading_progress.json` | `attachmentId`, `pageIndex`, `pageCount`, `lastOpenedAt`, `updatedAt` | `progressPercent` defaults 0 | Byte verification applies to the whole UTF-8 JSON object. |
| `pdf_annotations.json` | `id`, `attachmentId`, `pageIndex`, rectangle, `color`, `createdAt`, `updatedAt` | folder, text, selected text, type, text size, background, display fields | Types include `highlight`, historic `text_box`, and `page_note`; unknown fields are additive. |
| `pdf_annotation_geometry.json` | `annotationId`, `orderIndex`, `pageIndex`, rectangle | unknown additive fields | Optional complete multi-rectangle geometry. Malformed optional segments are ignored by Android; valid segments must reference a parent annotation. |
| `source_backlinks.json` | `id`, `noteId`, `attachmentId`, `pageIndex`, `createdAt` | `annotationId`, rectangle coordinates | Coordinates may be absent. |
| `knowledge_tags.json` | `id`, `name`, `createdAt` | unknown additive fields | Names are unique under Android verification. |
| `knowledge_tag_links.json` | `tagId`, `targetType`, `targetId`, `createdAt` | unknown additive fields | Targets are note, attachment, or annotation. |

## Settings structures

Current Android writes theme compatibility fields, workspace/accent/font preferences, Note display preferences, security state, Qur'an position/display/audio state, bookmarks, recent locations, Memorise records and attempts, expanded folder IDs, and legacy Library view modes. Arrays and nested attempt payloads remain opaque to Web features that do not understand them and must survive a no-op round trip.

## Relationship rules

- Relationship validation uses all rows, including deleted/tombstoned folders, notes, and attachments.
- Blocks, tables, versions, attachments, tags, backlinks, and knowledge links must resolve to their corresponding complete identity sets.
- PDF geometry resolves to its logical annotation parent; attachment `fileEntry` resolves to a manifest file `backupEntry` or path when nonblank.
- Unknown optional collections and fields do not invalidate an otherwise compatible backup.

## Web application boundary

Web performs complete download, byte-size/checksum verification, JSON parsing, schema validation, and relationship validation before any IndexedDB mutation. The existing unsynchronised-change guard remains in place. Application of the staged bundle and its sync base remains one IndexedDB transaction.
