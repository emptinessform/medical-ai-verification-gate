import { describe, it, expect } from 'vitest';
import type { L1Node } from '@sb/ir-schema';
import { classifyNode } from './classify.js';
import { l2IdFor } from './l2-id.js';

function node(partial: Partial<L1Node> & { tag: string }): L1Node {
  return {
    nodeId: 'l1:x', provenance: { source: { domPath: partial.tag }, captureId: 'c', scenarioId: 'empty' },
    confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['empty'],
    attributes: {}, children: [], ...partial,
  } as L1Node;
}

describe('classifyNode', () => {
  it('classifies form controls as Field', () => {
    expect(classifyNode(node({ tag: 'input' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'select' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'textarea' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'div', attributes: { role: 'combobox' } }))).toBe('Field');
  });
  it('classifies button as Action', () => {
    expect(classifyNode(node({ tag: 'button' }))).toBe('Action');
    expect(classifyNode(node({ tag: 'input', attributes: { type: 'submit' } }))).toBe('Action');
  });
  it('classifies form as Form', () => {
    expect(classifyNode(node({ tag: 'form' }))).toBe('Form');
  });
  it('returns null for structural-only elements', () => {
    expect(classifyNode(node({ tag: 'div' }))).toBeNull();
    expect(classifyNode(node({ tag: 'label' }))).toBeNull();
  });
  it('classifies input[type=button] and input[type=reset] as Action', () => {
    expect(classifyNode(node({ tag: 'input', attributes: { type: 'button' } }))).toBe('Action');
    expect(classifyNode(node({ tag: 'input', attributes: { type: 'reset' } }))).toBe('Action');
  });
  it('classifies role=button as Action and role=spinbutton/checkbox as Field', () => {
    expect(classifyNode(node({ tag: 'div', attributes: { role: 'button' } }))).toBe('Action');
    expect(classifyNode(node({ tag: 'div', attributes: { role: 'spinbutton' } }))).toBe('Field');
    expect(classifyNode(node({ tag: 'div', attributes: { role: 'checkbox' } }))).toBe('Field');
  });
});

describe('l2IdFor', () => {
  it('derives an l2 id deterministically from the L1 stablePath', () => {
    const n = node({ tag: 'input', provenance: { source: { domPath: 'form>input[name=dose]' }, captureId: 'c', scenarioId: 'empty' } });
    const a = l2IdFor('hosp-A', n);
    const b = l2IdFor('hosp-A', n);
    expect(a).toBe(b);
    expect(a).toMatch(/^l2:[0-9a-f]{12}$/);
  });
  it('throws when the L1 provenance has no domPath', () => {
    const n = node({ tag: 'input', provenance: { source: { file: 'a.tsx', line: 1, col: 2 }, captureId: 'c', scenarioId: 'empty' } });
    expect(() => l2IdFor('hosp-A', n)).toThrow(/domPath/);
  });
});
