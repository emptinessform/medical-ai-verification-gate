# CLI + 리포트(SARIF) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 파이프라인을 실제 `softbowl verify` 명령으로 묶는다 — 입력 HTML을 lift→normalize→promote→runRules→decideGate로 검증하고, 머신리더블 `ValidationReport`(§5.1)와 SARIF(§5.3)를 출력하며, §5.2 exit code로 계약한다.

**아키텍처:** 두 패키지. (1) `@sb/report` — `buildReport`(findings+gate → ValidationReport, 결정적; 타임스탬프는 주입) + `toSarif`(SARIF 2.1.0 직렬화, PR 인라인용). (2) `@sb/cli` — `runVerify`(전체 파이프라인 오케스트레이션 + tool-error→exit 2) + `main(argv)`(인자 파싱·파일 IO·요약 출력·exit code). exit code 의미는 1일차 동결: `pass`/`block-overridden`→0, `block`→1(게이트 활성 시), tool-error(캡처 실패·authority 부재)→2. `--no-gate`(1단계 기본)는 차단하지 않고(exit 0) 리포트에 gate 결정을 담는다 — 매핑 의미는 동일 유지(§5.3).

**기술 스택:** TypeScript(strict), pnpm workspace, Vitest, Zod, node:fs.

## 전역 제약 (Global Constraints)

- TypeScript `strict: true`. 새 패키지는 타입을 `@sb/ir-schema`에서, 파이프라인 함수를 각 패키지에서 import한다.
- **결정성:** `buildReport`는 순수하며 타임스탬프(`generatedAt`)를 인자로 받는다(내부에서 `Date` 호출 금지). 같은 입력+룰셋+generatedAt → 같은 리포트.
- exit code 계약(§5.2, 동결): 0 = pass/block-overridden, 1 = block(게이트 활성), 2 = tool-error(`liftHtml` 캡처 실패·`runRules`의 authority/스키마 거부). `--no-gate`면 block이어도 0(리포트 전용)이되 리포트의 `gate.result`는 그대로 기록.
- **침묵 통과 금지:** tool-error는 반드시 exit 2로 구분(코드 위반 1과 혼동 금지).
- SARIF level 매핑: `block`→`error`, `warn`→`warning`, `info`→`note`.
- 각 태스크 끝에서 conventional-commit으로 커밋.

---

### Task 1: `@sb/report` — ValidationReport + buildReport + SARIF

**Files:**
- Create: `packages/report/package.json`
- Create: `packages/report/tsconfig.json`
- Create: `packages/report/src/report.ts`
- Create: `packages/report/src/sarif.ts`
- Create: `packages/report/src/index.ts`
- Modify: `tsconfig.json` (루트 — `packages/report` 참조 추가)
- Test: `packages/report/src/report.test.ts`
- Test: `packages/report/src/sarif.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`ReportedFinding`, `Severity` 타입 + `ReportedFinding` 스키마)
- Produces:
  - `ValidationReport`(Zod) = `{ schemaVersion:'1.0.0', runId, tenantId, inputDigest, ruleSetVersion, irSchemaVersion, gate:{result,blocking}, findings: ReportedFinding[], summary:{block,warn,info,unknownNodes,coverageGaps,scenarios[]}, generatedAt }` (§5.1 부분집합 — ci/audit/location은 후속 플랜)
  - `buildReport(args: { findings: ReportedFinding[]; gate: GateDecision; runId; tenantId; inputDigest; ruleSetVersion; irSchemaVersion; scenarios: string[]; generatedAt: string }): ValidationReport` — summary 자동 집계, `ValidationReport.parse`로 검증
  - `toSarif(report: ValidationReport): object` — SARIF 2.1.0 로그

- [ ] **Step 1: 실패 테스트 작성**

`packages/report/src/report.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ReportedFinding } from '@sb/ir-schema';
import { buildReport, ValidationReport } from './report.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function f(over: Partial<ReportedFinding> = {}): ReportedFinding {
  return { ruleId: 'a11y.image-alt', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: {}, category: 'accessibility',
    effectiveSeverity: 'block', rolloutState: 'block', overridden: false, ...over };
}
const base = {
  gate: { result: 'block' as const, blocking: ['a11y.image-alt'] },
  runId: 'r', tenantId: 'hosp-A', inputDigest: 'sha256:x', ruleSetVersion: 'rs@1',
  irSchemaVersion: '1.0.0', scenarios: ['empty'], generatedAt: '2026-06-26T00:00:00Z',
};

