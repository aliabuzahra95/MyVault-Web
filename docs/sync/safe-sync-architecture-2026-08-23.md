# MyVault Android/Web Safe Sync Architecture

Date: 23 August 2026

Status: implementation contract

## Safety verdict

The hardened path now maintains an immutable common Base, verifies a separate Incoming Drive generation, and reconciles pending Website work with a three-way merge before any upload. Same-note body conflicts preserve both versions as separate notes. Ambiguous structural conflicts fail closed with Base, Website, and Incoming payloads retained.

This prevents silent loss; it does not guess user intent for every possible conflict. Local editing may continue when Drive is unavailable, but the application must not describe locally saved work as synchronised until a verified manifest-last commit succeeds.

## Non-negotiable contract

For an existing Android corpus, every Web commit is:

> newest complete Android-compatible Drive backup + verified Web operations -> validated new Android-compatible backup

Web must never rebuild an existing canonical backup solely from its visible Islamic Corpus projection. Unknown records and fields, Personal workspace data, Qur'an and memorisation state, Android settings, unsupported formatting, and unchanged PDF geometry must pass through from the newest Drive envelope.

## 1. Current Android backup format

Android writes backup format `myvault-backup`, version `1`. The incremental Drive backup contains 21 canonical metadata JSON files:

- `manifest.json`, `settings.json`
- courses, course concept cards, course folders, course notes, and course sticky notes
- folders, folder sticky notes, notes, blocks, tags, note tags, note tables, and note versions
- attachments and PDF reading progress/annotations
- source backlinks, knowledge tags, and knowledge tag links

Large attachments remain separate Drive files and are referenced by the Drive sync manifest. Android restore rebuilds its complete database from this canonical representation.

## 2. Web restore architecture

Web downloads every metadata entry listed by `sync_manifest.json` and retains the parsed JSON in `MetadataRestoreBundle.files`. That raw bundle is a viable lossless envelope foundation. The visible Web corpus is a filtered projection of it.

The browser database is scoped by stable Google Drive account identity. It retains:

- an immutable Base bundle and exact revision descriptor;
- the currently displayed projection;
- pending Website drafts and entity operations;
- durable conflicts and recovery snapshots.

Restore and startup refresh download Drive into a staged Incoming bundle first. A clean browser applies verified Incoming atomically. A dirty browser computes Base -> Website and Base -> Incoming changes and reconciles them before replacing visible state.

## 3. Web write-back architecture

Backup first verifies the latest Drive generation and performs the same safe pull/reconciliation used at startup. It then builds the candidate from immutable Base plus pending Website operations, stages changed metadata, verifies downloaded bytes and checksums, and updates `sync_manifest.json` last.

Pending operations are acknowledged only after the committed manifest and changed objects are read back successfully. A second remote change during the operation fails closed and leaves Website work pending for retry.

## 4. Entity identity

Android uses stable string IDs for folders, notes, blocks, attachments, PDF annotations, courses, concept cards, course folders, course notes, sticky notes, note tables, note versions, backlinks, and knowledge tags. Relationships use those IDs. Web must preserve restored IDs exactly and allocate one stable Android-compatible ID once for every new entity.

Tags and several join records use natural or composite identity. Reading progress is keyed by attachment ID. Missing IDs must never be regenerated during restore or merge.

## 5. Revision metadata coverage

Strong entity-level `updatedAt` exists for folders, notes, course records, concepts, sticky notes, note tables, reading progress, PDF annotations, backlinks, and knowledge tags.

Blocks, tags, note-tag links, some attachment properties, and several relationship rows lack sufficient independent revision/tombstone metadata. Their merge identity must therefore use stable keys plus canonical structural fingerprints against Base. Absence alone is not always safe evidence of deletion.

## 6. Android data not fully modelled by Web

Web does not expose the complete Personal workspace, Qur'an reader and bookmark state, memorisation records, all application/security preferences, all note-version/table/tag/link workflows, or every future Android field. It also supports only a subset of Android note formatting and PDF annotation editing semantics.

These sections remain Android-owned unless Web performs an explicit, validated operation on a supported entity.

## 7. Unknown-field behaviour

The restored raw metadata files preserve unknown JSON fields. However, touched records are currently normalised through narrow TypeScript objects, and the Drive manifest parser also narrows unknown fields. Rich-note editing can remove original body blocks and replace them with one Web `rich_text` block.

