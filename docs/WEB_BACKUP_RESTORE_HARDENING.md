# Web Backup/Restore Hardening

## Current status: implementation tested; live handoffs blocked

Updated 2026-09-05 after the user's narrow Android writer exception. The earlier
audit below is historical. The writer blocker has been addressed in production
code, and the independent Web startup/editing work has continued. This is **not**
acceptance of the three required real Android/Web round trips.

### Source checkpoints

| Project | Starting HEAD | Recovery tag | Implemented HEAD |
| --- | --- | --- | --- |
| Android, `frozen-design-master-port` | `182282cbba582224fc697ea7146d89854830d082` | `recovery-android-writer-safety-20260905` | `31f3c80f96db81395bd9ac69bc11025bee8c8262` |
| Web, `main` | `5cdc792f47f390693ddf2fde7c7b1e5d166593aa` | `recovery-web-writer-safety-20260905` | `6c350fb74d38217272058eeac564660582119085` |

Both recovery tags were pushed and peeled remote revisions matched local.
Both tracked trees were clean at the start. Existing untracked Android artifacts
were left untouched. No reset/stash or full-project copy was used. Web code is
split into `3ee2ad4` (integrity), `472a257` (writer/edit protection), and `6c350fb`
(background orchestration). The final documentation commit follows these.

### Proven causes and fixes

1. Android updated existing metadata/binary IDs before publishing its new
   manifest. Interruption left the previous manifest pointing at different bytes.
   The production push now uses `DriveBackupPublisher`: transactionally capture
   metadata, create separate changed objects, verify bytes, recheck the active
   manifest, publish once, then read back before advancing success state.
2. Web already staged new IDs, but its failure cleanup could delete newly
   committed files when the publication response was lost. Cleanup is removed.
   An uncertain response triggers one readback, never an unconditional replay.
3. Web writer fallback selected same-name/same-size newest objects. That is not
   identity. Any missing-ID fallback now requires the expected raw-byte SHA-256
   from the correct parent. Duplicate active manifests fail explicitly.
4. Startup waited for cloud work before rendering the app. The shell and scoped
   cached content now render independently. One account-scoped owner performs
   check -> download -> validate -> stage -> guarded apply -> UI update. Manual
   and automatic pulls use it and the existing account sync lock.
5. A clean-at-download-start check did not protect subsequent typing/autosaves.
   Editors hold a browser shared lock through their final durable save. Apply
   takes an exclusive lock without waiting/covering the app, and an IndexedDB
   transaction rechecks the captured local generation. Otherwise it stays staged.
6. Older snapshot completion could clear later edits. Publication settlement now
   clears overlays/journal/binary cache only in the same transaction that verifies
   the captured generation. Later edits remain pending. A readback-verified own
   publication is recorded as their ancestor, so the next backup does not mistake
   the browser's own upload for an unrelated Android change. Genuine divergent
   edits still use the existing three-way reconciliation/keep-both facilities.
7. Local writes previously resolved on a request success before transaction
   commit. Draft + journal + generation now commit together; aborts and synchronous
   quota/clone failures roll back. Failed final editor saves retain the in-memory
   draft and lock, expose Retry save, and warn against closing the tab.

### Reader compatibility and unchanged contracts

- Android and Web current readers use `cloudFileId` from the active manifest for
  metadata/binaries. Active selection is scoped to `MyVault/manifests` and
  `sync_manifest.json`. No logical filenames, paths, schema versions or serialized
  IDs changed. New duplicate logical metadata names have different exact IDs.
- Android still retains its legacy missing-ID/name fallback. The new writer
  rejects a previous manifest lacking exact IDs **before staging duplicates**;
  it does not modify those older reader semantics. Older backups remain readable
  by their existing reader, but updating a legacy manifest without IDs is a
  documented compatibility stop, not an automatic migration.
- Web's existing raw-byte SHA validation is preserved. A legacy metadata size
  mismatch is tolerated only with an exact SHA match; absent SHA remains strict
  about size. JSON is not reserialized before checking a downloaded hash.
- Android metadata is captured in its existing Room transaction. Attachment IDs
  come from that same export; changed file bytes are copied/hashed and rechecked
  before upload. Unchanged files are reused after hash/size verification.
