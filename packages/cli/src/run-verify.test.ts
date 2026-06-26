import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runVerify } from './run-verify.js';

const dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(dir, '..', 'fixtures', 'verify.golden.json');

const DIRTY = `<form>
  <input id="dose" type="number"/>
  <img src="pill.png"/>
  <button style="color:#bbb;background:#fff">저장</button>
</form>`;
const CLEAN = `<form>
  <label for="dose">용량</label>
  <input id="dose" type="number" aria-label="용량"/>
  <img src="pill.png" alt="알약"/>
</form>`;
const base = { tenantId: 'hosp-A', runId: 'r', ruleSetPin: 'rs@1', generatedAt: '2026-06-26T00:00:00Z' };

describe('runVerify', () => {
  it('exits 1 and blocks on observed accessibility violations (gate enabled)', async () => {
    const res = await runVerify({ ...base, html: DIRTY, gateEnabled: true });
    expect(res.exitCode).toBe(1);
    expect(res.report?.gate.result).toBe('block');
    expect(res.report?.summary.block).toBeGreaterThan(0);
  });
  it('exits 0 when --no-gate even if findings would block (report still records block)', async () => {
    const res = await runVerify({ ...base, html: DIRTY, gateEnabled: false });
    expect(res.exitCode).toBe(0);
    expect(res.report?.gate.result).toBe('block');
  });
  it('exits 2 (tool-error) on uncapturable input', async () => {
    const res = await runVerify({ ...base, html: '   ', gateEnabled: true });
    expect(res.exitCode).toBe(2);
    expect(res.error).toBeTruthy();
  });
  it('matches the committed golden for the dirty fixture (deterministic)', async () => {
    const res = await runVerify({ ...base, html: DIRTY, gateEnabled: true });
    const actual = JSON.stringify(res, null, 2);
    if (!existsSync(goldenPath)) writeFileSync(goldenPath, actual);
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });
});
