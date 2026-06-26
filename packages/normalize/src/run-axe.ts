import type { AxeOutput } from './map-axe.js';

// axe-core needs DOM globals set BEFORE it is imported, and deduces its context then.
// We set them, dynamically import axe, run, and restore the prior globals.
export async function runAxe(doc: Document): Promise<AxeOutput> {
  const win = (doc.defaultView ?? (doc as unknown as { window?: unknown }).window) as
    | (Window & typeof globalThis)
    | undefined;
  if (!win) throw new Error('runAxe: document has no associated window');

  const g = globalThis as Record<string, unknown>;
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'Element', 'getComputedStyle'] as const;
  const prior: Record<string, unknown> = {};
  for (const k of keys) prior[k] = g[k];

  g['window'] = win;
  g['document'] = doc;
  g['Node'] = (win as unknown as { Node: unknown }).Node;
  g['HTMLElement'] = (win as unknown as { HTMLElement: unknown }).HTMLElement;
  g['Element'] = (win as unknown as { Element: unknown }).Element;
  g['getComputedStyle'] = win.getComputedStyle.bind(win);

  try {
    const axe = (await import('axe-core')).default;
    const results = await axe.run(doc, { resultTypes: ['violations', 'incomplete'] });
    // axe's Result[] is structurally compatible with our minimal AxeResult[]; adapt at this boundary.
    return {
      violations: results.violations as unknown as AxeOutput['violations'],
      incomplete: results.incomplete as unknown as AxeOutput['incomplete'],
    };
  } finally {
    for (const k of keys) g[k] = prior[k];
  }
}