- No Room/entity/migration, restore algorithm, encryption, backup representation,
  OAuth/client/scope/secret, Drive hierarchy, widget, Quran, or PDF architecture
  changes. Android's only exception is the writer and its narrow helper/tests.
- New Web metadata is local, in the existing account metadata store. No IndexedDB
  version bump, new backend, shared revision format, or cloud sync protocol.

### Runtime evidence

Real Chrome, isolated profiles, actual Web code with mocked Drive:

- Delayed download: shell visible in **248 ms**, first metadata request **351 ms**,
  existing Course note editor ready **441 ms**. Automated typing took **148 ms**.
  These are one local small-fixture run, not Internet/large-vault guarantees.
- Typing survived download completion; the incoming bundle stayed staged. Closing
  the editor flushed the draft; explicit retry safely applied the update.
- An unchanged committed manifest skipped another metadata download. A manifest
  change during download was rejected without replacing the active local bundle.
- Shared editor lock in another tab blocked replacement. Late account-A autosave
  after switching to B stayed in A. Query clients/corpus callbacks are scoped and
  invalidated on account change.
- Edit C made while B uploaded survived B's settlement; the next upload included
  C without a false conflict. Genuine divergent edits retained conflict copies.
- Injected quota failure did not commit a journal-only mutation. Retry saved the
  retained draft before releasing its editor protection. Closing/crashing the
  browser while storage remains unavailable can still lose in-memory-only work.
- Offline/503 startup kept cached content/navigation usable and reached a small
  failure status, not an endless full-screen spinner.
- Screenshots visually inspected: `/tmp/myvault-background-editor-staged.png`,
  `/tmp/myvault-offline-cached-shell.png`, and
  `/tmp/myvault-web-nonblocking-settings.png`.

Separate 147-page / 5,623,880-byte local PDF regression: highlights on pages 98
and 113, page note, zoom, close/reopen and reading-position persistence passed.
Peak five canvases/text layers; resources released on close; no unhandled errors.
The PDF was read locally into an isolated browser; its original file was not
edited and it was not uploaded to Drive.

### Build evidence

- Android JBR 21.0.11: 279 unit tests, zero failures/errors/skips; lintDebug,
  assembleDebug and assembleRelease passed. Final log:
  `/tmp/myvault-android-writer-verification.log`.
- Android production helper fault injection exercises actual publication order:
  first/mid metadata failure, changed binary verification failure, pre-publication
  failure, rejected publication, changed remote, lost response and failed final
  readback. It proves original A bytes/IDs remain and B resolves after success.
  This is not an Android UI restore or a live Google Drive test.
- Android debug SHA-256:
  `7affe405443c82538e7b8961226859eed1e0df7525122a529346a5b12d727906`.
- Android release/R8 output is **unsigned**, version 0.1.0 (1), SHA-256:
  `0286636c95e84cb3a67c2268b30c46e3c9302df961e4dd176254c12f689816bf`.
  Neither APK was installed over the user's phone or uploaded.
- Web complete typecheck/build, workspace, safe-sync, auth/restore, three Quran
  suites, browser-sync, background-sync and PDF regression passed. No standalone
  lint command is configured; existing sourcemap/large-chunk warnings remain.
  Browser scripts use the existing local Chrome/runtime paths, with no new
  production dependency. `git diff --check` passed.

### Recovery, storage and remaining gates

- Previous manifest copies are retained in the existing backups folder, along
  with unchanged original referenced objects. This is a recoverable exact
  manifest-and-files combination, but no new recovery-picker UI is introduced.
  Archived raw sync manifests may require an explicit developer-assisted recovery;
  do not present them as an automatically selectable Android restore archive.
- No Drive object was deleted, moved, garbage-collected or migrated. No live
  Drive test objects were created: **count 0, storage 0 bytes**. Injected tests
  use memory-only mock Drive objects. Future interrupted attempts retain staging
  objects; failure messages give a lower-bound count/bytes of verified creates.
  Lost create responses can leave additional objects whose IDs are unknown.
- Storage grows by archived manifests and changed object generations. Unchanged
  PDFs stay incremental. No cleanup has been added or authorized.
