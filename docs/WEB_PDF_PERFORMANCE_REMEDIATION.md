# MyVault Web PDF Performance Remediation

Date: 2026-08-29 (Australia/Sydney)

Scope: large-PDF rendering, highlighting stability, bounded memory, resource cleanup, and contained PDF errors.

Starting commit: `bf44e25cf643ef55b63010fa6fc0decefcb442e7`

## Root cause

The previous viewer mapped every PDF page directly to a React-PDF `Page`. A 1,494-page PDF therefore mounted approximately 1,494 canvases, 1,494 text layers, and 1,494 annotation layers. Turning on highlight mode or saving annotation state rerendered the parent containing that entire tree. A module-level `Map<string, Blob>` also retained every opened PDF for the life of the tab in addition to IndexedDB and the active object URL.

The earlier production audit measured about 1.9 GB Chrome process-family RSS with a 500-page eager-render fixture. The real 24,118,227-byte/1,494-page scanned PDF reproduced the reported freeze/crash path.

## Implemented architecture

### Stable document

- One React-PDF `Document` remains mounted for the opened object URL.
- Annotation, colour, highlight-mode, and panel state do not change its key.
- The automated highlight test marks the active canvas before save and proves the same canvas node remains afterward.

### Five-page virtualization window

- Only the current page plus two pages before and after mount React-PDF `Page` instances.
- A maximum of five page canvases, text layers, and PDF annotation layers are active in steady state.
- Off-screen pages keep lightweight, fixed-height placeholders so total document height, page jump, reading position, and scroll continuity remain stable.
- `IntersectionObserver` updates current-page state without scanning all page elements on every scroll event.
- Unmounting an obsolete `Page` lets React-PDF cancel/release its pending render, canvas, text layer, and annotation layer.

### Stable variable-page geometry

- The viewer reads page 1 dimensions before creating the virtual document layout.
- Unknown pages use that established ratio rather than changing globally as distant pages load.
- Programmatic jumps remain anchored until the complete five-page local window has reported real dimensions. This prevents mixed-size neighboring pages from pushing the requested page out of view.
- Page dimensions use an explicit 24-entry bounded cache. Distant dimension entries are evicted.

### Page-local annotation work

- Annotation overlays mount only for the five active pages.
- The overlay component has a reference-aware memo comparison, so adding an annotation to one page does not rebuild unchanged active-page overlays.
- Expensive PDF `Page` components are memoized independently from toolbar and annotation metadata.

### Blob and reader cleanup

- The unbounded module-level PDF Blob map was removed.
- IndexedDB remains the durable local Blob owner; the open reader owns one object URL.
- Replaced and closed object URLs are revoked.
- Page observers and timers are disconnected/cleared on unmount.
- A PDF reader error boundary contains unexpected rendering errors instead of allowing the whole MyVault application to reload.

## Chrome stress evidence

All tests used the production Library document route, local attachment persistence, real Chrome, two drawn highlights where the PDF had multiple pages, a page note, zoom, a return jump, close, and reopen. `peakJsHeapBytes` is Chrome's measured JavaScript heap after forced collection at checkpoints, not whole-process RSS.

| Fixture | Size | Pages | Peak PDF canvases | Peak text layers | Peak DOM nodes | Peak JS heap | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| macOS Volume fixture | 16,284 B | 1 | 2 during replacement | 1 | 388 | 15.7 MB | PASS |
| Arabic medium fixture | 12,362,535 B | 247 | 5 | 5 | 1,402 | 18.0 MB | PASS |
| Reported crash fixture | 24,118,227 B | 1,494 | 5 | 5 | 6,374 | 24.1 MB | PASS |
| Largest suitable local fixture | 40,482,212 B | 135 | 5 | 5 | 954 | 17.3 MB | PASS |
| High-page text-layer fixture | 16,704,585 B | 494 | 5 | 5, 24 spans sampled | 2,405 | 20.4 MB | PASS |

The 1,494-page fixture fell from 6,374 measured DOM nodes/24.1 MB JavaScript heap while open to 334 nodes/15.6 MB after close. It had zero PDF canvases and text layers after leaving the reader. The 494-page text fixture also had zero attached PDF canvases/text layers after close; its JavaScript heap fell from 20.4 MB to 16.8 MB.

No tested fixture froze, crashed, reloaded, or emitted an unhandled page error after remediation. Highlights and the page note persisted after closing and reopening each fixture.

## Targeted contract

`pnpm --filter @workspace/myvault-web run verify:pdf-performance -- <pdf paths...>` verifies:

- active rendered page count never exceeds five;
- canvas/text/annotation resources remain bounded;
- deep jumps work for uniform and mixed page sizes;
- one annotation save retains the same active canvas node;
- two distant highlights and one page note save successfully;
- zoom remains usable;
- returning to the earlier page displays the highlight;
- closing releases attached PDF canvases and text layers;
- reopening restores reading position and annotations;
- no Chrome page crash or unhandled exception occurs.

## Deliberately unchanged

- PDF annotation coordinates, types, tags, Study links, and backup representation.
- Text selection and text-layer behavior on active pages.
- PDF.js/React-PDF document, worker, and rendering engines.
- Library metadata and IndexedDB schema.
- Android source and backup format.
