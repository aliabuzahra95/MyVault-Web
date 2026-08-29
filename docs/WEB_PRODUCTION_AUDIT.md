# MyVault Web Production Audit

Audit date: 2026-08-29 (Australia/Sydney)  
Scope: Web application only  
Mode: audit baseline plus mandatory Drive persistence and PDF performance remediation

## Executive result

The Web application builds and its implemented local/restore-backed routes render without browser exceptions under a controlled fixture. Its browser-side sync contract has meaningful safeguards for account isolation, write locking, offline journalling, three-way merge conflicts, verified uploads, and manifest-last commits.

The original audit proved three P1 issues:

1. Google Drive connection persistence ends when the short-lived access token expires because there is no refresh token or automatic reauthorization during application initialization.
2. The ordinary restore path parses metadata but does not verify each downloaded object's manifest size/SHA-256 or run the full candidate validator before replacing the browser workspace.
3. The PDF reader eagerly creates every page canvas, text layer, and annotation layer. A 500-page fixture drove the Chrome process family to about 1.9 GB RSS.

No cross-account data exposure was reproduced by the browser contract test. The implementation gaps are now remediated; real Google-account Chrome restart and destructive disposable-data restore remain release acceptance gates until the server OAuth environment is configured and exercised.

## Current remediation status

The Drive restore-integrity gap remains resolved without changing the backup format. The mandatory persistence phase additionally replaces browser token storage with a server authorization-code exchange and an encrypted HTTP-only refresh session:

- startup now restores/renews through `/api/google-drive-auth` before choosing the final Drive state;
- access tokens remain in memory and refresh credentials remain inaccessible to browser JavaScript;
- renewal re-verifies the stable Drive permission ID and fails closed on account mismatch or revoked grant;
- auth presentation distinguishes initialization, connection, renewal, reauthentication, and error states;
- concurrent token renewal is single-flight, and guarded operations attempt at most one auth renewal/retry;
- expiry and intentional disconnect no longer delete the remembered account-scoped local vault;
- account switching no longer deletes either account's local vault and does not reuse in-memory Drive discovery state;
- Restore now freshly discovers Drive state, verifies object presence/size and metadata SHA-256, validates JSON/schema/references, stages before apply, reasserts identity, and atomically commits the bundle plus sync base.

The PDF issue is also remediated. The viewer now keeps one stable document, renders a five-page window, retains lightweight placeholders, caps remembered page dimensions at 24, removes the unbounded Blob map, and contains reader errors. The reported 24,118,227-byte/1,494-page file completed two highlights, a page note, zoom, close, and reopen with five peak PDF canvases and no crash. See `docs/WEB_DRIVE_AUTH_REMEDIATION.md` and `docs/WEB_PDF_PERFORMANCE_REMEDIATION.md`.

## A. Baseline Git and build

| Item | Result |
|---|---|
| Repository | `/Users/aliah/Desktop/Current Projects/MyVault-Web` |
| Branch | `main` |
| Baseline commit for mandatory remediation | `56c4754cf4ef74779685b09cabb2037d0652f887` |
| Remote | `https://github.com/aliabuzahra95/MyVault-Web.git` |
| Local/remote state | Local `main` matched `origin/main` at baseline |
| Recovery tag | `pre-drive-pdf-remediation-20260829` |
| Tag push | Passed |
| Tracked tree before audit | Clean |
| Dependency install | `pnpm install --frozen-lockfile` passed |
| Typecheck | `pnpm run typecheck` passed |
| Unit-test command | No root or Web `test` script exists |
| Lint command | No root or Web `lint` script exists |
| Production build | Passed with `PORT=18899 BASE_PATH=/ pnpm run build` |
| Build without required environment | Failed because the Vite configuration requires `PORT` |
| Android project | Read-only contract inspection only; no Android files changed |

Build warnings were limited to source-map lookup warnings and a large main chunk (about 774 kB). The PDF viewer chunk was about 445 kB and rich-editor chunk about 414 kB.

