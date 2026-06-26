import { describe, it, expect } from 'vitest';
import { liftHtml } from './lift-dom.js';

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug"></select>
  <input id="dose" name="order.dose" type="number"/>
</form>`;

const args = { html: HTML, tenantId: 'hosp-A', runId: 'run1', scenarioId: 'empty', ruleSetPin: 'rs@1' };

describe('liftHtml', () => {
  it('produces a schema-valid IR pinned to 1.0.0', () => {
    const ir = liftHtml(args);
    expect(ir.irSchemaVersion).toBe('1.0.0');
    expect(ir.tenantId).toBe('hosp-A');
    expect(Object.keys(ir.l1.nodes).length).toBeGreaterThan(0);
  });

  it('marks static computed fields as unmeasured (measured:false)', () => {
    const ir = liftHtml(args);
    const select = Object.values(ir.l1.nodes).find((n) => n.tag === 'select')!;
    expect(select.computed?.contrast).toEqual({ value: null, measured: false });
    expect(select.status).toBe('known');
    expect(select.confidence).toBe(1);
  });

  it('keeps L2/L3/facts empty in this slice', () => {
    const ir = liftHtml(args);
    expect(ir.l2).toEqual([]);
    expect(ir.l3).toEqual([]);
    expect(ir.facts).toEqual([]);
  });
});
