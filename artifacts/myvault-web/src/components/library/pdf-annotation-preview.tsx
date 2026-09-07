import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RestoredPdfAnnotation } from '@/lib/restore/restoredCorpus';

type Preview = { url: string; partial: boolean };
const cache = new Map<string, Preview>();
const MAX_PREVIEWS = 40;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
// One crop render at a time, independent of the reader's bounded visible-page window.
let renderQueue: Promise<unknown> = Promise.resolve();

export function annotationBounds(annotation: RestoredPdfAnnotation, width: number, height: number) {
  const normalized = annotation.right <= 1.2 && annotation.bottom <= 1.2;
  const x = Math.max(0, annotation.left * (normalized ? width : 1));
  const y = Math.max(0, annotation.top * (normalized ? height : 1));
  return { x, y, width: Math.max(0, Math.min(width, annotation.right * (normalized ? width : 1)) - x), height: Math.max(0, Math.min(height, annotation.bottom * (normalized ? height : 1)) - y) };
}

export function previewKey(identity: string, annotation: RestoredPdfAnnotation) {
  return JSON.stringify([identity, annotation.id, annotation.pageIndex, annotation.left, annotation.top, annotation.right, annotation.bottom, annotation.updatedAt]);
}

export function retainAnnotationPreviews(identity: string, annotations: RestoredPdfAnnotation[]) {
  const valid = new Set(annotations.map(annotation => previewKey(identity, annotation)));
  for (const key of cache.keys()) {
    if ((JSON.parse(key) as string[])[0] === identity && !valid.has(key)) cache.delete(key);
  }
}

export function PdfAnnotationPreview({ document, identity, annotation }: { document: PDFDocumentProxy; identity: string; annotation: RestoredPdfAnnotation }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const key = previewKey(identity, annotation);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '120px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setResult(null); setFailed(false);
    if (!visible) return;
    let cancelled = false;
    const saved = cache.get(key);
    if (saved) { cache.delete(key); cache.set(key, saved); setResult(saved); return; }
    const render = async () => {
      if (cancelled) return;
      const page = await document.getPage(annotation.pageIndex + 1);
      const source = page.getViewport({ scale: 1 });
      const bounds = annotationBounds(annotation, source.width, source.height);
      if (!bounds.width || !bounds.height) throw new Error('No renderable rectangle');
      const scale = Math.min(2, 560 / bounds.width);
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(bounds.width * scale);
      canvas.height = Math.min(360, Math.ceil(bounds.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      try {
        await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -bounds.x * scale, -bounds.y * scale] }).promise;
        const preview = { url: canvas.toDataURL('image/png'), partial: bounds.height * scale > 360 };
        if (!cancelled) {
          cache.set(key, preview);
          let bytes = [...cache.values()].reduce((sum, item) => sum + item.url.length * 2, 0);
          while (cache.size > MAX_PREVIEWS || bytes > MAX_PREVIEW_BYTES) {
            const oldest = cache.keys().next().value!;
            bytes -= cache.get(oldest)!.url.length * 2;
            cache.delete(oldest);
          }
          setResult(preview);
        }
      } finally { canvas.width = 0; canvas.height = 0; }
    };
    renderQueue = renderQueue.catch(() => undefined).then(render).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [key, visible, document]);
  return <div ref={element} className="min-h-24">
    {result ? <img src={result.url} alt="Highlighted PDF region" className="block w-full bg-white" data-testid={`pdf-raster-${annotation.id}`} /> : <p className="py-6 text-xs text-muted-foreground">{failed ? 'Preview unavailable' : 'Preparing preview…'}</p>}
    <p className="py-2 text-xs leading-5 text-muted-foreground">Page {annotation.pageIndex + 1} · {result?.partial ? 'Partial preview · Open full highlighted region' : 'Open highlighted area'} →</p>
  </div>;
}
