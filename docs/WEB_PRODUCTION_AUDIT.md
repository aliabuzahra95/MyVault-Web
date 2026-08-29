# MyVault Web Production Audit

Audit date: 2026-08-29 (Australia/Sydney)  
Scope: Web application only  
Mode: audit, reproduction, and diagnosis; no application remediation

## Executive result

The Web application builds and its implemented local/restore-backed routes render without browser exceptions under a controlled fixture. Its browser-side sync contract has meaningful safeguards for account isolation, write locking, offline journalling, three-way merge conflicts, verified uploads, and manifest-last commits.

It is not ready to describe as fully production-reliable. Three P1 issues are proven:

1. Google Drive connection persistence ends when the short-lived access token expires because there is no refresh token or automatic reauthorization during application initialization.
2. The ordinary restore path parses metadata but does not verify each downloaded object's manifest size/SHA-256 or run the full candidate validator before replacing the browser workspace.
3. The PDF reader eagerly creates every page canvas, text layer, and annotation layer. A 500-page fixture drove the Chrome process family to about 1.9 GB RSS.

No cross-account data exposure was reproduced by the browser contract test, but real Google Account A/B and destructive Drive restore testing could not be performed because a controllable browser session with a visibly verified disposable account was unavailable.

## A. Baseline Git and build

| Item | Result |
|---|---|
| Repository | `/Users/aliah/Desktop/Current Projects/MyVault-Web` |
| Branch | `main` |
| Baseline commit | `8c4a60755164eb07b9ae0ea50cdae35fbcedb521` |
| Remote | `https://github.com/aliabuzahra95/MyVault-Web.git` |
| Local/remote state | Local `main` matched `origin/main` at baseline |
| Recovery tag | `pre-web-production-audit-20260829` |
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

### Implementation

- Google Identity Services OAuth token client (`initTokenClient`).
- Scope: `https://www.googleapis.com/auth/drive.file`.
- Browser implicit access-token flow; no server authorization-code exchange.
- No backend user session, session cookie, refresh token, or refresh-token rotation.
- Access token, expiry, and scope are stored in plaintext localStorage under `myvault-google-drive-session`.
- A legacy sessionStorage token is migrated to localStorage.
- The marker `myvault-google-drive-authorized` remembers that consent happened, but it is not a valid session.
- Drive `about` is used to verify the token and obtain the stable Google Drive `permissionId` used as the account namespace.

### Root cause of unreliable persistence

The connection survives reload/tab close only while the cached access token remains valid. Tokens within 60 seconds of expiry are removed. Application initialization does not request a replacement token when no valid token exists; it resets to disconnected/idle. A token request occurs only after the user initiates Connect/Restore or a document path attempts a reconnect.

This exactly explains the reported intermittent behavior: reopen within the token lifetime appears connected; reopen after expiry appears disconnected and asks the user to authenticate again.

### Initialization/state concerns

- Initial state labels the connection `connected` from token presence before the Drive account has been reverified. The effect later performs verification, but the initial badge can briefly overstate certainty.
- The access token in localStorage is readable by any script executing in the origin. This increases the impact of an XSS defect and should be considered when choosing the remediation architecture.
- Disconnect clears the local token/authorization marker without revoking the Google grant. This is deliberate in current code, but the UI should describe it accurately.

## D. Drive persistence reproduction

| Transition | Result |
|---|---|
| Valid cached token -> reload | Source path rehydrates token and verifies Drive identity |
| Valid cached token -> tab reopen | Supported by localStorage while token remains unexpired |
| Expired/near-expiry token -> reload | Proven disconnected fallback; token is cleared |
| Automatic silent refresh at startup | Not implemented |
| Manual Connect/Reconnect | Requests a new access token through Google Identity Services |
| Deliberate Disconnect -> reload | Local session remains disconnected |
| Cross-tab token change | Storage event refreshes session state |
| Browser restart with unexpired token | Architecture supports it; real Google browser restart not exercised |
| Browser restart after expiry | Returns disconnected; no automatic token renewal |

The real Google transition matrix was not run because the authorized disposable account could not be visibly asserted in an automatable browser context.

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

### Proven restore integrity gap

The sync/write-back download path verifies size and SHA-256. The user-facing restore hook uses JSON download directly, then checks required files/internal manifest only. It does not verify each entry's manifest size/hash and does not call `validateSyncCandidate` before saving the replacement bundle.

A parseable but truncated, stale, or altered metadata object can therefore pass the ordinary restore path if required files remain present. The pre-restore recovery snapshot reduces recoverability risk but does not make the restored candidate trustworthy.

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

- The full response is materialized as a Blob before rendering.
- The Blob may exist in IndexedDB, a module-level in-memory `Map`, and an active object URL simultaneously.
- Object URLs are revoked when replaced/unmounted.
- The module-level PDF session cache has no size bound, LRU eviction, or explicit release on close.
- A stable React-PDF `Document` is used per open viewer.

### Rendering lifecycle

- `numPages` is converted to an array containing every page number.
- Every page mounts a React-PDF `Page` immediately.
- Every page enables canvas, text layer, and annotation layer immediately.
- There is no virtual list, IntersectionObserver, visible-page window, render cancellation, or bounded canvas/page cache.
- Every scroll frame scans every mounted page element to find the nearest page, adding O(page count) layout reads.
- Zoom changes the width of every mounted page and can trigger broad rerendering.

