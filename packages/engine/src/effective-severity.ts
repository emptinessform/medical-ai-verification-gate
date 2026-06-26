import type { Severity, Violation, RuleBinding, UnknownPolicy } from '@sb/ir-schema';

export function effectiveSeverity(
  v: Violation,
  binding: RuleBinding,
  rule: { confidenceFloor: number; unknownPolicy: UnknownPolicy },
): Severity | null {
  let sev: Severity = v.severity;

  // ① confidence-gating (P5)
  if (sev === 'block' && v.confidence < rule.confidenceFloor) sev = 'warn';

  // ② status-gating (P6) — dominates even when confidence ≥ floor
  if (v.nodeStatus === 'unknown' || v.nodeStatus === 'ambiguous') {
    if (rule.unknownPolicy === 'skip') return null;
    if (rule.unknownPolicy === 'report') return 'info';
    if (rule.unknownPolicy === 'demote' && sev === 'block') sev = 'warn';
  }

  // ③ rollout-gating (P9)
  if (binding.rolloutState === 'shadow') return 'info';
  if (binding.rolloutState === 'warn' && sev === 'block') sev = 'warn';
  return sev;
}
