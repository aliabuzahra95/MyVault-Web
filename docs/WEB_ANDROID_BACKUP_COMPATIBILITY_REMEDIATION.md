# Web Android Backup Compatibility Remediation

## Safety and scope

- Web repository start: `fc6e7fcb303f64d6a126dcb0663a93b65ada07b8`
- Recovery tag: `pre-web-android-backup-compatibility-remediation`
- Android reference before/after: `5a872867cb0491b3cd1b306448ea75594f1670fa`
- Android source, schema, serializers, manifest, Drive layout, OAuth, and existing backups were not modified.

## Root causes and changes

1. `course_concept_cards.json`: Android writes plural `details`, and `JSONObject.put("details", null)` omits the key. Web incorrectly required the key. Web now distinguishes Android-required `get*` fields from optional/defaulted `opt*` fields.
2. `attachments.json`: Web rejected a Drive listing-size mismatch before downloading the object. Listing size is now advisory; the downloaded object must still match manifest byte size and SHA-256.
3. `pdf_reading_progress.json`: manifest size is exact UTF-8 bytes, not JavaScript string characters. Fixtures and checks now use Blob/TextEncoder byte size. Downloaded bytes and SHA-256 remain mandatory.
4. Tombstones: Web previously excluded deleted notes/folders/attachments from relationship identity sets, falsely rejecting their blocks and version history. Validation now matches Android and uses the complete backup identity set.
5. PDF geometry: `pdf_annotation_geometry.json` is now a recognized Android metadata collection with parent and ordered-segment validation.
6. Preflight: metadata downloads, byte/hash checks, JSON parsing, row validation, and relationships now aggregate all compatibility errors into one `RestoreCompatibilityError` before restore can apply.

## Integrity retained

- Manifest schema/storage/path validation remains active.
- Missing Drive objects remain blocking.
- Downloaded byte-size mismatch remains blocking.
- Downloaded SHA-256 mismatch remains blocking.
- Invalid JSON, missing required collections, invalid row types, duplicate IDs, and broken references remain blocking.
- Unknown additive fields and omitted Android-optional fields are accepted.
- The unsynchronised-change guard and pre-restore recovery snapshot remain unchanged.
- IndexedDB restore and sync-base update remain atomic.

## Compatibility matrix

| Object | Android valid | Web before | Web after |
|---|---|---|---|
| manifest | v1 object | accepted | accepted, all manifest issues aggregated |
| settings | v1/defaultable object | preserved | preserved unchanged |
| courses | nullable links may be omitted | rejected omitted nullable keys | accepted |
| course concept cards | optional `arabicTerm`, `definition`, `details`, `sortOrder` | rejected absent `details` | accepted |
| legacy course folders | optional sort | over-required sort | accepted |
| legacy course notes | optional body/sort/last-opened | over-required optional values | accepted |
| course sticky notes | optional sort | over-required sort | accepted |
| folders | nullable hierarchy/description/deletion/color; mode default | over-required nullable/defaulted keys | accepted |
| folder sticky notes | required core row | accepted | accepted |
| notes | optional hierarchy/folder pin/order/deletion | over-required optional values | accepted |
| blocks | required core row | tombstone references falsely rejected | accepted against complete note set |
| tags | name row | accepted | accepted |
| note tags | note/tag cross-reference | tombstone references could fail | accepted against complete sets |
| tables | required core row | tombstone references could fail | accepted against complete note set |
| versions | sparse legacy rows valid | over-required optional snapshot fields; tombstones failed | accepted |
| attachments | nullable/defaulted location and state | over-required optional keys; listing size blocked early | accepted; bytes/hash authoritative |
| PDF progress | optional percentage | over-required percentage; UTF-8 fixture size wrong | accepted; exact byte/hash checks retained |
| PDF annotations | optional text/type/display fields | over-required optional fields | accepted |
| PDF geometry | optional additive collection | unregistered/unvalidated | recognized, validated, preserved |
| source backlinks | nullable annotation/coordinates | over-required coordinates | accepted |
| knowledge tags | required core row | accepted | accepted |
| knowledge links | required core row | accepted | accepted |

## Verification evidence

- Android-shaped fixture includes omitted nullable fields, Arabic UTF-8 data, unknown additive fields, legacy optional AI files, and multi-rectangle PDF geometry.
- A stale Drive listing-size fixture passes only after the actual downloaded bytes and SHA-256 pass.
- Corrupt bytes/checksum still abort.
- Two independently invalid collections are reported together in one preflight.
- Browser verification passed for account isolation, IndexedDB persistence, account locking, offline journalling, manifest-last write-back, and failed-upload recovery.
- Read-only mounted Android Drive backup preflight: PASS.
  - Cloud version: `1788056233336`
  - Metadata files: 22
  - Courses: 5
  - Folders: 87
  - Notes: 174
  - Blocks: 168
  - Attachments: 207
  - PDF annotations: 72
- The mounted backup was not mutated. Local Google Drive Desktop conflict suffixes were resolved read-only by checksum, not by renaming files.

## Acceptance boundary

The mounted backup belongs to `aliabuzahra95@gmail.com`, not the approved disposable `aahforex@gmail.com` account. It was therefore used only for read-only full-contract preflight. Browser IndexedDB restore, reload persistence, Web backup-after-restore, and disposable Android round trip remain unperformed until the disposable account/session is available. No destructive operation was attempted on the mounted account.