- Android clients before `31f3c80` and Web clients before these fixes must be
  updated. Old Android writers can still overwrite referenced objects. A website
  deployment cannot update the phone's installed APK.
- Browser locks do not lock Android. Check-before-publication detects observed
  remote changes but has a final race window; no global cross-device compare-and-
  swap guarantee is claimed. Use sequential handoffs, not simultaneous writers.
- Browsers without Web Locks retain staged updates rather than risk an editor.
  Large-vault parse/projection responsiveness, crash during atomic commit, and
  all token-expiry/rate-limit combinations remain incompletely tested.
- **BLOCKED:** three real Android -> Web -> Android / reverse UI cycles, actual
  test-account binary/formatting restores, and Web-created content on Android.
  The separate empty Chrome profile is not authenticated. Its actual page says
  Not connected / Popup window closed. `aahforex@gmail.com` remains the only
  authorized live test account; no primary account or primary phone was touched.
- To resume: authenticate that isolated profile to aahforex, verify actual Google
  identity and disposable local datasets, use an isolated Android emulator with
  the new writer, preserve its external test snapshot, then execute the matrix's
  three distinct UI handoffs. Do not substitute injected fixtures for this gate.

### Deployment

Production `6c350fb` is live at https://myvault-web.vercel.app via deployment
`dpl_Ewwv2DML6cv28XfD1p1HrmM87aAD` (READY). Fresh Chrome at 1440x1000 and 390x844
loaded the actual new JavaScript asset and all six main routes without overflow
or unhandled errors. Served asset SHA and exact evidence are in the acceptance
matrix. These fresh unauthenticated checks do not prove authenticated backup.
No deployment/OAuth configuration changed. Documentation-only commits do not
change the tested application code.

## Historical audit: before the narrow Android exception

The remainder preserves the original evidence at the earlier source revision.
Its paused/not-implemented statements describe that earlier audit only.

### Historical status: paused at an explicit protected boundary

Date: 2026-09-05. This is NOT a completion or deployment acceptance report.
The current Android writer can invalidate the last committed backup during an
interrupted upload. Web cannot prevent that write or reconstruct unavailable
original bytes. The requested instructions explicitly require a pause for this
shared Android/Drive limitation. No production remediation has been applied.

## Source and recovery identity

- Web: `/Users/aliah/Desktop/Current Projects/MyVault-Web`.
- Branch: `main`; starting/runtime source HEAD: `59c0ba71754e99f33b567f0c6151281e01f23bf6`.
- Remote: `https://github.com/aliabuzahra95/MyVault-Web.git`.
- Starting tracked and untracked Web tree: clean.
- Annotated recovery tag: `recovery-web-backup-hardening-20260905`.
- Tag object: `e18f24ae16c11cf3bb241e5fa1347af7d6b2bf9b`, pushed and verified remotely;
  peeled commit is the starting HEAD above.
- Android read-only reference: `182282cbba582224fc697ea7146d89854830d082`, branch
  `frozen-design-master-port`. Evidence was read with `git show` against that
  exact revision, not an evolving worktree. Android tracked files are clean;
  existing untracked historical artifacts/signature sidecars were left alone.
- Available Android APK: `release/MyVault-0.1.0-PRE-RELEASE-182282c-Manual-Widget-Appearance-signed.apk`
  in the Android repository, version `0.1.0`, code `1`. Not installed or tested
  during this pass. No APK was generated.

The evidence commit adds only a fault-model test and these two documents.
Git protects source; it does not preserve browser state or Drive file contents.

## Proven publication blocker

