import { describe, it, expect } from 'vitest';
import { liftHtml } from '@sb/lift';
import { promote } from './promote.js';

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug" required></select>
  <input id="dose" name="order.dose" type="number"/>
  <button>처방 저장</button>
</form>`;

const ir = liftHtml({ html: HTML, tenantId: 'hosp-A', runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
const l2 = promote({ l1: ir.l1, facts: [], tenantId: 'hosp-A', hook: { captureKind: 'runtime-dom' } });

function byKind(kind: string) { return l2.filter((o) => o.kind === kind); }

describe('promote', () => {
  it('produces one Form, two Fields, one Action', () => {
    expect(byKind('Form')).toHaveLength(1);
    expect(byKind('Field')).toHaveLength(2);
    expect(byKind('Action')).toHaveLength(1);
  });

  it('marks the required select as required:true / status known', () => {
    const drug = byKind('Field').find((f: any) => f.binding?.path === 'order.drug') as any;
    expect(drug.required).toBe(true);
    expect(drug.label).toBe('약품');
    expect(drug.status).toBe('known');
  });

  it('marks the untyped-required dose as required:unknown / status ambiguous', () => {
    const dose = byKind('Field').find((f: any) => f.binding?.path === 'order.dose') as any;
    expect(dose.dataType).toBe('number');     // type=number is known
    expect(dose.required).toBe('unknown');    // no required signal
    expect(dose.status).toBe('ambiguous');    // ambiguous propagates to node status
  });

  it('every L2 node has a derivedFrom L1 id and an l2: nodeId', () => {
    for (const o of l2) {
      expect(o.nodeId).toMatch(/^l2:[0-9a-f]{12}$/);
      expect(o.derivedFrom).toHaveLength(1);
      expect(o.derivedFrom[0]).toMatch(/^l1:[0-9a-f]{12}$/);
    }
  });

  it('the Form lists its field and action l2 ids', () => {
    const form = byKind('Form')[0] as any;
    expect(form.fields).toHaveLength(2);
    expect(form.actions).toHaveLength(1);
  });
});
