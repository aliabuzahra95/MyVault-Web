# MyVault Web UI/UX Roadmap

These notes capture the current desktop-web refinements for MyVault Islamic Corpus. The goal is a true desktop companion to the Android app, not just a restored metadata counter.

## Dashboard

- Remove Dashboard restore/metadata card.
- Keep Recent Courses, Recent Library Documents, Recent Study Notes, and Quran sections.
- Move restore and Google Drive controls into Settings.
- Make View All actions navigate to their full sections later.

## Navigation

Order:

1. Dashboard
2. Study
3. Library
4. Courses
5. Quran
6. Settings

## Study

- Use desktop width better; avoid centering a narrow folder list.
- Move folder/content work area toward the left.
- Show useful metadata alongside folders when appropriate.
- Preserve nested folders.
- Folder detail pages should show direct notes and direct subfolders together.
- Add view modes: grid, list, icon.
- View modes should work naturally inside nested folders too.

## Note Viewer

- Render notes as documents, not raw source.
- Never expose raw Markdown, escaped line breaks, or formatting instructions to the user.
- Match the Android reading experience as closely as practical:
  - headings
  - bold text
  - highlights
  - spacing
  - lists
  - quotations
  - colors
  - rich formatting

## Library

- Preserve folder hierarchy.
- Documents should appear inside their proper folders rather than one flat list.
- Add grid, list, and icon views.
- Match Study browsing flexibility.

## Courses

- Keep on roadmap for a fuller future pass.
- No immediate refinement is required beyond preserving the current section.

## Implementation Priority

1. Completed: Dashboard/navigation/settings cleanup.
2. Completed: Study desktop layout with an inline expandable knowledge tree, grid/list/icon views, pinned notes, restored folder sticky notes, and no folder-page navigation from Study.
3. Completed: Library hierarchy with inline folder expansion, document metadata, pinned documents, reading progress, and grid/list/icon views.
4. Completed: Android rich-text JSON parsing and document rendering for restored notes, including headings, emphasis, colors, spacing, and note links.
5. Completed: On-demand Google Drive document restoration and an embedded PDF reader.
6. Acceptance check: Confirm one restored long note and one real Google Drive PDF in the user's existing browser data after sign-in.
7. Next: Course-specific workspace refinements.
8. Later: Quran reader and AI features.
