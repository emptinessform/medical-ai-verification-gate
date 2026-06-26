import { describe, it, expect } from 'vitest';
import { Violation, AuthorityRef, RuleBinding, ReportedFinding } from './gate.js';

const authority = { standard: 'WCAG 2.1', clause: '4.1.2' };
const v = {
  ruleId: 'a11y.input-label', ruleVersion: '1.0.0', nodeId: 'l1:abc',
  nodeStatus: 'known' as const, confidence: 1, severity: 'block' as const,
  authority, evidence: { axeRuleId: 'label' },
};

describe('Violation', () => {
  it('accepts a violation with authority', () => {
    expect(Violation.parse(v).ruleId).toBe('a11y.input-label');
  });
  it('REJECTS a violation missing authority (fail-closed)', () => {
    const { authority: _omit, ...noAuth } = v;
    expect(() => Violation.parse(noAuth)).toThrow();
  });
});

describe('AuthorityRef', () => {
  it('requires standard and clause', () => {
    expect(AuthorityRef.parse(authority).clause).toBe('4.1.2');
    expect(() => AuthorityRef.parse({ standard: 'WCAG 2.1' })).toThrow();
  });
});

describe('RuleBinding', () => {
  it('accepts rollout states', () => {
    expect(RuleBinding.parse({ ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'block' }).rolloutState).toBe('block');
    expect(() => RuleBinding.parse({ ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'live' })).toThrow();
  });
});

describe('ReportedFinding', () => {
  it('extends a violation with gate fields', () => {
    const f = { ...v, category: 'accessibility' as const, effectiveSeverity: 'block' as const,
      rolloutState: 'block' as const, overridden: false };
    expect(ReportedFinding.parse(f).effectiveSeverity).toBe('block');
  });
});
