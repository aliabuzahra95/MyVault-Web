import type { Attachment, Folder, HomeSnapshot, Note, SearchResults } from "@workspace/api-client-react";
import { loadRestoredCorpus } from "@/lib/restore/restoredCorpus";
import type { LocalPdfReaderState } from "@/lib/restore/localRestoreStore";
import {
  deleteLocalCreatedFolder,
  deleteLocalCreatedNote,
  loadLocalCreatedAttachments,
  loadLocalCreatedFolders,
  loadLocalCreatedNotes,
  loadLocalPdfReaderStates,
  isLocallyDeleted,
  saveLocalCreatedFolder,
  saveLocalCreatedNote,
} from "@/lib/restore/localRestoreStore";

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

const emptyHomeSnapshot: HomeSnapshot = {
  recentNotes: [],
  pinnedNotes: [],
  recentFolders: [],
  stats: {
    totalNotes: 0,
    totalFolders: 0,
    totalAttachments: 0,
    totalTags: 0,
    totalWordCount: 0,
  },
};

const emptySearchResults: SearchResults = { query: "", items: [] };

let nextId = 9000;
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `web-${crypto.randomUUID()}`;
  return `web-${Date.now()}-${++nextId}`;
}

function mergeById<T extends { id: string }>(base: T[], local: T[]) {
  const merged = new Map(base.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].filter((item) => !isLocallyDeleted(item));
}

