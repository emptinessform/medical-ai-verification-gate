import { z } from 'zod';
import { NodeStatus } from './scalars.js';
import type { IR } from './ir.js';

export const Severity = z.enum(['block', 'warn', 'info']);
export type Severity = z.infer<typeof Severity>;

export const RuleCategory = z.enum([
  'accessibility', 'consistency', 'data-integrity-closed', 'data-integrity-contract', 'regulatory-safety',
]);
export type RuleCategory = z.infer<typeof RuleCategory>;

export const UnknownPolicy = z.enum(['skip', 'demote', 'report']);
export type UnknownPolicy = z.infer<typeof UnknownPolicy>;

export const RolloutState = z.enum(['shadow', 'warn', 'block']);
export type RolloutState = z.infer<typeof RolloutState>;

export const AuthorityRef = z.object({
  standard: z.string(),
  clause: z.string(),
  url: z.string().optional(),
});
export type AuthorityRef = z.infer<typeof AuthorityRef>;

export const Violation = z.object({
  ruleId: z.string(),
  ruleVersion: z.string(),
  nodeId: z.string(),
  nodeStatus: NodeStatus,
  confidence: z.number().min(0).max(1),
  severity: Severity,
  authority: AuthorityRef, // REQUIRED — fail-closed (P4/ADR-4)
  evidence: z.record(z.unknown()),
});
export type Violation = z.infer<typeof Violation>;

export const RuleBinding = z.object({
  ruleId: z.string(),
  ruleVersion: z.string(),
  rolloutState: RolloutState,
});
export type RuleBinding = z.infer<typeof RuleBinding>;

export const ReportedFinding = Violation.extend({
  category: RuleCategory,
  effectiveSeverity: Severity,
  rolloutState: RolloutState,
  overridden: z.boolean(),
});
export type ReportedFinding = z.infer<typeof ReportedFinding>;

export type GateResult = 'pass' | 'block' | 'block-overridden';
export interface GateDecision {
  result: GateResult;
  blocking: string[]; // ruleIds that block
}

// Rule plugin interface — TS interface (carries a function, so not a Zod schema).
export interface RuleContext {
  tenantId: string;
}
export interface Rule {
  id: string;
  version: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  confidenceFloor: number; // 0..1
  unknownPolicy: UnknownPolicy;
  requires: Array<'l1' | 'l2' | 'l3' | 'facts'>;
  authority: AuthorityRef;
  evaluate(ir: IR, ctx: RuleContext): Violation[];
}
