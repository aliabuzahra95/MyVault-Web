import { pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getActiveAccountId } from '@/lib/sync/accountContext';

type Entry = { document: Promise<PDFDocumentProxy>; bytes: number; users: number; touched: number; timer?: ReturnType<typeof setTimeout> };
const entries = new Map<string, Entry>();
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DOCUMENTS = 2;
const IDLE_MS = 60_000;

function remove(key: string, entry: Entry) {
  if (entry.users || entries.get(key) !== entry) return;
  entries.delete(key);
  clearTimeout(entry.timer);
  void entry.document.then(pdf => pdf.destroy()).catch(() => undefined);
}

function trim() {
  let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of [...entries].sort((a, b) => a[1].touched - b[1].touched)) {
    if (entries.size <= MAX_DOCUMENTS && bytes <= MAX_BYTES) break;
    if (!entry.users) { bytes -= entry.bytes; remove(key, entry); }
  }
}

export async function acquirePdfDocument(attachmentId: string, url: string) {
  const started = performance.now();
  const account = getActiveAccountId();
  const response = await fetch(url);
  if (!response.ok) throw new Error('The local PDF could not be read.');
  const data = await response.arrayBuffer();
  const bytesReady = performance.now();
  // Content identity prevents a replaced file, reused filename or account switch reusing an old document.
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const key = `${account}:${attachmentId}:${hash}`;
  let entry = entries.get(key);
  const hit = Boolean(entry);
  if (!entry) {
    const bytes = data.byteLength;
    const task = pdfjs.getDocument({ data: new Uint8Array(data) });
    entry = { document: task.promise, bytes, users: 0, touched: Date.now() };
    entries.set(key, entry);
  }
  entry.users++;
  entry.touched = Date.now();
  clearTimeout(entry.timer);
  const owned = entry;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    owned.users--;
    owned.timer = setTimeout(() => remove(key, owned), IDLE_MS);
    trim();
  };
  try {
    const document = await entry.document;
    trim();
    return { document, key, release, timing: { hit, localBytesMs: bytesReady - started, initMs: performance.now() - bytesReady } };
  } catch (error) {
    release();
    remove(key, owned);
    throw error;
  }
}
