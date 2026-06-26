import { JSDOM } from 'jsdom';
import { IR, IR_SCHEMA_VERSION, type L1Node } from '@sb/ir-schema';
import { stablePath } from './stable-path.js';
import { makeNodeId } from './node-id.js';
import { inputDigest } from './input-digest.js';

interface LiftArgs {
  html: string;
  tenantId: string;
  runId: string;
  scenarioId: string;
  ruleSetPin: string;
}

const unmeasured = () => ({ value: null, measured: false });

export function liftHtml(args: LiftArgs) {
  const { html, tenantId, runId, scenarioId, ruleSetPin } = args;
  const dom = new JSDOM(`<body>${html}</body>`);
  const doc = dom.window.document;
  const captureId = runId;

  const nodes: Record<string, L1Node> = {};

  function visit(el: Element): string {
    const { path, indexOnly } = stablePath(el);
    const id = makeNodeId('l1', tenantId, path);
    const attributes: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attributes[a.name] = a.value;

    const childIds: string[] = [];
    for (const child of Array.from(el.children)) childIds.push(visit(child));

    nodes[id] = {
      nodeId: id,
      provenance: {
        source: { domPath: path },
        captureId,
        scenarioId,
        ...(indexOnly ? { pathStability: 'index-only' as const } : {}),
      },
      confidence: 1,
      status: 'known',
      derivedFrom: [],
      scenarioCoverage: [scenarioId],
      tag: el.tagName.toLowerCase(),
      attributes,
      ...(el.children.length === 0 && el.textContent?.trim()
        ? { text: el.textContent.trim() }
        : {}),
      computed: {
        contrast: unmeasured(),
        focusable: unmeasured(),
        tabOrder: unmeasured(),
        fontSizePx: unmeasured(),
      },
      children: childIds,
    };
    return id;
  }

  const root = doc.body.firstElementChild;
  if (!root) {
    throw new Error('liftHtml: input html contains no element node to lift');
  }
  const rootId = visit(root);

  return IR.parse({
    irSchemaVersion: IR_SCHEMA_VERSION,
    tenantId,
    runId,
    inputDigest: inputDigest(html, ruleSetPin),
    l1: { rootId, nodes },
    l2: [],
    l3: [],
    facts: [],
  });
}
