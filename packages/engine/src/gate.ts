import type { ReportedFinding, GateDecision } from '@sb/ir-schema';

export function decideGate(findings: ReportedFinding[]): GateDecision {
  const blocking = findings.filter(
    (f) => f.effectiveSeverity === 'block' && f.rolloutState === 'block' && !f.overridden,
  );
  if (blocking.length === 0) {
    const wasOverridden = findings.some(
      (f) => f.effectiveSeverity === 'block' && f.rolloutState === 'block' && f.overridden,
    );
    return { result: wasOverridden ? 'block-overridden' : 'pass', blocking: [] };
  }
  return { result: 'block', blocking: blocking.map((f) => f.ruleId) };
}

export function exitCodeFor(gate: GateDecision): 0 | 1 {
  // pass / block-overridden → 0 ; block → 1 (tool-error exit 2 is handled by the CLI layer)
  return gate.result === 'block' ? 1 : 0;
}
