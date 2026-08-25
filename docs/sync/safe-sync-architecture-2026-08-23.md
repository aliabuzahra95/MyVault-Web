# MyVault Android/Web Safe Sync Architecture

Date: 23 August 2026

Status: implementation contract

## Safety verdict

The current Web write-back path is **not production-safe for two-way Android/Web use**. It has useful foundations (raw metadata restore, staged uploads, and manifest-last commit), but it does not yet maintain an immutable common Base, perform a true three-way reconciliation, isolate browser state by Google identity, retain coherent prior generations, or represent conflicts. It can also replace Android rich-text blocks with a narrower Web representation.

Until the gates in this document pass, Drive write-back must fail closed. Local editing may continue, but the application must not describe locally saved work as synchronised.

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

## 2. Current Web restore architecture

Web downloads every metadata entry listed by `sync_manifest.json` and retains the parsed JSON in `MetadataRestoreBundle.files`. That raw bundle is a viable lossless envelope foundation. The visible Web corpus is a filtered projection of it.

The current browser database stores one global `current` bundle and global edit stores. Restore reconciliation only rebases note drafts using `cloudVersion` and `updatedAt`; it does not preserve an immutable Base revision or reconcile a newer Drive backup with dirty Web work.

## 3. Current Web write-back architecture

Web currently overlays local arrays into the restored bundle, uploads new metadata and changed files to staging, checks `cloudVersion`, and updates `sync_manifest.json` last. This protects the old current manifest from many partial-upload failures.

It is not yet a true three-way merge. It compares one numeric cloud version, has no conflict objects, clears all pending stores after commit, does not verify the committed generation by downloading it again, and does not retain a coherent historical manifest before switching current state.

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

## 10. Can three-way reconciliation avoid an Android schema change?

Yes, for a conservative first production-safe Web implementation. Web can retain the exact restored Base bundle, download CURRENT Drive into staging, compute BASE -> WEB operations from its journal, compute BASE -> CURRENT structural changes, and merge only deterministic cases. Android continues to read the existing version-1 backup.

Blocks and entities without tombstones require conservative conflict rules. Same-note body edits, incompatible moves, delete-versus-edit, ambiguous absence, and unsupported formatting changes must block automatic commit.

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

Phase D remains the release gate: install a candidate Android build on a test device, restore a generated candidate containing the representative fixture, inspect the corpus, create another Android backup, restore that backup into a clean Web account namespace, and compare semantic equivalence. Canonical Drive write-back must remain explicitly pre-release until that physical Android round trip passes.
