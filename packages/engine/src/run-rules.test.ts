import { describe, it, expect } from 'vitest';
import type { IR, Rule, RuleBinding } from '@sb/ir-schema';
import { runRules, requiresSatisfied } from './run-rules.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function baseIR(over: Partial<IR> = {}): IR {
  return {
    irSchemaVersion: '1.0.0', tenantId: 't', runId: 'r', inputDigest: 'sha256:x',
    l1: { rootId: 'l1:a', nodes: { 'l1:a': {
      nodeId: 'l1:a', provenance: { source: { domPath: 'a' }, captureId: 'c', scenarioId: 'e' },
      confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['e'],
      tag: 'input', attributes: {}, children: [],
    } } },
    l2: [], l3: [], facts: [], ...over,
  } as IR;
}
const ctx = { tenantId: 't' };
const block: RuleBinding = { ruleId: 'rx', ruleVersion: '1.0.0', rolloutState: 'block' };

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'rx', version: '1.0.0', category: 'accessibility', defaultSeverity: 'block',
    confidenceFloor: 0.9, unknownPolicy: 'demote', requires: ['l1'], authority: auth,
    evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
      confidence: 1, severity: 'block', authority: auth, evidence: {} }],
    ...over,
  };
}

describe('requiresSatisfied', () => {
  it('skips a facts-dependent rule when facts is empty', () => {
    expect(requiresSatisfied(['facts'], baseIR())).toBe(false);
    expect(requiresSatisfied(['l1'], baseIR())).toBe(true);
  });
});

describe('runRules', () => {
  it('produces a blocking finding for an observed violation at rollout=block', () => {
    const findings = runRules(baseIR(), [{ rule: rule(), binding: block }], ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].effectiveSeverity).toBe('block');
    expect(findings[0].category).toBe('accessibility');
  });
  it('skips a rule whose requires are unmet', () => {
    const findings = runRules(baseIR(), [{ rule: rule({ requires: ['facts'] }), binding: block }], ctx);
    expect(findings).toHaveLength(0);
  });
  it('FAIL-CLOSED: throws when a violation lacks authority', () => {
    const bad = rule({ evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0', nodeId: 'l1:a',
      nodeStatus: 'known', confidence: 1, severity: 'block', evidence: {} } as never] });
    expect(() => runRules(baseIR(), [{ rule: bad, binding: block }], ctx)).toThrow();
  });
  it('excludes findings whose effectiveSeverity is null (skip policy on unknown)', () => {
    const r = rule({ unknownPolicy: 'skip', evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0',
      nodeId: 'l1:a', nodeStatus: 'unknown', confidence: 1, severity: 'block', authority: auth, evidence: {} }] });
    expect(runRules(baseIR(), [{ rule: r, binding: block }], ctx)).toHaveLength(0);
  });
});
