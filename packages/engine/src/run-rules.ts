import { Violation, type IR, type Rule, type RuleBinding, type ReportedFinding, type RuleContext } from '@sb/ir-schema';
import { effectiveSeverity } from './effective-severity.js';

export function requiresSatisfied(requires: Rule['requires'], ir: IR): boolean {
  return requires.every((req) => {
    switch (req) {
      case 'l1': return Object.keys(ir.l1.nodes).length > 0;
      case 'l2': return ir.l2.length > 0;
      case 'l3': return ir.l3.length > 0;
      case 'facts': return ir.facts.length > 0;
    }
  });
}

export function runRules(
  ir: IR,
  ruleset: Array<{ rule: Rule; binding: RuleBinding }>,
  ctx: RuleContext,
): ReportedFinding[] {
  const findings: ReportedFinding[] = [];
  const ordered = [...ruleset].sort((a, b) => (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0));

  for (const { rule, binding } of ordered) {
    if (!requiresSatisfied(rule.requires, ir)) continue; // auto-skip
    const raw = rule.evaluate(ir, ctx);
    for (const candidate of raw) {
      // fail-closed: a violation without authority is rejected at the schema boundary
      const v = Violation.parse(candidate);
      const eff = effectiveSeverity(v, binding, rule);
      if (eff === null) continue;
      findings.push({
        ...v,
        category: rule.category,
        effectiveSeverity: eff,
        rolloutState: binding.rolloutState,
        overridden: false,
      });
    }
  }

  findings.sort((a, b) =>
    a.ruleId !== b.ruleId ? (a.ruleId < b.ruleId ? -1 : 1)
    : a.nodeId !== b.nodeId ? (a.nodeId < b.nodeId ? -1 : 1) : 0);
  return findings;
}