## B. Audit coverage

The audit covered 54 user-facing capabilities and 39 technical controls, for 93 checks total.

User-facing areas:

- startup, shell, navigation, reload, Dashboard, workspace selection;
- Study folders, hierarchy, notes, local creation/edit/delete, pins, search, restored rich text;
- Library folders, imports, files, PDF open/progress/annotations/download;
- Courses, folders, notes, sticky notes, concept cards, Continue routing;
- Settings, themes, accent selection, Google Drive and sync panels;
- global Search;
- current Qur'an and Memorise route availability.

Technical controls:

- OAuth token lifecycle, storage, expiry, reconnect, disconnect, identity verification;
- account-scoped IndexedDB keys, account switching, cross-tab locking and stale-session assertions;
- Drive discovery, manifest parsing, restore, recovery snapshots, preflight, merge, upload verification, failure recovery;
- Android metadata preservation, optional-field handling, rich-text envelope handling, PDF geometry extension behavior;
- PDF fetch, Blob ownership, object URLs, PDF.js document/page lifecycle, rendering strategy, memory, scroll and close behavior;
- offline journalling, reload persistence, browser errors, type/build health.

## C. Google Drive authentication architecture

### Original implementation

- Google Identity Services OAuth token client (`initTokenClient`).
- Scope: `https://www.googleapis.com/auth/drive.file`.
- Browser implicit access-token flow with no server authorization-code exchange.
- Access token, expiry, and scope stored in plaintext localStorage under `myvault-google-drive-session`.
- No backend user session or durable refresh mechanism.

### Remediated implementation

- Google Identity Services authorization-code client (`initCodeClient`) requests a one-time code in a popup.
- `/api/google-drive-auth` exchanges that code with Google and keeps the refresh credential server-side.
- The server seals the refresh credential and expected Drive `permissionId` with AES-256-GCM in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on HTTPS).
- Browser JavaScript receives only a short-lived access token, expiry, scope, and verified Drive account ID. Access tokens remain in module memory and are never persisted.
- Startup calls the session endpoint before rendering the final Drive state. A valid cookie is refreshed and reverified without account selection.
- Renewal verifies the refreshed credential against the stored Drive `permissionId`; revoked grants, invalid credentials, and account mismatch clear the session and fail closed.
- Legacy localStorage/sessionStorage token records are removed during initialization.
- The marker `myvault-google-drive-authorized` remains a non-secret presentation hint only and is not treated as proof of connection.

### Root cause of unreliable persistence (original audit)

The connection survives reload/tab close only while the cached access token remains valid. Tokens within 60 seconds of expiry are removed. Application initialization does not request a replacement token when no valid token exists; it resets to disconnected/idle. A token request occurs only after the user initiates Connect/Restore or a document path attempts a reconnect.

This exactly explains the reported intermittent behavior: reopen within the token lifetime appears connected; reopen after expiry appears disconnected and asks the user to authenticate again.

### Initialization/state result

- Drive begins in `initializing`, not `connected` or `disconnected`.
- The final connected state is published only after server renewal and Drive identity verification succeed.
- `connected`, `renewing`, `reauth-required`, `disconnected`, and `error` remain distinct states.
- Disconnect clears the sealed server session and the non-secret browser marker. It does not claim to revoke the Google grant.

## D. Drive persistence reproduction

| Transition | Result |
|---|---|
| Startup with valid sealed session | Server refreshes, verifies expected Drive identity, then returns connected state |
| Reload/tab reopen | Restores through the server cookie; browser token persistence is not used |
| Expired access token | Single-flight server renewal obtains a new token and guarded operation retries once |
| Revoked/invalid refresh grant | Session is cleared and UI moves to reauthentication-required |
| Account mismatch on renewal | Session is cleared and request fails closed |
| Manual Connect/Reconnect | GIS code popup -> server exchange -> verified sealed session |
| Deliberate Disconnect -> reload | Server session and marker remain disconnected |
| Cross-tab authorization change | Non-secret nonce triggers session re-evaluation; access tokens are not copied between tabs |
| Browser restart | Architecture supports cookie-backed renewal; real Google Chrome restart remains an acceptance gate |

