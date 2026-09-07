type Trace = {started: number; stages: Record<string, number>; detail: Record<string, unknown>};
const traces = new Map<string, Trace>();
export function beginPdfOpen(id: string) {
  traces.delete(id);
  traces.set(id, {started: performance.now(), stages: {}, detail: {}});
  while (traces.size > 8) traces.delete(traces.keys().next().value!);
}
export function markPdfOpen(id: string, stage: string, detail: Record<string, unknown> = {}) {
  const trace = traces.get(id);
  if (!trace) return;
  trace.stages[stage] ??= performance.now() - trace.started;
  Object.assign(trace.detail, detail);
  performance.clearMeasures('myvault-pdf-open');
  performance.measure('myvault-pdf-open', {start: trace.started, detail: {stages: {...trace.stages}, ...trace.detail}});
}
