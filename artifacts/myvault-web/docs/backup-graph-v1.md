# Backup Graph v1: Reader Contract

Status: protocol, pure readers and disposable fixtures only. Publication is hard-disabled.
The existing full-array Backup writer and production Restore routes are unchanged.
Room stays at 34. No graph persistence, Drive transport, journal integration or UI is installed.

## Commit Schema

Canonical JSON fields, in this exact order:

```json
{
  "format": "myvault-backup-commit",
  "version": 1,
  "requiredReaders": ["backup-commit-graph-v1", "checkpoint-delta-v1"],
  "accountId": "verified-drive-permission-id",
  "lineageId": "selected-lineage-id",
  "commitId": "00000000-0000-4000-8000-000000000001",
  "kind": "delta",
  "parents": [{
    "commitId": "00000000-0000-4000-8000-000000000002",
    "cloudFileId": "immutable-parent-object",
    "sha256": "64-lowercase-hex",
    "size": 1024
  }],
  "checkpoint": {
    "checkpointId": "full-<exact-checkpoint-manifest-sha256>",
    "cloudFileId": "immutable-full-checkpoint-object",
    "sha256": "64-lowercase-hex",
    "size": 12000
  },
  "delta": {
    "deltaId": "existing-delta-id",
    "parentId": "parent-delta-head-or-checkpoint-id",
    "cloudFileId": "immutable-delta-object",
    "sha256": "64-lowercase-hex",
    "size": 800
  }
}
```

The example is indented for reading; actual commit bytes contain no whitespace.
`checkpoint` and `delta` reference existing formats, not a second mutation representation.
Initial root: `kind=checkpoint`, empty `parents`, `delta=null`.
Delta commit: exactly one parent, identical active checkpoint descriptor, delta parent matching its parent's delta head.
Later checkpoint: exactly one parent, changed checkpoint descriptor, `delta=null`; ancestry is preserved.
Multiple parents, unknown fields, unknown kinds and implicit merge semantics are rejected.
Creation timestamps/client labels are deliberately omitted: neither is needed for identity or ordering.

## Identity and Exact Bytes

- Hybrid identity from the approved design: allocate/persist a lowercase UUID once for the operation/commit. SHA-256 separately binds its bytes. IDs are not content-addressed.
- No circular self-hash field. An external receipt carries the commit's physical object ID, exact byte count and SHA-256; child parent references bind the same receipt.
- Future retries must retain the operation UUID, preallocated physical IDs and exact bytes, never rebuild an intent from newer data. This stage tests serialization/replay, not remote create retries.
- Identical duplicate receipts/commit bytes are idempotent. Different bytes under the same commit UUID or physical object ID block the graph.
- UTF-8 without BOM; no whitespace; fixed object field order as above; descriptor fields follow the displayed order.
- Strings retain Unicode without normalization. Escape only quote, backslash and JSON controls. Reject malformed UTF-8/unpaired surrogates.
- Integers use plain shortest decimal notation; no floats, exponent notation or coercion. Required-reader arrays are sorted and unique; parent arrays retain order. Null is literal `null`.
- Reader re-encoding must match the ORIGINAL bytes exactly. This rejects duplicate keys and permissive-parser ambiguities on Android as well as JavaScript.
- Commit bodies/parent receipts are limited to 64 KiB; checkpoint and delta references to 16 MiB. Existing safe-integer/binary-size validation is retained. Existing zero-length binaries are allowed.

## Discovery and Plans

`discover(commitObjects, expectedAccountId, expectedLineageId)` receives a caller-scoped immutable inventory.
Future transport must verify account identity, ownership and exact namespace membership before supplying that inventory.
Current fixtures supply byte receipts; no authentication or namespace network validation is claimed.

Discovery verifies each commit once, indexes logical/physical identities, and iteratively processes parent-to-child links.
This is O(total commit bytes + vertices + edges), with O(vertices + edges + retained metadata) memory.
It never loads checkpoints, deltas or binary bodies to discover tips.
An ancestry walk is iterative O(depth), so 10,000 commits do not overflow the call stack.

Only valid children remove a parent from the tip set. Known bad/unsupported children block automatic latest selection even when their parent is valid.
Multiple tips OR multiple roots produce `FORK`; ordinary reconstruction is unavailable and all valid branches remain indexed.
Sorting returned root/tip IDs is only for deterministic diagnostics, NEVER branch selection.
No timestamp, mutable head, index hint or listing order selects a branch.

