# Web Backup/Restore Acceptance Matrix

Date: 2026-09-05. Overall: **BLOCKED at the Android publication boundary**.
This matrix does not declare the requested implementation complete.

Web runtime/source: `59c0ba71754e99f33b567f0c6151281e01f23bf6` (`main`).
Android reference: `182282cbba582224fc697ea7146d89854830d082` (read-only).
Recovery: `recovery-web-backup-hardening-20260905`, verified on origin.
Only new test/documentation files are included in this evidence checkpoint.

## Executed checks

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Web baseline clean; branch/remote/revision | PASS | Main, source/recovery identities in hardening log |
| Android unchanged | PASS | Fixed `git show` reads; no tracked edits; existing untracked artifacts left alone |
| Complete typecheck and production build | PASS | `env PORT=18899 BASE_PATH=/ pnpm run build`; pre-existing sourcemap/chunk warnings |
| Workspace projection | PASS | Existing `verify:workspace`; synthetic fixture |
| Safe-sync/rich-data contract | PASS | Existing `verify:sync`; not an Android runtime round trip |
| Auth/restore integrity contract | PASS | Existing `verify:drive-auth`; mocked auth and synthetic bytes |
| Browser account isolation/persistence/locking | PASS, bounded | Existing `verify:sync-browser`; fresh real Chrome contexts, mocked Drive |
| Browser upload/failed-upload baseline | PASS, bounded | Existing scenarios only; not response-loss or simultaneous Android publication proof |
| Original metadata snapshot validity | PASS | New publication-boundary script, actual Web validator |
| Android-style interruption after overwrite, before manifest | FAIL, reproduced in model | Same-size bytes change, unchanged manifest, production Web checksum rejection |
| Manifest-only recovery | FAIL, reproduced in model | Old manifest still points at changed bytes |
| Manifest plus external original byte copy | PASS in model | Control accepts original metadata |
| Distinct-ID staging with existing manifest fields | PASS in model | Old/new metadata snapshots both valid; no shared schema change |
| Android overwrite after a Web publication | FAIL, reproduced in model | Current Android existing-ID path invalidates Web-published generation too |

The fault-model assertions exit successfully when the unsafe state is reproduced.
That is evidence of a defect, not a passing release gate. No live Drive or Android
Kotlin execution occurs in the model. No Google credentials or user content are used.

## Pending implementation and mandatory live gates

| Requirement | Status | Reason / next verification |
| --- | --- | --- |
| Nonblocking startup | NOT IMPLEMENTED | Root cause located; paused before production changes at explicit boundary |
| Shell/local/check/download/validation/apply timings | NOT MEASURED | Baseline screenshot is not a timing result |
| Typing while download finishes | NOT VERIFIED | Add in-memory/queued-save and transactional generation regressions |
| Late autosave after restore | NOT VERIFIED | Prevent old editor callback from overwriting applied generation |
| Edit during upload | PARTIAL BASELINE ONLY | Existing journal test does not close final asynchronous-clear race |
| One automatic/manual restore owner | NOT VERIFIED | Module promise map is not full account/tab coordination |
| Account switch during every transfer/apply step | PARTIAL BASELINE ONLY | Existing isolation tests pass, all late-response races not covered |
| Manifest changes during download | NOT VERIFIED | Must pin and recheck committed snapshot with bounded retries |
| Web manifest write accepted but response lost | NOT VERIFIED, RISK IDENTIFIED | Current cleanup branch can delete newly referenced staged IDs |
| Conditional/version-aware remote publication | UNRESOLVED | Official docs reviewed; live conditional behavior not tested; per-file version is not global revision |
| Three Android -> Web -> Android cycles | NOT RUN | Protected writer blocker; no verified disposable Android/auth session |
| Reverse Android/Web cycles | NOT RUN | Same boundary |
| Web-created Study/Course notes via normal UI | NOT RUN on Android | Existing synthetic tests are not the required acceptance evidence |
| Current/legacy Course IDs and hierarchy | PARTIAL BASELINE ONLY | Existing fixture coverage; current fixed Android full reader/writer comparison pending |
| Arabic/English paragraphs, blank lines, marks, lists, tables, links | PARTIAL BASELINE ONLY | Existing safe-sync fixture passes; no current-device round trip |
| Attachments and actual binary identity | NOT VERIFIED LIVE | Metadata fixture does not validate real PDF files |
| PDF selection, all geometry segments, progress, backlinks | PARTIAL BASELINE ONLY | Synthetic preservation tests; no actual PDF round trip |
| Android-only settings, Quran/Memorise, unknown additive fields | PARTIAL BASELINE ONLY | Existing fixture preservation; exhaustive current contract audit pending |
| Duplicate filenames, missing object hash fallback | NOT FULLY VERIFIED | Writer selection by name/size/date is insufficient alone |
| Invalid JSON, corrupt checksum, omitted optional fields | PASS IN EXISTING MOCK TESTS | Full combined failure matrix remains pending |
| Missing binaries, quota, reload during commit, recovery across storage | NOT VERIFIED | Must cover both record and binary stores before acceptance |
| Auth expiry/rate limits/server failure | PARTIAL BASELINE ONLY | Existing auth retry tests; no real transfer failure testing |
| Existing UI/navigation regressions | NOT FULLY VERIFIED | No production UI changes in this pass |
| Production deployment and Chrome build identity | NOT ACCEPTED | No remediation deployed or claimed; evidence-only Git push may trigger normal rebuild |

## Artifacts and safety

- Test: `artifacts/myvault-web/scripts/verify-publication-boundary.ts`.
- Baseline Chrome screenshot: `/tmp/myvault-backup-baseline-20260905.png`, visually
  inspected; shows mock account Settings, not production account or startup fix.
- Details/reproduction/source line evidence: `WEB_BACKUP_RESTORE_HARDENING.md`.
- Test cloud account authorization: `aahforex@gmail.com`, **not authenticated or
  mutated in this pass**. Primary Google account and phone untouched.
- Google Drive writes/deletes/moves: **NONE**.
- Android source/build/configuration/schema/backup/OAuth modifications: **NONE**.
- Backup/manifest format, folder layout, credentials/scopes/encryption changes: **NONE**.

## Required decision

Approve the narrow Android writer change described in the hardening document,
or explicitly accept that Web-only work cannot guarantee previous-cloud-backup
availability after an interrupted Android overwrite. Do not bypass Web integrity
checks or treat retries as proof that the previous cloud snapshot remains intact.