This is the proven primary large-document bottleneck.

## K. Controlled large-PDF reproduction

Disposable synthetic files were generated outside the repository. Chrome ran headless at 1440 x 1000. RSS is the aggregate Chrome process family for the isolated profile, so it includes browser overhead and should be used comparatively rather than as a JavaScript-heap measurement.

| Fixture | Size | Pages/type | First canvas | Rendered DOM | Peak/loaded RSS | RSS after close |
|---|---:|---|---:|---:|---:|---:|
| small text | 13 KB | 10 text pages | 0.99 s | 10 pages, 11 canvases, 560 text spans, 1,390 elements | ~1,005 MB | ~966 MB |
| medium text | 121 KB | 100 text pages | 1.92 s | 100 pages, 101 canvases, 5,600 text spans, 12,010 elements | ~1,234 MB | ~1,030 MB |
| image-heavy | 35.97 MB | 18 image pages | 0.99 s | 18 canvases, no text spans | ~1,300 MB | ~1,089 MB |
| large text | 595 KB | 500 text pages | 3.14 s | 500 pages, 501 canvases, 28,000 text spans, 59,210 elements | ~1,911 MB | ~1,107 MB |

No tab crash occurred in these bounded runs and no console/page error was emitted. That does not clear the user-reported crash. The measured growth proves the reader scales with total page count and content raster cost rather than the visible viewport. A 36 MB image-heavy file and a 500-page text file both push memory sharply upward.

A same-context switching harness did not complete because the first synthetic attachment failed to reach a visible canvas within its 60-second bound. The earlier isolated open/close runs remain valid; repeated PDF switching and cache accumulation remain unverified and should be a remediation acceptance test.

## L. Recommended PDF architecture

1. Keep one PDF.js document/worker per open file.
2. Virtualize pages and mount only visible pages plus a small overscan window.
3. Lazy-render text and annotation layers with the page window.
4. Cancel obsolete render tasks when pages leave the window or zoom changes.
5. Bound cached page/canvas resources and evict least-recently-used entries.
6. Replace the unbounded Blob map with a bounded cache; rely on IndexedDB for durable local blobs.
7. Cap effective render scale/device pixel ratio where necessary.
8. Use an observer/current-page index instead of scanning all page rectangles on every scroll frame.
9. Explicitly destroy document resources and clear transient caches on close/switch.
10. Retest small, scanned 20 MB+, 500-page, rapid scroll/jump/zoom, close/switch/reopen, and annotations.

## M. Console, network, and runtime observations

- Restored-data smoke routes rendered with no page exceptions or console errors.
- Routes exercised: Dashboard, Study, restored Note, Library, Courses, Course detail, Qur'an, Search, Settings.
- Search returned the expected restored Note for `Tawakkul`.
- Existing browser sync verification passed account isolation, locking, offline journalling, manifest-last commit, and failed-upload recovery.
- No real Google network trace was collected because no verified disposable account session was available.
- The production API server implements only `/api/healthz`. The Web frontend installs `mockFetcher()` and handles application API behavior in the browser/IndexedDB. The OpenAPI CRUD contract is not implemented by the Express server.

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

Count: **3**

1. **Drive connection expires without automatic renewal.** Short-lived token persistence is mistaken for session persistence; no refresh token/backend session/silent initialization recovery exists.
2. **Ordinary restore omits object integrity and full candidate validation.** It does not enforce entry size/SHA-256 or `validateSyncCandidate` before replacing local metadata.
3. **PDF rendering is unbounded.** Every page/canvas/text layer mounts eagerly and the Blob session cache is unbounded; measured RSS reached about 1.9 GB for 500 pages.

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

- Choose a supported persistent OAuth architecture: preferably authorization code + PKCE with a secure backend session/refresh handling, or a carefully tested GIS silent-reauthorization strategy.
- Do not store refresh tokens in browser JavaScript/localStorage.
- Model `connecting`, `verifying`, `connected`, `expired`, and `disconnected` separately.
- Require verified `permissionId` before displaying account-connected/backup actions.
- Run reload, reopen, browser restart, expiry, disconnect/reconnect, and two-account tests.

### Phase 2 - restore and backup reliability

- Reuse the verified metadata download path for restore.
- Enforce manifest size/SHA-256 and `validateSyncCandidate` before any replacement.
- Keep recovery snapshot and dirty-workspace guard.
- Clarify metadata restored versus files downloaded/offline ready.
- Update Android metadata inventory for `pdf_annotation_geometry.json` and add Android -> Web edit -> Android fixtures.
- Run repeated real Drive backup/restore under a visibly verified disposable account.

### Phase 3 - PDF scalability

- Virtualize pages, lazy layers, cancel stale renders, bound caches, and dispose resources.
- Profile scanned/image-heavy, high-page-count, repeated switching, jump, zoom, annotations, and close/reopen.

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

**TEST ACCOUNT AUTHENTICATION REQUIRES MANUAL GOOGLE VERIFICATION**

Until the disposable account is visibly authenticated in a controllable browser session, destructive restore, repeated real Drive backup/restore, browser-restart identity persistence, and real Google Account A/B acceptance must remain unclaimed.
