import { describe, it, expect } from 'vitest';
import type { L1Node, L1Graph } from '@sb/ir-schema';
import { resolveLabel, resolveRequired, resolveDataType } from './promote-field.js';

function n(id: string, tag: string, attributes: Record<string, string> = {}, text?: string, children: string[] = []): L1Node {
  return { nodeId: id, provenance: { source: { domPath: id }, captureId: 'c', scenarioId: 'empty' },
    confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['empty'],
    tag, attributes, ...(text ? { text } : {}), children } as L1Node;
}
function graph(...nodes: L1Node[]): L1Graph {
  const map: Record<string, L1Node> = {};
  for (const x of nodes) map[x.nodeId] = x;
  return { rootId: nodes[0].nodeId, nodes: map };
}

describe('resolveLabel', () => {
  it('uses <label for> with confidence 0.95', () => {
    const input = n('l1:i', 'input', { id: 'dose' });
    const label = n('l1:l', 'label', { for: 'dose' }, '용량');
    const r = resolveLabel(input, graph(label, input));
    expect(r).toEqual({ label: '용량', confidence: 0.95, ambiguous: false });
  });
  it('uses aria-label with confidence 0.9', () => {
    const input = n('l1:i', 'input', { 'aria-label': '약품명' });
    expect(resolveLabel(input, graph(input))).toEqual({ label: '약품명', confidence: 0.9, ambiguous: false });
  });
  it('returns null + known when no label exists', () => {
    const input = n('l1:i', 'input', { id: 'x' });
    expect(resolveLabel(input, graph(input))).toEqual({ label: null, confidence: 0.95, ambiguous: false });
  });
  it('joins multiple aria-labelledby ids (0.9)', () => {
    const input = n('l1:i', 'input', { 'aria-labelledby': 'l1 l2' });
    const a = n('l1:a', 'span', { id: 'l1' }, '약품');
    const b = n('l1:b', 'span', { id: 'l2' }, '용량');
    expect(resolveLabel(input, graph(input, a, b))).toEqual({ label: '약품 용량', confidence: 0.9, ambiguous: false });
  });
  it('returns ambiguous when aria-labelledby points to nothing', () => {
    const input = n('l1:i', 'input', { 'aria-labelledby': 'missing' });
    expect(resolveLabel(input, graph(input))).toEqual({ label: null, confidence: 0.6, ambiguous: true });
  });
  it('returns ambiguous when a matching label element exists but has no captured text', () => {
    const input = n('l1:i', 'input', { id: 'drug' });
    const label = n('l1:l', 'label', { for: 'drug' }); // no text (nested in a child, not captured)
    expect(resolveLabel(input, graph(label, input))).toEqual({ label: null, confidence: 0.6, ambiguous: true });
  });
});

describe('resolveRequired', () => {
  it('reads the required attribute as true (0.95)', () => {
    expect(resolveRequired(n('l1:i', 'input', { required: '' }), null))
      .toEqual({ required: true, confidence: 0.95, ambiguous: false });
  });
  it('reads aria-required=true as true (0.95)', () => {
    expect(resolveRequired(n('l1:i', 'input', { 'aria-required': 'true' }), null))
      .toEqual({ required: true, confidence: 0.95, ambiguous: false });
  });
  it('infers required from a * in the label (0.7)', () => {
    expect(resolveRequired(n('l1:i', 'input', {}), '약품 *'))
      .toEqual({ required: true, confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous when there is no signal (never false)', () => {
    expect(resolveRequired(n('l1:i', 'input', {}), '약품'))
      .toEqual({ required: 'unknown', confidence: 0.5, ambiguous: true });
  });
});

describe('resolveDataType', () => {
  it('maps input[type=number] directly (0.9)', () => {
    expect(resolveDataType(n('l1:i', 'input', { type: 'number' })))
      .toEqual({ dataType: 'number', confidence: 0.9, ambiguous: false });
  });
  it('maps input[type=date] to date', () => {
    expect(resolveDataType(n('l1:i', 'input', { type: 'date' })).dataType).toBe('date');
  });
  it('uses inputmode as an auxiliary signal (0.7)', () => {
    expect(resolveDataType(n('l1:i', 'input', { inputmode: 'numeric' })))
      .toEqual({ dataType: 'number', confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous for an untyped input', () => {
    expect(resolveDataType(n('l1:i', 'input', {})))
      .toEqual({ dataType: 'unknown', confidence: 0.5, ambiguous: true });
  });
});