Fixed Android source:
[GoogleDriveIncrementalSyncRepository.kt at 182282c](https://github.com/aliabuzahra95/MyVault/blob/182282cbba582224fc697ea7146d89854830d082/app/src/main/java/com/myvault/app/data/sync/GoogleDriveIncrementalSyncRepository.kt).

1. Lines 112-119 read the remote manifest/version at the beginning of push.
2. Lines 194-206 choose an existing object ID for upload. For metadata, this is
   `remote?.cloudFileId` or the existing child found by name.
3. Lines 634-655 implement an existing-ID upload as PATCH, changing its contents.
4. Lines 210-214 verify the newly uploaded metadata. They do not preserve its
   previous bytes.
5. Only after the object loop, lines 227-236 publish `sync_manifest.json`.
6. Lines 238-243 can delete IDs belonging to paths absent from the new manifest.
   This path was NOT executed. It also prevents treating old manifests as durable
   archives of all their referenced files.

Failure sequence: manifest M references object F with hash H1. Android replaces
F with new bytes H2, then stops before publishing M2. M remains unchanged and
still promises H1. A Web client must reject H2. Retrying M cannot reconstruct H1.
This is a demonstrable failure mode, not a claim that it caused every historical
account-specific failure or that the user's current Drive is corrupt.

### Reproduction and controls

Run from the Web repository:

```sh
pnpm --filter @workspace/myvault-web exec tsx scripts/verify-publication-boundary.ts '/Users/aliah/Desktop/Current Projects/MyVault Complete Before Tutor'
```

The script checks the referenced Android source branches, then uses an in-memory
object store and the actual production `stageVerifiedMetadataRestore` validator.
It is a source-backed fault model, NOT execution of Kotlin or live Android/Drive.
All network requests are forbidden. Fixtures are synthetic; no local app database
or real cloud object is mutated.

- Intact manifest and all metadata: accepted by the production Web validator.
- Same-size metadata overwrite with unchanged manifest: rejected with
  `notes.json: downloaded SHA-256 checksum does not match the manifest.`
- A saved copy of the manifest alone: still rejected against overwritten bytes.
- Saved manifest plus saved original object bytes: accepted.
- Control using a distinct new object ID: both old and newly published metadata
  snapshots validate under the existing schema/layout.
- Next Android-style overwrite of that Web-published ID: rejected again.

Passing assertions confirm the defect model; they do not mean the defect is fixed.
The representative fixture's attachment records are present, but this metadata
test does not download or verify actual PDF binary contents.

## What the existing Web writer does

`artifacts/myvault-web/src/lib/sync/driveWriteBack.ts` uploads changed metadata and
new attachments as distinct Drive objects, verifies their bytes, rereads the
manifest before publication, then updates the manifest. That existing mechanism
avoids Web itself overwriting old metadata during staging. Keep it.

However, a later Android push updates those same committed IDs. The Web recovery
generation JSON saves the previous manifest and candidate revision, not independent
copies of all old object bytes. It therefore cannot guarantee restoration after
Android overwrites or deletes the referenced objects.

Additional Web risks identified during the narrow trace, not fixed or fully
fault-tested in this paused pass:

- `committed` is set only after the manifest write returns. A server-accepted
  write with a lost response can enter the uncommitted cleanup path and request
  deletion of staged objects now referenced by the manifest. Publication
  uncertainty must be resolved without deleting those objects.
- `repairManifestEntries` chooses a replacement missing ID by filename, optional
  size and modified time. That selection alone is not identity or checksum proof.
- The writer's metadata downloader rejects a size mismatch before checking the
  hash, unlike the existing checksum-proven legacy-size policy in restore.
- A pre-publication reread is not a lock against Android writing after that read.

No cleanup or live backup was run. Nothing in Google Drive was deleted, moved,
uploaded, or otherwise modified during this investigation.

## Official Drive operations reviewed

Google documents file-level updates and revision retention, not an atomic commit
of an entire set of MyVault files:

- [files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
  updates one file's content/metadata.
- [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
  describes `version` as a read-only counter for one file, not a vault revision.
- [Manage revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions)
  explains that unretained old blob revisions can be purged. Downloadable retained
  revisions require their own identity and retention handling.

The current manifest names file IDs and hashes, not revision IDs. Neither current
client downloads committed metadata by an explicit historical revision. Do not
assume Drive history silently repairs the contract or relax checksum checks.

The reviewed v3 reference does not establish a tested conditional upload contract
for these clients. No live `If-Match`/ETag test was performed. Support is unresolved,
not declared impossible. Even a conditional manifest write would not undo a
previous in-place metadata overwrite. Browser locks cannot lock Android.

## Startup and editing trace: unchanged, not accepted

Current flow: `Layout` calls `useGoogleDriveConnection`; `initializing`/`renewing`
replace the full layout with the backup-check screen. The hook normally waits
through account verification, discovery, download, validation and safe pull before
publishing the ready state. Multiple hook instances own separate UI state, while
automatic refresh promises have only a module-level account-keyed deduplicator.
Manual metadata restore does not enter the writer's account sync lock.

Requested final flow remains pending: account-correct shell/cache, background
check, pinned manifest download, validation, staged update, transaction-boundary
edit-generation recheck, safe apply, truthful nonblocking status. Do not merely
remove the full-screen gate before protecting editing during download/apply.

The current preserving-restore transaction writes metadata/base while retaining
overlay stores. Its pending counts are not an in-memory editor-generation guard.
Backup completion clears overlay stores after an asynchronous journal read when
no remaining operations were observed. The narrow trace did not establish safety
for an edit arriving between that read and the clear transactions. These races
still require regression tests and Web-only correction after the boundary decision.

No startup timing improvement, in-flight typing safety, or full account-switch
guarantee is claimed. Baseline screenshot:
`/tmp/myvault-backup-baseline-20260905.png`, inspected, uses mocked identity and is
only an existing Settings-screen test artifact, not evidence of faster startup.

## Test and deployment record

Passed at the unchanged production source:

- Complete `pnpm run build` with `PORT=18899 BASE_PATH=/`, including typechecks and
  production workspace builds. Existing sourcemap and large-chunk warnings remain.
- `verify:workspace`, `verify:sync`, `verify:drive-auth`.
- `verify:sync-browser` in fresh, isolated actual Chrome contexts at
  `http://localhost:18899`, using mocked Drive and synthetic browser data.
- New publication-boundary fault model. See the acceptance matrix for exclusions.

Existing deployment: Vercel project `myvault-web`; `vercel.json` defines the build
and `artifacts/myvault-web/dist/public` output. Production URL:
`https://myvault-web.vercel.app`. No manual deployment or production acceptance
was performed. A Git integration may rebuild unchanged runtime source when the
evidence commit is pushed; that is not a deployed remediation.

No service-worker registration was found in the inspected app entry points.
Comprehensive production cache/deployment identity verification remains pending.

## Smallest requested approval

Permit a narrowly scoped Android backup-writer correction to stage changed
metadata/attachment bytes under new object IDs, verify them, and retain existing
committed objects rather than overwrite or delete them. Keep the current v1
manifest fields, logical filenames, folder layout, note IDs, encryption behavior,
OAuth and Room unchanged. Reuse exact unchanged bytes only with valid identity
and hash evidence. Do not introduce automatic pruning.

This is an Android algorithm change, so it has NOT been made. It addresses the
interrupted-publication blocker, not every simultaneous-writer race. Manifest
publication uncertainty/concurrency still needs a bounded, verified solution and
must not be marketed as a global transaction.

After approval, resume the already-authorized Web startup, staging, editor-race,
integrity and account fixes; retain existing reconciliation; then run three real
handoff cycles. If Android must remain read-only, narrow acceptance explicitly to
Web preserving local data and reporting a damaged/interrupted Android backup,
not making all requested failure cases reliable.

## Data safety and recovery

Only `aahforex@gmail.com` is authorized for future live tests. No actual Google
identity or disposable Android installation was authenticated for this pass.
The primary phone/account were not used. Before a destructive test, export the
disposable local vault and copy its actual manifest plus referenced object bytes.
Do not use a manifest-only copy as a safety backup. Never lower hash checks or
upload stale data to force past a restore warning.

Code rollback: recover the starting source from the pushed recovery tag only on
explicit request. No rollback, stash, reset, or data restoration was performed.

## Project log

1. Confirmed clean Web baseline and fixed read-only Android reference; pushed tag.
2. Passed existing build/typecheck/contract/browser baselines.
3. Traced startup ownership and backup publication.
4. Reproduced interrupted object overwrite with the actual Web checksum validator.
5. Added reproducible evidence and acceptance matrix; paused under sections 2,
   12 and 20 of the request. Production changes and live cloud tests are pending.
