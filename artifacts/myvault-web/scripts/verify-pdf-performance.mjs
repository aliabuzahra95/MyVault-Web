import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "/Users/aliah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const baseUrl = process.env.MYVAULT_URL ?? "http://localhost:18899";
const MAX_TRANSIENT_CANVASES = 10;
const fixturePaths = process.argv.slice(2).filter((value) => value !== "--");
assert.ok(fixturePaths.length > 0, "Pass at least one PDF fixture path.");

const browser = await chromium.launch({
  headless: process.env.MYVAULT_HEADLESS !== "false",
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--js-flags=--expose-gc"],
});
const results = [];

async function metrics(cdp, page) {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  const performance = await cdp.send("Performance.getMetrics");
  const counters = await cdp.send("Memory.getDOMCounters");
  const metric = (name) => performance.metrics.find((item) => item.name === name)?.value ?? 0;
  return {
    canvases: await page.locator(".react-pdf__Page canvas").count(),
    renderedPages: await page.locator('[data-pdf-page-rendered="true"]').count(),
    textLayers: await page.locator(".react-pdf__Page__textContent").count(),
    textSpans: await page.locator(".react-pdf__Page__textContent span").count(),
    annotationLayers: await page.locator(".react-pdf__Page__annotations").count(),
    domNodes: counters.nodes,
    jsHeapBytes: metric("JSHeapUsedSize"),
  };
}

