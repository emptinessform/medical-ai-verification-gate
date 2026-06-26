import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TriBool, NodeStatus, Measured } from './scalars.js';

describe('scalars', () => {
  it('TriBool accepts true/false/unknown and rejects null', () => {
    expect(TriBool.parse('unknown')).toBe('unknown');
    expect(TriBool.parse(true)).toBe(true);
    expect(() => TriBool.parse(null)).toThrow();
  });

  it('NodeStatus is a closed enum', () => {
    expect(NodeStatus.parse('ambiguous')).toBe('ambiguous');
    expect(() => NodeStatus.parse('maybe')).toThrow();
  });

  it('Measured separates missing from value', () => {
    const M = Measured(z.number());
    expect(M.parse({ value: 4.5, measured: true })).toEqual({ value: 4.5, measured: true });
    expect(M.parse({ value: null, measured: false })).toEqual({ value: null, measured: false });
    expect(() => M.parse({ value: 4.5 })).toThrow(); // measured 필수
  });
});