Typed plan states: `HISTORICAL`, `SINGLE_TIP`, `ALREADY_CURRENT`, `DESCENDANTS`, `FORK`, `UNSUPPORTED`, `CORRUPT`, `MISSING_ANCESTRY`, `DIVERGENT`.
Historical selection is explicit; an empty/missing graph inventory is NOT interpreted as a historical backup or permission to seed Drive.
Missing parents, cycles, self-parent links, incorrect physical proofs, checkpoint mismatches and capability downgrades block selection.
For applied A in R/A/B/C, descendants AND incremental delta descriptors are B/C only. Applied C yields zero deltas.
An unrelated local commit yields `DIVERGENT`, never an implicit full restore.
Crossing a later checkpoint requires that checkpoint plus its subsequent deltas; old checkpoint deltas are not replayed across the boundary.

## Reconstruction

Cold reconstruction loads/verifies the selected tip's active full checkpoint, then synthesizes an ordered descriptor chain for the EXISTING checkpoint/delta validator.
It preserves the existing 4096-delta reconstruction-epoch limit and never bypasses checksums, sizes, exact IDs or parent validation.
Binary v2 deltas must declare `checkpoint-delta-binaries-v1` in the referencing commit; capabilities cannot disappear in descendants.
The existing binary resolver handles replacement, metadata-only retention, new attachments and explicit deletion.
Only final resolved binary objects are read/verified. Missing/corrupt replacement bytes fail closed; stale checkpoint fallback is forbidden.
Explicit tombstones retain their exact stable keys. Absence is never a deletion.
The result is an in-memory file/binary/deletion projection, NOT a database apply or production Restore.

Historical full-array readers remain unchanged. Graph roots identify exact full manifest bytes with `full-<SHA256>`; this stage copies/rewrites no historical objects.
Capability/version recognition does not retrofit installed legacy apps. Later graph publication MUST use the separate top-level `MyVault Backup Graph v1/<lineageId>/` namespace.
Reserved immutable directories are `checkpoints`, `commits`, `deltas`, `binaries`; no `sync_manifest.json`, mutable head or index dependency exists here.
Legacy graph-unaware clients must not participate; coordinated upgrades/enrollment are still gates.

## Disposable Verification

Two independent generators produce exact-byte/base64 fixture bundles; each client's reader consumes BOTH bundles and exports matching domain summaries.
28 cases cover the requested 15 scenarios plus account/lineage isolation, multiple roots, physical-proof/UUID conflicts, capability downgrade, duplicate keys, numeric/string versions and field order.
Shared Unicode vectors exercise Arabic, supplementary Unicode, quotes, slash/backslash, U+2028/U+2029, arrays, nulls and integers.
The 4096-byte checkpoint PDF is replaced by an 8192-byte immutable object. Both clients reject missing/corrupt replacements without reading the superseded PDF bytes.
Fixture-only graph benchmarks run at 10/100/1,000/10,000 commits; checkpoint rollovers every 1,000 retain ancestry while respecting reconstruction-epoch limits.
Heap deltas are noisy GC-dependent observations, not peak-memory bounds or Samsung measurements.

Run Web generation, Android tests, then Web verification again with the SAME disposable `MYVAULT_GRAPH_COMPAT_DIR`:

```sh
pnpm exec tsx scripts/verify-backup-graph.ts
./gradlew :app:testDebugUnitTest --tests '*BackupGraphTest'
pnpm exec tsx scripts/verify-backup-graph.ts
node scripts/verify-backup-graph-browser.mjs
```

The browser test uses a fresh isolated Chrome context and loopback-only codec harness, not the application or account storage.
No Drive requests, real Vault writes or authenticated tests occur.

## Next Gates, Not Implemented

Explicit approval is required before a disposable writer stage.
It still needs durable prepared-operation receipts, pre-generated Drive-ID create/retry proof, namespace/ownership/enrollment validation, staged dependency verification, crash/lost-ACK tests and stale concurrent writers producing retained siblings.
Journal/baseline graph binding, production restore cursors, fork UX and coordinated client release are later stages.
Index packs/bounded discovery become worthwhile as cold graphs grow: 10,000 small local commits do NOT justify 10,000 remote body downloads.
No index packs, compaction, garbage collection, background sync or live publication have been implemented.
The production 76-second preparation problem is NOT fixed by this reader-only stage.
