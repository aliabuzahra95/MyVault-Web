# PDF hardening - Web, 2026-09-07

## Acceptance status

Web implementation and local Chrome acceptance passed. Cross-platform final acceptance is **OPEN**: no Samsung was connected and no authenticated disposable Drive round-trip was performed. Do not treat this report as proof that a specific production backup has restored correctly on a phone.

## Recovery and scope

- Repository: `aliabuzahra95/MyVault-Web`; branch `main`.
- Starting commit: `d2f1f1959a7c5f0a9c90aa874227f64cff0c7f12`.
- Pushed recovery tag: `pre-pdf-hardening-20260907-web-d2f1f19`.
- Android starting commit: `3ba4153b6629f47b49ac288cb97aa733df6e0b4b`.
- Android recovery tag: `pre-pdf-hardening-20260907-android-3ba4153`.
- No backup writer, restore semantics, schema, annotation IDs/geometry representation, source-backlink records, OAuth, Drive architecture, Quran or widget code changed.
- `restoredCorpus.ts` only exposes the already-existing optional saved selected-text field to presentation. It does not extract or generate text.
- No Drive data was deleted, moved or written during this work.

## Findings and changes

The existing reader already checked account-scoped IndexedDB bytes before Drive. It was not repeatedly downloading the local test files. React-PDF's mounted Document owner nevertheless destroyed/reinitialized PDF.js on navigation away/back. The saved selected-text field was also absent from the Web presentation projection.

The reader now leases a PDF.js document keyed by account, attachment ID and SHA-256 of the actual local bytes. Two idle documents and 64 MiB of source bytes are the retention budgets, with a 60-second idle expiry. Active leases are protected until release. These are not claims of a 64 MiB cap on total PDF.js decoded memory. Replaced bytes cannot reuse the old document. Persistent bytes still use the existing IndexedDB store; restore already clears that store when applying replacement data.

The sidebar keeps desktop's right-side panel and uses a bottom panel on mobile. All/Highlights/Notes/Study links and All pages/This page filters are available. Existing selected text is displayed directly. Rectangle-only highlights use actual PDF.js raster pixels, without OCR or text inference. Notes are readable, with expansion for long notes. Study links use existing backlinks and open their linked note. Edit/delete remain secondary.

Previews share the reader document, are intersection-triggered, and use one crop render at a time. Maximum output is 560 x 360 pixels; tall crops are labelled partial. The in-memory cache retains at most 40 previews and approximately 12 MiB of encoded string storage. Keys include file identity, annotation ID, page, geometry and update time. Changed/deleted annotation entries are pruned; replaced files receive different keys. Preview failure leaves the row and exact-navigation action visible.

Clicking an annotation brings its actual region into view and briefly outlines the existing overlay. Resizing now keeps the current page instead of allowing changing page widths to move the reader to a different page. The existing five-page canvas window is retained.

An offline browser test exposed a second issue: TanStack queries for the local Library projection paused offline, so the Library showed no documents even though bytes existed. Only the Library list/detail local queries now use `networkMode: always`, with their existing generated keys. Drive operations are unchanged. Missing local bytes still reach the existing Connect/Reconnect and open path.

## Measured PDF reopening

Chrome desktop, local Vite development servers, identical disposable fixtures and script. Baseline used a detached checkout of the exact starting commit; only its local dependency-serving allowlist was adjusted. Each table entry is a single observation, not a statistical guarantee. Measurements were taken before the final heavy Android release build; later concurrent-build browser checks were slower and are not substituted into this comparison.

Times are **viewer shell / visible saved page / interactive**, milliseconds. Interactive means the requested page has drawn nonblank pixels and its page control accepts focus. All rows made zero Drive requests. Reload/restart reuse persistent bytes but must create a new PDF.js worker/document. The warm path is the clearly demonstrated improvement; cold/reload/restart results are mixed.

