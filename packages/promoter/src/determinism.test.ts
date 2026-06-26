import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from '@sb/lift';
import { promote } from './promote.js';

const dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(dir, '..', 'fixtures', 'prescription-l2.golden.json');

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug" required></select>
  <input id="dose" name="order.dose" type="number"/>
  <button>처방 저장</button>
</form>`;

function run() {
  const ir = liftHtml({ html: HTML, tenantId: 'hosp-A', runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
  return promote({ l1: ir.l1, facts: [], tenantId: 'hosp-A', hook: { captureKind: 'runtime-dom' } });
}

describe('promoter determinism', () => {
  it('produces a bit-identical L2 across two runs', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('matches the committed golden snapshot', () => {
    const actual = JSON.stringify(run(), null, 2);
    if (!existsSync(goldenPath)) writeFileSync(goldenPath, actual);
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });

  it('every l2 node references a deterministic l1 id', () => {
    for (const o of run()) {
      expect(o.nodeId).toMatch(/^l2:[0-9a-f]{12}$/);
      expect(o.derivedFrom[0]).toMatch(/^l1:[0-9a-f]{12}$/);
    }
  });
});
