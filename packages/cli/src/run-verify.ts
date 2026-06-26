import { liftHtml } from '@sb/lift';
import { normalizeHtml } from '@sb/normalize';
import { promote } from '@sb/promoter';
import { A11Y_RULES } from '@sb/rules';
import { runRules, decideGate, exitCodeFor } from '@sb/engine';
import { buildReport, type ValidationReport } from '@sb/report';
import type { RuleBinding } from '@sb/ir-schema';

export interface VerifyResult {
  report?: ValidationReport;
  error?: string;
  exitCode: 0 | 1 | 2;
}

export async function runVerify(args: {
  html: string;
  tenantId: string;
  runId: string;
  ruleSetPin: string;
  generatedAt: string;
  gateEnabled: boolean;
}): Promise<VerifyResult> {
  const { html, tenantId, runId, ruleSetPin, generatedAt, gateEnabled } = args;
  try {
    const ir = liftHtml({ html, tenantId, runId, scenarioId: 'empty', ruleSetPin });
    const facts = await normalizeHtml({ html, tenantId, scenarioId: 'empty', l1: ir.l1 });
    const l2 = promote({ l1: ir.l1, facts, tenantId, hook: { captureKind: 'runtime-dom' } });
    const fullIr = { ...ir, facts, l2 };

    const ruleset = A11Y_RULES.map((rule) => ({
      rule,
      binding: { ruleId: rule.id, ruleVersion: rule.version, rolloutState: 'block' } as RuleBinding,
    }));
    const findings = runRules(fullIr, ruleset, { tenantId });
    const gate = decideGate(findings);

    const report = buildReport({
      findings, gate, runId, tenantId, inputDigest: ir.inputDigest,
      ruleSetVersion: ruleSetPin, irSchemaVersion: ir.irSchemaVersion,
      scenarios: ['empty'], generatedAt,
    });

    const exitCode = gateEnabled ? exitCodeFor(gate) : 0;
    return { report, exitCode };
  } catch (e) {
    // tool-error (capture failure / authority-missing schema rejection) → exit 2 (never a silent pass)
    return { error: e instanceof Error ? e.message : String(e), exitCode: 2 };
  }
}
