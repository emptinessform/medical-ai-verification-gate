import type { Severity } from '@sb/ir-schema';
import type { ValidationReport } from './report.js';

function level(sev: Severity): 'error' | 'warning' | 'note' {
  return sev === 'block' ? 'error' : sev === 'warn' ? 'warning' : 'note';
}

export function toSarif(report: ValidationReport): object {
  // one rule metadata entry per distinct ruleId, sorted for determinism
  const ruleIds = [...new Set(report.findings.map((f) => f.ruleId))].sort();
  const rules = ruleIds.map((id) => {
    const sample = report.findings.find((f) => f.ruleId === id)!;
    return {
      id,
      helpUri: sample.authority.url,
      properties: { standard: sample.authority.standard, clause: sample.authority.clause },
    };
  });

  const results = report.findings.map((f) => ({
    ruleId: f.ruleId,
    level: level(f.effectiveSeverity),
    message: { text: `${f.authority.standard} ${f.authority.clause}: ${f.ruleId} on ${f.nodeId}` },
    locations: [{ logicalLocations: [{ fullyQualifiedName: f.nodeId }] }],
    properties: { nodeStatus: f.nodeStatus, confidence: f.confidence, rolloutState: f.rolloutState },
  }));

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'softbowl', informationUri: 'https://softbowl.example', rules } }, results }],
  };
}
