import { JSDOM } from 'jsdom';
import { IR, type L1Node } from '@sb/ir-schema';
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

const unmeasuredNumber = { value: null, measured: false };

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
        contrast: unmeasuredNumber,
        focusable: { value: null, measured: false },
        tabOrder: unmeasuredNumber,
        fontSizePx: unmeasuredNumber,
      },
      children: childIds,
    };
    return id;
  }

  const root = doc.body.firstElementChild!;
  const rootId = visit(root);

  return IR.parse({
    irSchemaVersion: '1.0.0',
    tenantId,
    runId,
    inputDigest: inputDigest(html, ruleSetPin),
    l1: { rootId, nodes },
    l2: [],
    l3: [],
    facts: [],
  });
}
