import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  getGetNoteQueryKey,
  getListNoteVersionsQueryKey,
  useGetNote,
  useListNoteVersions,
} from "@workspace/api-client-react";
import { NoteWorkspace, type NoteSaveStatus } from "@/components/note/note-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import {
  loadLocalNoteDraft,
  loadLocalSyncBase,
  loadMetadataRestoreBundle,
  reconcileLocalNoteDrafts,
  saveLocalNoteDraft,
  type LocalNoteDraft,
} from "@/lib/restore/localRestoreStore";
import {
  normalizeVaultRichTextDocument,
  type VaultRichTextDocument,
} from "@/lib/restore/vaultRichText";
import { recordRecentActivity } from "@/lib/recentActivity";
import { getActiveAccountId } from "@/lib/sync/accountContext";
import { acquireNoteEditorLease, retainFailedEditorSave } from "@/lib/sync/editorLease";

const emptyDocument: VaultRichTextDocument = { text: "", styleMarks: [], noteLinks: [] };

function draftSignature(draft: LocalNoteDraft) {
  return JSON.stringify({
    title: draft.title,
    richTextDocument: draft.richTextDocument,
    isPinned: draft.isPinned,
  });
}

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <NoteEditor key={`${getActiveAccountId()}:${id}`} />;
}

