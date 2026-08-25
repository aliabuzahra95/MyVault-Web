import type { MetadataRestoreBundle, RestoredMetadataFile } from "@/lib/restore/metadataRestore";
import { canonicalJson } from "@/lib/sync/revision";

export type ThreeWayConflict = {
  entityType: string;
  entityId: string;
  kind: "same-entity-changed" | "delete-edit" | "unsupported-file-shape";
  fileName: string;
};

export type ThreeWayMergeResult = {
  bundle: MetadataRestoreBundle;
  conflicts: ThreeWayConflict[];
  mergedEntityCount: number;
  remoteEntityCount: number;
  webEntityCount: number;
};

const IDENTITY_FIELDS: Record<string, string[][]> = {
  "tags.json": [["name"]],
  "note_tags.json": [["noteId", "tagId"], ["noteId", "tagName"]],
  "pdf_reading_progress.json": [["attachmentId"]],
  "knowledge_tag_links.json": [["tagId", "targetType", "targetId"], ["knowledgeTagId", "targetType", "targetId"]],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityFor(fileName: string, value: unknown) {
  if (!isRecord(value)) return null;
  if (typeof value.id === "string" && value.id) return value.id;
  const alternatives = IDENTITY_FIELDS[fileName] ?? [];
  for (const fields of alternatives) {
    if (fields.every((field) => typeof value[field] === "string" || typeof value[field] === "number")) {
      return fields.map((field) => String(value[field])).join("::");
    }
  }
  return null;
}

function same(first: unknown, second: unknown) {
  return canonicalJson(first) === canonicalJson(second);
}

function arrayMap(fileName: string, value: unknown[]) {
  const rows = value.map((item) => [identityFor(fileName, item), item] as const);
  return rows.some(([identity]) => identity === null)
    ? null
    : new Map(rows as Array<readonly [string, unknown]>);
}

function mergeArrayFile(fileName: string, base: unknown[], web: unknown[], remote: unknown[]) {
  const baseRows = arrayMap(fileName, base);
  const webRows = arrayMap(fileName, web);
  const remoteRows = arrayMap(fileName, remote);
  if (!baseRows || !webRows || !remoteRows) {
    return {
      merged: remote,
      conflicts: [{
        entityType: fileName.replace(/\.json$/, ""),
        entityId: fileName,
        kind: "unsupported-file-shape" as const,
        fileName,
      }],
      mergedEntityCount: 0,
      remoteEntityCount: 0,
      webEntityCount: 0,
    };
  }
  const ids = new Set([...baseRows.keys(), ...webRows.keys(), ...remoteRows.keys()]);
  const conflicts: ThreeWayConflict[] = [];
  const merged: unknown[] = [];
  let mergedEntityCount = 0;
  let remoteEntityCount = 0;
  let webEntityCount = 0;

  for (const id of ids) {
    const baseValue = baseRows.get(id);
    const webValue = webRows.get(id);
    const remoteValue = remoteRows.get(id);
    const webChanged = !same(baseValue, webValue);
    const remoteChanged = !same(baseValue, remoteValue);

    if (webChanged && remoteChanged && !same(webValue, remoteValue)) {
      conflicts.push({
        entityType: fileName.replace(/\.json$/, ""),
        entityId: id,
        kind: webValue === undefined || remoteValue === undefined ? "delete-edit" : "same-entity-changed",
        fileName,
      });
      continue;
    }

    const selected = webChanged ? webValue : remoteValue;
    if (selected !== undefined) merged.push(selected);
    if (webChanged && remoteChanged) mergedEntityCount += 1;
    else if (webChanged) webEntityCount += 1;
    else if (remoteChanged) remoteEntityCount += 1;
  }

  return { merged, conflicts, mergedEntityCount, remoteEntityCount, webEntityCount };
}

function fileMap(bundle: MetadataRestoreBundle) {
  return new Map(bundle.files.map((file) => [file.fileName, file]));
}

function withJson(file: RestoredMetadataFile, json: unknown): RestoredMetadataFile {
  return {
    ...file,
    json,
    itemCount: Array.isArray(json) ? json.length : file.itemCount,
  };
}

export function reconcileMetadataBundles({
  base,
  web,
  remote,
  touchedFiles,
}: {
  base: MetadataRestoreBundle;
  web: MetadataRestoreBundle;
  remote: MetadataRestoreBundle;
  touchedFiles: ReadonlySet<string>;
}): ThreeWayMergeResult {
  const baseFiles = fileMap(base);
  const webFiles = fileMap(web);
  const remoteFiles = fileMap(remote);
  const conflicts: ThreeWayConflict[] = [];
  let mergedEntityCount = 0;
  let remoteEntityCount = 0;
  let webEntityCount = 0;

  const files = remote.files.map((remoteFile) => {
    if (!touchedFiles.has(remoteFile.fileName)) return remoteFile;
    const baseFile = baseFiles.get(remoteFile.fileName);
    const webFile = webFiles.get(remoteFile.fileName);
    if (!baseFile && webFile && same(webFile.json, remoteFile.json)) {
      webEntityCount += 1;
      return remoteFile;
    }
    if (!baseFile || !webFile) {
      conflicts.push({
        entityType: remoteFile.fileName.replace(/\.json$/, ""),
        entityId: remoteFile.fileName,
        kind: "unsupported-file-shape",
        fileName: remoteFile.fileName,
      });
      return remoteFile;
    }

    if (Array.isArray(baseFile.json) && Array.isArray(webFile.json) && Array.isArray(remoteFile.json)) {
      const result = mergeArrayFile(remoteFile.fileName, baseFile.json, webFile.json, remoteFile.json);
      conflicts.push(...result.conflicts);
      mergedEntityCount += result.mergedEntityCount;
      remoteEntityCount += result.remoteEntityCount;
      webEntityCount += result.webEntityCount;
      return withJson(remoteFile, result.merged);
    }

    const webChanged = !same(baseFile.json, webFile.json);
    const remoteChanged = !same(baseFile.json, remoteFile.json);
    if (webChanged && remoteChanged && !same(webFile.json, remoteFile.json)) {
      conflicts.push({
        entityType: remoteFile.fileName.replace(/\.json$/, ""),
        entityId: remoteFile.fileName,
        kind: "same-entity-changed",
        fileName: remoteFile.fileName,
      });
      return remoteFile;
    }
    return webChanged ? withJson(remoteFile, webFile.json) : remoteFile;
  });

  for (const webFile of web.files) {
    if (!remoteFiles.has(webFile.fileName) && touchedFiles.has(webFile.fileName)) {
      const baseFile = baseFiles.get(webFile.fileName);
      if (!baseFile) {
        files.push(webFile);
        webEntityCount += Array.isArray(webFile.json) ? webFile.json.length : 1;
        continue;
      }
      if (same(baseFile.json, webFile.json)) continue;
      conflicts.push({
        entityType: webFile.fileName.replace(/\.json$/, ""),
        entityId: webFile.fileName,
        kind: "unsupported-file-shape",
        fileName: webFile.fileName,
      });
    }
  }

  return {
    bundle: {
      ...remote,
      files,
      fileEntries: remote.fileEntries,
    },
    conflicts,
    mergedEntityCount,
    remoteEntityCount,
    webEntityCount,
  };
}