The endpoint and browser contract matrix passed for startup renewal, expiry renewal, single-flight behavior, invalid grant, account mismatch, logout, and one-retry limits. The real Google transition matrix is still pending because the deployed Vercel environment does not yet have the required matched server OAuth credentials and session secret, and the disposable identity has not yet been visibly asserted in the browser.

## E. Google account switching and isolation

### Safeguards found

- Drive `permissionId`, not email/display text, is the stable account identifier.
- IndexedDB records are prefixed by account ID.
- Account activation is serialized and guarded against token/account changes.
- Operations assert the expected token and account before and after network calls.
- Account changes clear or switch account-scoped state rather than reusing a previous preview.
- Restore rescans the manifest for the currently verified account instead of accepting a stale preview.
- Web Locks serialize same-account commits across tabs.

### Verification result

The browser sync contract passed:

- Account A metadata was not visible from Account B.
- Clearing Account A did not clear Account B.
- concurrent same-account operations were serialized;
- a stale local operation was not silently cleared;
- offline edits were retained and journalled;
- failed upload/readback did not commit the manifest.

No P0 account leak was reproduced. This is not equivalent to a real two-Google-account acceptance test; that remains mandatory after authentication is available.

## F. Backup architecture

### Format and storage

- Backup envelope: `myvault-backup`, version 1.
- Drive layout:
  - `MyVault/metadata`
  - `MyVault/files`
  - `MyVault/manifests/sync_manifest.json`
  - `MyVault/backups`
- Metadata is JSON; binary attachments/PDFs are separate Drive objects.
- Archives and Drive objects are not application-encrypted. Confidentiality depends on Google account/Drive permissions and browser/device security.
- The sync manifest records path, file name, backup entry, type, SHA-256, size, cloud ID, and update time.
- Sync is manual. Local changes are journalled in IndexedDB.
- Changed metadata is detected canonically; binary files use resumable upload above 5 MB.
- Uploads are staged, read back, checked by size/SHA-256, then committed by writing the manifest last.
- A previous manifest descriptor is retained as recovery history.
- Three-way merge is fail-closed for same-entity conflicts.

### Restore behavior

- The restore preview validates manifest shape and required metadata names.
- Restore downloads metadata first and stores binary documents for on-demand download.
- Unsynchronised local edits block destructive restore.
- A local recovery snapshot is created before replacement.
- Restored data is account-scoped.

### Proven restore integrity gap (resolved in Phase 1)

The sync/write-back download path verifies size and SHA-256. The user-facing restore hook uses JSON download directly, then checks required files/internal manifest only. It does not verify each entry's manifest size/hash and does not call `validateSyncCandidate` before saving the replacement bundle.

A parseable but truncated, stale, or altered metadata object can therefore pass the ordinary restore path if required files remain present. The pre-restore recovery snapshot reduces recoverability risk but does not make the restored candidate trustworthy.

Phase 1 replaced that path with verified in-memory staging and an atomic IndexedDB apply. The historical paragraph above is retained as the audit finding that motivated the remediation.

### Full versus metadata-only restore

The UI restores metadata and fetches file blobs later when a document is opened. This is a valid lazy strategy, but “restore complete” can be misleading: PDFs are not necessarily available offline immediately after metadata restore.

## G. Disposable Google backup/restore result

Not performed. No destructive Drive action was attempted because the exact active disposable identity could not be proven in the available browser automation context.

Required next acceptance run after manual authentication:

1. visibly confirm the disposable account;
2. record Drive `permissionId`, manifest cloud version/timestamp, entry count, and expected fixture identity;
3. export/snapshot the current browser test state;
4. restore through the production UI;
5. compare all supported entities;
6. repeat with no changes, changed metadata, interrupted upload, token expiry, and account switch.

