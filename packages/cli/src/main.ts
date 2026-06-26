import { readFileSync, writeFileSync } from 'node:fs';
import { toSarif } from '@sb/report';
import { runVerify } from './run-verify.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

export async function main(argv: string[], now: string): Promise<number> {
  if (argv[0] !== 'verify') {
    process.stderr.write('usage: softbowl verify --input <file> --tenant <id> [--out <file>] [--format json|sarif] [--no-gate]\n');
    return 2;
  }
  const args = parseArgs(argv.slice(1));
  const input = args['input'];
  const tenantId = args['tenant'];
  if (typeof input !== 'string' || typeof tenantId !== 'string') {
    process.stderr.write('error: --input and --tenant are required\n');
    return 2;
  }

  let html: string;
  try {
    html = readFileSync(input, 'utf8');
  } catch {
    process.stderr.write(`error: cannot read input file: ${input}\n`);
    return 2; // tool-error
  }

  const ruleSetPin = typeof args['ruleset'] === 'string' ? (args['ruleset'] as string) : 'softbowl-global@1';
  const gateEnabled = args['no-gate'] !== true;
  const res = await runVerify({ html, tenantId, runId: 'cli', ruleSetPin, generatedAt: now, gateEnabled });

  if (res.error || !res.report) {
    process.stderr.write(`tool-error: ${res.error ?? 'unknown'}\n`);
    return 2;
  }

  const format = args['format'] === 'sarif' ? 'sarif' : 'json';
  const out = typeof args['out'] === 'string' ? (args['out'] as string) : undefined;
  const payload = format === 'sarif' ? toSarif(res.report) : res.report;
  if (out) writeFileSync(out, JSON.stringify(payload, null, 2));

  const s = res.report.summary;
  process.stdout.write(
    `softbowl: gate=${res.report.gate.result} block=${s.block} warn=${s.warn} info=${s.info} (exit ${res.exitCode})\n`,
  );
  return res.exitCode;
}
