import { describe, it, expect } from 'vitest';
import { L2Overlay, ExternalFact, BindingDescriptor } from './l2.js';

const meta = {
  nodeId: 'l2:abc', provenance: { source: { domPath: 'form>input' }, captureId: 'c', scenarioId: 'empty' },
  confidence: 0.95, status: 'known' as const, derivedFrom: ['l1:abc'], scenarioCoverage: ['empty'],
};

describe('L2Overlay', () => {
  it('accepts a Field with required unknown and a binding', () => {
    const field = { ...meta, kind: 'Field' as const, label: null, required: 'unknown' as const,
      dataType: 'number' as const, binding: { scope: 'ui-internal' as const, path: 'order.dose' } };
    const parsed = L2Overlay.parse(field);
    expect(parsed.kind).toBe('Field');
  });

  it('accepts a Form referencing field/action nodeIds', () => {
    const form = { ...meta, kind: 'Form' as const, fields: ['l2:f1'], actions: ['l2:a1'] };
    expect(L2Overlay.parse(form).kind).toBe('Form');
  });

  it('rejects an unknown kind', () => {
    expect(() => L2Overlay.parse({ ...meta, kind: 'Widget' })).toThrow();
  });

  it('Field.label accepts null (confirmed absent) and string', () => {
    expect(L2Overlay.parse({ ...meta, kind: 'Field', label: '약품', required: true, dataType: 'string' }).kind).toBe('Field');
  });
});

describe('ExternalFact', () => {
  it('accepts an axe-style fact', () => {
    expect(ExternalFact.parse({
      engine: 'axe-core@4.x', ruleId: 'label', appliesTo: 'l1:abc',
      impact: 'serious', measurable: true, observed: { accessibleName: '' }, scenarioId: 'empty',
    }).ruleId).toBe('label');
  });
});

describe('BindingDescriptor', () => {
  it('accepts a UCUM unit slot with unknown status', () => {
    expect(BindingDescriptor.parse({
      scope: 'ui-internal', path: 'order.dose', unit: { system: 'UCUM', status: 'unknown' },
    }).path).toBe('order.dose');
  });
});
