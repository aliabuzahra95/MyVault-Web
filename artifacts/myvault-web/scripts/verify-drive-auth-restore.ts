import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getGoogleDriveStartupAction } from "../src/lib/googleDrive/authPolicy";
import { createSingleFlight } from "../src/lib/googleDrive/singleFlight";
import { retryOnceAfterAuthFailure } from "../src/lib/googleDrive/authRetry";
import { stageVerifiedMetadataRestore, sha256Blob, verifyDriveManifestFiles } from "../src/lib/restore/verifiedDriveRestore";
import type { DriveSyncManifest, DriveSyncManifestEntry } from "../src/lib/restore/driveManifestPreview";
import { representativeAndroidBackup } from "./fixtures/representative-android-backup";
import { handleGoogleDriveAuthRequest } from "../../../api/_googleDriveSession";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  sessionSecret: process.env.MYVAULT_GOOGLE_SESSION_SECRET,
};
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.MYVAULT_GOOGLE_SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";

let refreshedAccountId = "permission-account-a";
let tokenError: string | null = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://oauth2.googleapis.com/token") {
    if (tokenError) {
      return Response.json({ error: tokenError, error_description: "The durable grant is no longer valid." }, { status: 400 });
    }
    const form = new URLSearchParams(init?.body?.toString());
    if (form.get("grant_type") === "authorization_code") {
      assert.equal(form.get("redirect_uri"), "postmessage");
      return Response.json({
        access_token: "initial-access-token",
        expires_in: 3600,
        refresh_token: "server-only-refresh-token",
        scope: "https://www.googleapis.com/auth/drive.file",
      });
    }
    assert.equal(form.get("refresh_token"), "server-only-refresh-token");
    return Response.json({
      access_token: "renewed-access-token",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/drive.file",
    });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/about")) {
    return Response.json({ user: { permissionId: refreshedAccountId } });
  }
  throw new Error(`Unexpected authentication fetch: ${url}`);
};

try {
  const connectResponse = await handleGoogleDriveAuthRequest(new Request("http://localhost/api/google-drive-auth", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ code: "authorization-code" }),
  }));
  assert.equal(connectResponse.status, 200);
  const connectBody = await connectResponse.json() as Record<string, unknown>;
  assert.equal(connectBody.accessToken, "initial-access-token");
  assert.equal(connectBody.accountId, "permission-account-a");
  assert.equal("refreshToken" in connectBody, false, "The refresh credential must never reach browser JavaScript.");
  const sessionCookie = connectResponse.headers.get("set-cookie");
  assert.ok(sessionCookie?.includes("HttpOnly"));
  assert.ok(sessionCookie?.includes("SameSite=Lax"));
  assert.equal(sessionCookie?.includes("server-only-refresh-token"), false, "The cookie must contain only sealed session data.");
  const cookieValue = sessionCookie!.split(";")[0];

  const restoredResponse = await handleGoogleDriveAuthRequest(new Request("http://localhost/api/google-drive-auth", {
    headers: { origin: "http://localhost", cookie: cookieValue },
  }));
  assert.equal(restoredResponse.status, 200);
  const restoredBody = await restoredResponse.json() as Record<string, unknown>;
  assert.equal(restoredBody.accessToken, "renewed-access-token");
  assert.equal(restoredBody.accountId, "permission-account-a");

  refreshedAccountId = "permission-account-b";
  const mismatchResponse = await handleGoogleDriveAuthRequest(new Request("http://localhost/api/google-drive-auth", {
    headers: { origin: "http://localhost", cookie: cookieValue },
  }));
  assert.equal(mismatchResponse.status, 401);
  assert.match(mismatchResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);

  refreshedAccountId = "permission-account-a";
  tokenError = "invalid_grant";
  const invalidGrantResponse = await handleGoogleDriveAuthRequest(new Request("http://localhost/api/google-drive-auth", {
    headers: { origin: "http://localhost", cookie: cookieValue },
  }));
  assert.equal(invalidGrantResponse.status, 401);
  assert.match(invalidGrantResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
} finally {
  globalThis.fetch = originalFetch;
  process.env.GOOGLE_OAUTH_CLIENT_ID = originalEnvironment.clientId;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalEnvironment.clientSecret;
  process.env.MYVAULT_GOOGLE_SESSION_SECRET = originalEnvironment.sessionSecret;
}

assert.equal(getGoogleDriveStartupAction({ configured: false, hasUsableToken: false, previouslyAuthorized: false }), "setup-needed");
assert.equal(getGoogleDriveStartupAction({ configured: true, hasUsableToken: true, previouslyAuthorized: true }), "validate-token");
assert.equal(getGoogleDriveStartupAction({ configured: true, hasUsableToken: false, previouslyAuthorized: true }), "renew-token");
assert.equal(
  getGoogleDriveStartupAction({ configured: true, hasUsableToken: false, previouslyAuthorized: false }),
  "disconnected",
  "An intentional disconnect must suppress startup renewal.",
);

