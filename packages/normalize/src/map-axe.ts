import type { ExternalFact } from '@sb/ir-schema';
import { stablePath, makeNodeId } from '@sb/lift';

export interface AxeCheck {
  data?: unknown;
}
export interface AxeNode {
  target: string | string[];
  any?: AxeCheck[];
  all?: AxeCheck[];
  none?: AxeCheck[];
}
export interface AxeResult {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  nodes: AxeNode[];
}
export interface AxeOutput {
  violations: AxeResult[];
  incomplete: AxeResult[];
}

function selectorOf(target: string | string[]): string {
  return Array.isArray(target) ? target[target.length - 1] : target;
}

function observedOf(node: AxeNode): Record<string, unknown> {
  for (const group of [node.any, node.all, node.none]) {
    if (group) {
      for (const c of group) {
        if (c.data == null) continue;
        return typeof c.data === 'object'
          ? (c.data as Record<string, unknown>)
          : { value: c.data };
      }
    }
  }
  return {};
}

export function mapAxeResults(
  axe: AxeOutput,
  doc: Document,
  opts: { tenantId: string; scenarioId: string; engine: string },
): ExternalFact[] {
  const facts: ExternalFact[] = [];

  const consume = (results: AxeResult[], incomplete: boolean) => {
    for (const r of results) {
      for (const node of r.nodes) {
        const selector = selectorOf(node.target);
        // axe ran on this doc, so selectors resolve; an unresolvable selector yields no
        // element and is skipped (it is not an incomplete result, so §3.4 no-silent-drop holds).
        const els = Array.from(doc.querySelectorAll(selector));
        const data = observedOf(node);
        for (const el of els) {
          const { path } = stablePath(el);
          facts.push({
            engine: opts.engine,
            ruleId: r.id,
            appliesTo: makeNodeId('l1', opts.tenantId, path),
            impact: r.impact ?? 'moderate',
            measurable: true,
            observed: incomplete ? { ...data, result: 'incomplete' } : data,
            scenarioId: opts.scenarioId,
          });
        }
      }
    }
  };

  consume(axe.violations, false);
  consume(axe.incomplete, true); // §3.4: incomplete preserved, never dropped

  facts.sort((a, b) => {
    if (a.appliesTo !== b.appliesTo) return a.appliesTo < b.appliesTo ? -1 : 1;
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    if (a.measurable !== b.measurable) return a.measurable ? -1 : 1;
    return 0;
  });
  return facts;
}
