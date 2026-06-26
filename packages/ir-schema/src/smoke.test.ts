import { describe, it, expect } from 'vitest';
import { IR_SCHEMA_VERSION } from './index.js';

describe('smoke', () => {
  it('exports the frozen schema version', () => {
    expect(IR_SCHEMA_VERSION).toBe('1.0.0');
  });
});
