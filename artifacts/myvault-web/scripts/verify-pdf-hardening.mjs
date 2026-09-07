import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { chromium } from '/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = process.env.MYVAULT_URL ?? 'http://localhost:18899';
const fixture = process.argv[2];
assert.ok(fixture, 'Supply a local PDF fixture');
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const context = await browser.newContext({viewport:{width:1440,height:1000}});
 const page = await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__fixture.pdf',r=>r.fulfill({path:fixture,contentType:'application/pdf'}));
 await page.goto(base);
 await page.evaluate(async size=>{
   const store=await import('/src/lib/restore/localRestoreStore.ts');
   const blob=await(await fetch('/__fixture.pdf')).blob();
   const files = [
     {fileName:'folders.json',json:[{id:'study',parentId:null,name:'Study',mode:'study'}]},
     {fileName:'notes.json',json:[{id:'linked-note',folderId:'study',title:'Linked study note',bodyPlainText:'Source research',createdAt:1,updatedAt:1}]},
     {fileName:'source_backlinks.json',json:[{id:'source-link',noteId:'linked-note',attachmentId:'pdf-hardening',pageIndex:25,createdAt:1}]},
   ].map(file=>({...file,entryPath:`metadata/${file.fileName}`,backupEntry:file.fileName,cloudFileId:file.fileName,size:JSON.stringify(file.json).length,updatedAt:1,itemCount:file.json.length}));
   await store.saveMetadataRestoreBundle({schemaVersion:1,restoredAt:new Date().toISOString(),cloudVersion:1,driveEntryCount:3,metadataFileCount:3,metadataBytes:0,files,counts:{courses:0,folders:1,notes:1,blocks:0,attachments:0,tags:0,stickyNotes:0,pdfAnnotations:0},groupSummaries:[],issues:[]});
   await store.saveLocalCreatedAttachment({id:'pdf-hardening',name:'PDF hardening.pdf',mimeType:'application/pdf',sizeBytes:size,createdAt:1,updatedAt:1,noteId:null,libraryFolderId:null,isPinned:false,readingProgressPercent:0});
   await store.saveLocalAttachmentBlob('pdf-hardening',blob);
   const annotation={attachmentId:'pdf-hardening',libraryFolderId:null,pageIndex:25,left:0.1,top:0.55,right:0.9,bottom:0.75,color:'yellow',annotationType:'highlight',noteText:null,textSize:16,backgroundColor:'none',displayTitle:null,displayFolderId:null,createdAt:1,updatedAt:1};
   await store.saveLocalPdfAnnotation({...annotation,id:'crop'});
   await store.saveLocalPdfAnnotation({...annotation,id:'text',selectedText:'Genuine saved selected text',createdAt:2});
   await store.saveLocalPdfAnnotation({...annotation,id:'note',annotationType:'page_note',noteText:'First paragraph\n\nSecond paragraph with a complete readable note.',createdAt:3});
   await store.saveLocalPdfAnnotation({...annotation,id:'long-note',annotationType:'page_note',noteText:'Long readable note.\n\n'.repeat(80),createdAt:3});
   await store.saveLocalPdfAnnotation({...annotation,id:'invalid-preview',left:0,right:0,top:0,bottom:0,createdAt:4});
   for(let i=0;i<35;i++)await store.saveLocalPdfAnnotation({...annotation,id:`lazy-${i}`,pageIndex:26+i,createdAt:10+i});
 },(await stat(fixture)).size);
 const timings=[];
 for(const mode of ['first','warm','reload']) {
   const start=Date.now();
   if(mode==='warm') {await page.getByLabel('Back to Library').click(); await page.getByText('PDF hardening.pdf',{exact:true}).first().click();}
   else if(mode==='reload')await page.reload();
   else await page.goto(`${base}/library/document/pdf-hardening`);
   await page.getByTestId('pdf-reader').waitFor();
   const shellMs=Date.now()-start;
   await page.waitForFunction(()=>performance.getEntriesByName('myvault-pdf-open').at(-1)?.detail?.stages?.pageVisible !== undefined);
   timings.push({mode,shellMs,visibleMs:Date.now()-start,trace:await page.evaluate(()=>performance.getEntriesByName('myvault-pdf-open').at(-1)?.detail)});
 }
 await page.getByTestId('pdf-raster-crop').waitFor();
 assert.equal(await page.getByTestId('pdf-raster-text').count(),0);
 await page.getByText('Genuine saved selected text',{exact:true}).waitFor();
 assert.ok(await page.locator('[data-testid^="pdf-raster-"]').count()<35, 'Previews must be lazy');
 await page.getByTestId('pdf-annotation-crop').click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Page number"]')?.value==='26');
 await page.waitForFunction(()=>{
   const region=document.getElementById('pdf-emphasis-crop')?.getBoundingClientRect();
   const viewport=document.querySelector('[data-testid="pdf-scroll-viewport"]')?.getBoundingClientRect();
   return region&&viewport&&region.top>=viewport.top&&region.top<viewport.bottom;
 });
 await page.locator('[data-pdf-page="26"] canvas').waitFor();
 const expectedCrop = await page.evaluate(() => {
   const source = document.querySelector('[data-pdf-page="26"] canvas');
   const image = document.querySelector('[data-testid="pdf-raster-crop"]');
   const output = document.createElement('canvas');
   output.width=image.naturalWidth; output.height=image.naturalHeight;
   output.getContext('2d').drawImage(source,source.width*.1,source.height*.55,source.width*.8,source.height*.2,0,0,output.width,output.height);
   return output.toDataURL();
 });
 await writeFile('/tmp/myvault-pdf-expected-crop.png',Buffer.from(expectedCrop.split(',')[1],'base64'));
 await page.getByTestId('pdf-raster-crop').screenshot({path:'/tmp/myvault-pdf-actual-crop.png'});
 await page.getByLabel('Annotation filter').selectOption('notes');
 await page.getByText('Second paragraph with a complete readable note.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Read full note',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Show less',exact:true}).getAttribute('aria-expanded'),'true');
 await page.getByRole('button',{name:'Show less',exact:true}).click();
 await page.getByLabel('Annotation filter').selectOption('all');
 await page.getByLabel('Annotation filter').selectOption('links');
 await page.getByText('Linked study note',{exact:true}).waitFor();
 assert.equal(await page.getByText('Open note →',{exact:true}).getAttribute('href'),'/notes/linked-note');
 await page.getByLabel('Annotation filter').selectOption('all');
 await page.getByTestId('pdf-annotation-invalid-preview').scrollIntoViewIfNeeded();
 await page.getByTestId('pdf-annotation-invalid-preview').getByText('Preview unavailable').waitFor();
 const widths=[];
 for(const width of [1440,360,390,412,430]) {
   await page.setViewportSize({width,height:width===1440?1000:892});
   await page.waitForTimeout(250);
   assert.equal(await page.getByLabel('Page number',{exact:true}).inputValue(),'26','Resize must retain page');
   await page.getByTestId('pdf-annotations-panel').evaluate(e=>e.scrollTop=0);
   await page.screenshot({path:`/tmp/myvault-pdf-${width}.png`});
   const bounds=await page.getByTestId('pdf-annotations-panel').boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Panel must fit viewport');
   widths.push({width,panel:bounds});
 }
 await page.getByTestId('pdf-annotation-crop').click();
 assert.equal(await page.getByTestId('pdf-annotations-panel').count(),0,'Mobile source tap closes panel');
 await context.setOffline(true);
 await page.getByLabel('Back to Library').click();
 await page.getByText('PDF hardening.pdf',{exact:true}).filter({visible:true}).first().click();
 await page.locator('.react-pdf__Page canvas').first().waitFor();
 assert.ok(await page.locator('.react-pdf__Page canvas').count()<=5);
 await context.setOffline(false);
 await page.getByLabel('Back to Library').click();
 const cacheChecks = await page.evaluate(async () => {
   const {acquirePdfDocument} = await import('/src/components/library/pdf-document-cache.ts');
   const {previewKey, annotationBounds} = await import('/src/components/library/pdf-annotation-preview.tsx');
   const blob = await (await fetch('/__fixture.pdf')).blob();
   const url = URL.createObjectURL(blob);
   try {
     const first = await acquirePdfDocument('cache-a',url); first.release(); first.release();
     const warm = await acquirePdfDocument('cache-a',url);
     const reused = warm.timing.hit && warm.document === first.document; warm.release();
     for (const id of ['cache-b','cache-c']) { const lease = await acquirePdfDocument(id,url); lease.release(); }
     const oldest = await acquirePdfDocument('cache-a',url); const evicted = !oldest.timing.hit; oldest.release();
     const replacementUrl = URL.createObjectURL(new Blob([blob,'\n% replacement identity test\n'],{type:'application/pdf'}));
     const replacement = await acquirePdfDocument('cache-a',replacementUrl);
     const replacementMiss = !replacement.timing.hit && replacement.key !== oldest.key;
     replacement.release(); URL.revokeObjectURL(replacementUrl);
     const annotation = {id:'key',pageIndex:0,left:.1,top:.2,right:.5,bottom:.4,updatedAt:1};
     const key = previewKey('file-v1',annotation);
     const identity = key!==previewKey('file-v2',annotation) && key!==previewKey('file-v1',{...annotation,updatedAt:2}) && key!==previewKey('file-v1',{...annotation,right:.8});
     const bounds = annotationBounds(annotation,600,800);
     return {reused,evicted,replacementMiss,identity,normalizedBounds:bounds.x===60&&bounds.y===160&&bounds.width===240&&bounds.height===160};
   } finally { URL.revokeObjectURL(url); }
 });
 assert.ok(Object.values(cacheChecks).every(Boolean),JSON.stringify(cacheChecks));
 await page.evaluate(async () => {
   const store = await import('/src/lib/restore/localRestoreStore.ts');
   await store.saveLocalCreatedAttachment({id:'cache-miss',name:'Not cached.pdf',mimeType:'application/pdf',sizeBytes:100,createdAt:1,updatedAt:1,noteId:null,libraryFolderId:null,isPinned:false,readingProgressPercent:0});
 });
 await page.goto(`${base}/library/document/cache-miss`);
 await page.getByRole('button',{name:/^(Reconnect|Connect) and open$/}).waitFor();
 assert.deepEqual(errors,[]);
 const output={timings,widths,cacheChecks,cacheMissFallback:true,offlineLocalReopen:true,lazyPreviews:true,exactRegion:true,storedText:true,readableNote:true,studyLink:true,previewFailureVisible:true,errors};
 await writeFile('/tmp/myvault-pdf-hardening-results.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output,null,2));
 await context.close();
} finally {await browser.close();}
