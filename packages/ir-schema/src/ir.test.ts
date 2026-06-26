import { describe, it, expect } from 'vitest';
import { IR, L1Node } from './ir.js';

const node = {
  nodeId: 'l1:abc', provenance: { source: { domPath: 'form' }, captureId: 'c', scenarioId: 'empty' },
  confidence: 1, status: 'known' as const, derivedFrom: [], scenarioCoverage: ['empty'],
  tag: 'input', attributes: { name: 'order.dose' },
  computed: { contrast: { value: null, measured: false } },
  children: [],
};

describe('IR root', () => {
  it('accepts an L1Node with unmeasured computed field', () => {
    expect(L1Node.parse(node).tag).toBe('input');
  });

  it('pins irSchemaVersion to 1.0.0', () => {
    const ir = {
      irSchemaVersion: '1.0.0', tenantId: 'hosp-A', runId: 'run1', inputDigest: 'sha256:x',
      l1: { rootId: 'l1:abc', nodes: { 'l1:abc': node } },
      l2: [], l3: [], facts: [],
    };
    expect(IR.parse(ir).irSchemaVersion).toBe('1.0.0');
    expect(() => IR.parse({ ...ir, irSchemaVersion: '2.0.0' })).toThrow();
  });
});