export function installMockFetcher(): void {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const resolvedUrl = new URL(rawUrl, window.location.href);
    const isApiPath = resolvedUrl.pathname === "/api" || resolvedUrl.pathname.startsWith("/api/");
    if (resolvedUrl.origin !== window.location.origin || !isApiPath) {
      return originalFetch(input, init);
    }
    const url = resolvedUrl.pathname + resolvedUrl.search;
    const method = (init?.method ?? "GET").toUpperCase();

    // Only intercept /api/* calls
    const path = url;
    if (path.replace(/\?.*/, "") === "/api/google-drive-auth") {
      return originalFetch(input, init);
    }

    const apiPath = path.replace(/\?.*/, "").replace(/^\/api/, "");
    const restoredCorpus = await loadRestoredCorpus().catch(() => null);
    const [createdFolders, createdNotes, createdAttachments, readerStates]: [Folder[], Note[], Attachment[], LocalPdfReaderState[]] = await Promise.all([
      loadLocalCreatedFolders().catch(() => [] as Folder[]),
      loadLocalCreatedNotes().catch(() => [] as Note[]),
      loadLocalCreatedAttachments().catch(() => [] as Attachment[]),
      loadLocalPdfReaderStates().catch(() => [] as LocalPdfReaderState[]),
    ]);
    const readerStateByAttachment = new Map(readerStates.map((state) => [state.attachmentId, state]));
    const applyReaderState = (attachment: Attachment) => {
      const readerState = readerStateByAttachment.get(attachment.id);
      return readerState
        ? { ...attachment, readingProgressPercent: readerState.progressPercent, updatedAt: Math.max(attachment.updatedAt, readerState.updatedAt) }
        : attachment;
    };

    // ── Health ──────────────────────────────────────────────────────────────
    if (apiPath === "/healthz" && method === "GET") {
      return jsonResponse({ status: "ok" });
    }

    // ── Folders ──────────────────────────────────────────────────────────────
    if (apiPath === "/folders" && method === "GET") {
      const sp = getSearchParams(apiPath.includes("?") ? apiPath : url);
      const workspace = sp.get("workspace");
      const mode = sp.get("mode");
      let result = mergeById(restoredCorpus?.folders ?? [], createdFolders);
      if (workspace) result = result.filter(f => f.workspace === workspace);
      if (mode && mode !== "all") result = result.filter(f => f.mode === mode);
      return jsonResponse(result);
    }
    if (apiPath === "/folders" && method === "POST") {
      const body = JSON.parse(init?.body as string ?? "{}");
      const folder: Folder = { id: uid(), parentId: body.parentId ?? null, title: body.title, description: body.description ?? null, mode: body.mode ?? "study", workspace: body.workspace ?? null, orderIndex: (restoredCorpus?.folders.length ?? 0) + createdFolders.length, noteCount: 0, createdAt: Date.now(), updatedAt: Date.now() };
      await saveLocalCreatedFolder(folder);
      return jsonResponse(folder, 201);
    }
    const folderById = matchPath(apiPath, "/folders/:id");
    if (folderById) {
      const { id } = folderById;
      const folderSource = mergeById(restoredCorpus?.folders ?? [], createdFolders);
      const idx = folderSource.findIndex(f => f.id === id);
      if (method === "GET") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        return jsonResponse(folderSource[idx]);
      }
      if (method === "PATCH") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        const body = JSON.parse(init?.body as string ?? "{}");
        const updatedFolder = { ...folderSource[idx], ...body, updatedAt: Date.now() };
        await saveLocalCreatedFolder(updatedFolder);
        return jsonResponse(updatedFolder);
      }
      if (method === "DELETE") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        await deleteLocalCreatedFolder(id, folderSource[idx]);
        return new Response(null, { status: 204 });
      }
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (apiPath === "/notes" && method === "GET") {
      const sp = getSearchParams(url);
      const folderId = sp.get("folderId");
      const isPinned = sp.get("isPinned");
      let result = mergeById(restoredCorpus?.notes ?? [], createdNotes);
      if (folderId) result = result.filter(n => n.folderId === folderId);
      if (isPinned === "true") result = result.filter(n => n.isPinned);
      return jsonResponse(result);
    }
    if (apiPath === "/notes" && method === "POST") {
      const body = JSON.parse(init?.body as string ?? "{}");
      const note: Note = { id: uid(), folderId: body.folderId ?? null, parentNoteId: body.parentNoteId ?? null, title: body.title, bodyPreview: null, wordCount: 0, characterCount: 0, isPinned: false, isFolderPinned: false, orderIndex: (restoredCorpus?.notes.length ?? 0) + createdNotes.length, tagNames: [], createdAt: Date.now(), updatedAt: Date.now() };
      await saveLocalCreatedNote(note);
      return jsonResponse(note, 201);
    }
    const noteVersions = matchPath(apiPath, "/notes/:id/versions");
    if (noteVersions && method === "GET") {
      const versions = restoredCorpus?.noteVersions[noteVersions.id] ?? [];
      return jsonResponse(versions);
    }
    const noteTagNames = matchPath(apiPath, "/notes/:id/tags");
    if (noteTagNames) {
      const noteSource = mergeById(restoredCorpus?.notes ?? [], createdNotes);
      if (method === "GET") {
        const note = noteSource.find(n => n.id === noteTagNames.id);
        return jsonResponse(note?.tagNames ?? []);
      }
      if (method === "PUT") {
        const body = JSON.parse(init?.body as string ?? "{}");
        const note = noteSource.find(n => n.id === noteTagNames.id);
        if (!note) return jsonResponse({ error: "Not found" }, 404);
        const tagNames = body.tagNames ?? [];
        await saveLocalCreatedNote({ ...note, tagNames, updatedAt: Date.now() });
        return jsonResponse(tagNames);
      }
    }
    const noteBlocks = matchPath(apiPath, "/notes/:id/blocks");
    if (noteBlocks && method === "PUT") {
      return jsonResponse({ error: "Block updates must use the universal note editor so Android formatting can be preserved." }, 409);
    }
    const noteById = matchPath(apiPath, "/notes/:id");
    if (noteById) {
      const { id } = noteById;
      const noteSource = mergeById(restoredCorpus?.notes ?? [], createdNotes);
      const idx = noteSource.findIndex(n => n.id === id);
      if (method === "GET") {
        const detail = restoredCorpus?.noteDetails[id] ?? noteSource[idx] ?? null;
        if (!detail) return jsonResponse({ error: "Not found" }, 404);
        const blocks = restoredCorpus?.noteDetails[id]?.blocks ?? [];
        return jsonResponse({ ...detail, blocks });
      }
      if (method === "PATCH") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        const body = JSON.parse(init?.body as string ?? "{}");
        const updatedNote = { ...noteSource[idx], ...body, updatedAt: Date.now() };
        await saveLocalCreatedNote(updatedNote);
        return jsonResponse(updatedNote);
      }
      if (method === "DELETE") {
        if (idx < 0) return jsonResponse({ error: "Not found" }, 404);
        await deleteLocalCreatedNote(id, noteSource[idx]);
        return new Response(null, { status: 204 });
      }
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (apiPath === "/tags" && method === "GET") {
      return jsonResponse(restoredCorpus?.tags ?? []);
    }

    // ── Attachments ───────────────────────────────────────────────────────────
    if (apiPath === "/attachments" && method === "GET") {
      const sp = getSearchParams(url);
      const libraryFolderId = sp.get("libraryFolderId");
      const noteId = sp.get("noteId");
      const isPinned = sp.get("isPinned");
      let result = mergeById(restoredCorpus?.attachments ?? [], createdAttachments).map(applyReaderState);
      if (libraryFolderId) result = result.filter(a => a.libraryFolderId === libraryFolderId);
      if (noteId) result = result.filter(a => a.noteId === noteId);
      if (isPinned === "true") result = result.filter(a => a.isPinned);
      return jsonResponse(result);
    }
    const attachById = matchPath(apiPath, "/attachments/:id");
    if (attachById && method === "GET") {
      const a = mergeById(restoredCorpus?.attachments ?? [], createdAttachments).map(applyReaderState).find(x => x.id === attachById.id);
      if (!a) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse(a);
    }

    // ── Search ────────────────────────────────────────────────────────────────
    if (apiPath === "/search" || apiPath.startsWith("/search?")) {
      const sp = getSearchParams(url);
      const q = (sp.get("q") ?? "").toLowerCase();
      const folderNames = new Map(mergeById(restoredCorpus?.folders ?? [], createdFolders).map((folder) => [folder.id, folder.title]));
      const localItems: SearchResults["items"] = [
        ...createdNotes.map((note) => ({
          type: "note" as const,
          id: note.id,
          title: note.title,
          snippet: note.bodyPreview,
          folderId: note.folderId,
          folderTitle: note.folderId ? folderNames.get(note.folderId) ?? null : null,
          updatedAt: note.updatedAt,
        })),
        ...createdAttachments.map((attachment) => ({
          type: "attachment" as const,
          id: attachment.id,
          title: attachment.name,
          snippet: attachment.mimeType,
          folderId: attachment.libraryFolderId,
          folderTitle: attachment.libraryFolderId ? folderNames.get(attachment.libraryFolderId) ?? null : null,
          updatedAt: attachment.updatedAt,
        })),
      ];
      let items = mergeById(restoredCorpus?.searchResults.items ?? emptySearchResults.items, localItems);
      if (q) items = items.filter(i => i.title.toLowerCase().includes(q) || (i.snippet ?? "").toLowerCase().includes(q));
      return jsonResponse({ query: q, items });
    }

    // ── Home ──────────────────────────────────────────────────────────────────
    if (apiPath === "/home/snapshot" || apiPath.startsWith("/home/snapshot?")) {
      return jsonResponse(restoredCorpus?.homeSnapshot ?? emptyHomeSnapshot);
    }

    // ── Knowledge Tags ────────────────────────────────────────────────────────
    if (apiPath === "/knowledge-tags" && method === "GET") {
      return jsonResponse(restoredCorpus?.knowledgeTags ?? []);
    }
    if (apiPath === "/knowledge-tags" && method === "POST") {
      return jsonResponse({ error: "Knowledge-tag creation is not yet available for Android-compatible Drive backup." }, 501);
    }
    const ktLinks = matchPath(apiPath, "/knowledge-tags/:id/links");
    if (ktLinks && method === "GET") {
      return jsonResponse(restoredCorpus?.knowledgeTagLinks[ktLinks.id] ?? []);
    }

    // Unknown API route
    return jsonResponse({ error: "Not found" }, 404);
  };
}
