import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { stablePath } from './stable-path.js';

function el(html: string, selector: string) {
  const dom = new JSDOM(`<body>${html}</body>`);
  return dom.window.document.querySelector(selector)!;
}

describe('stablePath', () => {
  it('uses a stable anchor attribute when present', () => {
    const node = el('<form><select id="drug" name="order.drug"></select></form>', 'select');
    const r = stablePath(node);
    expect(r.path).toBe('body>form>select[id=drug]');
    expect(r.indexOnly).toBe(false);
  });

  it('falls back to same-tag sibling ordinal and flags index-only', () => {
    const node = el('<div></div><div></div>', 'div:nth-child(2)');
    const r = stablePath(node);
    expect(r.path).toBe('body>div[2]');
    expect(r.indexOnly).toBe(true);
  });

  it('emits bare tag for a unique-tag element', () => {
    const node = el('<form></form>', 'form');
    expect(stablePath(node).path).toBe('body>form');
  });

  it('uses name-only anchor when id is not present', () => {
    const node = el('<form><input name="order.dose"/></form>', 'input');
    const r = stablePath(node);
    expect(r.path).toBe('body>form>input[name=order.dose]');
    expect(r.indexOnly).toBe(false);
  });

  it('uses data-testid anchor when id and name are not present', () => {
    const node = el('<div data-testid="panel"></div>', '[data-testid=panel]');
    const r = stablePath(node);
    expect(r.path).toBe('body>div[data-testid=panel]');
    expect(r.indexOnly).toBe(false);
  });

  it('prefers id anchor over name when both are present', () => {
    const node = el('<input id="x" name="y"/>', 'input');
    const r = stablePath(node);
    expect(r.path).toBe('body>input[id=x]');
    expect(r.indexOnly).toBe(false);
  });

  it('flags indexOnly as false when bare-tag is used (unique sibling)', () => {
    const node = el('<form></form>', 'form');
    const r = stablePath(node);
    expect(r.indexOnly).toBe(false);
  });

  it('flags indexOnly as true when any ancestor segment falls back to index', () => {
    const node = el('<div></div><div><input name="a"/></div>', 'input');
    const r = stablePath(node);
    expect(r.path).toBe('body>div[2]>input[name=a]');
    expect(r.indexOnly).toBe(true);
  });
});