The hardened path must patch original raw records field-by-field, retain unknown properties, retain untouched records byte-equivalently where practical, and reject edits that cannot preserve unsupported rich-text or annotation data safely.

## 8. Existing backup versioning

Android and Web currently use a timestamp-like `cloudVersion`. Android uploads changed files, commits the manifest last, then removes stale entries. A `backups` folder exists, but coherent historical generations are not currently retained. Timestamps are diagnostic only and cannot be the correctness identity.

The hardened Web revision identity will be a deterministic digest of the complete Drive manifest and ordered entry fingerprints, supplemented by Drive file version/generation metadata where available.

## 9. Existing Drive layout

The root layout is:

```text
MyVault/
  metadata/
  files/
  manifests/sync_manifest.json
  backups/
```

The current Android client only depends on the canonical manifest and its entries. Web sidecars and historical manifests can live under `manifests` and `backups` without making Android restore depend on them.

## 10. Three-way reconciliation and Android schema

Yes. Android continues to read the existing version-1 backup.

Independent record fields merge automatically. PDF reading progress uses the newest real update timestamp. New entities with distinct IDs coexist. Same-note body/body conflicts use a lossless keep-both resolution: Incoming remains on the original stable note ID and Website content becomes a recovered conflict copy with a new stable ID.

Entities without sufficient revision or tombstone metadata still require conservative rules. Incompatible moves, delete-versus-edit, ambiguous absence, and unsupported transformations retain all three payloads and block automatic commit.

## 11. Android changes

No Android schema change is required for the first safe Web reconciliation path.

A later coordinated Android release is recommended to add a generated backup revision UUID, durable tombstones/revisions for blocks and relationship entities, and symmetric historical-generation retention. Those additions must be backward compatible and optional to Android restore; Web sidecars must never become an Android restore dependency.

## 12. IndexedDB migration

The current version-8 global database requires a non-destructive migration:

1. Introduce an account namespace based on Google Drive `user.permissionId` (not display name or email).
2. Preserve legacy stores untouched during schema upgrade.
3. Snapshot legacy state before claiming it for an account.
4. Copy legacy records into the first explicitly confirmed account namespace; never silently copy them into every account.
5. Store, per account: current projection, immutable Base envelope, Base revision descriptor, operation journal, conflicts, recovery snapshots, and sync log.
6. Broadcast account/content changes across tabs and guard Drive commits with Web Locks.

Account switching must unload the previous projection immediately and must never reveal another account's corpus or dirty state.

## 13. Conflict representation

Conflicts are durable records, not transient error strings. Each contains:

- conflict ID and account ID
- Base and CURRENT revision IDs
- entity type and stable entity ID
- Web operation IDs
- safe metadata summaries/fingerprints (not OAuth tokens or full note bodies in logs)
- conflict kind, such as body/body, move/move, delete/edit, or unsupported transformation
- available resolutions: keep Web, keep Android, or keep both when a safe duplicate can be constructed

Unresolved conflicts block canonical commit. Neither version is discarded. A local pre-merge recovery snapshot is created before applying a resolution.

## 14. Preserving old backups

Before switching the current manifest, Web writes a historical generation descriptor under `MyVault/backups` containing the complete prior manifest, revision ID, creation time, origin, schema version, and validation digest. Existing immutable entry files remain referenced by that descriptor.

Candidate metadata and new assets are uploaded under new file IDs, checksummed, and read back. The canonical manifest is changed last. At least several verified generations are retained; no automatic deletion occurs until a later, separately reviewed retention policy exists.

## 15. Automated Android compatibility gate

The existing preflight script must be replaced with a deterministic compatibility suite using a representative canonical fixture. It must contain nested Islamic and Personal data, Arabic/English/RTL content, Android rich-text marks and unknown fields, courses, sticky notes, concepts, tags/links/tables, tombstoned rows, PDFs, progress, and precise annotations.

The gate must prove:

- untouched files/records/unknown fields survive the Web round trip;
- stable IDs and all references remain valid;
- Web-created supported entities match Android version-1 JSON;
- body/body, move/move, and delete/edit conflicts are detected;
- independent Android and Web changes both survive;
- failed/interrupted upload leaves the prior current generation recoverable;
- pending operations clear only after post-commit verification;
- account switching has zero corpus leakage;
- Android restore accepts the candidate, followed by Android backup and another Web restore with semantic equivalence.

Automated JSON and browser tests are necessary but not sufficient. Final production approval requires a real Android restore/re-backup round trip against the representative fixture.

