import { z } from 'zod';
import { ReportedFinding, type GateDecision } from '@sb/ir-schema';

export const ValidationReport = z.object({
  schemaVersion: z.literal('1.0.0'),
  runId: z.string(),
  tenantId: z.string(),
  inputDigest: z.string(),
  ruleSetVersion: z.string(),
  irSchemaVersion: z.string(),
  gate: z.object({
    result: z.enum(['pass', 'block', 'block-overridden']),
    blocking: z.array(z.string()),
  }),
  findings: z.array(ReportedFinding),
  summary: z.object({
    block: z.number(), warn: z.number(), info: z.number(),
    unknownNodes: z.number(), coverageGaps: z.number(), scenarios: z.array(z.string()),
  }),
  generatedAt: z.string(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export function buildReport(args: {
  findings: ReportedFinding[];
  gate: GateDecision;
  runId: string;
  tenantId: string;
  inputDigest: string;
  ruleSetVersion: string;
  irSchemaVersion: string;
  scenarios: string[];
  generatedAt: string;
}): ValidationReport {
  const { findings } = args;
  const summary = {
    block: findings.filter((f) => f.effectiveSeverity === 'block').length,
    warn: findings.filter((f) => f.effectiveSeverity === 'warn').length,
    info: findings.filter((f) => f.effectiveSeverity === 'info').length,
    unknownNodes: findings.filter((f) => f.nodeStatus === 'unknown' || f.nodeStatus === 'ambiguous').length,
    coverageGaps: 0, // populated when coverage-gap findings land (§4.7, later plan)
    scenarios: args.scenarios,
  };
  return ValidationReport.parse({
    schemaVersion: '1.0.0',
    runId: args.runId,
    tenantId: args.tenantId,
    inputDigest: args.inputDigest,
    ruleSetVersion: args.ruleSetVersion,
    irSchemaVersion: args.irSchemaVersion,
    gate: { result: args.gate.result, blocking: args.gate.blocking },
    findings,
    summary,
    generatedAt: args.generatedAt,
  });
}
