import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { chromium } from '/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const base = process.env.MYVAULT_URL ?? 'http://localhost:18899';
const results = [];
for (const fixture of process.argv.slice(2)) {
  const profile = await mkdtemp('/tmp/myvault-pdf-profile-');
  const name = fixture.split('/').at(-1);
  const target = name.includes('824') ? 725 : 2;
  const id = `reopen-${name}`;
  let context;
  let page;
  const errors = [];
  let driveRequests = 0;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, viewport:{width:1440,height:1000}});
    page = context.pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/googleapis.com\/drive/.test(request.url())) driveRequests++; });
    await page.route('**/__fixture.pdf', route => route.fulfill({path:fixture,contentType:'application/pdf'}));
  }
  await launch();
  try {
    await page.goto(base);
    await page.evaluate(async ({id,name,size,target}) => {
      const store = await import('/src/lib/restore/localRestoreStore.ts');
      const blob = await (await fetch('/__fixture.pdf')).blob();
      await store.saveLocalCreatedAttachment({id,name,mimeType:'application/pdf',sizeBytes:size,createdAt:1,updatedAt:1,noteId:null,libraryFolderId:null,isPinned:false,readingProgressPercent:0});
      await store.saveLocalAttachmentBlob(id,blob);
      await store.saveLocalPdfReaderState({schemaVersion:1,attachmentId:id,pageIndex:target-1,pageCount:target+1,progressPercent:0,zoom:1,lastOpenedAt:1,updatedAt:1,pendingDriveSync:false});
    }, {id,name,size:(await stat(fixture)).size,target});
    for (const mode of ['first','warm','reload','restart']) {
      if (mode === 'restart') { await context.close(); await launch(); }
      if (mode === 'warm') await page.getByLabel('Back to Library').click();
      const start = performance.now();
      if (mode === 'warm') await page.getByText(name,{exact:true}).filter({visible:true}).first().click();
      else if (mode === 'reload') await page.reload();
      else await page.goto(`${base}/library/document/${encodeURIComponent(id)}`);
      await page.getByTestId('pdf-reader').waitFor();
      const shellMs = Math.round(performance.now()-start);
      await page.waitForFunction(target => {
        const canvas = document.querySelector(`[data-pdf-page="${target}"] canvas`);
        if (!canvas || canvas.hidden || !canvas.width) return false;
        const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let dark = 0;
        for(let i=0;i<data.length;i+=16) if(data[i+3]>0 && data[i]<200) dark++;
        const rect=canvas.getBoundingClientRect(), viewport=document.querySelector('[data-testid="pdf-scroll-viewport"]').getBoundingClientRect();
        return dark>20 && rect.bottom>viewport.top && rect.top<viewport.bottom;
      }, target,{timeout:60000});
      const visibleMs = Math.round(performance.now()-start);
      assert.equal(await page.getByLabel('Page number',{exact:true}).inputValue(),String(target));
      await page.getByLabel('Page number',{exact:true}).focus();
      const interactiveMs = Math.round(performance.now()-start);
      const canvases = await page.locator('.react-pdf__Page canvas').count();
      assert.ok(canvases<=5);
      const trace=await page.evaluate(()=>performance.getEntriesByName('myvault-pdf-open').at(-1)?.detail ?? null);
      const result={fixture:name,bytes:(await stat(fixture)).size,mode,target,shellMs,visibleMs,interactiveMs,canvases,driveRequests,trace};
      results.push(result);
      console.log(JSON.stringify(result));
    }
    assert.deepEqual(errors,[]);
    assert.equal(driveRequests,0);
  } finally { await context.close(); }
}
await writeFile(process.env.MYVAULT_RESULTS ?? '/tmp/myvault-pdf-reopen.json',JSON.stringify(results,null,2));
