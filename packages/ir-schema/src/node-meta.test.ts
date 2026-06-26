import { describe, it, expect } from 'vitest';
import { NodeMeta, Provenance } from './node-meta.js';

const validMeta = {
  nodeId: 'l1:0a1b2c3d4e5f',
  provenance: { source: { domPath: 'form>input' }, captureId: 'cap1', scenarioId: 'empty' },
  confidence: 1.0,
  status: 'known' as const,
  derivedFrom: [],
  scenarioCoverage: ['empty'],
};

describe('NodeMeta', () => {
  it('accepts a well-formed observed node', () => {
    expect(NodeMeta.parse(validMeta).nodeId).toBe('l1:0a1b2c3d4e5f');
  });

  it('rejects confidence outside 0..1', () => {
    expect(() => NodeMeta.parse({ ...validMeta, confidence: 1.5 })).toThrow();
  });

  it('Provenance accepts source-map form', () => {
    expect(Provenance.parse({
      source: { file: 'a.tsx', line: 12, col: 4 }, captureId: 'c', scenarioId: 's',
    })).toBeTruthy();
  });
});
