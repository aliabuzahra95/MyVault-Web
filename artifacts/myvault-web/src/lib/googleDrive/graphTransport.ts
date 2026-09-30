import { BACKUP_GRAPH_NAMESPACE, verifyGraphObject, parseGraphCommit, type GraphObject } from "../restore/backupGraph";
import type { StagedGraphObject } from "../restore/webGraphStore";
import type { WebGraphTransport } from "../restore/webGraphWorkflow";
import { assertGoogleDriveSession, type VerifiedGoogleDriveSession } from "./accountSession";
import { listNamedDriveFolders, GoogleDriveRequestError, type MyVaultDriveScan } from "./driveClient";

type GraphFile = { id: string; name: string; parents?: string[]; size?: string; sha256Checksum?: string; mimeType?: string; trashed?: boolean };
export type VerifiedGraphLayout = { rootId: string; lineageId: string; checkpoints: string; commits: string; deltas: string; binaries: string };
const API = "https://www.googleapis.com/drive/v3";
const fields = "id,name,parents,size,sha256Checksum,mimeType,trashed";
const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Read-only safety barrier: visible graph data must never be overwritten by the legacy writer. */
export async function assertNoActiveGraphNamespace(accessToken: string) {
  const roots = await listNamedDriveFolders(accessToken, BACKUP_GRAPH_NAMESPACE);
  if (roots.length) throw new Error("A graph backup exists. Web Backup is disabled for this graph; use Android to back up. Local data and Drive were not changed.");
}