## Implementation phases and release gates

### Phase A: fail-closed foundation

- stable Google account identity
- account-scoped state and non-destructive migration
- immutable Base revision/envelope and local recovery snapshots
- operation journal and cross-tab coordination
- disable canonical write-back when these prerequisites are absent

### Phase B: conservative reconciliation

- deterministic revision fingerprints
- three-way entity merge with durable conflicts
- raw-record patching and unknown-field preservation
- rich-text and annotation ownership guards
- complete semantic candidate validation

### Phase C: verified Drive commit

- account-level Web Lock
- historical generation descriptor
- staged immutable uploads and checksum read-back
- manifest-last commit and post-commit verification
- idempotent retry and journal acknowledgement by operation ID

### Phase D: compatibility approval

- representative fixture and regression suite
- repaired sync verification gate
- Android restore/re-backup/Web-restore round trip
- explicit production-safe sign-off

Drive write-back remains non-production until every phase passes. This is intentional: a visible disabled sync action is safer than a successful-looking operation that can silently lose real study material.

## Implementation status after hardening

Phases A through C are implemented on `feature/safe-sync-contract` and covered by the Web contract suites:

- Google Drive identity uses the stable Drive permission ID and all restored data, drafts, journals, conflicts, Base revisions, and recovery snapshots are account-scoped.
- Dirty local operations survive offline use, failed uploads, account changes, and newer edits made in another tab. Same-account commits are serialised with a Web Lock.
- Existing Android backups require an immutable Base. Web creates a candidate from Base, re-downloads CURRENT Drive, performs a conservative three-way merge, and records durable conflicts instead of choosing silently.
- Unsupported Android rich-text transformations and deletions without Android tombstone support fail closed. Current Android course, concept-card, and sticky-note schemas cannot safely represent deletion of an already-backed-up row.
- Candidate metadata is validated against required Android fields and cross-file relationships. Unknown fields, untouched Personal/Qur'an/settings data, precise PDF geometry, and optional historical AI files remain in the lossless envelope.
- Changed files are uploaded to new Drive file IDs, downloaded for checksum verification, and only then made current by a manifest-last commit. The prior manifest is retained as a recovery generation. The committed manifest and changed bytes are verified again before captured journal operations are acknowledged.
- A web-first account creates the 21 metadata files written by current Android builds; it does not invent the three legacy optional AI files.

Automated TypeScript and browser checks now cover the representative Android fixture, independent Android/Web edits, conflicts, unsupported deletions, current knowledge-link identity, account isolation, offline journalling, cross-tab locking, verified staging, manifest-last commit, and failed-upload recovery.

### 1 September 2026 retained-draft and paragraph remediation

- Startup performs a read-only verified safe pull before showing an editable workspace when the saved Google session can be recovered. It does not upload, delete, or move Drive objects.
- Backup repeats that safe pull immediately before constructing a candidate, so a stale browser cannot upload over a newer Android generation.
- Every new note draft records the exact Base revision. Missing or invalid revision binding fails closed instead of being silently rebased.
- Browsers affected by the former unconditional rebase are repaired non-destructively. A redundant stale draft is removed; a different stale draft is converted into a separate recovered Website note before the original note displays the verified Drive body.
- Concurrent edits to the same note keep both bodies in one Backup operation. The Incoming/Android version retains the original note identity and the Website version becomes a clearly titled conflict copy.
- Different fields on the same entity merge deterministically. Independent folders, notes, PDFs, annotations, and PDF progress changes are covered by contract tests.
- Web Vault rich-text tests cover blank paragraphs, headings, bold, italic, and mixed Arabic/English text. Android tests prove exact stored `\n` preservation and rich-text mark round trips.
- Android long-note display chunking no longer trims or skips whitespace at chunk boundaries; concatenated chunks exactly reproduce the stored text.
- The repair does not change the Android backup schema, Room schema, canonical metadata filenames, or manifest semantics.
- No Google Drive object was deleted or moved while developing or validating this remediation.

Automated compatibility is necessary but not sufficient for the final acceptance claim. The deployed revision must still pass the user-observed sequence on controlled real data: Android backup -> Web restore; Website edit of an existing note -> Web backup -> Android restore; Android -> Android restore; and paragraph/blank-line inspection on both clients. These results must be reported separately. A successful build, browser fixture, or one-way restore is not a substitute for that round trip.
