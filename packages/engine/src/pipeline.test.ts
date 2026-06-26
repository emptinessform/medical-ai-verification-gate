import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from '@sb/lift';
import { normalizeHtml } from '@sb/normalize';
import { A11Y_RULES } from '@sb/rules';
import { runRules, decideGate, exitCodeFor } from './index.js';
import type { RuleBinding } from '@sb/ir-schema';

const dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(dir, '..', 'fixtures', 'gate.golden.json');

// An unlabeled input + an img without alt + a low-contrast button.
const HTML = `<form>
  <input id="dose" type="number"/>
  <img src="pill.png"/>
  <button style="color:#bbb;background:#fff">저장</button>
</form>`;

const TENANT = 'hosp-A';
const bindings: Record<string, RuleBinding> = Object.fromEntries(
  A11Y_RULES.map((r) => [r.id, { ruleId: r.id, ruleVersion: r.version, rolloutState: 'block' }]),
);

async function run() {
  const ir = liftHtml({ html: HTML, tenantId: TENANT, runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
  const facts = await normalizeHtml({ html: HTML, tenantId: TENANT, scenarioId: 'empty', l1: ir.l1 });
  const irWithFacts = { ...ir, facts };
  const ruleset = A11Y_RULES.map((rule) => ({ rule, binding: bindings[rule.id] }));
  const findings = runRules(irWithFacts, ruleset, { tenantId: TENANT });
  const gate = decideGate(findings);
  return { findings, gate, exit: exitCodeFor(gate) };
}

describe('full pipeline → gate', () => {
  it('BLOCKS on observed accessibility violations (label/image-alt)', async () => {
    const { findings, gate, exit } = await run();
    // label and image-alt are observed (known) → block-capable
    const blockers = findings.filter((f) => f.effectiveSeverity === 'block').map((f) => f.ruleId);
    expect(blockers).toContain('a11y.input-label');
    expect(blockers).toContain('a11y.image-alt');
    expect(gate.result).toBe('block');
    expect(exit).toBe(1);
  });

  it('DEMOTES incomplete color-contrast to warn (never hard-blocks — P5/P6)', async () => {
    const { findings } = await run();
    const cc = findings.find((f) => f.ruleId === 'a11y.color-contrast');
    if (cc) {
      expect(cc.nodeStatus).toBe('unknown');
      expect(cc.effectiveSeverity).not.toBe('block'); // demoted because unmeasured in jsdom
    }
  });

  it('every finding carries an authority (fail-closed held)', async () => {
    const { findings } = await run();
    for (const f of findings) expect(f.authority.standard).toContain('WCAG');
  });

  it('is deterministic and matches the committed golden', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const actual = JSON.stringify(a, null, 2);
    if (!existsSync(goldenPath)) writeFileSync(goldenPath, actual);
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });
});
