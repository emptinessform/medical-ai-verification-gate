import { describe, it, expect } from 'vitest';
import type { IR, ExternalFact } from '@sb/ir-schema';
import { a11yInputLabel, a11yColorContrast } from './a11y.js';

function irWith(facts: ExternalFact[]): IR {
  return {
    irSchemaVersion: '1.0.0', tenantId: 't', runId: 'r', inputDigest: 'sha256:x',
    l1: { rootId: 'l1:a', nodes: { 'l1:a': {
      nodeId: 'l1:a', provenance: { source: { domPath: 'a' }, captureId: 'c', scenarioId: 'e' },
      confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['e'],
      tag: 'input', attributes: {}, children: [],
    } } },
    l2: [], l3: [], facts,
  } as IR;
}
const ctx = { tenantId: 't' };
function fact(over: Partial<ExternalFact>): ExternalFact {
  return { engine: 'axe-core@4.x', ruleId: 'label', appliesTo: 'l1:a', impact: 'serious',
    measurable: true, observed: {}, scenarioId: 'e', ...over };
}

describe('a11yInputLabel', () => {
  it('emits an observed (known) violation from a label fact', () => {
    const vs = a11yInputLabel.evaluate(irWith([fact({ ruleId: 'label' })]), ctx);
    expect(vs).toHaveLength(1);
    expect(vs[0].nodeStatus).toBe('known');
    expect(vs[0].confidence).toBe(1);
    expect(vs[0].authority.standard).toContain('WCAG');
  });
  it('requires facts (auto-skip handled by engine)', () => {
    expect(a11yInputLabel.requires).toContain('facts');
  });
});

describe('a11yColorContrast', () => {
  it('marks an incomplete contrast fact as nodeStatus unknown (gate will demote)', () => {
    const vs = a11yColorContrast.evaluate(
      irWith([fact({ ruleId: 'color-contrast', observed: { result: 'incomplete' } })]), ctx);
    expect(vs).toHaveLength(1);
    expect(vs[0].nodeStatus).toBe('unknown'); // P5/P6: unmeasured → unknown → demoted at gate
  });
  it('uses unknownPolicy demote so incomplete never hard-blocks', () => {
    expect(a11yColorContrast.unknownPolicy).toBe('demote');
  });
});
