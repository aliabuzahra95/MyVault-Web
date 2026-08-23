# MyVault Web Restore Map

This document explains what the website must read from Google Drive before it can show your real MyVault Islamic Corpus data.

## Simple Summary

The Android app uses a Google Drive folder named `MyVault`.

Inside that folder, the important structure is:

```text
MyVault/
  metadata/
  files/
  manifests/
  backups/
```

The website should start by reading:

```text
MyVault/manifests/sync_manifest.json
```

That file is the table of contents. It tells the website which metadata JSON files and Library files exist in Drive.

## Important Difference

There are two manifest files:

```text
MyVault/manifests/sync_manifest.json
metadata/manifest.json
```

`sync_manifest.json` belongs to Google Drive sync. It lists Drive entries, file IDs, sizes, and hashes.

`metadata/manifest.json` belongs to the backup package itself. It must contain:

```json
{
  "format": "myvault-backup",
  "version": 1
}
```

The website should validate both.

## Drive Manifest Shape

The Android code creates `sync_manifest.json` with:

```text
schemaVersion
cloudVersion
storage
layout
entries
```

Each entry has:

```text
path
fileName
backupEntry
kind
sha256
size
cloudFileId
updatedAt
```

`kind` is either:

```text
metadata
file
```

Metadata entries live under:

```text
MyVault/metadata
```

File entries live under:

```text
MyVault/files
```

## Metadata Files To Parse

The Android app currently exports these metadata files:

```text
manifest.json
settings.json
courses.json
course_concept_cards.json
course_folders.json
course_notes.json
course_sticky_notes.json
folders.json
folder_sticky_notes.json
notes.json
blocks.json
tags.json
note_tags.json
note_tables.json
note_versions.json
ai_conversations.json
ai_messages.json
home_chat_history.json
attachments.json
pdf_reading_progress.json
pdf_annotations.json
source_backlinks.json
knowledge_tags.json
knowledge_tag_links.json
```

## First Web Restore Scope

For the first real website restore, use read-only mode.

Read-only mode means:

```text
The website reads Google Drive and displays data.
It does not edit Drive.
It does not push anything back.
It does not delete anything.
```

The first useful preview should show:

```text
Courses
Library files
Study folders
Study notes
Quran reader settings, if present
```

AI history can be parsed later. It is listed in the backup, but it does not need to block the first restore milestone.

## Library Files

`attachments.json` stores Library metadata.

Each attachment may point to a file entry:

```text
files/<attachment-id>
```

In Google Drive, the real uploaded file name is:

```text
<attachment-id>.<safe-extension>
```

The website should not trust the display file name alone. It should use the manifest entry, Drive file ID, size, and hash.

## Implementation Order

1. Add Google login to the web app.
2. Request access to Google Drive.
3. Find `MyVault/manifests/sync_manifest.json`.
4. Parse and validate the Drive manifest.
5. Download only metadata JSON first.
6. Build the restore preview from metadata.
7. Download Library files only after the metadata preview works.
8. Keep everything read-only until the restore path is proven safe.

## Current Web Milestone

The web app now has the safe restore foundation:

```text
Connect to Google Drive
Find the MyVault Drive folders
Find sync_manifest.json
Download sync_manifest.json as JSON
Validate the manifest shape
Build a manifest preview
Download metadata JSON entries listed by the manifest
Validate metadata/manifest.json
Store restored metadata in browser storage on this computer
Show restored metadata counts for Courses, Library, Study, and PDF state
```

The next milestone is using restored metadata on the main pages:

```text
Load restored courses on the Courses page
Load restored folders and documents on the Library page
Load restored notes, blocks, and tags on the Study page
Prepare the file download queue for large Library files
```

## Google Web Setup

The web app uses Google Identity Services in the browser.

For local development, it expects this environment value:

```text
VITE_GOOGLE_CLIENT_ID
```

That value belongs in:

```text
/Users/aliah/Desktop/MyVault-Web/artifacts/myvault-web/.env.local
```

The first implementation uses this scope, matching the Android sync scope:

```text
https://www.googleapis.com/auth/drive.file
```

Important note: this scope is intentionally narrow. If Google does not expose the Android-created MyVault folder to the web client during testing, the next fix is to use the same Google Cloud OAuth project as Android or review the Drive scope.

## Android Source Files Used

```text
/Users/aliah/Desktop/Finished Projects/MyVault Complete Before Tutor/MYVAULT_WEB_CONTEXT.md
/Users/aliah/Desktop/Finished Projects/MyVault Complete Before Tutor/app/src/main/java/com/myvault/app/data/sync/GoogleDriveIncrementalSyncRepository.kt
/Users/aliah/Desktop/Finished Projects/MyVault Complete Before Tutor/app/src/main/java/com/myvault/app/data/repository/BackupRepository.kt
```