async function waitForPageCanvas(page, pageNumber) {
  const selector = `[data-pdf-page="${pageNumber}"][data-pdf-page-rendered="true"] canvas`;
  await page.locator(selector).waitFor({ state: "visible", timeout: 120000 });
  try {
    await page.waitForFunction((targetPage) => {
      const target = document.querySelector(`[data-pdf-page="${targetPage}"]`);
      const viewport = document.querySelector('[data-testid="pdf-scroll-viewport"]');
      if (!(target instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false;
      const targetBounds = target.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      return targetBounds.top < viewportBounds.bottom && targetBounds.bottom > viewportBounds.top;
    }, pageNumber, { timeout: 15000 });
  } catch (error) {
    const diagnostic = await page.evaluate((targetPage) => {
      const target = document.querySelector(`[data-pdf-page="${targetPage}"]`);
      const viewport = document.querySelector('[data-testid="pdf-scroll-viewport"]');
      return {
        pageInput: document.querySelector('[aria-label="Page number"]')?.value ?? null,
        scrollTop: viewport instanceof HTMLElement ? viewport.scrollTop : null,
        scrollHeight: viewport instanceof HTMLElement ? viewport.scrollHeight : null,
        targetBounds: target instanceof HTMLElement ? target.getBoundingClientRect().toJSON() : null,
        viewportBounds: viewport instanceof HTMLElement ? viewport.getBoundingClientRect().toJSON() : null,
      };
    }, pageNumber);
    throw new Error(`Page ${pageNumber} rendered outside the PDF viewport: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  return page.locator(selector);
}

async function jumpToPage(page, pageNumber) {
  const input = page.getByLabel("Page number");
  await input.fill(String(pageNumber));
  await input.press("Enter");
  await waitForPageCanvas(page, pageNumber);
}

async function drawHighlight(page, pageNumber) {
  const layer = page.locator(`[data-testid="pdf-highlight-layer-${pageNumber}"]`);
  await layer.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(250);
  const beforeCount = await page.locator('[data-testid^="pdf-annotation-overlay-"]').count();
  const bounds = await layer.boundingBox();
  const viewportBounds = await page.getByTestId("pdf-scroll-viewport").boundingBox();
  assert.ok(bounds && bounds.width > 160 && bounds.height > 160, "Active highlight layer was not measurable.");
  assert.ok(viewportBounds, "PDF viewport was not measurable.");
  const startX = bounds.x + Math.min(80, bounds.width * 0.16);
  const startY = Math.min(
    bounds.y + bounds.height - 60,
    Math.max(bounds.y + 40, viewportBounds.y + 100),
  );
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + Math.min(180, bounds.width * 0.34), startY + 36, { steps: 5 });
  await page.mouse.up();
  try {
    await page.waitForFunction((previous) => (
      document.querySelectorAll('[data-testid^="pdf-annotation-overlay-"]').length > previous
    ), beforeCount, { timeout: 30000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      previewVisible: Boolean(document.querySelector('[data-testid="pdf-highlight-preview"]')),
      saveState: document.querySelector('[data-testid="pdf-annotation-save-state"]')?.textContent ?? null,
      activeTool: document.querySelector('[data-testid="pdf-highlight-tool"]')?.getAttribute("aria-pressed"),
      scrollTop: document.querySelector('[data-testid="pdf-scroll-viewport"]')?.scrollTop ?? null,
    }));
    throw new Error(`Highlight drag did not create an annotation: ${JSON.stringify({ ...diagnostic, bounds, viewportBounds, startX, startY })}`, { cause: error });
  }
}

for (const fixturePath of fixturePaths) {
  const file = await stat(fixturePath);
  console.error(`[pdf-performance] opening ${path.basename(fixturePath)} (${file.size} bytes)`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const errors = [];
  let crashed = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("crash", () => { crashed = true; });
  await page.route("**/__myvault_pdf_fixture.pdf", (route) => route.fulfill({
    path: fixturePath,
    contentType: "application/pdf",
  }));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const attachmentId = `pdf-performance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.evaluate(async ({ attachmentId, fileName, sizeBytes }) => {
    const store = await import("/src/lib/restore/localRestoreStore.ts");
    const response = await fetch("/__myvault_pdf_fixture.pdf");
    if (!response.ok) throw new Error(`Fixture fetch failed: ${response.status}`);
    const blob = await response.blob();
    await store.saveLocalCreatedAttachment({
      id: attachmentId,
      noteId: null,
      libraryFolderId: null,
      name: fileName,
      mimeType: "application/pdf",
      sizeBytes,
      isPinned: false,
      readingProgressPercent: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await store.saveLocalAttachmentBlob(attachmentId, blob);
  }, { attachmentId, fileName: path.basename(fixturePath), sizeBytes: file.size });

  await page.goto(`${baseUrl}/library/document/${attachmentId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-reader").waitFor({ timeout: 120000 });
  const totalLabel = page.locator('[aria-label$="total pages"]');
  await totalLabel.waitFor({ timeout: 120000 });
  const totalText = await totalLabel.getAttribute("aria-label");
  const pageCount = Number.parseInt(totalText ?? "", 10);
  assert.ok(pageCount > 0, `Could not read fixture page count from ${totalText}.`);
  console.error(`[pdf-performance] loaded ${pageCount} pages`);
  await waitForPageCanvas(page, 1);

  const samples = [await metrics(cdp, page)];
  const firstTarget = Math.max(1, Math.min(pageCount, Math.round(pageCount * 0.67)));
  await jumpToPage(page, firstTarget);
  samples.push(await metrics(cdp, page));
  const canvasToken = `stable-${Date.now()}`;
  await page.locator(`[data-pdf-page="${firstTarget}"] canvas`).evaluate((canvas, token) => { canvas.dataset.renderIdentity = token; }, canvasToken);
  await page.getByTestId("pdf-highlight-tool").click();
  await drawHighlight(page, firstTarget);
  console.error(`[pdf-performance] first highlight saved on page ${firstTarget}`);
  assert.equal(
    await page.locator(`[data-pdf-page="${firstTarget}"] canvas`).getAttribute("data-render-identity"),
    canvasToken,
    "Saving one highlight must not recreate the active PDF canvas.",
  );
  samples.push(await metrics(cdp, page));

  const secondTarget = Math.max(1, Math.min(pageCount, firstTarget + Math.max(1, Math.round(pageCount * 0.1))));
  if (secondTarget !== firstTarget) {
    await jumpToPage(page, secondTarget);
    await drawHighlight(page, secondTarget);
    console.error(`[pdf-performance] second highlight saved on page ${secondTarget}`);
  }
  await page.getByLabel("Add page note").click();
  await page.getByTestId("pdf-annotation-text").fill("Large PDF performance fixture note");
  await page.getByTestId("pdf-annotation-save").click();
  await page.getByTestId("pdf-annotation-save-state").filter({ hasText: "Saved locally" }).waitFor({ timeout: 30000 });
  await page.getByLabel("Zoom in").click();
  samples.push(await metrics(cdp, page));

  await jumpToPage(page, firstTarget);
  await page.locator('[data-testid^="pdf-annotation-overlay-"]').first().waitFor({ timeout: 30000 });
  const activeCounts = samples.map((sample) => sample.renderedPages);
  assert.ok(Math.max(...activeCounts) <= 5, `Rendered page window exceeded five pages: ${activeCounts.join(", ")}`);
  assert.ok(
    Math.max(...samples.map((sample) => sample.canvases)) <= MAX_TRANSIENT_CANVASES,
    `Canvas count must remain bounded during page/zoom replacement: ${samples.map((sample) => sample.canvases).join(", ")}`,
  );
  assert.ok(Math.max(...samples.map((sample) => sample.textLayers)) <= 5, "Text-layer count must remain bounded by the page window.");

  if (process.env.MYVAULT_PDF_SCREENSHOT_PATH && fixturePaths.length === 1) {
    await page.screenshot({ path: process.env.MYVAULT_PDF_SCREENSHOT_PATH, fullPage: false });
  }

  await page.getByLabel("Back to Library").click();
  await page.waitForURL("**/library");
  await page.waitForTimeout(1500);
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  const closedMetrics = await metrics(cdp, page);
  assert.equal(closedMetrics.canvases, 0, "Closing the PDF must release page canvases.");
  assert.equal(closedMetrics.textLayers, 0, "Closing the PDF must release text layers.");
  console.error("[pdf-performance] resources released on close");

  await page.goto(`${baseUrl}/library/document/${attachmentId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pdf-reader").waitFor({ timeout: 120000 });
  await page.locator('[aria-label$="total pages"]').waitFor({ timeout: 120000 });
  assert.equal(Number(await page.getByLabel("Page number").inputValue()), firstTarget, "Reopening must restore the last reading page.");
  await jumpToPage(page, firstTarget);
  await page.locator('[data-testid^="pdf-annotation-overlay-"]').first().waitFor({ timeout: 30000 });
  const reopenedMetrics = await metrics(cdp, page);
  assert.ok(reopenedMetrics.canvases <= 5);
  assert.equal(crashed, false, "Chrome reported a page crash.");
  assert.deepEqual(errors, [], `Unhandled PDF errors: ${errors.join(" | ")}`);
  console.error("[pdf-performance] reopen and persistence verified");

  results.push({
    file: path.basename(fixturePath),
    sizeBytes: file.size,
    pageCount,
    renderWindowLimit: 5,
    peakCanvases: Math.max(...samples.map((sample) => sample.canvases)),
    peakTextLayers: Math.max(...samples.map((sample) => sample.textLayers), 0),
    peakTextSpans: Math.max(...samples.map((sample) => sample.textSpans), 0),
    peakAnnotationLayers: Math.max(...samples.map((sample) => sample.annotationLayers), 0),
    peakDomNodes: Math.max(...samples.map((sample) => sample.domNodes)),
    peakJsHeapBytes: Math.max(...samples.map((sample) => sample.jsHeapBytes)),
    closedDomNodes: closedMetrics.domNodes,
    closedJsHeapBytes: closedMetrics.jsHeapBytes,
    reopenedCanvases: reopenedMetrics.canvases,
    highlightPersisted: true,
    crashed,
    unhandledErrors: errors,
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
