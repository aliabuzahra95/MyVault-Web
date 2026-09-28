# Binary Descriptor Reader Compatibility

The coordinated Android/Web checkpoint/delta extension uses manifest extension
version 2, required reader `checkpoint-delta-binaries-v1`, and version-2 deltas
with `binaries: [{ attachmentId, cloudFileId, sha256, size }]`. `size` is the exact
byte count; SHA-256 is lowercase hexadecimal. Each descriptor binds to a same-ID
attachment upsert in its own delta. Checkpoint entries/objects remain immutable.

The reader folds ordered descriptors over the checkpoint's attachment-ID map.
Metadata-only edits retain the mapping, new binary-backed attachments require a
descriptor, and exact attachment deletes remove the logical mapping. Missing,
corrupt, wrong-sized or unbound replacement objects fail closed. Web validates
the final object bytes before accepting the restore and blocks stale local-cache
or checkpoint-listing fallback. Legacy checkpoint/v1 cache behavior is unchanged.

The prior checkpoint/delta-v1 parsers explicitly reject version 2. Applications
older than checkpoint/delta support cannot be retroactively given this guard and
must upgrade before extended backups are published. Both publication gates remain
FALSE; existing manual full-array writers and legacy Restore routing are retained.

Run `scripts/verify-backup-binaries.ts` with `MYVAULT_BINARY_COMPAT_DIR` set to a
disposable fixture directory, run Android `BackupBinaryCompatibilityTest` with the
same directory, then repeat the Web script for the reverse fixture. It tests the
actual Web restore reader, immutable checkpoint entries, 4096 -> 8192 replacement,
metadata retention, new attachment, exact deletion, corrupt/missing bytes, invalid
capabilities and the actual previous Web parser's rejection.

`scripts/verify-backup-binaries-browser.mjs` additionally checks actual IndexedDB
cache verification and reload durability in a fresh browser with external requests
blocked. No authenticated Drive requests, deployment or real user data is involved.
The canonical detailed contract is Android `docs/backup/binary-descriptors-v1.md`.
