import { describe, it, expect } from 'vitest';
import { liftHtml } from '@sb/lift';
import { normalizeHtml } from './normalize.js';

const HTML = `<form>
  <input id="dose" type="number"/>
  <img src="pill.png"/>
  <button>저장</button>
</form>`;

const args = { html: HTML, tenantId: 'hosp-A', scenarioId: 'empty' };

describe('normalizeHtml', () => {
  it('produces facts that all join to an existing L1 node', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(facts.length).toBeGreaterThan(0);
    const l1Ids = new Set(Object.keys(ir.l1.nodes));
    for (const f of facts) {
      expect(l1Ids.has(f.appliesTo)).toBe(true); // every fact joins to a real L1 node
      expect(f.appliesTo).toMatch(/^l1:[0-9a-f]{12}$/);
      expect(f.engine).toContain('axe-core');
    }
  });

  it('surfaces the missing-alt finding on the img (image-alt) joined to its L1 node', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    const imgNode = Object.values(ir.l1.nodes).find((n) => n.tag === 'img')!;
    const imgFacts = facts.filter((f) => f.appliesTo === imgNode.nodeId);
    expect(imgFacts.some((f) => f.ruleId === 'image-alt')).toBe(true);
  });

  it('is deterministic across two runs', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const a = await normalizeHtml({ ...args, l1: ir.l1 });
    const b = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces a schema-valid IR when fed back into the IR root', async () => {
    const { IR } = await import('@sb/ir-schema');
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(() => IR.parse({ ...ir, facts })).not.toThrow();
  });
});
