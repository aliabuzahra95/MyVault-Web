import { driveManifest, driveRootFolder } from "@/lib/restore/driveRestoreMap";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FILE_FIELDS = "files(id,name,mimeType,size,modifiedTime,parents)";
const FILE_RECORD_FIELDS = "id,name,mimeType,size,modifiedTime,parents";

export type DriveFileRecord = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

export type DriveUserProfile = {
  permissionId?: string;
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
};

type DriveAboutResponse = {
  user?: DriveUserProfile;
};

type DriveListResponse = {
  files?: DriveFileRecord[];
  nextPageToken?: string;
};

export type MyVaultDriveFolderKey = "metadata" | "files" | "manifests" | "backups";

export type MyVaultDriveScan = {
  scannedAt: string;
  rootFolder: DriveFileRecord | null;
  folders: Record<MyVaultDriveFolderKey, DriveFileRecord | null>;
  manifestFile: DriveFileRecord | null;
  ready: boolean;
  missingPaths: string[];
};

export class GoogleDriveRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GoogleDriveRequestError";
  }
}

export function isGoogleDriveAuthorizationError(error: unknown) {
  return error instanceof GoogleDriveRequestError && (error.status === 401 || error.status === 403);
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch<T>(accessToken: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");

  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GoogleDriveRequestError(detail || `Google Drive request failed with status ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

export async function getDriveUserProfile(accessToken: string) {
  const fields = encodeURIComponent("user(permissionId,displayName,emailAddress,photoLink)");
  const response = await driveFetch<DriveAboutResponse>(accessToken, `/about?fields=${fields}`);
  return response.user ?? null;
}

async function driveMediaFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GoogleDriveRequestError(detail || `Google Drive file download failed with status ${response.status}.`, response.status);
  }

  return response;
}

async function listDriveFiles(accessToken: string, query: string, pageSize = 10) {
  const files: DriveFileRecord[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      pageSize: String(pageSize),
      fields: `nextPageToken,${FILE_FIELDS}`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await driveFetch<DriveListResponse>(accessToken, `/files?${params.toString()}`);
    files.push(...(response.files ?? []));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return files;
}

async function findFolder(accessToken: string, name: string, parentId: string) {
  const safeName = escapeDriveQueryValue(name);
  const safeParentId = escapeDriveQueryValue(parentId);
  const query = [
    `name = '${safeName}'`,
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    `'${safeParentId}' in parents`,
    "trashed = false",
  ].join(" and ");

  const files = await listDriveFiles(accessToken, query);
  return files[0] ?? null;
}

export async function findDriveFile(accessToken: string, name: string, parentId: string) {
  const safeName = escapeDriveQueryValue(name);
  const safeParentId = escapeDriveQueryValue(parentId);
  const query = [
    `name = '${safeName}'`,
    `mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`,
    `'${safeParentId}' in parents`,
    "trashed = false",
  ].join(" and ");

  const files = await listDriveFiles(accessToken, query);
  return files[0] ?? null;
}

export async function createDriveFolder(accessToken: string, parentId: string, name: string) {
  const fields = encodeURIComponent(FILE_RECORD_FIELDS);
  return driveFetch<DriveFileRecord>(accessToken, `/files?fields=${fields}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [parentId],
    }),
  });
}

export function listDriveChildren(accessToken: string, parentId: string) {
  const safeParentId = escapeDriveQueryValue(parentId);
  return listDriveFiles(accessToken, `'${safeParentId}' in parents and trashed = false`, 1000);
}

function getMissingPaths(scan: Omit<MyVaultDriveScan, "ready" | "missingPaths">) {
  const missingPaths: string[] = [];

  if (!scan.rootFolder) {
    missingPaths.push(driveRootFolder);
    return missingPaths;
  }

  Object.entries(scan.folders).forEach(([folderName, folder]) => {
    if (!folder) {
      missingPaths.push(`${driveRootFolder}/${folderName}`);
    }
  });

  if (!scan.manifestFile) {
    missingPaths.push(driveManifest.folder + "/" + driveManifest.fileName);
  }

  return missingPaths;
}