let renewalCalls = 0;
const renewSingleFlight = createSingleFlight<string>();
const renewals = Array.from({ length: 5 }, () => renewSingleFlight(async () => {
  renewalCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 5));
  return "renewed-token";
}));
assert.deepEqual(await Promise.all(renewals), Array(5).fill("renewed-token"));
assert.equal(renewalCalls, 1, "Concurrent expiry handling must own one renewal request.");
await renewSingleFlight(async () => {
  renewalCalls += 1;
  return "next-token";
});
assert.equal(renewalCalls, 2, "A completed renewal must not block a later renewal.");

let operationCalls = 0;
let retryRenewals = 0;
const retried = await retryOnceAfterAuthFailure({
  session: "expired-token",
  operation: async (session) => {
    operationCalls += 1;
    if (session === "expired-token") throw Object.assign(new Error("expired"), { status: 401 });
    return "Drive result";
  },
  renew: async () => {
    retryRenewals += 1;
    return "renewed-token";
  },
  isAuthorizationError: (error) => (error as { status?: number }).status === 401,
});
assert.equal(retried.value, "Drive result");
assert.equal(operationCalls, 2, "An expired Drive operation must retry exactly once.");
assert.equal(retryRenewals, 1, "An expired Drive operation must renew exactly once.");

async function buildFixture() {
  const source = representativeAndroidBackup();
  const blobs = new Map<string, Blob>();
  const metadataEntries: DriveSyncManifestEntry[] = [];
  for (const file of source.files) {
    const blob = new Blob([JSON.stringify(file.json)], { type: "application/json" });
    const cloudFileId = `verified-${file.fileName}`;
    blobs.set(cloudFileId, blob);
    metadataEntries.push({
      path: `metadata/${file.fileName}`,
      fileName: file.fileName,
      backupEntry: file.fileName,
      kind: "metadata",
      sha256: await sha256Blob(blob),
      size: blob.size,
      cloudFileId,
      updatedAt: 1_780_000_000_000,
    });
  }
  const fileEntries = (source.fileEntries ?? []).map((entry) => ({
    ...entry,
    sha256: entry.sha256 || "a".repeat(64),
    size: Math.max(entry.size, 0),
  }));
  const manifest: DriveSyncManifest = {
    schemaVersion: 1,
    cloudVersion: 1_780_000_000_000,
    storage: "google-drive-api",
    layout: "MyVault/metadata, MyVault/files, MyVault/manifests, MyVault/backups",
    entries: [...metadataEntries, ...fileEntries],
  };
  return { blobs, manifest };
}

const fixture = await buildFixture();
const arabicMetadata = fixture.blobs.get("verified-notes.json");
assert.ok(arabicMetadata);
const arabicText = await arabicMetadata.text();
assert.ok(arabicMetadata.size > arabicText.length, "Manifest sizes are UTF-8 bytes, never JavaScript character counts.");
const staged = await stageVerifiedMetadataRestore({
  accessToken: "test-token",
  manifest: fixture.manifest,
  download: async (_token, entry) => {
    const blob = fixture.blobs.get(entry.cloudFileId);
    assert.ok(blob, `Missing fixture blob ${entry.fileName}`);
    return blob;
  },
});
assert.equal(staged.issues.length, 0);
assert.equal(staged.files.length, representativeAndroidBackup().files.length);
const conceptCards = staged.files.find((file) => file.fileName === "course_concept_cards.json")?.json as Array<Record<string, unknown>>;
assert.equal("details" in conceptCards[0], false, "Android omits nullable concept details and Web must accept that shape.");

const listingVerification = await verifyDriveManifestFiles(
  "test-token",
  fixture.manifest,
  {
    scannedAt: new Date().toISOString(),
    rootFolder: { id: "root", name: "MyVault" },
    folders: {
      metadata: { id: "metadata", name: "metadata" },
      files: { id: "files", name: "files" },
      manifests: { id: "manifests", name: "manifests" },
      backups: { id: "backups", name: "backups" },
    },
    manifestFile: { id: "manifest", name: "sync_manifest.json" },
    ready: true,
    missingPaths: [],
  },
  async (_token, parentId) => fixture.manifest.entries
    .filter((entry) => entry.kind === (parentId === "metadata" ? "metadata" : "file"))
    .map((entry) => ({ id: entry.cloudFileId, name: entry.fileName, size: String(entry.size + 7) })),
);
assert.deepEqual(listingVerification.issues, []);
assert.ok(listingVerification.advisories.length > 0, "A stale Drive listing size is advisory until downloaded bytes are verified.");

const legacySizeFixture = await buildFixture();
const legacyProgressEntry = legacySizeFixture.manifest.entries.find((entry) => entry.fileName === "pdf_reading_progress.json");
assert.ok(legacyProgressEntry);
legacyProgressEntry.size += 11;
await stageVerifiedMetadataRestore({
  accessToken: "test-token",
  manifest: legacySizeFixture.manifest,
  download: async (_token, entry) => legacySizeFixture.blobs.get(entry.cloudFileId)!,
});

