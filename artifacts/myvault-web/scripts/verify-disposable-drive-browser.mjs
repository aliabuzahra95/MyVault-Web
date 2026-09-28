import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';
import { chromium } from '/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const directory=process.env.MYVAULT_DISPOSABLE_DRIVE_DIR;
assert.ok(directory);
await build({configFile:false,logLevel:'silent',build:{emptyOutDir:false,outDir:directory,
  lib:{entry:'src/lib/restore/backupGraph.ts',name:'MyVaultGraph',formats:['iife'],fileName:()=> 'authenticated-browser-reader.js'}}});
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable Drive Graph Reader Check</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext();
try {
  await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url); await page.addScriptTag({content:readFileSync(join(directory,'authenticated-browser-reader.js'),'utf8')});
  for(const name of ['root','replacement','linear','fork','missing','corrupt']) {
    const path=name==='root'||name==='replacement'?join(directory,`authenticated-graph-fixtures/${name}.json`):join(directory,`live-web-${name}.json`);
    const bundle=JSON.parse(readFileSync(path,'utf8'));
    await page.evaluate(async ({bundle,name})=>{
      window.fetch=async()=>{throw Error('Network forbidden in receipt-only browser check');};
      const api=window.MyVaultGraph;
      const bytes=id=>{if(!(id in bundle.objects))throw Error('Missing verified receipt');return Uint8Array.from(atob(bundle.objects[id]),c=>c.charCodeAt(0));};
      const graph=await api.BackupGraph.discover(bundle.refs.map(objectRef=>({objectRef,bytes:bytes(objectRef.cloudFileId)})),bundle.accountId,bundle.lineageId);
      if(graph.status!==bundle.expectedStatus)throw Error(`Browser status differs: ${name}`);
      if(name==='root'||name==='replacement'||name==='linear') {
        const result=await api.reconstructBackupGraph(graph,async id=>bytes(id));
        if(result.binaries.find(b=>b.attachmentId==='pdf').size!==(name==='root'?4096:8192))throw Error('Wrong verified binary');
        if(!JSON.stringify(result.files['blocks.json']).includes('styleMarks'))throw Error('Rich text missing');
        if(name==='linear' && (result.files['notes.json'].length!==2||result.files['notes.json'].some(n=>n.id==='two')))throw Error('Wrong deletion state');
        if(name==='replacement') {
          const order=graph.plan().commits;
          if(JSON.stringify(graph.plan(order[1].commitId).descendants.map(c=>c.commitId))!==JSON.stringify(order.slice(2).map(c=>c.commitId)))throw Error('Wrong incremental descendant plan');
        }
      } else {
        let refused=false;try{await api.reconstructBackupGraph(graph,async id=>bytes(id));}catch{refused=true;}
        if(!refused)throw Error('Unsafe graph accepted');
        if(name==='fork'&&graph.tips.length!==2)throw Error('Sibling commit lost');
      }
    },{bundle,name});
    console.log(`PASS fresh Chrome real Drive object receipts: ${name}`);
  }
  assert.deepEqual(errors,[]);
} finally {
  await context.close(); await browser.close(); await new Promise(resolve=>server.close(resolve));
}
