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
    switch (rule.unknownPolicy) {
      case 'skip':
        return null;
      case 'report':
        return 'info';
      case 'demote':
        if (sev === 'block') sev = 'warn';
        break;
      default: {
        // compile-time exhaustiveness: adding a new UnknownPolicy without handling it here is a type error
        const _exhaustive: never = rule.unknownPolicy;
        // runtime fail-safe: an unhandled policy must never leave a non-known node blocking
        void _exhaustive;
        if (sev === 'block') sev = 'warn';
      }
    }
  }

  // ③ rollout-gating (P9)
  if (binding.rolloutState === 'shadow') return 'info';
  if (binding.rolloutState === 'warn' && sev === 'block') sev = 'warn';
  // final invariant guard (defense in depth): a hard block requires an observed (known) node
  if (sev === 'block' && v.nodeStatus !== 'known') sev = 'warn';
  return sev;
}