export async function findMyVaultDriveMap(accessToken: string): Promise<MyVaultDriveScan> {
  const rootFolder = await findFolder(accessToken, driveRootFolder, "root");
  const emptyFolders: Record<MyVaultDriveFolderKey, DriveFileRecord | null> = {
    metadata: null,
    files: null,
    manifests: null,
    backups: null,
  };

  if (!rootFolder) {
    const scan = {
      scannedAt: new Date().toISOString(),
      rootFolder,
      folders: emptyFolders,
      manifestFile: null,
    };

    const missingPaths = getMissingPaths(scan);
    return {
      ...scan,
      ready: false,
      missingPaths,
    };
  }

  const [metadata, files, manifests, backups] = await Promise.all([
    findFolder(accessToken, "metadata", rootFolder.id),
    findFolder(accessToken, "files", rootFolder.id),
    findFolder(accessToken, "manifests", rootFolder.id),
    findFolder(accessToken, "backups", rootFolder.id),
  ]);

  const manifestFile = manifests ? await findDriveFile(accessToken, driveManifest.fileName, manifests.id) : null;
  const scan = {
    scannedAt: new Date().toISOString(),
    rootFolder,
    folders: {
      metadata,
      files,
      manifests,
      backups,
    },
    manifestFile,
  };
  const missingPaths = getMissingPaths(scan);

  return {
    ...scan,
    ready: rootFolder !== null && metadata !== null && files !== null && manifests !== null && manifestFile !== null,
    missingPaths,
  };
}

export async function downloadDriveFileText(accessToken: string, fileId: string) {
  const params = new URLSearchParams({ alt: "media" });
  const response = await driveMediaFetch(accessToken, `/files/${encodeURIComponent(fileId)}?${params.toString()}`);
  return response.text();
}

export async function downloadDriveFileJson<T>(accessToken: string, fileId: string) {
  const text = await downloadDriveFileText(accessToken, fileId);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Google Drive returned a file, but it was not valid JSON.");
  }
}

export async function downloadDriveFileBlob(accessToken: string, fileId: string, mimeType?: string) {
  const params = new URLSearchParams({ alt: "media" });
  const response = await driveMediaFetch(accessToken, `/files/${encodeURIComponent(fileId)}?${params.toString()}`);
  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: mimeType || response.headers.get("Content-Type") || "application/octet-stream" });
}

async function parseDriveUploadResponse(response: Response) {
  if (!response.ok) {
    const detail = await response.text();
    throw new GoogleDriveRequestError(detail || `Google Drive upload failed with status ${response.status}.`, response.status);
  }
  return response.json() as Promise<DriveFileRecord>;
}

function uploadHeaders(accessToken: string, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Authorization", `Bearer ${accessToken}`);
  result.set("Accept", "application/json");
  return result;
}

async function createMultipartDriveFile(
  accessToken: string,
  parentId: string,
  name: string,
  blob: Blob,
  mimeType: string,
) {
  const boundary = `myvault-web-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [parentId] });
  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadata,
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--\r\n`,
  ]);
  const fields = encodeURIComponent(FILE_RECORD_FIELDS);
  const response = await fetch(`${DRIVE_UPLOAD_API_BASE}/files?uploadType=multipart&fields=${fields}`, {
    method: "POST",
    headers: uploadHeaders(accessToken, { "Content-Type": `multipart/related; boundary=${boundary}` }),
    body,
  });
  return parseDriveUploadResponse(response);
}

async function createResumableDriveFile(
  accessToken: string,
  parentId: string,
  name: string,
  blob: Blob,
  mimeType: string,
) {
  const fields = encodeURIComponent(FILE_RECORD_FIELDS);
  const startResponse = await fetch(`${DRIVE_UPLOAD_API_BASE}/files?uploadType=resumable&fields=${fields}`, {
    method: "POST",
    headers: uploadHeaders(accessToken, {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(blob.size),
    }),
    body: JSON.stringify({ name, mimeType, parents: [parentId] }),
  });
  if (!startResponse.ok) return parseDriveUploadResponse(startResponse);
  const uploadUrl = startResponse.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive did not provide a resumable upload address.");
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders(accessToken, { "Content-Type": mimeType }),
    body: blob,
  });
  return parseDriveUploadResponse(uploadResponse);
}

export function createDriveFile(
  accessToken: string,
  parentId: string,
  name: string,
  blob: Blob,
  mimeType = blob.type || "application/octet-stream",
) {
  return blob.size > 5 * 1024 * 1024
    ? createResumableDriveFile(accessToken, parentId, name, blob, mimeType)
    : createMultipartDriveFile(accessToken, parentId, name, blob, mimeType);
}

export async function updateDriveFileContent(
  accessToken: string,
  fileId: string,
  blob: Blob,
  mimeType = blob.type || "application/octet-stream",
) {
  const fields = encodeURIComponent(FILE_RECORD_FIELDS);
  const response = await fetch(`${DRIVE_UPLOAD_API_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${fields}`, {
    method: "PATCH",
    headers: uploadHeaders(accessToken, { "Content-Type": mimeType }),
    body: blob,
  });
  return parseDriveUploadResponse(response);
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  const headers = uploadHeaders(accessToken);
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text();
    throw new GoogleDriveRequestError(detail || `Google Drive cleanup failed with status ${response.status}.`, response.status);
  }
}
