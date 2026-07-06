import {
  allFolders, allNotes, personalNotes, islamicNotes,
  noteDetails, noteVersionsMap, tags, attachments,
  knowledgeTags, knowledgeTagLinks, personalHomeSnapshot,
  islamicHomeSnapshot, allSearchItems, allSearchItems as searchBase,
} from "./data";
import type { Folder, Note } from "@workspace/api-client-react";

const originalFetch = window.fetch.bind(window);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matchPath(url: string, pattern: string): Record<string, string> | null {
  const urlParts = url.replace(/\?.*/, "").split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (urlParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

function getSearchParams(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

// In-memory state layered on top of mock data
const foldersStore: Folder[] = [...allFolders];
const notesStore: Note[] = [...allNotes];

let nextId = 9000;
function uid(): string { return String(++nextId); }

export function installMockFetcher(): void {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    // Only intercept /api/* calls
    const path = url.replace(/^.*?\/api/, "/api");
    if (!path.startsWith("/api")) {
      return originalFetch(input, init);
    }

    const apiPath = path.replace(/^\/api/, "");

    // ── Health ──────────────────────────────────────────────────────────────
    if (apiPath === "/healthz" && method === "GET") {
      return jsonResponse({ status: "ok" });
    }

    // ── Folders ──────────────────────────────────────────────────────────────
    if (apiPath === "/folders" && method === "GET") {
      const sp = getSearchParams(apiPath.includes("?") ? apiPath : url);
      const workspace = sp.get("workspace");
      const mode = sp.get("mode");
      let result = foldersStore;
      if (workspace) result = result.filter(f => f.workspace === workspace);
      if (mode && mode !== "all") result = result.filter(f => f.mode === mode);
      return jsonResponse(result);
    }
    if (apiPath === "/folders" && method === "POST") {
      const body = JSON.parse(init?.body as string ?? "{}");
      const folder: Folder = { id: uid(), parentId: body.parentId ?? null, title: body.title, description: body.description ?? null, mode: body.mode ?? "study", workspace: body.workspace ?? null, orderIndex: foldersStore.length, noteCount: 0, createdAt: Date.now(), updatedAt: Date.now() };
      foldersStore.push(folder);
      return jsonResponse(folder, 201);
    }
    const folderById = matchPath(apiPath, "/folders/:id");
    if (folderById) {
      const { id } = folderById;
      const idx = foldersStore.findIndex(f => f.id === id);
      if (method === "GET") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        return jsonResponse(foldersStore[idx]);
      }
      if (method === "PATCH") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        const body = JSON.parse(init?.body as string ?? "{}");
        foldersStore[idx] = { ...foldersStore[idx], ...body, updatedAt: Date.now() };
        return jsonResponse(foldersStore[idx]);
      }
      if (method === "DELETE") {
        if (idx >= 0) foldersStore.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (apiPath === "/notes" && method === "GET") {
      const sp = getSearchParams(url);
      const folderId = sp.get("folderId");
      const isPinned = sp.get("isPinned");
      const workspace = sp.get("workspace");
      let result = notesStore;
      if (folderId) result = result.filter(n => n.folderId === folderId);
      if (isPinned === "true") result = result.filter(n => n.isPinned);
      if (workspace === "islamic_corpus") result = result.filter(n => islamicNotes.some(i => i.id === n.id));
      else if (workspace === "personal") result = result.filter(n => personalNotes.some(i => i.id === n.id));
      return jsonResponse(result);
    }
    if (apiPath === "/notes" && method === "POST") {
      const body = JSON.parse(init?.body as string ?? "{}");
      const note: Note = { id: uid(), folderId: body.folderId ?? null, parentNoteId: body.parentNoteId ?? null, title: body.title, bodyPreview: null, wordCount: 0, characterCount: 0, isPinned: false, isFolderPinned: false, orderIndex: notesStore.length, tagNames: [], createdAt: Date.now(), updatedAt: Date.now() };
      notesStore.push(note);
      return jsonResponse(note, 201);
    }
    const noteVersions = matchPath(apiPath, "/notes/:id/versions");
    if (noteVersions && method === "GET") {
      const versions = noteVersionsMap[noteVersions.id] ?? [];
      return jsonResponse(versions);
    }
    const noteTagNames = matchPath(apiPath, "/notes/:id/tags");
    if (noteTagNames) {
      if (method === "GET") {
        const note = notesStore.find(n => n.id === noteTagNames.id);
        return jsonResponse(note?.tagNames ?? []);
      }
      if (method === "PUT") {
        const body = JSON.parse(init?.body as string ?? "{}");
        const idx = notesStore.findIndex(n => n.id === noteTagNames.id);
        if (idx >= 0) notesStore[idx].tagNames = body.tagNames ?? [];
        return jsonResponse(notesStore[idx]?.tagNames ?? []);
      }
    }
    const noteBlocks = matchPath(apiPath, "/notes/:id/blocks");
    if (noteBlocks && method === "PUT") {
      const body = JSON.parse(init?.body as string ?? "{}");
      return jsonResponse(body.blocks ?? []);
    }
    const noteById = matchPath(apiPath, "/notes/:id");
    if (noteById) {
      const { id } = noteById;
      const idx = notesStore.findIndex(n => n.id === id);
      if (method === "GET") {
        const detail = noteDetails[id] ?? notesStore[idx] ?? null;
        if (!detail) return jsonResponse({ error: "Not found" }, 404);
        return jsonResponse({ ...detail, blocks: noteDetails[id]?.blocks ?? [] });
      }
      if (method === "PATCH") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        const body = JSON.parse(init?.body as string ?? "{}");
        notesStore[idx] = { ...notesStore[idx], ...body, updatedAt: Date.now() };
        return jsonResponse(notesStore[idx]);
      }
      if (method === "DELETE") {
        if (idx >= 0) notesStore.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (apiPath === "/tags" && method === "GET") {
      return jsonResponse(tags);
    }

    // ── Attachments ───────────────────────────────────────────────────────────
    if (apiPath === "/attachments" && method === "GET") {
      const sp = getSearchParams(url);
      const libraryFolderId = sp.get("libraryFolderId");
      const noteId = sp.get("noteId");
      const isPinned = sp.get("isPinned");
      let result = attachments;
      if (libraryFolderId) result = result.filter(a => a.libraryFolderId === libraryFolderId);
      if (noteId) result = result.filter(a => a.noteId === noteId);
      if (isPinned === "true") result = result.filter(a => a.isPinned);
      return jsonResponse(result);
    }
    const attachById = matchPath(apiPath, "/attachments/:id");
    if (attachById && method === "GET") {
      const a = attachments.find(x => x.id === attachById.id);
      if (!a) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse(a);
    }

    // ── Search ────────────────────────────────────────────────────────────────
    if (apiPath === "/search" || apiPath.startsWith("/search?")) {
      const sp = getSearchParams(url);
      const q = (sp.get("q") ?? "").toLowerCase();
      const workspace = sp.get("workspace");
      let items = allSearchItems.items;
      if (q) items = items.filter(i => i.title.toLowerCase().includes(q) || (i.snippet ?? "").toLowerCase().includes(q));
      if (workspace === "islamic_corpus") items = items.filter(i => islamicNotes.some(n => n.id === i.id) || (i.type === "attachment" && attachments.find(a => a.id === i.id)));
      return jsonResponse({ query: q, items });
    }

    // ── Home ──────────────────────────────────────────────────────────────────
    if (apiPath === "/home/snapshot" || apiPath.startsWith("/home/snapshot?")) {
      const sp = getSearchParams(url);
      const workspace = sp.get("workspace");
      return jsonResponse(workspace === "islamic_corpus" ? islamicHomeSnapshot : personalHomeSnapshot);
    }

    // ── Knowledge Tags ────────────────────────────────────────────────────────
    if (apiPath === "/knowledge-tags" && method === "GET") {
      return jsonResponse(knowledgeTags);
    }
    if (apiPath === "/knowledge-tags" && method === "POST") {
      const body = JSON.parse(init?.body as string ?? "{}");
      return jsonResponse({ id: uid(), name: body.name, linkCount: 0, createdAt: Date.now() }, 201);
    }
    const ktLinks = matchPath(apiPath, "/knowledge-tags/:id/links");
    if (ktLinks && method === "GET") {
      return jsonResponse(knowledgeTagLinks[ktLinks.id] ?? []);
    }

    // Unknown API route
    return jsonResponse({ error: "Not found" }, 404);
  };
}
