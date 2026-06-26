import { describe, it, expect } from 'vitest';
import { buildReport } from './report.js';
import { toSarif } from './sarif.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1', url: 'https://example/wcag/1.1.1' };
const report = buildReport({
  findings: [{ ruleId: 'a11y.image-alt', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: { axeRuleId: 'image-alt' },
    category: 'accessibility', effectiveSeverity: 'block', rolloutState: 'block', overridden: false }],
  gate: { result: 'block', blocking: ['a11y.image-alt'] },
  runId: 'r', tenantId: 'hosp-A', inputDigest: 'sha256:x', ruleSetVersion: 'rs@1',
  irSchemaVersion: '1.0.0', scenarios: ['empty'], generatedAt: '2026-06-26T00:00:00Z',
});

describe('toSarif', () => {
  it('emits a SARIF 2.1.0 log with one result per finding', () => {
    const sarif = toSarif(report) as any;
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('softbowl');
    expect(sarif.runs[0].results).toHaveLength(1);
  });
  it('maps block→error level and carries ruleId + authority', () => {
    const sarif = toSarif(report) as any;
    const result = sarif.runs[0].results[0];
    expect(result.level).toBe('error');
    expect(result.ruleId).toBe('a11y.image-alt');
    const ruleMeta = sarif.runs[0].tool.driver.rules.find((r: any) => r.id === 'a11y.image-alt');
    expect(ruleMeta.helpUri).toBe('https://example/wcag/1.1.1');
  });
});
