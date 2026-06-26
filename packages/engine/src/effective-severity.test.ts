import { describe, it, expect } from 'vitest';
import type { Violation, RuleBinding } from '@sb/ir-schema';
import { effectiveSeverity } from './effective-severity.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function v(over: Partial<Violation> = {}): Violation {
  return { ruleId: 'r', ruleVersion: '1.0.0', nodeId: 'l1:x', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: {}, ...over };
}
const rule = { confidenceFloor: 0.9, unknownPolicy: 'demote' as const };
const block: RuleBinding = { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'block' };

describe('effectiveSeverity', () => {
  it('observed + high confidence + rollout block ⇒ block (the only way to block)', () => {
    expect(effectiveSeverity(v(), block, rule)).toBe('block');
  });
  it('confidence below floor demotes block→warn', () => {
    expect(effectiveSeverity(v({ confidence: 0.5 }), block, rule)).toBe('warn');
  });
  it('unknown status with demote policy ⇒ warn', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'unknown' }), block, rule)).toBe('warn');
  });
  it('ambiguous status with skip policy ⇒ null (removed)', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'ambiguous' }), block, { confidenceFloor: 0.9, unknownPolicy: 'skip' })).toBeNull();
  });
  it('unknown status with report policy ⇒ info', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'unknown' }), block, { confidenceFloor: 0.9, unknownPolicy: 'report' })).toBe('info');
  });
  it('shadow rollout ⇒ info regardless', () => {
    expect(effectiveSeverity(v(), { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'shadow' }, rule)).toBe('info');
  });
  it('warn rollout demotes block→warn', () => {
    expect(effectiveSeverity(v(), { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'warn' }, rule)).toBe('warn');
  });
  it('INVARIANT: never blocks when status is not known', () => {
    for (const s of ['unknown', 'ambiguous'] as const) {
      expect(effectiveSeverity(v({ nodeStatus: s }), block, rule)).not.toBe('block');
    }
  });
  it('INVARIANT holds even if confidence is high and rollout is block, for non-known status', () => {
    // demote policy + unknown status: must not block regardless of confidence/rollout
    expect(effectiveSeverity(v({ nodeStatus: 'unknown', confidence: 1 }), block, rule)).toBe('warn');
  });
});