## H. Intermittent/failure evidence

- Token-expiry behavior is deterministic, not random: the session disappears when the cached access token is no longer usable.
- Browser contract tests passed offline local journalling and failed-upload recovery.
- Restore blocks when pending local edits exist and creates a recovery snapshot.
- Write-back fails closed when upload readback differs or when a three-way merge conflicts.
- A real Drive interruption, token expiry during upload, repeated backup, refresh during restore, and stale Drive discovery remain untested without the disposable Google session.

## I. Android/Web compatibility

The current Android backup contract was inspected read-only.

### Passed

- Unknown fields on known JSON rows are retained by no-op and untouched-file flows.
- Unknown optional metadata files restored from Drive are retained by generic bundle handling and untouched three-way merges.
- Rich-text envelopes preserve recognized Android data and unknown top-level envelope fields.
- Unknown rich-text marks/members block write-back instead of being silently stripped.
- Legacy theme data is retained as raw settings JSON.
- Account-isolation and merge fixtures passed.

### PDF geometry extension

Current Android writes `pdf_annotation_geometry.json` for ordered multi-rectangle geometry. Web's declared metadata inventory and representative fixture still describe the previous 21-file Android set and do not list this new file.

A targeted audit fixture added the geometry file to an Android-origin bundle. No-change preflight reported all 25 files preserved, and untouched three-way merge retained the geometry payload exactly. Therefore Android-origin geometry is not currently proven to be lost by a no-op Web round trip.

However:

- Web-first backup initialization does not create/list the geometry file;
- candidate validation has no schema/reference checks for geometry segments;
- the compatibility fixture and comments are stale;
- Web renders only the parent representative rectangle and does not consume the ordered segments.

This is compatibility drift requiring explicit remediation tests before Android -> Web edit -> Android round-trip acceptance.

## J. PDF rendering architecture

### File lifecycle

- IndexedDB remains the durable owner of locally restored/imported PDF bytes.
- One object URL is active for the opened document and is revoked on replacement or close.
- The previous unbounded module-level Blob map has been removed.
- One stable React-PDF `Document` is keyed only by the opened file URL. Annotation, mode, and colour changes do not recreate it.

### Rendering lifecycle

- Only the current page plus two pages before and after it mount React-PDF `Page` components: five active pages maximum.
- Distant pages retain lightweight fixed-ratio placeholders so document height, page jump, and reading position remain stable.
- Canvas, text, and annotation layers exist only inside the active window. React-PDF cancels/reclaims page render work when a page leaves that window.
- IntersectionObserver owns current-page tracking; scrolling no longer scans every page rectangle on each frame.
- Page dimensions are cached with an explicit maximum of 24 entries.
- Page rendering and annotation overlays are memoized; saving an annotation updates the affected page overlay without replacing its PDF canvas.
- Viewer failures are contained by a PDF-specific error boundary rather than escaping into the application shell.

## K. Controlled large-PDF reproduction

The pre-fix measurements above proved linear growth and motivated the remediation. The post-fix harness uses the real Web route, IndexedDB attachment path, Chrome DevTools metrics, deep page jumps, two highlights, a page note, zoom, close, and reopen.

| Fixture | Size | Pages/type | Peak active PDF canvases | Peak DOM | Peak JS heap | After close |
|---|---:|---|---:|---:|---:|---|
| macOS Volume sample | 16,284 B | 1 page | 1 active page layer | 388 | 15.7 MB | PDF layers detached |
| Arabic medium | 12,362,535 B | 247 pages | 5 | 1,402 | 17.97 MB | PDF layers detached |
| WHERE IS ALLAH | 40,482,212 B | 135 pages | 5 | 954 | 17.29 MB | PDF layers detached |
| Kitab Al Iman | 16,704,585 B | 494 text pages | 5 | 2,405; 24 sampled text spans | 20.40 MB | 16.85 MB; zero attached PDF canvases/text layers |
| Reported reproducer | 24,118,227 B | 1,494 scanned pages | 5 | 6,374 | 24.05 MB | 334 DOM; 15.63 MB heap; zero attached PDF layers |

