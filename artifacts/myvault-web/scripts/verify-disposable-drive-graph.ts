import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackupGraph, encodeGraphCommit, reconstructBackupGraph } from '../src/lib/restore/backupGraph';

// Only a loopback, explicitly provisioned test broker. No production auth/store/routing imports.
const directory = process.env.MYVAULT_DISPOSABLE_DRIVE_DIR;
assert.ok(directory, 'Set the disposable evidence directory.');
const config = JSON.parse(readFileSync(join(directory, '.private/broker-config.json'), 'utf8'));
const phase = process.argv[2];
const objects: Record<string,string> = {};
let lineage = config.lineageId;
async function call(action: string, extra: object = {}) {
  const response = await fetch(`http://127.0.0.1:${config.port}/call`, { method:'POST', headers:{'Content-Type':'application/json','X-Test-Nonce':config.nonce},
    body:JSON.stringify({ action, lineage, ...extra }) });
  const result = await response.json(); assert.ok(response.ok,result.error); return result.value;
}
if (phase === 'missing') {
  const original = await call('commits');
  const known = await BackupGraph.discover(original.map((r:any)=>({objectRef:r.objectRef,bytes:new Uint8Array(Buffer.from(r.bytes,'base64'))})),config.driveAccountId,lineage);
  const template = [...known.commits.values()].find(c=>c.kind==='delta')!;
  assert.ok(template);
  lineage = randomUUID();
  const absentParent = await call('reserve');
  const physicalCommit = await call('reserve');
  const commit = {...template,lineageId:lineage,commitId:randomUUID(),parents:[{commitId:randomUUID(),cloudFileId:absentParent,sha256:'0'.repeat(64),size:1}]};
  await call('create',{id:physicalCommit,role:'COMMIT',bytes:Buffer.from(encodeGraphCommit(commit)).toString('base64')});
  config.missingLineageId=lineage;
  writeFileSync(join(directory,'.private/broker-config.json'),JSON.stringify(config),{mode:0o600});
}
if (phase === 'corrupt') {
  const id = await call('reserve');
  await call('create',{id,role:'COMMIT',bytes:Buffer.from('{"malformed_disposable_commit":true}').toString('base64')});
}
const refs = await call('commits');
for (const entry of refs) objects[entry.objectRef.cloudFileId]=entry.bytes;
const graph = await BackupGraph.discover(refs.map((r:any)=>({objectRef:r.objectRef,bytes:new Uint8Array(Buffer.from(r.bytes,'base64'))})),config.driveAccountId,lineage);
async function load(id:string) {
  if (id in objects) return new Uint8Array(Buffer.from(objects[id], 'base64'));
  const encoded = await call('read',{id}); assert.ok(encoded,`Missing disposable ${id}`);
  objects[id]=encoded; return new Uint8Array(Buffer.from(encoded,'base64'));
}
if(phase==='linear') {
  assert.equal(graph.status,'SINGLE_TIP');
  const result=await reconstructBackupGraph(graph,load);
  const notes=result.files['notes.json'] as any[];
  assert.equal(notes.length,2); assert.ok(notes.find(n=>n.id==='n').bodyPlainText.includes('Frozen'));
  assert.ok(!notes.some(n=>n.id==='two'));
  assert.equal(result.binaries!.find(b=>b.attachmentId==='pdf')!.size,8192);
  assert.equal(result.binaries!.find(b=>b.attachmentId==='new-attachment')!.size,4096);
  assert.ok(JSON.stringify(result.files['blocks.json']).includes('styleMarks'));
  assert.equal(graph.plan(graph.tips[0]).status,'ALREADY_CURRENT');
  // Explicit historical prefixes of a proven linear graph, not automatic branch selection.
  const ordered=graph.plan().commits;
  async function prefix(index:number) {
    const ids=new Set(ordered.slice(0,index+1).map(c=>c.commitId));
    const selected=refs.filter((r:any)=>ids.has(JSON.parse(Buffer.from(r.bytes,'base64').toString('utf8')).commitId));
    const historical=await BackupGraph.discover(selected.map((r:any)=>({objectRef:r.objectRef,bytes:new Uint8Array(Buffer.from(r.bytes,'base64'))})),config.driveAccountId,lineage);
    assert.equal(historical.status,'SINGLE_TIP');
    return {graph:historical,result:await reconstructBackupGraph(historical,load)};
  }
  const checkpoint=await prefix(0);assert.equal(checkpoint.result.binaries!.find(b=>b.attachmentId==='pdf')!.size,4096);
  const replacement=await prefix(3);assert.equal(replacement.result.binaries!.find(b=>b.attachmentId==='pdf')!.size,8192);
  assert.deepEqual(replacement.graph.plan(ordered[1].commitId).descendants.map(c=>c.commitId),ordered.slice(2,4).map(c=>c.commitId));
  const added=await prefix(4),metadata=await prefix(5);
  assert.equal(added.result.binaries!.find(b=>b.attachmentId==='new-attachment')!.size,2048);
  assert.equal(metadata.result.binaries!.find(b=>b.attachmentId==='pdf')!.cloudFileId,replacement.result.binaries!.find(b=>b.attachmentId==='pdf')!.cloudFileId);
  assert.equal(metadata.result.binaries!.find(b=>b.attachmentId==='new-attachment')!.cloudFileId,added.result.binaries!.find(b=>b.attachmentId==='new-attachment')!.cloudFileId);
} else if(phase==='fork') {
  assert.equal(graph.status,'FORK'); assert.equal(graph.tips.length,2);
  await assert.rejects(()=>reconstructBackupGraph(graph,load));
} else if(phase==='missing') {
  assert.equal(graph.status,'MISSING_ANCESTRY');
  await assert.rejects(()=>reconstructBackupGraph(graph,load));
} else {
  assert.equal(phase,'corrupt'); assert.equal(graph.status,'CORRUPT');
  await assert.rejects(()=>reconstructBackupGraph(graph,load));
}
writeFileSync(join(directory,`live-web-${phase}.json`),JSON.stringify({accountId:config.driveAccountId,lineageId:lineage,objects,
  refs:refs.map((r:any)=>r.objectRef),expectedStatus:graph.status},null,2),{mode:0o600});
console.log(`PASS Web reader -> actual disposable Drive: ${phase}; ${graph.commits.size} valid immutable commits, ${graph.tips.length} tips.`);
