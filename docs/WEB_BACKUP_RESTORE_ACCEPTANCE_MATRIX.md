# Web Backup/Restore Acceptance Matrix

Updated 2026-09-05. **Web remediation deployed; mandatory live Android/Web
handoffs BLOCKED, not passed.** Independent implementation/testing continued
under the narrow Android exception and the original Web authorization.

## Source and deployment

| Item | Identity |
| --- | --- |
| Android source | `31f3c80f96db81395bd9ac69bc11025bee8c8262`, frozen-design-master-port, pushed |
| Android recovery | `recovery-android-writer-safety-20260905` -> `182282cbba582224fc697ea7146d89854830d082`, pushed/verified |
| Web starting source | `5cdc792f47f390693ddf2fde7c7b1e5d166593aa`, main |
| Web recovery | `recovery-web-writer-safety-20260905` -> starting source, pushed/verified |
| Earlier Web recovery | `recovery-web-backup-hardening-20260905` -> `59c0ba71754e99f33b567f0c6151281e01f23bf6` |
| Web tested/deployed code | `6c350fb74d38217272058eeac564660582119085`, pushed |
| Deployment | `dpl_Ewwv2DML6cv28XfD1p1HrmM87aAD`, production, READY |
| Public URL | https://myvault-web.vercel.app |
| Unique deployment | https://myvault-ghq77il9v-aliabuhassan1995-5368s-projects.vercel.app |
| Created | 2026-09-05 13:01:33 Australia/Sydney |
| Served asset | `/assets/index-vNi-LJ3N.js` |
| Asset SHA-256 | `b077523af5321358b14323907a9ed85f23ff203a9dbcd05dd7bd6f0fc417ed6a` |

The CLI deployment was issued from the clean 6c350fb checkout using the existing
linked Vercel project. Returned JSON omitted Git SHA; provenance is the recorded
clean checkout, deployment output, matching served asset and actual new code
markers in production JavaScript. Documentation-only commits follow it.
No Vercel/OAuth settings changed. Local test URL: http://localhost:18899.

## Automated checks

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Baselines/tags/scoped commits | PASS | Both tracked trees clean initially; unrelated Android artifacts untouched |
| Android full unit suite | PASS | 279 tests, zero failures/errors/skips; JBR21.0.11 |
| Android lint/debug/release R8 | PASS | Release output unsigned; no phone install |
| Android first/mid metadata failure | PASS, injected | Actual production publisher retains A manifest/bytes |
| Android changed-binary/pre-publication failure | PASS, injected | Old IDs/bytes unchanged; no incomplete publication |
| Android rejected commit/remote conflict | PASS, injected | Failure; no success timestamp |
| Android lost final response | PASS, injected | Candidate readback accepted; publish called once |
| Android commit accepted/readback unavailable | PASS, injected | Failure reported; previous success state retained; no blind replay |
| Android successful B | PASS, injected | B exact IDs/bytes verified; unchanged files reused; not Android UI restore |
| Legacy manifest missing cloud IDs | PASS, safety stop | Refused before staging duplicates; no reader migration |
| Web full typecheck/production build | PASS | Existing sourcemap/chunk warnings; no standalone lint command configured |
| Workspace/safe-sync/data preservation | PASS | Existing synthetic compatibility suites |
| Auth renewal/restore integrity | PASS | Existing mock suite; strict hash/relationship checks |
| Quran regression | PASS | All three existing suites; canonical Android asset hashes unchanged |
| Browser sync/persistence/account isolation | PASS | Actual Chrome/IndexedDB/Web writer with mocked Drive |
| Web lost publication response | PASS | Server commits B then drops response; one write, readback identifies B |
| Web staging retention | PASS | Old bytes unchanged; zero mock DELETE calls on success/failure |
| Later edit C during B upload | PASS | C pending; next backup includes C without false conflict/copy |
| Course editor typing during download | PASS | Cached note opens, typing survives, update stays staged |
| Queued autosave/guarded apply | PASS | Editor close -> durable flush -> retry safely applies |
| Unchanged manifest | PASS | Exact applied marker/base match skips metadata downloads |
| Manifest changes during download | PASS | Active local bundle unchanged; retry required |
| Generation changes before apply/settle | PASS | Stale apply aborts, stale settle false; later draft survives |
| Account switch/late autosave | PASS, bounded | A's late draft stays in A, never B |
| Another tab's editor | PASS | Shared editor lock prevents exclusive local replacement |
| Quota-style synchronous save failure | PASS, injected | Journal/generation roll back; draft retained and retry saves |
| Offline/503 startup | PASS, mocked | Cached navigation works, small error status, no endless full-screen gate |
| PDF runtime | PASS, local | 147pages/5.6MB; highlights, page note, zoom, progress/reopen; peak5canvases |
| Production fresh Chrome | PASS, unauthenticated | 1440x1000 and390x844; six routes each200; no overflow/page errors |
| git diff whitespace check | PASS | Both source scopes checked |

The historical publication-boundary script models the old defect. New Kotlin
tests execute the actual production publication control flow with injected
transport. Neither is a live Google Drive/Android UI restore.

## Startup measurements

