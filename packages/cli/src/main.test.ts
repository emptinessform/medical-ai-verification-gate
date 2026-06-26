import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './main.js';

const NOW = '2026-06-26T00:00:00Z';
let tmp: string | undefined;
function setup(html: string) {
  tmp = mkdtempSync(join(tmpdir(), 'sb-cli-'));
  const input = join(tmp, 'screen.html');
  writeFileSync(input, html);
  return { input, out: join(tmp, 'report.json') };
}
afterEach(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

const DIRTY = '<form><input id="d" type="number"/><img src="x"/></form>';

describe('main', () => {
  it('returns exit 1 and writes a JSON report for a blocking input (gate on)', async () => {
    const { input, out } = setup(DIRTY);
    const code = await main(['verify', '--input', input, '--tenant', 'hosp-A', '--out', out], NOW);
    expect(code).toBe(1);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.gate.result).toBe('block');
  });
  it('writes SARIF when --format sarif', async () => {
    const { input, out } = setup(DIRTY);
    const code = await main(['verify', '--input', input, '--tenant', 'hosp-A', '--out', out, '--format', 'sarif'], NOW);
    expect(code).toBe(1);
    const sarif = JSON.parse(readFileSync(out, 'utf8'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
  });
  it('returns exit 0 with --no-gate even on a blocking input', async () => {
    const { input, out } = setup(DIRTY);
    const code = await main(['verify', '--input', input, '--tenant', 'hosp-A', '--out', out, '--no-gate'], NOW);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8')).gate.result).toBe('block');
  });
  it('returns exit 2 when the input file is missing', async () => {
    const code = await main(['verify', '--input', '/no/such/file.html', '--tenant', 'hosp-A'], NOW);
    expect(code).toBe(2);
  });
  it('returns exit 2 on an unknown/missing subcommand', async () => {
    expect(await main([], NOW)).toBe(2);
  });
});
