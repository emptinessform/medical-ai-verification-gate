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
});