describe('buildReport', () => {
  it('aggregates summary counts by effectiveSeverity', () => {
    const report = buildReport({ ...base, findings: [
      f(), f({ ruleId: 'a11y.color-contrast', effectiveSeverity: 'warn', nodeStatus: 'unknown' }),
      f({ ruleId: 'x', effectiveSeverity: 'info' }),
    ] });
    expect(report.summary.block).toBe(1);
    expect(report.summary.warn).toBe(1);
    expect(report.summary.info).toBe(1);
    expect(report.summary.unknownNodes).toBe(1); // the color-contrast finding has nodeStatus unknown
  });
  it('is deterministic for the same inputs (generatedAt injected)', () => {
    const a = buildReport({ ...base, findings: [f()] });
    const b = buildReport({ ...base, findings: [f()] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('embeds the gate decision and pins versions', () => {
    const report = buildReport({ ...base, findings: [f()] });
    expect(report.gate.result).toBe('block');
    expect(report.schemaVersion).toBe('1.0.0');
    expect(ValidationReport.parse(report).ruleSetVersion).toBe('rs@1');
  });
});
```

`packages/report/src/sarif.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildReport } from './report.js';
import { toSarif } from './sarif.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1', url: 'https://example/wcag/1.1.1' };
const report = buildReport({
  findings: [{ ruleId: 'a11y.image-alt', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: { axeRuleId: 'image-alt' },
    category: 'accessibility', effectiveSeverity: 'block', rolloutState: 'block', overridden: false }],
  gate: { result: 'block', blocking: ['a11y.image-alt'] },
  runId: 'r', tenantId: 'hosp-A', inputDigest: 'sha256:x', ruleSetVersion: 'rs@1',
  irSchemaVersion: '1.0.0', scenarios: ['empty'], generatedAt: '2026-06-26T00:00:00Z',
});

describe('toSarif', () => {
  it('emits a SARIF 2.1.0 log with one result per finding', () => {
    const sarif = toSarif(report) as any;
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('softbowl');
    expect(sarif.runs[0].results).toHaveLength(1);
  });
  it('maps block→error level and carries ruleId + authority', () => {
    const sarif = toSarif(report) as any;
    const result = sarif.runs[0].results[0];
    expect(result.level).toBe('error');
    expect(result.ruleId).toBe('a11y.image-alt');
    const ruleMeta = sarif.runs[0].tool.driver.rules.find((r: any) => r.id === 'a11y.image-alt');
    expect(ruleMeta.helpUri).toBe('https://example/wcag/1.1.1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/report/src/`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`packages/report/package.json`:
```json
{
  "name": "@sb/report",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@sb/ir-schema": "workspace:*" }
}
```

`packages/report/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../ir-schema" }],
  "include": ["src"]
}
```

루트 `tsconfig.json` `references`에 `{ "path": "packages/report" }` 추가.

`packages/report/src/report.ts`:
```ts
import { z } from 'zod';
import { ReportedFinding, type GateDecision } from '@sb/ir-schema';

export const ValidationReport = z.object({
  schemaVersion: z.literal('1.0.0'),
  runId: z.string(),
  tenantId: z.string(),
  inputDigest: z.string(),
  ruleSetVersion: z.string(),
  irSchemaVersion: z.string(),
  gate: z.object({
    result: z.enum(['pass', 'block', 'block-overridden']),
    blocking: z.array(z.string()),
  }),
  findings: z.array(ReportedFinding),
  summary: z.object({
    block: z.number(), warn: z.number(), info: z.number(),
    unknownNodes: z.number(), coverageGaps: z.number(), scenarios: z.array(z.string()),
  }),
  generatedAt: z.string(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export function buildReport(args: {
  findings: ReportedFinding[];
  gate: GateDecision;
  runId: string;
  tenantId: string;
  inputDigest: string;
  ruleSetVersion: string;
  irSchemaVersion: string;
  scenarios: string[];
  generatedAt: string;
}): ValidationReport {
  const { findings } = args;
  const summary = {
    block: findings.filter((f) => f.effectiveSeverity === 'block').length,
    warn: findings.filter((f) => f.effectiveSeverity === 'warn').length,
    info: findings.filter((f) => f.effectiveSeverity === 'info').length,
    unknownNodes: findings.filter((f) => f.nodeStatus === 'unknown' || f.nodeStatus === 'ambiguous').length,
    coverageGaps: 0, // populated when coverage-gap findings land (§4.7, later plan)
    scenarios: args.scenarios,
  };
  return ValidationReport.parse({
    schemaVersion: '1.0.0',
    runId: args.runId,
    tenantId: args.tenantId,
    inputDigest: args.inputDigest,
    ruleSetVersion: args.ruleSetVersion,
    irSchemaVersion: args.irSchemaVersion,
    gate: { result: args.gate.result, blocking: args.gate.blocking },
    findings,
    summary,
    generatedAt: args.generatedAt,
  });
}
```

`packages/report/src/sarif.ts`:
```ts
import type { Severity } from '@sb/ir-schema';
import type { ValidationReport } from './report.js';

function level(sev: Severity): 'error' | 'warning' | 'note' {
  return sev === 'block' ? 'error' : sev === 'warn' ? 'warning' : 'note';
}

export function toSarif(report: ValidationReport): object {
  // one rule metadata entry per distinct ruleId, sorted for determinism
  const ruleIds = [...new Set(report.findings.map((f) => f.ruleId))].sort();
  const rules = ruleIds.map((id) => {
    const sample = report.findings.find((f) => f.ruleId === id)!;
    return {
      id,
      helpUri: sample.authority.url,
      properties: { standard: sample.authority.standard, clause: sample.authority.clause },
    };
  });

  const results = report.findings.map((f) => ({
    ruleId: f.ruleId,
    level: level(f.effectiveSeverity),
    message: { text: `${f.authority.standard} ${f.authority.clause}: ${f.ruleId} on ${f.nodeId}` },
    locations: [{ logicalLocations: [{ fullyQualifiedName: f.nodeId }] }],
    properties: { nodeStatus: f.nodeStatus, confidence: f.confidence, rolloutState: f.rolloutState },
  }));

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'softbowl', informationUri: 'https://softbowl.example', rules } }, results }],
  };
}
```

`packages/report/src/index.ts`:
```ts
export * from './report.js';
export * from './sarif.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm install && pnpm vitest run packages/report/src/`  → PASS (report 3 + sarif 2 = 5)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/report/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(report): add ValidationReport builder and SARIF serializer"
```

---

### Task 2: `@sb/cli` — `runVerify` 오케스트레이션 + tool-error

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/run-verify.ts`
- Create: `packages/cli/src/index.ts`
- Modify: `tsconfig.json` (루트 — `packages/cli` 참조 추가)
- Test: `packages/cli/src/run-verify.test.ts`
- Create: `packages/cli/fixtures/verify.golden.json`

**Interfaces:**
- Consumes: `@sb/lift`(`liftHtml`), `@sb/normalize`(`normalizeHtml`), `@sb/promoter`(`promote`), `@sb/rules`(`A11Y_RULES`), `@sb/engine`(`runRules`,`decideGate`,`exitCodeFor`), `@sb/report`(`buildReport`), `@sb/ir-schema`(타입)
- Produces:
  - `VerifyResult` = `{ report?: ValidationReport; error?: string; exitCode: 0 | 1 | 2 }`
  - `runVerify(args: { html; tenantId; runId; ruleSetPin; generatedAt; gateEnabled: boolean }): Promise<VerifyResult>` — 전체 파이프라인. tool-error(파이프라인 throw)는 catch해 exit 2 + error 메시지. 정상이면 gateEnabled에 따라 exitCodeFor(gate) 또는 0.

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/cli/package.json`:
```json
{
  "name": "@sb/cli",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "bin": { "softbowl": "./src/bin.ts" },
  "dependencies": {
    "@sb/ir-schema": "workspace:*",
    "@sb/lift": "workspace:*",
    "@sb/normalize": "workspace:*",
    "@sb/promoter": "workspace:*",
    "@sb/rules": "workspace:*",
    "@sb/engine": "workspace:*",
    "@sb/report": "workspace:*"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [
    { "path": "../ir-schema" }, { "path": "../lift" }, { "path": "../normalize" },
    { "path": "../promoter" }, { "path": "../rules" }, { "path": "../engine" }, { "path": "../report" }
  ],
  "include": ["src"]
}
```

루트 `tsconfig.json` `references`에 `{ "path": "packages/cli" }` 추가.

`packages/cli/src/run-verify.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/cli/src/run-verify.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`packages/cli/src/run-verify.ts`:
```ts
import { liftHtml } from '@sb/lift';
import { normalizeHtml } from '@sb/normalize';
import { promote } from '@sb/promoter';
import { A11Y_RULES } from '@sb/rules';
import { runRules, decideGate, exitCodeFor } from '@sb/engine';
import { buildReport, type ValidationReport } from '@sb/report';
import type { RuleBinding } from '@sb/ir-schema';

export interface VerifyResult {
  report?: ValidationReport;
  error?: string;
  exitCode: 0 | 1 | 2;
}

export async function runVerify(args: {
  html: string;
  tenantId: string;
  runId: string;
  ruleSetPin: string;
  generatedAt: string;
  gateEnabled: boolean;
}): Promise<VerifyResult> {
  const { html, tenantId, runId, ruleSetPin, generatedAt, gateEnabled } = args;
  try {
    const ir = liftHtml({ html, tenantId, runId, scenarioId: 'empty', ruleSetPin });
    const facts = await normalizeHtml({ html, tenantId, scenarioId: 'empty', l1: ir.l1 });
    const l2 = promote({ l1: ir.l1, facts, tenantId, hook: { captureKind: 'runtime-dom' } });
    const fullIr = { ...ir, facts, l2 };

    const ruleset = A11Y_RULES.map((rule) => ({
      rule,
      binding: { ruleId: rule.id, ruleVersion: rule.version, rolloutState: 'block' } as RuleBinding,
    }));
    const findings = runRules(fullIr, ruleset, { tenantId });
    const gate = decideGate(findings);

    const report = buildReport({
      findings, gate, runId, tenantId, inputDigest: ir.inputDigest,
      ruleSetVersion: ruleSetPin, irSchemaVersion: ir.irSchemaVersion,
      scenarios: ['empty'], generatedAt,
    });

    const exitCode = gateEnabled ? exitCodeFor(gate) : 0;
    return { report, exitCode };
  } catch (e) {
    // tool-error (capture failure / authority-missing schema rejection) → exit 2 (never a silent pass)
    return { error: e instanceof Error ? e.message : String(e), exitCode: 2 };
  }
}
```

`packages/cli/src/index.ts`:
```ts
export * from './run-verify.js';
```

- [ ] **Step 4: 테스트(골든 생성) + 타입체크**

Run: `pnpm vitest run packages/cli/src/run-verify.test.ts`  (최초 골든 생성 후 PASS, 재실행 PASS)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 골든 검토 + 커밋**

`packages/cli/fixtures/verify.golden.json` 확인: `exitCode:1`, `report.gate.result:"block"`, `summary.block ≥ 1`, color-contrast finding의 `observed`에 절대경로/스택 없음(이식 가능).

```bash
git add packages/cli/ tsconfig.json pnpm-lock.yaml packages/cli/fixtures/
git commit -m "feat(cli): add runVerify pipeline orchestration with tool-error exit 2"
```

---

### Task 3: `softbowl verify` 명령 — 인자 파싱 + bin + e2e

**Files:**
- Create: `packages/cli/src/main.ts`
- Create: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/index.ts` (main 재노출)
- Test: `packages/cli/src/main.test.ts`

**Interfaces:**
- Consumes: `run-verify.ts`, `@sb/report`(`toSarif`), `node:fs`
- Produces:
  - `main(argv: string[], now: string): Promise<number>` — `verify --input <file> --tenant <id> [--ruleset <pin>] [--out <file>] [--format json|sarif] [--no-gate]` 파싱; 입력 파일 읽기; `runVerify` 호출; `--out` 지정 시 리포트(json 또는 sarif) 파일 기록; 요약을 stdout에 출력; exit code 반환. (`now`는 결정성을 위해 주입; bin이 실제 시각 전달.)
  - `bin.ts`: `main(process.argv.slice(2), new Date(...))` 실행 후 `process.exit`. (※ `new Date()`는 bin 런타임에서만 — 라이브러리/테스트 경로엔 없음.)

- [ ] **Step 1: 실패 테스트 작성**

`packages/cli/src/main.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/cli/src/main.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`packages/cli/src/main.ts`:
```ts
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
```

`packages/cli/src/bin.ts`:
```ts
#!/usr/bin/env node
import { main } from './main.js';

// `new Date()` lives ONLY in the bin runtime entry — never in the library/test path.
main(process.argv.slice(2), new Date().toISOString()).then((code) => process.exit(code));
```

`packages/cli/src/index.ts`에 추가:
```ts
export * from './main.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/cli/src/main.test.ts`  → PASS (5 tests)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 전체 스위트 + 커밋**

Run: `pnpm test`  → 전 패키지 green
Run: `pnpm typecheck`  → exit 0

```bash
git add packages/cli/src/main.ts packages/cli/src/bin.ts packages/cli/src/index.ts packages/cli/src/main.test.ts
git commit -m "feat(cli): add softbowl verify command (arg parsing, json/sarif output, exit codes)"
```

---

## 완료 시 산출물

- `@sb/report`: `ValidationReport`(§5.1 부분집합) + `buildReport`(결정적) + `toSarif`(SARIF 2.1.0)
- `@sb/cli`: `runVerify`(전체 파이프라인 + tool-error exit 2) + `softbowl verify` 명령(인자 파싱·json/sarif 출력·exit code)
- end-to-end 실사용: `softbowl verify --input screen.html --tenant hosp-A --out report.json` → 위반 시 exit 1, 도구오류 exit 2, `--no-gate` 리포트 전용 exit 0

## 후속 플랜 (이 플랜 범위 밖)

1. **입력 경로 확장** — `--input <url>`(런타임 Capture/Playwright), bundle/tsx-source
2. **감사 레코드(prevHash 체인)** — 리포트의 `audit` 필드 채움(§6.2.1)
3. **ci 컨텍스트** — repo/commit/pr를 리포트 `ci`에 주입(GitHub Actions 통합)
4. **위양성 라벨링·break-glass** — `falsePositiveLabel`·`overridden` 활성(§4.5.1·§7.3)
