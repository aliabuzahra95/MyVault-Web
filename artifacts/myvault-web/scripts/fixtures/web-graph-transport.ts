import { GoogleDriveWebGraphTransport } from "../../src/lib/googleDrive/graphTransport";
import { rememberGoogleDriveToken, clearCachedGoogleDriveToken, getCachedGoogleDriveToken } from "../../src/lib/googleDrive/identity";
import { setActiveGoogleAccount } from "../../src/lib/sync/accountContext";
import { backupBytesSha256 } from "../../src/lib/restore/incrementalBackup";

export async function verifyGraphTransportContracts() {
  const originalFetch = globalThis.fetch;
  const previousAccount = "graph-runtime-transport";
  setActiveGoogleAccount(previousAccount);
  rememberGoogleDriveToken({ accessToken: "old-disposable-limited-grant", expiresAt: Date.now() + 900000,
    scope: "https://www.googleapis.com/auth/drive.file" });
  if (getCachedGoogleDriveToken() !== null) throw new Error("A limited old login bypassed renewed Drive visibility approval");
  const token = rememberGoogleDriveToken({ accessToken: "disposable-fixture-not-a-credential", expiresAt: Date.now() + 900000,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly" });
  const layout = { rootId: "fixture-root", lineageId: "fixture-lineage", checkpoints: "fixture-checkpoints", commits: "fixture-commits",
    deltas: "fixture-deltas", binaries: "fixture-binaries" };
  const store = new GoogleDriveWebGraphTransport({ accountId: previousAccount, token, profile: { permissionId: previousAccount } }, layout);
  let bytes = new TextEncoder().encode("immutable fixture"); let sha256 = await backupBytesSha256(bytes);
  let mediaReads = 0; let sibling = false; let removed = false; let outside = false; let multipleParents = false; let requests = 0;
  const json = (value: unknown) => Response.json(value);
  globalThis.fetch = async (input, init) => {
    requests++; const url = new URL(String(input));
    if (init?.method === "POST") return new Response(null, { status: 409 });
    if (url.pathname.endsWith("/fixture-root")) return json({ id: layout.rootId, name: "MyVault Backup Graph v1", mimeType: "application/vnd.google-apps.folder" });
    if (url.pathname.endsWith("/files")) {
      if (url.searchParams.get("q")!.includes("name = 'MyVault Backup Graph v1'")) return json({ files: [{ id: layout.rootId, name: "MyVault Backup Graph v1", mimeType: "application/vnd.google-apps.folder" }] });
      if (url.searchParams.get("q")!.includes(layout.rootId)) return json({ files: ["checkpoints", "commits", "deltas", "binaries"].map((name) => ({
        id: layout[name as keyof typeof layout], name, mimeType: "application/vnd.google-apps.folder", parents: [layout.rootId] })) });
      return json({ files: removed ? [] : ["fixture-object", ...(sibling ? ["fixture-sibling"] : [])].map((id) => ({ id, name: id,
        sha256Checksum: sha256, size: String(bytes.length), parents: [layout.commits], modifiedTime: "2026-10-04T01:00:00Z" })) });
    }
    if (url.searchParams.get("alt") === "media") { mediaReads++; return new Response(new Uint8Array(bytes)); }
    return json({ id: "fixture-object", parents: multipleParents ? [layout.commits, "not-enrolled"] : [outside ? "not-enrolled" : layout.commits] });
  };
  const check = (condition: unknown, reason: string) => { if (!condition) throw new Error(reason); };
  try {
    await store.commits(); check(mediaReads === 1, "Initial commit was not verified");
    check(store.previewScan({ current: true, remoteCommitId: "tip", commitObjectId: "fixture-object" }).verifiedGraph?.modifiedTime
      === "2026-10-04T01:00:00Z", "Graph date did not come from the verified tip receipt");
    await store.commits(); check(mediaReads === 1, "Repeated current digest re-downloaded immutable history");
    sibling = true; await store.commits(); check(mediaReads === 2, "Fresh sibling was missed by cache");
    bytes = new TextEncoder().encode("changed immutable bytes"); sha256 = await backupBytesSha256(bytes);
    await store.commits(); check(mediaReads === 4, "Changed provider digest reused stale cached bytes");
    removed = true; check((await store.commits()).length === 0, "Removed object remained authoritative in cache");
    removed = false; await store.commits(); check(mediaReads === 6, "Reappearing object bypassed verification");
    await store.create("fixture-object", "commit", bytes); check((await store.read("fixture-object"))?.length === bytes.length, "409 create could not recover exact bytes");
    outside = true; let refused = false;
    try { await store.read("fixture-object"); } catch { refused = true; }
    check(refused, "An unenrolled object was downloaded");
    outside = false; multipleParents = true; refused = false;
    const beforeMedia = mediaReads;
    try { await store.read("fixture-object"); } catch { refused = true; }
    check(refused && mediaReads === beforeMedia, "Ambiguous binary ownership bypassed the namespace guard");
    setActiveGoogleAccount("graph-runtime-other-account"); const before = requests;
    try { await store.commits(); } catch { /* Account guard must stop before any request. */ }
    check(requests === before, "Foreign account accessed cached/provider state");
  } finally {
    globalThis.fetch = originalFetch; clearCachedGoogleDriveToken();
  }
  return ["fresh digest cache still detects siblings, changed bytes and removal", "transport 409 recovery, namespace and account guards"];
}
