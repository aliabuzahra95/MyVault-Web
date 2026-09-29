# Gated Web Backup Graph Coordination

## Release Status

This is validated compatibility groundwork, not production enablement.
Android production code remains at the readiness-only behavior. Web graph
publication and Restore gates remain false. Nothing was pushed or deployed.
No new Android APK is needed for these Web-only runtime changes.

Starting revisions:

- Android: `8f3c34066da78a7cbeac5acd0d94c4223f270634`.
- Web: `18bc1154afadf6cdf1b4561c96bb79fb835a3c44`.
- Both recovery tags: `recovery-before-web-graph-coordination-20260929-continue`.
- Room remains 36; the only Android addition is a cross-client reader test.

## Durable Web State

IndexedDB upgrades additively from 9 to 10. Existing stores/content are retained.
Four stores hold account/lineage graph positions, frozen operations, staged
immutable bytes/receipts, and attachment fingerprints.

Published and applied positions are separate. A Restore advances only applied
position. Publication installs the verified captured canonical base and advances
publication/applied position while preserving newer local overlays.

Frozen publication intent survives browser process death. Binary/metadata/delta
objects are created first; commit is last. Every object receives exact SHA-256
and size readback verification. Duplicate intended IDs never trigger overwrite.
Local canonical state, captured-intent acknowledgements, binary destinations,
graph position and COMPLETE status commit in one IndexedDB transaction.

Acknowledgement matches captured operation IDs and captured overlay values.
Newer edits survive. Existing Web intent rows are retained until acknowledgement;
repeated edits collapse to one final logical payload, not one remote revision per
edit. Twenty edits plus two other note changes produced one delta and one commit.
The newly created note also required its direct rich-text block operation.

Restore rejects pending local changes, active unsaved editors, divergence,
invalidated proof and forks. First cold Restore requires an empty/unbound client;
an existing unbound Vault is not overwritten. Subsequent Restore applies missing
descendants without checkpoint replay. Binary replacement and canonical metadata
commit together; old bytes remain intact until the replacement is verified.
Settings are part of the canonical Web bundle and commit in that transaction.
Legacy Restore invalidates graph trust without deleting graph recovery receipts.

## Existing Behavior Safety Fixes

- Existing note metadata overlays retain canonical body, rich-text marks, links,
  unknown fields and favourite state. Truncated body previews cannot replace a
  note's actual body during rename/move.
- Reading/caching a verified PDF does not generate a user mutation.
- Actual durable byte replacement hashes/journals its attachment at write time.
- Legacy Web automatic write-back and refresh stop if a canonical graph namespace
  is visible. They cannot act as competing writers or apply stale legacy data.
- No legacy backup format or historical Drive object was rewritten.
- Graph readers accept the existing Android checkpoint shape without requiring
  the legacy mutable manifest's layout field.

The namespace barrier is fail-closed, not a production graph routing replacement.
An invisible folder under drive.file is not proof that another client has no graph.
Real production-client cross-visibility must be proved before activation.

## Verification

Disposable evidence directory:
`/Users/aliah/Documents/Codex/web-graph-coordination-20260929`.

- 125 focused Android host tests passed, no skipped tests/failures.
- Android additionally consumed the optimized real-Drive Web writer fixture.
- 30 Chromium/IndexedDB cases plus 3 outer integration checks passed: additive
  upgrade sentinel preservation, actual browser restart, and fresh-client Restore.
- 28 existing cross-client graph fixtures passed, including Unicode/canonical IDs.
- Historical checkpoint/delta and binary-descriptor suites passed.
- Four Android writer fixtures passed through Web: linear, replacement, new
  attachment and fork.
- Auth/session and legacy safe-write/restore contracts passed.
- Web typecheck and production build passed. Existing source-map/chunk-size build
  warnings remain; they are unrelated to this work.
- Android debug/release/R8 build passed; application sources were unchanged.
- Both diff checks passed.
- No Samsung or emulator runtime test was performed in this stage. Existing Room
  migrations were not modified. Browser migration/restart tests did run.

Three fresh disposable Drive namespaces were used with drive.file. The full
workflow passed before and after cache refinement. A separate provider test
proved exact duplicate-create recovery, conflicting-byte rejection and discovery
of a newly created sibling object. All 115 created objects/folders were deleted;
each disposable root subsequently returned 404.

Recorded Drive requests were 1155 + 627 + 43. Additionally, the two fixture
harvests downloaded 41 objects each, and each run made one final cleanup probe:
1910 Drive requests in total. OAuth refreshes are not Drive requests. These counts
include test setup, independent verification and cleanup, not just Backup work.
Credentials, authorization headers and request bodies were not written to logs.

## Web Provider Observations

One measured run per scenario, not a Samsung benchmark or a network SLA:

| Scenario | Before | After | Before/after requests |
| --- | ---: | ---: | ---: |
| First synthetic baseline | 94.42 s | 89.58 s | 107 / 107 |
| Zero changes | 2.57 s | 2.52 s | 5 / 5 |
| One note | 13.47 s | 10.24 s | 19 / 15 |
| Three note changes | 17.30 s | 11.31 s | 23 / 17 |
| 4096 to 8192 replacement | 22.78 s | 16.60 s | 31 / 21 |
| Attachment metadata only | 20.77 s | 12.01 s | 31 / 17 |
| New 1024-byte attachment | 27.34 s | 14.54 s | 39 / 21 |
| Cold full Restore | 166.95 s | 77.47 s | 237 / 109 |
| Already-current Restore | 12.30 s | 1.21 s | 19 / 3 |
| Two missing descendants | 48.64 s | 9.94 s | 73 / 17 |

Zero changes created no objects and read no canonical metadata payload. Already
current Restore applied no records and downloaded no binaries. One note created
one delta and one commit, with no binary upload. Replacement preserved the old
4096-byte object and resolved the new verified 8192-byte object.

The optimization is an account-bound in-memory commit-byte cache. Every discovery
still lists the immutable namespace afresh and validates it. Cached bytes are
reused only if the current provider SHA-256 and exact size match. Changed/removed
objects invalidate cache entries; fresh siblings are downloaded and validated.
The cache is never authoritative. Upload readback verification was not removed.
No Drive Changes integration or mutable head was introduced.

## Remaining Production Gates

1. Prove file visibility with the actual production Android and Web OAuth clients.
   The reusable disposable credential is a different client, although local
   configurations belong to the same Google Cloud project.
2. Finish explicit production namespace enrollment and existing-Vault baseline
   capture/activation. Internal createRoot accepts a prepared frozen full bundle;
   it must not be connected to arbitrary/unverified production input.
3. Wire coordinated manual graph Backup/Restore routing and clear status messages.
   Keep legacy backup untouched; do not create competing active authorities.
4. Resolve Force Backup/full-checkpoint reconciliation semantics. Internal Web
   targeted Restore deliberately blocks a replacement full checkpoint.
5. Review completed private staging retention and real-size Web quota behavior.
   Nonempty Web capture uses the existing canonical array bundle and relational
   validation; it is not a new per-record canonical storage system.
6. Run the final production-path disposable regression, then generate a signed
   in-place Android release for physical acceptance. The current readiness APK
   still uses legacy production Backup/Restore and is not that final release.

No real Vault rows, real MyVault Drive folder, legacy backup, production graph
baseline, signing configuration or OAuth scopes were changed during this work.