function NoteEditor() {
  const { id, courseId } = useParams<{ id: string; courseId?: string }>();
  const [, navigate] = useLocation();
  const [document, setDocument] = useState<VaultRichTextDocument>(emptyDocument);
  const [title, setTitle] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("loading");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedNoteId = useRef<string | null>(null);
  const editorReady = useRef(false);
  const baseCloudVersion = useRef(0);
  const baseUpdatedAt = useRef(0);
  const baseRevisionId = useRef<string | undefined>(undefined);
  const latestDraft = useRef<LocalNoteDraft | null>(null);
  const lastSavedSignature = useRef("");
  const saveRevision = useRef(0);
  const [accountId] = useState(getActiveAccountId);
  const [leaseReady, setLeaseReady] = useState(false);
  const saveQueue = useRef(Promise.resolve());

  function persistDraft(draft: LocalNoteDraft) {
    const saving = saveQueue.current.catch(() => undefined).then(() => saveLocalNoteDraft(draft, accountId));
    saveQueue.current = saving;
    return saving;
  }

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    void acquireNoteEditorLease(accountId).then((unlock) => {
      if (cancelled) { unlock(); return; }
      release = unlock;
      setLeaseReady(true);
    }).catch(() => setSaveStatus("error"));
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = latestDraft.current;
      const flush = pending && draftSignature(pending) !== lastSavedSignature.current
        ? persistDraft({ ...pending, savedAt: Date.now() }) : saveQueue.current;
      // Keep the editor lease until its last autosave is durably committed.
      void flush.then(() => release?.(), () => {
        // A failed save must not permit a restore to replace this editor's base.
        if (pending) retainFailedEditorSave(accountId, pending, release);
      });
    };
  }, [accountId]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (latestDraft.current && draftSignature(latestDraft.current) !== lastSavedSignature.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  const { data: note, isLoading } = useGetNote(id!, {
    query: {
      enabled: Boolean(id) && leaseReady,
      queryKey: [...getGetNoteQueryKey(id!), accountId],
    },
  });

  const { data: versions = [] } = useListNoteVersions(id!, {
    query: {
      enabled: Boolean(id) && leaseReady,
      queryKey: [...getListNoteVersionsQueryKey(id!), accountId],
    },
  });

  useEffect(() => {
    if (!leaseReady || !note || !id || initializedNoteId.current === id) return;
    initializedNoteId.current = id;
    editorReady.current = false;
    setLoadedNoteId(null);
    setSaveStatus("loading");
    let cancelled = false;

    void loadMetadataRestoreBundle().then(async (bundle) => {
      if (bundle) await reconcileLocalNoteDrafts(bundle);
      return Promise.all([loadLocalNoteDraft(id), Promise.resolve(bundle), loadLocalSyncBase()]);
    }).then(([draft, bundle, syncBase]) => {
      if (cancelled) return;

      const sourceDocument = normalizeVaultRichTextDocument({
        value: note.richTextJson,
        blocks: note.blocks ?? [],
        fallbackText: note.bodyPreview,
      });
      const draftDocument = draft?.mode === "rich_text" && draft.richTextDocument
        ? draft.richTextDocument
        : draft?.blocks.length
          ? normalizeVaultRichTextDocument({ blocks: draft.blocks })
          : sourceDocument;

      baseCloudVersion.current = draft?.baseCloudVersion ?? bundle?.cloudVersion ?? 0;
      baseUpdatedAt.current = draft?.baseUpdatedAt ?? note.updatedAt;
      baseRevisionId.current = draft ? draft.baseRevisionId : syncBase?.revision.revisionId;
      const initialDraft: LocalNoteDraft = {
        schemaVersion: 1,
        noteId: id,
        baseCloudVersion: baseCloudVersion.current,
        baseUpdatedAt: baseUpdatedAt.current,
        baseRevisionId: baseRevisionId.current,
        title: draft?.title ?? note.title,
        mode: "rich_text",
        richTextDocument: draftDocument,
        blocks: [],
        isPinned: draft?.isPinned ?? Boolean(note.isPinned),
        savedAt: draft?.savedAt ?? Date.now(),
        pendingDriveSync: true,
      };

      setTitle(initialDraft.title);
      setDocument(draftDocument);
      setIsPinned(initialDraft.isPinned);
      setSavedAt(draft?.savedAt ?? null);
      latestDraft.current = initialDraft;
      lastSavedSignature.current = draftSignature(initialDraft);
      setSaveStatus(draft
        ? bundle && bundle.cloudVersion !== draft.baseCloudVersion ? "conflict" : "saved"
        : "available");
      editorReady.current = true;
      setLoadedNoteId(id);
    }).catch(() => {
      if (!cancelled) setSaveStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [id, note, leaseReady]);

  useEffect(() => {
    if (id && note && loadedNoteId === id) recordRecentActivity("note", id);
  }, [id, loadedNoteId, note]);

  const draft = useMemo<LocalNoteDraft | null>(() => {
    if (!id || !note) return null;
    return {
      schemaVersion: 1,
      noteId: id,
      baseCloudVersion: baseCloudVersion.current,
      baseUpdatedAt: baseUpdatedAt.current || note.updatedAt,
      baseRevisionId: baseRevisionId.current,
      title,
      mode: "rich_text",
      richTextDocument: document,
      blocks: [],
      isPinned,
      savedAt: savedAt ?? Date.now(),
      pendingDriveSync: true,
    };
  }, [document, id, isPinned, note, savedAt, title]);

  useLayoutEffect(() => {
    if (!draft || !editorReady.current) return;
    latestDraft.current = draft;
    const signature = draftSignature(draft);
    if (signature === lastSavedSignature.current) return;

    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const revision = ++saveRevision.current;
    saveTimer.current = setTimeout(() => {
      const timestamp = Date.now();
      const savedDraft = { ...draft, savedAt: timestamp };
      void persistDraft(savedDraft)
        .then(() => {
          if (revision !== saveRevision.current) return;
          latestDraft.current = savedDraft;
          lastSavedSignature.current = signature;
          setSavedAt(timestamp);
          setSaveStatus("saved");
        })
        .catch(() => {
          if (revision === saveRevision.current) setSaveStatus("error");
        });
    }, 650);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft]);

  if (isLoading || loadedNoteId !== id) {
    return (
      <div className="w-full max-w-[1240px] space-y-4 px-5 py-8 md:px-8 lg:px-10">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-4 w-[min(760px,100%)]" />
        <Skeleton className="h-4 w-[min(680px,90%)]" />
      </div>
    );
  }

  if (!note || !id) return null;

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    if (courseId) {
      navigate(`/courses/${courseId}`);
      return;
    }
    navigate(note.folderId ? `/study?folder=${encodeURIComponent(note.folderId)}` : "/study");
  };

  return (
    <NoteWorkspace
      noteId={id}
      title={title}
      onTitleChange={setTitle}
      document={document}
      onDocumentChange={setDocument}
      saveStatus={saveStatus}
      savedAt={savedAt}
      sourceUpdatedAt={note.updatedAt}
      isPinned={isPinned}
      onTogglePin={() => setIsPinned((current) => !current)}
      onBack={handleBack}
      tagNames={note.tagNames ?? []}
      versions={versions}
    />
  );
}
