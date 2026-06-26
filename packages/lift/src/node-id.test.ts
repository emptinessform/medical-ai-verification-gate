import { describe, it, expect } from 'vitest';
import { makeNodeId, SEP } from './node-id.js';

describe('makeNodeId', () => {
  it('is deterministic for the same inputs', () => {
    const a = makeNodeId('l1', 'hosp-A', 'body>form>select[id=drug]');
    const b = makeNodeId('l1', 'hosp-A', 'body>form>select[id=drug]');
    expect(a).toBe(b);
  });

  it('encodes layer prefix and 12-hex body', () => {
    const id = makeNodeId('l1', 'hosp-A', 'body>form');
    expect(id).toMatch(/^l1:[0-9a-f]{12}$/);
  });

  it('changes when tenant or path changes', () => {
    const base = makeNodeId('l1', 'hosp-A', 'body>form');
    expect(makeNodeId('l1', 'hosp-B', 'body>form')).not.toBe(base);
    expect(makeNodeId('l1', 'hosp-A', 'body>div')).not.toBe(base);
  });

  it('uses the ‖ separator so concatenation is unambiguous', () => {
    // 'a‖b' != 'ab' — 구분자가 있어야 (a,b) 충돌 방지
    expect(makeNodeId('l1', 'a', 'b')).not.toBe(makeNodeId('l1', 'ab', ''));
    expect(SEP).toBe('‖');
  });
});
