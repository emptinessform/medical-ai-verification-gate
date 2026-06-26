import { describe, it, expect } from 'vitest';
import type { ReportedFinding } from '@sb/ir-schema';
import { decideGate, exitCodeFor } from './gate.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function f(over: Partial<ReportedFinding> = {}): ReportedFinding {
  return { ruleId: 'r', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known', confidence: 1,
    severity: 'block', authority: auth, evidence: {}, category: 'accessibility',
    effectiveSeverity: 'block', rolloutState: 'block', overridden: false, ...over };
}

describe('decideGate', () => {
  it('blocks when an effective block finding exists at rollout block', () => {
    const g = decideGate([f()]);
    expect(g.result).toBe('block');
    expect(g.blocking).toContain('r');
    expect(exitCodeFor(g)).toBe(1);
  });
  it('passes when only warnings exist', () => {
    const g = decideGate([f({ effectiveSeverity: 'warn' })]);
    expect(g.result).toBe('pass');
    expect(exitCodeFor(g)).toBe(0);
  });
  it('block-overridden when the only blocker is overridden (exit 0)', () => {
    const g = decideGate([f({ overridden: true })]);
    expect(g.result).toBe('block-overridden');
    expect(exitCodeFor(g)).toBe(0);
  });
});