The 24,118,227-byte reproducer saved highlights on pages 1001 and 1150, saved a page note, zoomed, returned, closed, reopened, and restored its annotations with five active canvases. No freeze, page crash, reload, unhandled rejection, or application-route ejection occurred. The reopened viewer again bounded itself to five canvases.

## L. Recommended PDF architecture

Implemented: stable document ownership, five-page virtualization window, lazy text/annotation layers, render cancellation through page unmount, capped dimension cache, IndexedDB-backed Blob ownership, observer-based current-page tracking, explicit object-URL cleanup, page-local annotation updates, and PDF error containment.

The same complete interaction sequence also passed in a visible headed Google Chrome run. The final headed metrics were five canvases, 6,382 peak DOM nodes, 24.4 MB peak JavaScript heap, 334 DOM nodes and 16.2 MB heap after close, and no crash or unhandled error.

## M. Console, network, and runtime observations

- Restored-data smoke routes rendered with no page exceptions or console errors.
- Routes exercised: Dashboard, Study, restored Note, Library, Courses, Course detail, Qur'an, Search, Settings.
- Search returned the expected restored Note for `Tawakkul`.
- Existing browser sync verification passed account isolation, locking, offline journalling, manifest-last commit, and failed-upload recovery.
- No real Google network trace has yet been collected because no verified disposable account session is available in the acceptance browser.
- Vercel now exposes `/api/google-drive-auth` as the narrow server-side OAuth/session boundary. General application CRUD still uses the browser/IndexedDB `mockFetcher()` architecture; the Express API remains health-only.

## N. Feature walk results

| Area | Result |
|---|---|
| Startup/shell | Route load passes; no browser exception |
| Workspace | Defect: selection is written to localStorage but provider always initializes Islamic Corpus; shell labels are hardcoded |
| Dashboard | Restored-backed content renders; no exception in fixture |
| Study | Restored hierarchy and note routes render; local CRUD exists and is journalled |
| Note editor | Restored rich text, formatting toolbar, local save status, pin, and version listing exist |
| Advanced Note parity | Tables/attachments/favourite/relationship editing are not complete production surfaces in the current Web editor |
| Library | Restored hierarchy, local import/folder actions, PDF open/download/progress and annotations exist |
| Courses | Restored courses/detail, local folders/notes/sticky/concept actions exist |
| Qur'an | Major gap: route is explicitly a placeholder with planned controls, not a functional reader |
| Memorise | Major gap: no Web route or implementation |
| Search | Notes/files supported; folder search promised by placeholder but not rendered; file result routes to Library root rather than exact file |
| Settings | Theme/accent and Drive/sync surfaces exist; settings parity is limited |
| Offline | Local edit journalling passed synthetic browser contract |
| Reload | Restored corpus persists; workspace selection does not rehydrate |

## O. Discovered issues and severity

### P0 - data loss/account isolation

Count: **0 proven**

No cross-account leak or committed backup corruption was reproduced. Real two-account and destructive restore tests remain required before release acceptance.

### P1 - crashes/auth/backup reliability

Count at original audit: **3**
Implemented remediations: **3**
Live acceptance blockers: **1**

1. **Drive automatic renewal:** implemented with the sealed server refresh session; automated expiry, single-flight, invalid-grant, and account-mismatch tests pass. Real Google Chrome restart remains unproven until the Vercel server environment and Google OAuth production origin are configured with one matched credential set.
2. **Restore object integrity:** resolved by verified staged restore, full candidate validation, identity reassertion, recovery snapshot, and atomic apply.
3. **PDF rendering:** resolved by the five-page virtual window and bounded ownership. The reported 24 MB/1,494-page reproducer passed highlight/note/zoom/reopen without crash in automated Chrome.

