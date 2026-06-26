import { describe, it, expect } from 'vitest';
import type { ReportedFinding } from '@sb/ir-schema';
import { buildReport, ValidationReport } from './report.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function f(over: Partial<ReportedFinding> = {}): ReportedFinding {
  return { ruleId: 'a11y.image-alt', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: {}, category: 'accessibility',
    effectiveSeverity: 'block', rolloutState: 'block', overridden: false, ...over };
}
const base = {
  gate: { result: 'block' as const, blocking: ['a11y.image-alt'] },
  runId: 'r', tenantId: 'hosp-A', inputDigest: 'sha256:x', ruleSetVersion: 'rs@1',
  irSchemaVersion: '1.0.0', scenarios: ['empty'], generatedAt: '2026-06-26T00:00:00Z',
};

describe('buildReport', () => {
  it('aggregates summary counts by effectiveSeverity', () => {
    const report = buildReport({ ...base, findings: [
      f(), f({ ruleId: 'a11y.color-contrast', effectiveSeverity: 'warn', nodeStatus: 'unknown' }),
      f({ ruleId: 'x', effectiveSeverity: 'info' }),
    ] });
    expect(report.summary.block).toBe(1);
    expect(report.summary.warn).toBe(1);
    expect(report.summary.info).toBe(1);
    expect(report.summary.unknownNodes).toBe(1); // the color-contrast finding has nodeStatus unknown
  });
  it('is deterministic for the same inputs (generatedAt injected)', () => {
    const a = buildReport({ ...base, findings: [f()] });
    const b = buildReport({ ...base, findings: [f()] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('embeds the gate decision and pins versions', () => {
    const report = buildReport({ ...base, findings: [f()] });
    expect(report.gate.result).toBe('block');
    expect(report.schemaVersion).toBe('1.0.0');
    expect(ValidationReport.parse(report).ruleSetVersion).toBe('rs@1');
  });
});
