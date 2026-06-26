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

  it('throws a clear error when the html has no element', () => {
    expect(() => liftHtml({ ...args, html: '   ' })).toThrow(/no element/);
  });

  it('throws when html has multiple root elements', () => {
    expect(() => liftHtml({ ...args, html: '<div></div><div></div>' })).toThrow(
      /expected exactly one root/,
    );
  });

  it('lifts both inputs in a radio group to distinct nodes', () => {
    const ir = liftHtml({
      ...args,
      html: '<form><input name="sex" value="m"/><input name="sex" value="f"/></form>',
    });
    const inputNodes = Object.values(ir.l1.nodes).filter((n) => n.tag === 'input');
    expect(inputNodes.length).toBe(2);
    const nodeIds = inputNodes.map((n) => n.nodeId);
    expect(nodeIds[0]).not.toBe(nodeIds[1]);
  });
});
