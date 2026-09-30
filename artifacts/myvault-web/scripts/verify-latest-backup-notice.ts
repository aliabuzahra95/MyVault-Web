import assert from "node:assert/strict";
import { decideLatestBackupNotice, latestBackupNoticeStorageKey } from "../src/lib/restore/latestBackupNotice";

assert.equal(decideLatestBackupNotice("DESCENDANTS", "c10", false, null)?.status, "NEWER");
assert.equal(decideLatestBackupNotice("ALREADY_CURRENT", "c10", false, null), null);
assert.equal(decideLatestBackupNotice("DESCENDANTS", "c10", true, null)?.status, "LOCAL_CHANGES");
assert.equal(decideLatestBackupNotice("FORK", null, false, null)?.status, "BLOCKED");
assert.equal(decideLatestBackupNotice("UNSUPPORTED", null, false, null)?.status, "BLOCKED");
assert.equal(decideLatestBackupNotice("DESCENDANTS", "c10", false, "c10"), null);
assert.equal(decideLatestBackupNotice("DESCENDANTS", "c11", false, "c10")?.remoteCommitId, "c11");
assert.equal(decideLatestBackupNotice("ALREADY_CURRENT", "c11", false, "c10"), null);
assert.notEqual(latestBackupNoticeStorageKey("account-a", "lineage"), latestBackupNoticeStorageKey("account-b", "lineage"));
console.log("latest backup notice checks passed");