| PDF | Mode | Before | After |
|---|---|---:|---:|
| Small, 7.4 KB, 12 pages | First | 676 / 955 / 980 | 691 / 928 / 952 |
| Small | Warm | 89 / 318 / 326 | 82 / 120 / 136 |
| Small | Reload | 978 / 991 / 994 | 646 / 850 / 865 |
| Small | Browser restart | 906 / 1159 / 1176 | 1090 / 1227 / 1241 |
| Image-heavy, 11.8 MB | First | 701 / 1012 / 1030 | 652 / 934 / 943 |
| Image-heavy, 11.8 MB | Warm | 69 / 390 / 398 | 85 / 208 / 212 |
| Image-heavy, 11.8 MB | Reload | 626 / 877 / 888 | 755 / 978 / 983 |
| Image-heavy, 11.8 MB | Browser restart | 858 / 1151 / 1157 | 873 / 1159 / 1164 |
| Image-heavy, 23.6 MB | First | 720 / 1072 / 1079 | 676 / 947 / 962 |
| Image-heavy, 23.6 MB | Warm | 67 / 337 / 342 | 87 / 195 / 199 |
| Image-heavy, 23.6 MB | Reload | 642 / 892 / 897 | 779 / 1064 / 1074 |
| Image-heavy, 23.6 MB | Browser restart | 860 / 1178 / 1186 | 885 / 1174 / 1182 |
| 824 pages, saved page 725 | First | 844 / 1214 / 1234 | 622 / 983 / 997 |
| 824 pages | Warm | 58 / 344 / 363 | 122 / 277 / 298 |
| 824 pages | Reload | 659 / 996 / 1009 | 621 / 1058 / 1071 |
| 824 pages | Browser restart | 870 / 1240 / 1251 | 836 / 1220 / 1236 |

Warm PDF.js initialization plus content hashing was 0.0 / 9.5 / 17.2 / 0.2 ms for these fixtures, versus approximately 178-245 ms on their cold opens. Saved page 725 rendered with five active canvases, not 725 or 824 canvases. Persistent-browser restart tests reused IndexedDB bytes without Drive access. Offline SPA reopening passed; loading the entire site from a fully closed offline browser is not promised because this task does not add a service worker.

Developer timing snapshots are bounded and available as the latest `performance.getEntriesByName('myvault-pdf-open')` detail: metadata, local bytes, optional network, reader state, annotation state, shell, document init, page parsing and visible current page.

## Verification

- Full workspace typecheck and production build passed. Existing UI sourcemap warnings and large-bundle warnings remain.
- Workspace projection verification passed, including retained selected text and unchanged source bundle.
- Safe-sync contract verification passed; no backup code changed.
- `verify-pdf-hardening.mjs`: raster preview, saved text, fallback row, lazy rendering, full/long notes, Study link, exact region, 360/390/412/430/1440 widths, resize page retention, offline Library reopen, cache hit/miss, replacement identity, LRU eviction and missing-byte connection fallback.
- `measure-pdf-reopen.mjs`: four fixtures x four modes; persistent browser profiles; saved page and nonblank-pixel assertions; no Drive requests.
- Existing `verify-pdf-performance.mjs`: 824 pages, highlights saved at pages 552 and 634, saved highlight/reading position reopened, no canvas remount on save, no crash or unhandled error. Peak five canvases/text layers/annotation layers; about 22.6 MB main-thread JS heap, 16.9 MB after close. Worker/decoded-image memory is not included in this heap figure.
- `git diff --check` passed.

## Visual evidence

Chrome screenshots inspected: `/tmp/myvault-pdf-1440.png`, `/tmp/myvault-pdf-360.png`, `/tmp/myvault-pdf-390.png`, `/tmp/myvault-pdf-412.png`, `/tmp/myvault-pdf-430.png`. Source-pixel comparison inspected: `/tmp/myvault-pdf-expected-crop.png` versus `/tmp/myvault-pdf-actual-crop.png`. These use disposable annotation data on a local Islamic PDF, never a connected Drive account.

## Remaining gates and limitations

1. Samsung touch/fling acceptance and real Web backup -> Android restore remain unverified. A disconnected phone and missing authenticated disposable test session cannot be replaced by source tests.
2. No live production record/Room row comparison was made. The Android support/geometry tests and emulator presentation tests are separate evidence.
3. No new OCR, richer geometry contract, background cloud freshness protocol or offline-site installation architecture was introduced.
4. React-PDF's exported DocumentContext/LinkService paths are used to retain its annotation/link layers with the leased document. Their compatibility was built and tested against the installed React-PDF 10.4.1 / PDF.js 5.4.296; dependency upgrades should rerun the PDF browser suite.
5. No signed Android release upload was performed in this task.

## Production publication

Implementation commit `5e70b99e54615aa175853308965745dd3dd592d4` was pushed to `main` and deployed to the existing Vercel project. Deployment `dpl_EzyUyYDViwof6aVEhoZ1W5Z1EspL` reached READY and was aliased to `https://myvault-web.vercel.app`.

A fresh isolated Chrome session loaded `/library` with HTTP 200 and no page errors. It loaded `index-Dnq04cY2.js`; the deployed `pdf-document-viewer-CX6Ra8mU.js` returned HTTP 200 and contained the new partial-preview and Study-link UI. Screenshot: `/tmp/myvault-pdf-production-live.png`. This confirms publication, not an authenticated Drive restore. The publication-check browser contained no user account/data.
