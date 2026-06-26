import { describe, it, expect } from 'vitest';
import type { L1Node, L1Graph } from '@sb/ir-schema';
import { resolveActionRole } from './promote-action.js';
import { resolveBinding } from './binding.js';

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

describe('resolveActionRole', () => {
  it('treats type=submit as submit (0.85)', () => {
    expect(resolveActionRole(n('l1:b', 'button', { type: 'submit' }), graph(n('l1:b', 'button', { type: 'submit' }))))
      .toEqual({ role: 'submit', confidence: 0.85, ambiguous: false });
  });
  it('treats a sole button in a form as submit (0.85)', () => {
    const form = n('l1:f', 'form', {}, undefined, ['l1:b']);
    const btn = n('l1:b', 'button', {}, '처방 저장');
    expect(resolveActionRole(btn, graph(form, btn)).role).toBe('submit');
  });
  it('uses the text dictionary for destructive (0.7)', () => {
    const a = n('l1:b', 'button', {}, '삭제'); const b = n('l1:c', 'button', {}, '취소');
    const form = n('l1:f', 'form', {}, undefined, ['l1:b', 'l1:c']);
    expect(resolveActionRole(a, graph(form, a, b))).toEqual({ role: 'destructive', confidence: 0.7, ambiguous: false });
    expect(resolveActionRole(b, graph(form, a, b))).toEqual({ role: 'cancel', confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous for an unlabeled non-submit button among many', () => {
    const a = n('l1:b', 'button', {}, '???'); const b = n('l1:c', 'button', {}, '...');
    const form = n('l1:f', 'form', {}, undefined, ['l1:b', 'l1:c']);
    expect(resolveActionRole(a, graph(form, a, b))).toEqual({ role: 'unknown', confidence: 0.5, ambiguous: true });
  });
});

describe('resolveBinding', () => {
  it('extracts binding.path from name (0.8, ui-internal)', () => {
    expect(resolveBinding(n('l1:i', 'input', { name: 'order.dose' })))
      .toEqual({ scope: 'ui-internal', path: 'order.dose' });
  });
  it('falls back to data-bind then id', () => {
    expect(resolveBinding(n('l1:i', 'input', { 'data-bind': 'order.drug' }))?.path).toBe('order.drug');
    expect(resolveBinding(n('l1:i', 'input', { id: 'dose' }))?.path).toBe('dose');
  });
  it('returns undefined when no binding source exists', () => {
    expect(resolveBinding(n('l1:i', 'input', {}))).toBeUndefined();
  });
  it('falls through an empty name to data-bind', () => {
    expect(resolveBinding(n('l1:i', 'input', { name: '', 'data-bind': 'order.qty' }))?.path).toBe('order.qty');
  });
});
