import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from './lift-dom.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fixtures = join(dir, '..', 'fixtures');
const html = readFileSync(join(fixtures, 'prescription.html'), 'utf8');
const goldenPath = join(fixtures, 'prescription.golden.json');

const args = { html, tenantId: 'hosp-A', runId: 'run1', scenarioId: 'empty', ruleSetPin: 'rs@1' };

describe('determinism', () => {
  it('produces a bit-identical IR across two runs', () => {
    const a = JSON.stringify(liftHtml(args));
    const b = JSON.stringify(liftHtml(args));
    expect(a).toBe(b);
  });

  it('matches the committed golden snapshot', () => {
    const ir = liftHtml(args);
    const actual = JSON.stringify(ir, null, 2);
    if (!existsSync(goldenPath)) {
      writeFileSync(goldenPath, actual); // 최초 1회 생성
    }
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });

  it('every nodeId is the deterministic l1:<12hex> form', () => {
    const ir = liftHtml(args);
    for (const id of Object.keys(ir.l1.nodes)) {
      expect(id).toMatch(/^l1:[0-9a-f]{12}$/);
      // Join-key invariant: embedded nodeId must equal its map key.
      expect(ir.l1.nodes[id].nodeId).toBe(id);
    }
  });
});
