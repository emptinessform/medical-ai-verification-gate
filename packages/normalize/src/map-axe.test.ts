import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { mapAxeResults, type AxeOutput } from './map-axe.js';

function doc(html: string): Document {
  return new JSDOM(`<body>${html}</body>`).window.document;
}
const opts = { tenantId: 'hosp-A', scenarioId: 'empty', engine: 'axe-core@4.x' };

describe('mapAxeResults', () => {
  it('maps a violation to a fact joined to the targeted L1 nodeId', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious',
        nodes: [{ target: ['#dose'], any: [{ data: { accessibleName: '' } }] }] }],
      incomplete: [],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(1);
    expect(facts[0].ruleId).toBe('label');
    expect(facts[0].impact).toBe('serious');
    expect(facts[0].measurable).toBe(true);
    expect(facts[0].observed).toEqual({ accessibleName: '' });
    expect(facts[0].appliesTo).toMatch(/^l1:[0-9a-f]{12}$/);
  });

  it('preserves incomplete results (no silent drop) with observed.result', () => {
    const d = doc('<form><button id="b">저장</button></form>');
    const axe: AxeOutput = {
      violations: [],
      incomplete: [{ id: 'color-contrast', impact: null,
        nodes: [{ target: ['#b'], any: [{ data: { fgColor: '#bbb' } }] }] }],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(1);
    expect(facts[0].ruleId).toBe('color-contrast');
    expect(facts[0].impact).toBe('moderate'); // null impact defaults to moderate
    expect(facts[0].observed).toEqual({ result: 'incomplete', fgColor: '#bbb' });
  });

  it('splits a selector matching multiple nodes into separate facts', () => {
    const d = doc('<form><input class="x"/><input class="x"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious', nodes: [{ target: ['.x'] }] }],
      incomplete: [],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(2);
    expect(facts[0].appliesTo).not.toBe(facts[1].appliesTo);
  });

  it('is deterministic and sorted by (appliesTo, ruleId)', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious', nodes: [{ target: ['#dose'] }] }],
      incomplete: [],
    };
    expect(JSON.stringify(mapAxeResults(axe, d, opts))).toBe(JSON.stringify(mapAxeResults(axe, d, opts)));
  });

  it('uses the last selector in a nested target array', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'minor', nodes: [{ target: ['#frame', '#dose'] }] }],
      incomplete: [],
    };
    expect(mapAxeResults(axe, d, opts)).toHaveLength(1);
  });

  it('keeps the incomplete marker even when check data has a result key', () => {
    const d = doc('<form><input id="x"/></form>');
    const facts = mapAxeResults({ violations: [], incomplete: [
      { id: 'color-contrast', impact: null, nodes: [{ target: ['#x'], any: [{ data: { result: 'spoofed', ratio: 2 } }] }] },
    ] }, d, opts);
    expect(facts[0].observed).toEqual({ ratio: 2, result: 'incomplete' });
  });

  it('strips a non-deterministic stack trace from observed but keeps other fields', () => {
    const d = doc('<form><button id="b">저장</button></form>');
    const facts = mapAxeResults({ violations: [], incomplete: [
      { id: 'color-contrast', impact: null, nodes: [{ target: ['#b'], any: [{ data: {
        message: 'Skipping color-contrast', stack: 'TypeError\n  at D:\\\\x\\\\axe.js:1:1' } }] }] },
    ] }, d, opts);
    expect(facts[0].observed).toEqual({ message: 'Skipping color-contrast', result: 'incomplete' });
    expect('stack' in (facts[0].observed as object)).toBe(false);
  });

  it('preserves primitive check data by wrapping it', () => {
    const d = doc('<form><input id="x"/></form>');
    const facts = mapAxeResults({ violations: [
      { id: 'label', impact: 'serious', nodes: [{ target: ['#x'], any: [{ data: 'too-short' }] }] },
    ], incomplete: [] }, d, opts);
    expect(facts[0].observed).toEqual({ value: 'too-short' });
  });
});