/** No folder creation, no mutable update and no deletion. Layout must be explicitly enrolled. */
export class GoogleDriveWebGraphTransport implements WebGraphTransport {
  readonly accountId: string;
  readonly lineageId: string;
  private readonly verifiedCommits = new Map<string, GraphObject>();
  constructor(private readonly session: VerifiedGoogleDriveSession, private readonly layout: VerifiedGraphLayout) {
    this.accountId = session.accountId; this.lineageId = layout.lineageId;
  }
  /** Existing namespaces only. Android establishes the initial production baseline. */
  static async open(session: VerifiedGoogleDriveSession): Promise<GoogleDriveWebGraphTransport | null> {
    assertGoogleDriveSession(session.token, session.accountId);
    const roots = await listNamedDriveFolders(session.token.accessToken, BACKUP_GRAPH_NAMESPACE);
    assertGoogleDriveSession(session.token, session.accountId);
    if (!roots.length) return null;
    if (roots.length !== 1) throw new Error("Multiple graph namespaces require reconciliation. No branch was selected.");
    const placeholder = new GoogleDriveWebGraphTransport(session, { rootId: roots[0].id, lineageId: "unresolved", checkpoints: "", commits: "", deltas: "", binaries: "" });
    const folders = await placeholder.listing(roots[0].id);
    const layout: VerifiedGraphLayout = { rootId: roots[0].id, lineageId: "unresolved", checkpoints: "", commits: "", deltas: "", binaries: "" };
    for (const name of ["checkpoints", "commits", "deltas", "binaries"] as const) {
      const matching = folders.filter((file) => file.name === name);
      if (matching.length !== 1 || matching[0].mimeType !== "application/vnd.google-apps.folder"
        || matching[0].parents?.length !== 1 || matching[0].parents[0] !== layout.rootId) throw new Error("Incomplete or ambiguous graph namespace.");
      layout[name] = matching[0].id;
    }
    const commits = await placeholder.listing(layout.commits);
    if (!commits.length) throw new Error("Initial graph backup is not committed yet. Wait for the original device to finish.");
    const first = commits[0]; const size = Number(first.size);
    if (!first.sha256Checksum || !Number.isSafeInteger(size) || size < 1 || size > 65536
      || first.parents?.length !== 1 || first.parents[0] !== layout.commits) throw new Error("Invalid graph commit descriptor.");
    const transport = new GoogleDriveWebGraphTransport(session, layout);
    const bytes = await transport.read(first.id); if (!bytes) throw new Error("Graph commit disappeared during discovery.");
    const object: GraphObject = { objectRef: { cloudFileId: first.id, sha256: first.sha256Checksum, size }, bytes };
    const commit = await parseGraphCommit(object);
    if (commit.accountId !== session.accountId) throw new Error("Graph belongs to a different Drive account.");
    layout.lineageId = commit.lineageId;
    const resolved = new GoogleDriveWebGraphTransport(session, layout);
    resolved.verifiedCommits.set(first.id, { objectRef: { ...object.objectRef }, bytes: bytes.slice() });
    return resolved;
  }
  assertAccount() { assertGoogleDriveSession(this.session.token, this.accountId); }
  get rootId() { return this.layout.rootId; }
  previewScan(): MyVaultDriveScan {
    return { scannedAt: new Date().toISOString(), rootFolder: { id: this.rootId, name: BACKUP_GRAPH_NAMESPACE },
      folders: { metadata: null, files: null, manifests: null, backups: null }, manifestFile: null, ready: true, missingPaths: [] };
  }
  private async request(url: string, init: RequestInit = {}) {
    this.assertAccount();
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${this.session.token.accessToken}`);
    const response = await fetch(url, { ...init, headers }); this.assertAccount(); return response;
  }
  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.request(url, init);
    if (!response.ok) throw new GoogleDriveRequestError(`Graph Drive request failed (${response.status}). No existing objects were overwritten.`, response.status);
    return response.json() as Promise<T>;
  }
  private async listing(parentId: string): Promise<GraphFile[]> {
    const result: GraphFile[] = []; let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: `'${quote(parentId)}' in parents and trashed = false`, spaces: "drive", pageSize: "1000", fields: `nextPageToken,files(${fields})` });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.json<{ files?: GraphFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
      result.push(...(page.files ?? [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }
  async verifyLayout() {
    const root = await this.json<GraphFile>(`${API}/files/${encodeURIComponent(this.layout.rootId)}?fields=${fields}`);
    if (root.trashed || root.name !== BACKUP_GRAPH_NAMESPACE || root.mimeType !== "application/vnd.google-apps.folder") throw new Error("Graph root is unavailable or changed.");
    const roots = await listNamedDriveFolders(this.session.token.accessToken, BACKUP_GRAPH_NAMESPACE);
    this.assertAccount();
    if (roots.length !== 1 || roots[0].id !== this.layout.rootId) throw new Error("Graph namespace is missing or ambiguous.");
    const children = await this.listing(this.layout.rootId);
    for (const name of ["checkpoints", "commits", "deltas", "binaries"] as const) {
      const matching = children.filter((f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder");
      if (matching.length !== 1 || matching[0].id !== this.layout[name]
        || matching[0].parents?.length !== 1 || matching[0].parents[0] !== this.layout.rootId) throw new Error("Graph namespace is ambiguous or changed.");
    }
  }
  async commits(): Promise<GraphObject[]> {
    await this.verifyLayout();
    const result: GraphObject[] = [];
    const present = new Set<string>();
    for (const file of await this.listing(this.layout.commits)) {
      const size = Number(file.size);
      if (!file.sha256Checksum || !/^[a-f0-9]{64}$/.test(file.sha256Checksum) || !Number.isSafeInteger(size) || size < 1 || size > 65536
        || file.trashed || file.mimeType === "application/vnd.google-apps.folder"
        || file.parents?.length !== 1 || file.parents[0] !== this.layout.commits) throw new Error("Invalid graph commit object receipt.");
      present.add(file.id);
      const cached = this.verifiedCommits.get(file.id);
      // A fresh provider inventory is still required. Cached bytes can only be
      // reused when Drive's current cryptographic digest and exact size agree.
      if (cached?.objectRef.sha256 === file.sha256Checksum && cached.objectRef.size === size) {
        result.push({ objectRef: { ...cached.objectRef }, bytes: cached.bytes.slice() }); continue;
      }
      const bytes = await this.read(file.id); if (!bytes) throw new Error("Graph commit disappeared during discovery.");
      const objectRef = { cloudFileId: file.id, sha256: file.sha256Checksum, size };
      await verifyGraphObject(objectRef, bytes);
      this.verifiedCommits.set(file.id, { objectRef, bytes: bytes.slice() });
      result.push({ bytes, objectRef });
    }
    for (const id of this.verifiedCommits.keys()) if (!present.has(id)) this.verifiedCommits.delete(id);
    return result;
  }
  async reserveIds(count: number): Promise<string[]> {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid immutable object count.");
    const ids: string[] = [];
    while (ids.length < count) {
      const response = await this.json<{ ids: string[] }>(`${API}/files/generateIds?space=drive&type=files&count=${Math.min(1000, count - ids.length)}`);
      if (!response.ids?.length) throw new Error("Drive did not reserve immutable object IDs."); ids.push(...response.ids);
    }
    return ids;
  }
  async read(id: string): Promise<Uint8Array | null> {
    const metadata = await this.request(`${API}/files/${encodeURIComponent(id)}?fields=${fields}`);
    if (metadata.status === 404) return null;
    if (!metadata.ok) throw new GoogleDriveRequestError(`Graph object lookup failed (${metadata.status}).`, metadata.status);
    const file = await metadata.json() as GraphFile;
    const allowed = [this.layout.checkpoints, this.layout.deltas, this.layout.commits, this.layout.binaries];
    if (file.trashed || file.mimeType === "application/vnd.google-apps.folder"
      || file.parents?.length !== 1 || !allowed.includes(file.parents[0])) throw new Error("Graph read is outside the enrolled namespace.");
    const response = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    if (!response.ok) throw new GoogleDriveRequestError(`Graph object download failed (${response.status}).`, response.status);
    const bytes = new Uint8Array(await response.arrayBuffer()); this.assertAccount(); return bytes;
  }
  async create(id: string, role: StagedGraphObject["role"], bytes: Uint8Array) {
    const parent = role === "binary" ? this.layout.binaries : role === "commit" ? this.layout.commits
      : role === "delta" ? this.layout.deltas : this.layout.checkpoints;
    const mimeType = role === "binary" ? "application/octet-stream" : "application/json";
    const metadata = JSON.stringify({ id, name: `${role}-${id}`, parents: [parent], mimeType });
    let response: Response;
    if (bytes.length <= 5 * 1024 * 1024) {
      const boundary = `myvault-graph-${crypto.randomUUID()}`;
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, new Uint8Array(bytes), `\r\n--${boundary}--\r\n`]);
      response = await this.request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    } else {
      const start = await this.request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Length": String(bytes.length), "X-Upload-Content-Type": mimeType }, body: metadata });
      if (start.status === 409) return;
      if (!start.ok) throw new GoogleDriveRequestError(`Graph upload initiation failed (${start.status}).`, start.status);
      const url = start.headers.get("Location");
      if (!url) throw new Error("Missing resumable upload location.");
      const location = new URL(url);
      if (location.origin !== "https://www.googleapis.com" || location.pathname !== "/upload/drive/v3/files"
        || location.username || location.password || location.hash) throw new Error("Unexpected resumable upload origin.");
      response = await this.request(url, { method: "PUT", headers: { "Content-Type": mimeType }, body: new Uint8Array(bytes) });
    }
    // Existing intended IDs are never updated. The caller must verify exact
    // bytes after 409 or an uncertain response before proceeding to the commit.
    if (response.status !== 409 && !response.ok) throw new GoogleDriveRequestError(`Immutable graph create failed (${response.status}).`, response.status);
  }
}