Latest small-fixture local Chrome run: shell248ms; first metadata request351ms;
existing Course editor441ms; automated typing action148ms. Download completion,
validation, staged status and apply were asserted but not individually timed.
This is not Internet-speed or large-vault performance acceptance.

Screenshots visually inspected:
- `/tmp/myvault-background-editor-staged.png`
- `/tmp/myvault-offline-cached-shell.png`
- `/tmp/myvault-live-settings-1440.png`
- `/tmp/myvault-live-settings-390.png`

## Compatibility and remaining gates

| Requirement | Status / limit |
| --- | --- |
| Study/Course IDs, nested/root relationships | Existing fixture/projection/sync checks; repeated live gate pending |
| Arabic/English paragraphs, marks, lists, links/tables | Existing rich-text suite; Course UI typing retained Arabic/emphasis/link content |
| Sticky/concept cards/details and Android-only fields | Existing preservation suite; not exhaustive live proof |
| Attachments/annotations/segments/backlinks/progress | Fixture + local PDF runtime; no actual Android cross-platform binary/geometry acceptance |
| Missing metadata, invalid JSON/hash/relationships | Existing suites reject before local apply |
| Duplicate active manifest/missing-ID fallback | Reject ambiguity; fallback needs exact raw SHA in correct parent |
| Actual aahforex identity | BLOCKED: separate empty Chrome says Not connected / Popup window closed |
| Disposable Android with test account | BLOCKED: no verified signed-in disposable installation; primary phone not used |
| Three Android -> Web -> Android / reverse cycles | NOT RUN: requires normal UI fixtures and real Drive |
| Web-created Study/Course notes restored on Android | NOT RUN: synthetic records do not replace this gate |
| Android -> Android actual restore | NOT RUN: writer fault injection is not restore UI |
| Simultaneous Android/Web writers | NOT GUARANTEED: check-before-write has a final race window; no global CAS |
| Older Android writers | UNSAFE UNTIL UPDATED: pre-31f3c80 can overwrite referenced objects |
| Browsers without Web Locks | Conservative limit: updates stay staged |
| Large-vault parse/projection responsiveness | NOT FULLY MEASURED |
| Process death during all apply/commit windows | PARTIAL: transactions/response loss tested, not every restart window |
| Expiry/rate limit during every transfer phase | PARTIAL: existing auth and503tests only |
| Quota failure followed by browser kill | In-memory draft can be lost; warning says keep tab open and retry |
| Archived-manifest recovery UI | No new UI; exact raw manifest+objects retained, may need explicit assisted recovery |

## Safety and storage

Real Drive test mutations: **NONE**. Live created/staged objects0, storage0bytes.
No deletion, move, pruning, migration or garbage collection. No primary-account
write, phone restore/uninstall/data-clear or APK install. No backup/manifest
schema, Room/entity, restore, OAuth, encryption or hierarchy changes. Android
production edits are exactly the approved writer exception.

Future failures retain staged objects and report a lower-bound successful-create
count/bytes; lost create responses may leave uncounted objects. Old manifests and
changed generations consume storage; unchanged PDFs are reused. No cleanup is
authorized or implemented. Mock Drive objects exist only in test memory.

## Exact files changed

Android, relative to its repository:
- `app/src/main/java/com/myvault/app/data/repository/BackupRepository.kt`
- `app/src/main/java/com/myvault/app/data/sync/GoogleDriveIncrementalSyncRepository.kt`
- `app/src/main/java/com/myvault/app/data/sync/DriveBackupPublisher.kt`
- `app/src/test/java/com/myvault/app/data/sync/DriveBackupPublisherTest.kt`

Web, under `artifacts/myvault-web/`:
- `src/App.tsx`
- `src/components/layout.tsx`
- `src/hooks/useGoogleDriveConnection.ts`
- `src/hooks/useRestoredCorpus.ts`
- `src/lib/googleDrive/driveClient.ts`
- `src/lib/restore/localRestoreStore.ts`
- `src/lib/restore/verifiedDriveRestore.ts`
- `src/lib/sync/driveRefresh.ts`
- `src/lib/sync/driveWriteBack.ts`
- `src/lib/sync/editorLease.ts`
- `src/lib/sync/safePull.ts`
- `src/pages/note-detail.tsx`
- `scripts/verify-browser-sync.mjs`
- `scripts/verify-background-sync.mjs`
- `package.json` (test command only)

Web root docs: this matrix and `docs/WEB_BACKUP_RESTORE_HARDENING.md`.

## Logs and next live action

Temporary local logs:
- `/tmp/myvault-android-writer-verification.log`
- `/tmp/myvault-web-hardening-build.log`
- `/tmp/myvault-web-browser-verification.log`
- `/tmp/myvault-web-background-verification.log`
- `/tmp/myvault-web-pdf-verification.log`
- `/tmp/myvault-web-production-deploy.log`
- `/tmp/myvault-web-production-identity.json`
- `/tmp/myvault-web-live-verification.log`

Authenticate **aahforex@gmail.com only** in the isolated Chrome profile, verify
actual identity and disposable browser/Android datasets, then execute three
distinct normal-UI handoffs using the new Android writer. Preserve the test
dataset and exact manifest/objects externally first. Do not use the main phone.
See the hardening log for detailed causes, build hashes and recovery boundaries.
