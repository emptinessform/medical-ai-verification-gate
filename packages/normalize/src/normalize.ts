import { JSDOM } from 'jsdom';
import type { ExternalFact, L1Graph } from '@sb/ir-schema';
import { mapAxeResults } from './map-axe.js';
import { runAxe } from './run-axe.js';

const AXE_ENGINE = 'axe-core@4.x';

// axe-core's IIFE captures the global window at the moment the module is first
// evaluated. Because the module is cached by the ESM loader, every subsequent
// call to runAxe must pass a document that belongs to the SAME window/JSDOM
// instance — otherwise axe's `doc instanceof window.Node` check fails.
// Using a single shared JSDOM and resetting body.innerHTML per call satisfies
// both constraints: same-window compatibility and identical stablePaths/nodeIds
// as liftHtml (which also wraps html in <body>…</body>).
const _sharedDom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');

// NOT safe for concurrent invocation: `_sharedDom` is module-level mutable state.
// Two overlapping calls would clobber each other's body.innerHTML and produce
// silently wrong facts. The verification pipeline runs Runs sequentially, so this
// is fine today; do not call this inside Promise.all without serializing.
export async function normalizeHtml(args: {
  html: string;
  tenantId: string;
  scenarioId: string;
  l1: L1Graph;
}): Promise<ExternalFact[]> {
  // Parse identically to liftHtml so stablePath/nodeId align with the L1 graph.
  const html = args.html.replace(/\r\n?/g, '\n');
  const doc = _sharedDom.window.document;
  doc.body.innerHTML = html;

  const axe = await runAxe(doc);
  const facts = mapAxeResults(axe, doc, {
    tenantId: args.tenantId,
    scenarioId: args.scenarioId,
    engine: AXE_ENGINE,
  });

  // Keep only facts that join to a real L1 node. axe also reports document-level
  // findings on the synthetic <html>/<body> wrapper (e.g. html-has-lang, region);
  // those have no corresponding L1 node and are wrapper artifacts, not findings
  // about the user artifact.
  const l1Ids = new Set(Object.keys(args.l1.nodes));
  return facts.filter((f) => l1Ids.has(f.appliesTo));
}
