import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";

const html = readFileSync(new URL("../public/drive-visibility-check.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "standalone page script exists");
const androidBytes = new TextEncoder().encode("Disposable Android visibility proof: English العربية");
const webBytes = new TextEncoder().encode("Disposable Web visibility proof: English العربية");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(androidBytes), "313e2d87808a4aaeff71d19c010ac7689411750c7a316648716ba0875cb44199");
const rootId = "1aLk2-9E1SOLPYvLuOhG-Hu-Zo9dQ4Mku";
const androidId = "1TJcmWNIm7fSsWOT79hStp4JWFc2pe1Ga";
const webId = "DISPOSABLE_WEB_FILE_ID";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

async function scenario({ noSession = false, wrongAccount = false, androidVisible = true, uncertainCreate = false } = {}) {
  const elements = Object.fromEntries(["#run", "#copy", "#status", "#detail"].map((id) => [id, {
    disabled: false, hidden: id === "#copy", textContent: "", handler: null,
    addEventListener(_event, callback) { this.handler = callback; },
  }]));
  const storage = new Map();
  const calls = [];
  let created = false;
  let interrupted = false;
  let copied = "";
  const fetcher = async (url, options = {}) => {
    const target = new URL(url, "https://myvault-web.vercel.app");
    calls.push({ method: options.method || "GET", path: `${target.pathname}${target.search}` });
    if (target.pathname === "/api/google-drive-auth") {
      return noSession ? json({}, 401) : json({
        accessToken: "FAKE_TOKEN_DO_NOT_DISPLAY", accountId: wrongAccount ? "OTHER_ACCOUNT" : "14287589311515837545",
        scope: "https://www.googleapis.com/auth/drive.file",
      });
    }
    assert.equal(options.headers?.Authorization, "Bearer FAKE_TOKEN_DO_NOT_DISPLAY");
    if (target.pathname === "/drive/v3/about") return json({ user: { permissionId: "14287589311515837545" } });
    if (target.pathname === `/drive/v3/files/${rootId}`) return json({
      id: rootId,
      name: "MYVAULT-OAUTH-VISIBILITY-DISPOSABLE-a0cc73a0-6dc1-4878-83ad-baa7b699a0c1",
      mimeType: "application/vnd.google-apps.folder", trashed: false,
    });
    if (target.pathname === "/drive/v3/files" && !target.pathname.includes("generateIds")) {
      assert.match(target.searchParams.get("q"), /1aLk2-9E1SOLPYvLuOhG-Hu-Zo9dQ4Mku/);
      return json({ files: androidVisible ? [{ id: androidId, name: "android-proof.txt", parents: [rootId] },
        ...(created ? [{ id: webId, name: "web-proof.txt", parents: [rootId] }] : [])] : [] });
    }
    if (target.pathname === `/drive/v3/files/${androidId}`) {
      return new Response(androidBytes);
    }
    if (target.pathname === "/drive/v3/files/generateIds") return json({ ids: [webId] });
    if (target.pathname === `/drive/v3/files/${webId}` && target.searchParams.has("alt")) {
      return created ? new Response(webBytes) : json({}, 404);
    }
    if (target.pathname === `/drive/v3/files/${webId}`) {
      return created ? json({ id: webId, name: "web-proof.txt", parents: [rootId], size: String(webBytes.length) }) : json({}, 404);
    }
    if (target.pathname === "/upload/drive/v3/files") {
      assert.equal(options.method, "POST");
      const body = Buffer.from(await options.body.arrayBuffer()).toString();
      assert.ok(body.includes(`"id":"${webId}"`));
      assert.ok(body.includes(`"parents":["${rootId}"]`));
      assert.ok(body.includes("العربية"));
      created = true;
      if (uncertainCreate && !interrupted) {
        interrupted = true;
        return json({}, 503);
      }
      return json({ id: webId });
    }
    throw new Error(`Unexpected request: ${target.href}`);
  };
  const context = vm.createContext({
    document: { querySelector: (id) => elements[id] },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    crypto: { subtle: webcrypto.subtle, randomUUID },
    fetch: fetcher, TextEncoder, Uint8Array, Array, URLSearchParams, Blob, Error,
  });
  vm.runInContext(script, context);
  await elements["#run"].handler();
  return { elements, calls, storage, copied: () => copied, retry: () => elements["#run"].handler(), copy: () => elements["#copy"].handler() };
}

const success = await scenario();
assert.match(success.elements["#status"].textContent, /Success/);
assert.equal(success.calls.filter((call) => call.method === "POST").length, 1);
await success.copy();
assert.equal(JSON.parse(success.copied()).webFileId, webId);
assert.ok(!success.copied().includes("FAKE_TOKEN"));
await success.retry();
assert.equal(success.calls.filter((call) => call.method === "POST").length, 1, "retry reuses verified file");

for (const options of [{ noSession: true }, { wrongAccount: true }, { androidVisible: false }]) {
  const failed = await scenario(options);
  assert.match(failed.elements["#status"].textContent, /stopped safely/);
  assert.equal(failed.calls.filter((call) => call.method === "POST").length, 0);
}

const uncertain = await scenario({ uncertainCreate: true });
assert.match(uncertain.elements["#status"].textContent, /stopped safely/);
await uncertain.retry();
assert.match(uncertain.elements["#status"].textContent, /Success/);
assert.equal(uncertain.calls.filter((call) => call.method === "POST").length, 1);

console.log("Disposable page: success, account/session isolation, missing Android file, retry, redacted result passed.");
