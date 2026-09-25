import {
  createDriveFile,
  createDriveFolder,
  downloadDriveFileJson,
  findDriveFile,
  GoogleDriveRequestError,
  listDriveChildren,
  type DriveFileRecord,
} from "@/lib/googleDrive/driveClient";
import { parseRecordSyncRevision, verifyRecordSyncRevision, type RecordSyncRevision } from "./protocol";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type RecordSyncDriveChange = {
  fileId: string;
  removed: boolean;
  file: DriveFileRecord | null;
};

export type RecordSyncDriveChangePage = {
  changes: RecordSyncDriveChange[];
  nextPageToken: string | null;
  newStartPageToken: string | null;
};

async function driveGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new GoogleDriveRequestError(`Google Drive sync request failed (${response.status}).`, response.status);
  return response.json() as Promise<T>;
}

async function findFolder(token: string, parent: string, name: string): Promise<DriveFileRecord | null> {
  const matches = (await listDriveChildren(token, parent)).filter(
    (file) => file.name === name && file.mimeType === FOLDER_MIME,
  );
  if (matches.length > 1) throw new Error(`Multiple ${name} folders exist. Sync stopped without changing data.`);
  return matches[0] ?? null;
}

export async function findRecordSyncFolder(token: string): Promise<string | null> {
  const root = await findFolder(token, "root", "MyVault");
  const sync = root && await findFolder(token, root.id, "sync-v1");
  const records = sync && await findFolder(token, sync.id, "records");
  return records?.id ?? null;
}

export async function ensureRecordSyncFolder(token: string): Promise<string> {
  const root = await findFolder(token, "root", "MyVault") ?? await createDriveFolder(token, "root", "MyVault");
  const sync = await findFolder(token, root.id, "sync-v1") ?? await createDriveFolder(token, root.id, "sync-v1");
  const records = await findFolder(token, sync.id, "records") ?? await createDriveFolder(token, sync.id, "records");
  return records.id;
}

export function listRecordSyncFiles(token: string, folderId: string) {
  return listDriveChildren(token, folderId).then((files) => files.filter((file) => file.mimeType !== FOLDER_MIME));
}

export async function getRecordSyncStartToken(token: string): Promise<string> {
  const result = await driveGet<{ startPageToken: string }>(token, "/changes/startPageToken");
  return result.startPageToken;
}

export async function getRecordSyncChanges(token: string, pageToken: string): Promise<RecordSyncDriveChangePage> {
  const params = new URLSearchParams({
    pageToken,
    includeRemoved: "true",
    spaces: "drive",
    pageSize: "1000",
    fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,parents,mimeType))",
  });
  const result = await driveGet<{
    changes?: Array<{ fileId: string; removed?: boolean; file?: DriveFileRecord }>;
    nextPageToken?: string;
    newStartPageToken?: string;
  }>(token, `/changes?${params}`);
  return {
    changes: (result.changes ?? []).map((change) => ({
      fileId: change.fileId,
      removed: Boolean(change.removed),
      file: change.file ?? null,
    })),
    nextPageToken: result.nextPageToken ?? null,
    newStartPageToken: result.newStartPageToken ?? null,
  };
}

export async function downloadRecordSyncRevision(token: string, file: DriveFileRecord): Promise<RecordSyncRevision> {
  const revision = parseRecordSyncRevision(await downloadDriveFileJson<unknown>(token, file.id));
  if (file.name !== `${revision.revisionId}.json`) throw new Error("Sync file name does not match its revision.");
  await verifyRecordSyncRevision(revision);
  return revision;
}

export async function uploadRecordSyncRevision(
  token: string,
  folderId: string,
  revision: RecordSyncRevision,
): Promise<DriveFileRecord> {
  const name = `${revision.revisionId}.json`;
  const existing = await findDriveFile(token, name, folderId);
  if (existing) {
    const saved = await downloadRecordSyncRevision(token, existing);
    if (saved.mutationId !== revision.mutationId || saved.contentHash !== revision.contentHash) {
      throw new Error("A sync revision name is already in use with different content.");
    }
    return existing;
  }
  return createDriveFile(token, folderId, name, new Blob([JSON.stringify(revision)], { type: "application/json" }));
}