### P2 - major broken/incomplete behavior

Count: **9**

1. Workspace choice does not survive reload; provider initialization ignores the stored value.
2. Workspace identity text in the shell is hardcoded to Islamic Corpus.
3. Qur'an is a placeholder rather than a functioning reader.
4. Memorise is absent.
5. Global Search does not honor its folder-search promise and file results do not deep-link to the selected document.
6. Restore completion is metadata-first while files remain on-demand, without a strong offline-readiness distinction.
7. Initial Drive status can say connected before account identity verification completes.
8. Android PDF geometry metadata inventory/fixtures/validation are stale; Web-first backups omit the additive file.
9. The Express production API implements only health while CRUD behavior is supplied by an in-browser mock/IndexedDB layer, leaving no server durability/auth boundary beyond Drive sync.

### P3 - quality/performance hardening

Count: **3**

1. No declared unit-test or lint command at root/Web package level.
2. Build requires externally supplied `PORT` and emits source-map warnings.
3. Main production bundle exceeds the Vite 500 kB warning threshold; route/chunk loading should be reviewed after correctness work.

## P. Remediation phases

### Phase 1 - Google session and account truth

- Implemented authorization-code exchange and encrypted HTTP-only refresh session.
- Implemented initialization/connected/renewing/reauthentication/error state separation.
- Implemented verified `permissionId` binding and fail-closed account mismatch handling.
- Automated endpoint/browser contracts pass.
- Pending: matched Vercel OAuth secrets, Google production origin authorization, and repeated real Chrome restart/two-account acceptance.

### Phase 2 - restore and backup reliability

- Reuse the verified metadata download path for restore.
- Enforce manifest size/SHA-256 and `validateSyncCandidate` before any replacement.
- Keep recovery snapshot and dirty-workspace guard.
- Clarify metadata restored versus files downloaded/offline ready.
- Update Android metadata inventory for `pdf_annotation_geometry.json` and add Android -> Web edit -> Android fixtures.
- Run repeated real Drive backup/restore under a visibly verified disposable account.

### Phase 3 - PDF scalability

- Implemented virtualization, lazy layers, stale-render cleanup, bounded caches, page-local annotation updates, and close disposal.
- Small, medium, image-heavy, high-page-count text, 40 MB, and the reported 24 MB/1,494-page fixture pass the automated Chrome stress matrix.
- Completed: the reported 24 MB/1,494-page fixture passed the complete interaction sequence in visible headed Google Chrome.

### Phase 4 - functional gaps

- Fix workspace rehydration and remove hardcoded identity text.
- Decide and implement the actual server/offline architecture rather than relying on production `mockFetcher` implicitly.
- Complete Search deep links and truthful result types.
- Plan Qur'an, Memorise, and advanced Note parity as explicitly scoped product work, not incidental fixes.

### Phase 5 - release regression and compatibility

- Real disposable-account Drive matrix, including account A/B isolation.
- Android -> Web -> Android round trip with all optional metadata and files.
- offline, quota, token expiry, interrupted upload/restore, stale manifest, duplicate/no-change backup.
- full feature walk, accessibility, browser matrix, large-PDF memory acceptance thresholds.

## Manual blocker

**PRODUCTION OAUTH ENVIRONMENT AND TEST ACCOUNT VERIFICATION ARE REQUIRED**

The live Vercel project currently exposes only `VITE_GOOGLE_CLIENT_ID`; it does not yet contain `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, or `MYVAULT_GOOGLE_SESSION_SECRET`. The locally available Web OAuth client is a different client ID and currently authorizes only localhost origins. A matched credential set and the production origin `https://myvault-web.vercel.app` must be configured before deployment and real Chrome restart acceptance.

Until the disposable account is visibly authenticated in a controllable browser session, destructive restore, repeated real Drive backup/restore, browser-restart identity persistence, and real Google Account A/B acceptance remain unclaimed.
