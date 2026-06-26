import type { Rule, Violation, IR, AuthorityRef, Severity, UnknownPolicy } from '@sb/ir-schema';

export function axeBackedRule(opts: {
  id: string;
  axeRuleId: string;
  defaultSeverity: Severity;
  confidenceFloor: number;
  unknownPolicy: UnknownPolicy;
  authority: AuthorityRef;
}): Rule {
  return {
    id: opts.id,
    version: '1.0.0',
    category: 'accessibility',
    defaultSeverity: opts.defaultSeverity,
    confidenceFloor: opts.confidenceFloor,
    unknownPolicy: opts.unknownPolicy,
    requires: ['facts'],
    authority: opts.authority,
    evaluate(ir: IR): Violation[] {
      const out: Violation[] = [];
      for (const f of ir.facts) {
        if (f.ruleId !== opts.axeRuleId) continue;
        const node = ir.l1.nodes[f.appliesTo];
        if (!node) continue; // fact must join to a real L1 node
        const incomplete = (f.observed as { result?: unknown }).result === 'incomplete';
        out.push({
          ruleId: opts.id,
          ruleVersion: '1.0.0',
          nodeId: f.appliesTo,
          nodeStatus: incomplete ? 'unknown' : node.status,
          confidence: node.confidence,
          severity: opts.defaultSeverity,
          authority: opts.authority,
          evidence: { axeRuleId: opts.axeRuleId, impact: f.impact, observed: f.observed },
        });
      }
      return out;
    },
  };
}
