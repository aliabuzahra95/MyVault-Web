import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BackupGraph, reconstructBackupGraph } from '../src/lib/restore/backupGraph';

const path = process.env.MYVAULT_ANDROID_TARGETED_DRIVE_FIXTURE;
assert.ok(path, 'A disposable Android fixture path is required.');
const fixture = JSON.parse(readFileSync(path, 'utf8'));
const bytes = new Map<string, Uint8Array>(Object.entries(fixture.objects).map(([id, value]) =>
  [id, new Uint8Array(Buffer.from(value as string, 'base64'))]));
const refs = fixture.refs.map((objectRef: { cloudFileId: string; sha256: string; size: number }) => ({
  objectRef, bytes: bytes.get(objectRef.cloudFileId)!,
}));
const graph = await BackupGraph.discover(refs, fixture.accountId, fixture.lineageId);
assert.equal(graph.status, 'SINGLE_TIP');
const ordered = graph.plan().commits;
assert.equal(ordered.length, fixture.refs.length);
assert.equal(graph.plan(ordered[1].commitId).descendants.length, ordered.length - 2);
assert.equal(graph.plan(graph.tips[0]).status, 'ALREADY_CURRENT');
const resolved = await reconstructBackupGraph(graph, async (id) => bytes.get(id)!);
const notes = resolved.files['notes.json'] as Array<{ id: string; bodyPlainText: string }>;
assert.equal(notes.length, 1);
assert.equal(notes[0].id, fixture.expectedNotes[0].id);
assert.ok(notes[0].bodyPlainText.includes('العربية'));
assert.ok(Array.isArray(resolved.files['blocks.json']));
assert.equal(resolved.binaries?.find((binary) => binary.attachmentId === 'pdf')?.size, 8192);
assert.equal(resolved.binaries?.some((binary) => binary.attachmentId === 'new'), false);
console.log(`PASS Web reconstructed Android's authenticated targeted Restore graph: ${ordered.length} commits, 8192-byte replacement, exact attachment deletion.`);