const uncheckedSizeFixture = await buildFixture();
const uncheckedProgressEntry = uncheckedSizeFixture.manifest.entries.find((entry) => entry.fileName === "pdf_reading_progress.json");
assert.ok(uncheckedProgressEntry);
uncheckedProgressEntry.size += 11;
uncheckedProgressEntry.sha256 = "";
await assert.rejects(
  stageVerifiedMetadataRestore({
    accessToken: "test-token",
    manifest: uncheckedSizeFixture.manifest,
    download: async (_token, entry) => uncheckedSizeFixture.blobs.get(entry.cloudFileId)!,
  }),
  /no checksum is available/,
  "A size mismatch without a matching checksum must remain blocking.",
);

const corruptFixture = await buildFixture();
const firstMetadata = corruptFixture.manifest.entries.find((entry) => entry.kind === "metadata");
assert.ok(firstMetadata);
firstMetadata.sha256 = "0".repeat(64);
await assert.rejects(
  stageVerifiedMetadataRestore({
    accessToken: "test-token",
    manifest: corruptFixture.manifest,
    download: async (_token, entry) => corruptFixture.blobs.get(entry.cloudFileId)!,
  }),
  /downloaded SHA-256 checksum does not match/,
  "A corrupt object must abort before restore application.",
);

const missingReference = await buildFixture();
const attachmentsEntry = missingReference.manifest.entries.find((entry) => entry.fileName === "attachments.json");
assert.ok(attachmentsEntry);
const attachments = JSON.parse(await missingReference.blobs.get(attachmentsEntry.cloudFileId)!.text()) as Array<Record<string, unknown>>;
attachments[0] = { ...attachments[0], fileEntry: "files/not-present.pdf" };
const invalidBlob = new Blob([JSON.stringify(attachments)], { type: "application/json" });
missingReference.blobs.set(attachmentsEntry.cloudFileId, invalidBlob);
attachmentsEntry.size = invalidBlob.size;
attachmentsEntry.sha256 = await sha256Blob(invalidBlob);
await assert.rejects(
  stageVerifiedMetadataRestore({
    accessToken: "test-token",
    manifest: missingReference.manifest,
    download: async (_token, entry) => missingReference.blobs.get(entry.cloudFileId)!,
  }),
  /refers to missing backup file/,
);

const multipleFailures = await buildFixture();
const conceptsEntry = multipleFailures.manifest.entries.find((entry) => entry.fileName === "course_concept_cards.json");
const progressEntry = multipleFailures.manifest.entries.find((entry) => entry.fileName === "pdf_reading_progress.json");
assert.ok(conceptsEntry && progressEntry);
const concepts = JSON.parse(await multipleFailures.blobs.get(conceptsEntry.cloudFileId)!.text()) as Array<Record<string, unknown>>;
delete concepts[0].term;
const invalidConcepts = new Blob([JSON.stringify(concepts)], { type: "application/json" });
multipleFailures.blobs.set(conceptsEntry.cloudFileId, invalidConcepts);
conceptsEntry.size = invalidConcepts.size;
conceptsEntry.sha256 = await sha256Blob(invalidConcepts);
const progress = JSON.parse(await multipleFailures.blobs.get(progressEntry.cloudFileId)!.text()) as Array<Record<string, unknown>>;
delete progress[0].attachmentId;
const invalidProgress = new Blob([JSON.stringify(progress)], { type: "application/json" });
multipleFailures.blobs.set(progressEntry.cloudFileId, invalidProgress);
progressEntry.size = invalidProgress.size;
progressEntry.sha256 = await sha256Blob(invalidProgress);
await assert.rejects(
  stageVerifiedMetadataRestore({
    accessToken: "test-token",
    manifest: multipleFailures.manifest,
    download: async (_token, entry) => multipleFailures.blobs.get(entry.cloudFileId)!,
  }),
  (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /course_concept_cards\.json row 1 has an invalid or missing term/);
    assert.match(error.message, /pdf_reading_progress\.json row 1 has an invalid or missing attachmentId/);
    return true;
  },
  "All collection compatibility errors must be reported by one preflight.",
);

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const panelSource = await readFile(`${projectRoot}/src/components/settings/google-drive-panel.tsx`, "utf8");
assert.equal(panelSource.includes("clearLocalWorkspaceData"), false, "Drive disconnect/account switch must not delete the local vault.");
const accountSource = await readFile(`${projectRoot}/src/lib/sync/accountContext.ts`, "utf8");
assert.equal(accountSource.includes("if (!hasUsableDriveSession()) return LOCAL_ACCOUNT_ID"), false, "Token expiry must not discard the remembered account namespace.");
const mockFetcherSource = await readFile(`${projectRoot}/src/mocks/mockFetcher.ts`, "utf8");
assert.equal(
  mockFetcherSource.includes('path.replace(/\\?.*/, "") === "/api/google-drive-auth"'),
  true,
  "The real Drive auth endpoint must bypass the demo-data API interceptor.",
);

console.log("Drive auth and restore contract verified: renewal is single-flight, disconnect is intentional, and corrupt restores fail before apply.");
