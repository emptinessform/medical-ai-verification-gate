# 규칙 엔진 + 게이트 (effectiveSeverity / decideGate) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 검증 게이트의 심장을 만든다 — 순수 함수 규칙이 IR(L1/L2/facts)을 읽어 `authority`가 박힌 `Violation`을 내고, `effectiveSeverity`(§4.4)가 confidence·status·rollout으로 게이팅하며, `decideGate`(§5.2)가 통과/차단을 결정하고 exit code로 계약한다. 접근성 룰은 NORMALIZE의 axe facts를 소비한다.

**아키텍처:** 세 패키지. (1) `@sb/ir-schema`에 게이트 계약 타입 추가(`Severity`, `AuthorityRef`, `Violation`, `RuleBinding`, `ReportedFinding`, `GateDecision`, `Rule` 인터페이스). (2) `@sb/engine` — `effectiveSeverity`(단일 강제 지점), `runRules`(requires-skip + fail-closed authority + 게이팅 → Findings), `decideGate` + `exitCodeFor`. (3) `@sb/rules` — axe 기반 접근성 룰(label/image-alt/color-contrast). 핵심 불변식: **차단은 `status==='known' ∧ confidence ≥ floor ∧ rolloutState==='block'`일 때만.** 미상·저신뢰·미승급 중 하나라도 있으면 절대 block 불가(P5/P6). axe `incomplete`(jsdom의 color-contrast)는 nodeStatus `unknown`이 되어 게이트에서 강등된다.

**기술 스택:** TypeScript(strict), pnpm workspace, Vitest, Zod.

## 전역 제약 (Global Constraints)

- TypeScript `strict: true`. `@sb/engine`/`@sb/rules`는 계약 타입을 `@sb/ir-schema`에서만 import한다.
- **fail-closed(P4/ADR-4):** 모든 `Violation`은 `authority`(외부 권위 인용) 필수. 엔진은 authority 없는 Violation을 스키마 검증으로 거부한다.
- **게이트 차단 불변식(§4.4):** effectiveSeverity가 `'block'`을 반환하려면 반드시 `nodeStatus==='known'` **이고** `confidence ≥ rule.confidenceFloor` **이고** `rolloutState==='block'`. 셋 중 하나라도 어긋나면 `warn`/`info`/`null`로 강등.
- `unknownPolicy`(룰별): `'skip'`(Finding 제거, null 반환) / `'demote'`(block→warn) / `'report'`(info, 게이트 미반영).
- 결정성: 룰을 ruleId 정렬 순으로 평가, Findings를 `(ruleId, nodeId)` 정렬. 같은 IR+룰셋 → 같은 Findings/게이트.
- exit code 계약(§5.2, 동결): `pass`/`block-overridden`→0, `block`→1, tool-error(authority 부재·캡처 실패)→2.
- 각 태스크 끝에서 conventional-commit으로 커밋.

---

### Task 1: 게이트 계약 타입 (`@sb/ir-schema`)

**Files:**
- Create: `packages/ir-schema/src/gate.ts`
- Modify: `packages/ir-schema/src/index.ts`
- Test: `packages/ir-schema/src/gate.test.ts`

**Interfaces:**
- Consumes: `node-meta.ts`(`NodeStatus`), `ir.ts`(`IR` 타입)
- Produces:
  - `Severity` = `'block'|'warn'|'info'`; `RuleCategory`; `UnknownPolicy` = `'skip'|'demote'|'report'`; `RolloutState` = `'shadow'|'warn'|'block'`
  - `AuthorityRef`(Zod) = `{ standard, clause, url? }`
  - `Violation`(Zod) = `{ ruleId, ruleVersion, nodeId, nodeStatus, confidence, severity, authority, evidence }` — **authority 필수(fail-closed)**
  - `RuleBinding`(Zod) = `{ ruleId, ruleVersion, rolloutState }`
  - `ReportedFinding`(Zod) = Violation + `{ category, effectiveSeverity, rolloutState, overridden }`
  - `GateResult` = `'pass'|'block'|'block-overridden'`; `GateDecision` = `{ result, blocking: string[] }`
  - `Rule`(TS interface, Zod 아님 — 함수 포함) + `RuleContext`

- [ ] **Step 1: 실패 테스트 작성**

`packages/ir-schema/src/gate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Violation, AuthorityRef, RuleBinding, ReportedFinding } from './gate.js';

const authority = { standard: 'WCAG 2.1', clause: '4.1.2' };
const v = {
  ruleId: 'a11y.input-label', ruleVersion: '1.0.0', nodeId: 'l1:abc',
  nodeStatus: 'known' as const, confidence: 1, severity: 'block' as const,
  authority, evidence: { axeRuleId: 'label' },
};

describe('Violation', () => {
  it('accepts a violation with authority', () => {
    expect(Violation.parse(v).ruleId).toBe('a11y.input-label');
  });
  it('REJECTS a violation missing authority (fail-closed)', () => {
    const { authority: _omit, ...noAuth } = v;
    expect(() => Violation.parse(noAuth)).toThrow();
  });
});

describe('AuthorityRef', () => {
  it('requires standard and clause', () => {
    expect(AuthorityRef.parse(authority).clause).toBe('4.1.2');
    expect(() => AuthorityRef.parse({ standard: 'WCAG 2.1' })).toThrow();
  });
});

describe('RuleBinding', () => {
  it('accepts rollout states', () => {
    expect(RuleBinding.parse({ ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'block' }).rolloutState).toBe('block');
    expect(() => RuleBinding.parse({ ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'live' })).toThrow();
  });
});

describe('ReportedFinding', () => {
  it('extends a violation with gate fields', () => {
    const f = { ...v, category: 'accessibility' as const, effectiveSeverity: 'block' as const,
      rolloutState: 'block' as const, overridden: false };
    expect(ReportedFinding.parse(f).effectiveSeverity).toBe('block');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/ir-schema/src/gate.test.ts`
Expected: FAIL ("Cannot find module './gate.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/ir-schema/src/gate.ts`:
```ts
import { z } from 'zod';
import { NodeStatus } from './scalars.js';
import type { IR } from './ir.js';

export const Severity = z.enum(['block', 'warn', 'info']);
export type Severity = z.infer<typeof Severity>;

export const RuleCategory = z.enum([
  'accessibility', 'consistency', 'data-integrity-closed', 'data-integrity-contract', 'regulatory-safety',
]);
export type RuleCategory = z.infer<typeof RuleCategory>;

export const UnknownPolicy = z.enum(['skip', 'demote', 'report']);
export type UnknownPolicy = z.infer<typeof UnknownPolicy>;

export const RolloutState = z.enum(['shadow', 'warn', 'block']);
export type RolloutState = z.infer<typeof RolloutState>;

export const AuthorityRef = z.object({
  standard: z.string(),
  clause: z.string(),
  url: z.string().optional(),
});
export type AuthorityRef = z.infer<typeof AuthorityRef>;

export const Violation = z.object({
  ruleId: z.string(),
  ruleVersion: z.string(),
  nodeId: z.string(),
  nodeStatus: NodeStatus,
  confidence: z.number().min(0).max(1),
  severity: Severity,
  authority: AuthorityRef, // REQUIRED — fail-closed (P4/ADR-4)
  evidence: z.record(z.unknown()),
});
export type Violation = z.infer<typeof Violation>;

export const RuleBinding = z.object({
  ruleId: z.string(),
  ruleVersion: z.string(),
  rolloutState: RolloutState,
});
export type RuleBinding = z.infer<typeof RuleBinding>;

export const ReportedFinding = Violation.extend({
  category: RuleCategory,
  effectiveSeverity: Severity,
  rolloutState: RolloutState,
  overridden: z.boolean(),
});
export type ReportedFinding = z.infer<typeof ReportedFinding>;

export type GateResult = 'pass' | 'block' | 'block-overridden';
export interface GateDecision {
  result: GateResult;
  blocking: string[]; // ruleIds that block
}

// Rule plugin interface — TS interface (carries a function, so not a Zod schema).
export interface RuleContext {
  tenantId: string;
}
export interface Rule {
  id: string;
  version: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  confidenceFloor: number; // 0..1
  unknownPolicy: UnknownPolicy;
  requires: Array<'l1' | 'l2' | 'l3' | 'facts'>;
  authority: AuthorityRef;
  evaluate(ir: IR, ctx: RuleContext): Violation[];
}
```

- [ ] **Step 4: index 재노출 + 테스트**

`packages/ir-schema/src/index.ts`에 추가:
```ts
export * from './gate.js';
```

Run: `pnpm vitest run packages/ir-schema/src/gate.test.ts`
Expected: PASS (6 tests)
Run: `pnpm vitest run packages/ir-schema/`  (기존 ir-schema 테스트 영향 없음)
Expected: PASS

- [ ] **Step 5: 타입체크 + 커밋**

Run: `pnpm typecheck`  → exit 0
```bash
git add packages/ir-schema/src/gate.ts packages/ir-schema/src/index.ts packages/ir-schema/src/gate.test.ts
git commit -m "feat(ir-schema): add gate contract types (Violation/Rule/Finding/GateDecision)"
```

---

### Task 2: `@sb/engine` 스캐폴드 + `effectiveSeverity` (§4.4 키스톤)

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/src/effective-severity.ts`
- Modify: `tsconfig.json` (루트 — `packages/engine` 참조 추가)
- Test: `packages/engine/src/effective-severity.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`Severity`, `Violation`, `RuleBinding`, `Rule` 타입)
- Produces:
  - `effectiveSeverity(v: Violation, binding: RuleBinding, rule: Pick<Rule,'confidenceFloor'|'unknownPolicy'>): Severity | null`
  - 알고리즘(순서 고정): ① confidence-gating — `severity==='block' ∧ confidence<floor ⇒ warn`; ② status-gating — `nodeStatus∈{unknown,ambiguous}` ⇒ unknownPolicy 적용(skip→null, report→'info', demote→block을 warn으로); ③ rollout-gating — `shadow⇒'info'`, `warn ∧ block⇒warn`.

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/engine/package.json`:
```json
{
  "name": "@sb/engine",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@sb/ir-schema": "workspace:*"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../ir-schema" }],
  "include": ["src"]
}
```

루트 `tsconfig.json`의 `references`에 `{ "path": "packages/engine" }` 추가(기존 유지).

`packages/engine/src/effective-severity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Violation, RuleBinding } from '@sb/ir-schema';
import { effectiveSeverity } from './effective-severity.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function v(over: Partial<Violation> = {}): Violation {
  return { ruleId: 'r', ruleVersion: '1.0.0', nodeId: 'l1:x', nodeStatus: 'known',
    confidence: 1, severity: 'block', authority: auth, evidence: {}, ...over };
}
const rule = { confidenceFloor: 0.9, unknownPolicy: 'demote' as const };
const block: RuleBinding = { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'block' };

describe('effectiveSeverity', () => {
  it('observed + high confidence + rollout block ⇒ block (the only way to block)', () => {
    expect(effectiveSeverity(v(), block, rule)).toBe('block');
  });
  it('confidence below floor demotes block→warn', () => {
    expect(effectiveSeverity(v({ confidence: 0.5 }), block, rule)).toBe('warn');
  });
  it('unknown status with demote policy ⇒ warn', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'unknown' }), block, rule)).toBe('warn');
  });
  it('ambiguous status with skip policy ⇒ null (removed)', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'ambiguous' }), block, { confidenceFloor: 0.9, unknownPolicy: 'skip' })).toBeNull();
  });
  it('unknown status with report policy ⇒ info', () => {
    expect(effectiveSeverity(v({ nodeStatus: 'unknown' }), block, { confidenceFloor: 0.9, unknownPolicy: 'report' })).toBe('info');
  });
  it('shadow rollout ⇒ info regardless', () => {
    expect(effectiveSeverity(v(), { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'shadow' }, rule)).toBe('info');
  });
  it('warn rollout demotes block→warn', () => {
    expect(effectiveSeverity(v(), { ruleId: 'r', ruleVersion: '1.0.0', rolloutState: 'warn' }, rule)).toBe('warn');
  });
  it('INVARIANT: never blocks when status is not known', () => {
    for (const s of ['unknown', 'ambiguous'] as const) {
      expect(effectiveSeverity(v({ nodeStatus: s }), block, rule)).not.toBe('block');
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/engine/src/effective-severity.test.ts`
Expected: FAIL ("Cannot find module './effective-severity.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/engine/src/effective-severity.ts`:
```ts
import type { Severity, Violation, RuleBinding, UnknownPolicy } from '@sb/ir-schema';

export function effectiveSeverity(
  v: Violation,
  binding: RuleBinding,
  rule: { confidenceFloor: number; unknownPolicy: UnknownPolicy },
): Severity | null {
  let sev: Severity = v.severity;

  // ① confidence-gating (P5)
  if (sev === 'block' && v.confidence < rule.confidenceFloor) sev = 'warn';

  // ② status-gating (P6) — dominates even when confidence ≥ floor
  if (v.nodeStatus === 'unknown' || v.nodeStatus === 'ambiguous') {
    if (rule.unknownPolicy === 'skip') return null;
    if (rule.unknownPolicy === 'report') return 'info';
    if (rule.unknownPolicy === 'demote' && sev === 'block') sev = 'warn';
  }

  // ③ rollout-gating (P9)
  if (binding.rolloutState === 'shadow') return 'info';
  if (binding.rolloutState === 'warn' && sev === 'block') sev = 'warn';
  return sev;
}
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/engine/src/effective-severity.test.ts`  → PASS (8 tests)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/engine/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(engine): add effectiveSeverity gating (the single block chokepoint)"
```

---

### Task 3: `runRules` (fail-closed + requires-skip) + `decideGate` + exit code

**Files:**
- Create: `packages/engine/src/run-rules.ts`
- Create: `packages/engine/src/gate.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/src/run-rules.test.ts`
- Test: `packages/engine/src/gate.test.ts`

**Interfaces:**
- Consumes: `effective-severity.ts`, `@sb/ir-schema`(`IR`, `Rule`, `RuleBinding`, `Violation`, `ReportedFinding`, `GateDecision`, `RuleContext` 타입 + `Violation` 스키마)
- Produces:
  - `requiresSatisfied(requires: Rule['requires'], ir: IR): boolean` — 각 의존 레이어/데이터 배열이 비어있지 않은지(l1 nodes, l2, l3, facts)
  - `runRules(ir: IR, ruleset: Array<{ rule: Rule; binding: RuleBinding }>, ctx: RuleContext): ReportedFinding[]` — requires 미충족 룰 skip; 각 Violation을 `Violation.parse`로 검증(authority 부재면 throw = fail-closed); effectiveSeverity 적용(null이면 제외); ReportedFinding으로. `(ruleId, nodeId)` 정렬.
  - `decideGate(findings: ReportedFinding[]): GateDecision` (§5.2)
  - `exitCodeFor(gate: GateDecision): 0 | 1`

- [ ] **Step 1: 실패 테스트 작성**

`packages/engine/src/run-rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { IR, Rule, RuleBinding } from '@sb/ir-schema';
import { runRules, requiresSatisfied } from './run-rules.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function baseIR(over: Partial<IR> = {}): IR {
  return {
    irSchemaVersion: '1.0.0', tenantId: 't', runId: 'r', inputDigest: 'sha256:x',
    l1: { rootId: 'l1:a', nodes: { 'l1:a': {
      nodeId: 'l1:a', provenance: { source: { domPath: 'a' }, captureId: 'c', scenarioId: 'e' },
      confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['e'],
      tag: 'input', attributes: {}, children: [],
    } } },
    l2: [], l3: [], facts: [], ...over,
  } as IR;
}
const ctx = { tenantId: 't' };
const block: RuleBinding = { ruleId: 'rx', ruleVersion: '1.0.0', rolloutState: 'block' };

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'rx', version: '1.0.0', category: 'accessibility', defaultSeverity: 'block',
    confidenceFloor: 0.9, unknownPolicy: 'demote', requires: ['l1'], authority: auth,
    evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known',
      confidence: 1, severity: 'block', authority: auth, evidence: {} }],
    ...over,
  };
}

describe('requiresSatisfied', () => {
  it('skips a facts-dependent rule when facts is empty', () => {
    expect(requiresSatisfied(['facts'], baseIR())).toBe(false);
    expect(requiresSatisfied(['l1'], baseIR())).toBe(true);
  });
});

describe('runRules', () => {
  it('produces a blocking finding for an observed violation at rollout=block', () => {
    const findings = runRules(baseIR(), [{ rule: rule(), binding: block }], ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].effectiveSeverity).toBe('block');
    expect(findings[0].category).toBe('accessibility');
  });
  it('skips a rule whose requires are unmet', () => {
    const findings = runRules(baseIR(), [{ rule: rule({ requires: ['facts'] }), binding: block }], ctx);
    expect(findings).toHaveLength(0);
  });
  it('FAIL-CLOSED: throws when a violation lacks authority', () => {
    const bad = rule({ evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0', nodeId: 'l1:a',
      nodeStatus: 'known', confidence: 1, severity: 'block', evidence: {} } as never] });
    expect(() => runRules(baseIR(), [{ rule: bad, binding: block }], ctx)).toThrow();
  });
  it('excludes findings whose effectiveSeverity is null (skip policy on unknown)', () => {
    const r = rule({ unknownPolicy: 'skip', evaluate: () => [{ ruleId: 'rx', ruleVersion: '1.0.0',
      nodeId: 'l1:a', nodeStatus: 'unknown', confidence: 1, severity: 'block', authority: auth, evidence: {} }] });
    expect(runRules(baseIR(), [{ rule: r, binding: block }], ctx)).toHaveLength(0);
  });
});
```

`packages/engine/src/gate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ReportedFinding } from '@sb/ir-schema';
import { decideGate, exitCodeFor } from './gate.js';

const auth = { standard: 'WCAG 2.1', clause: '1.1.1' };
function f(over: Partial<ReportedFinding> = {}): ReportedFinding {
  return { ruleId: 'r', ruleVersion: '1.0.0', nodeId: 'l1:a', nodeStatus: 'known', confidence: 1,
    severity: 'block', authority: auth, evidence: {}, category: 'accessibility',
    effectiveSeverity: 'block', rolloutState: 'block', overridden: false, ...over };
}

describe('decideGate', () => {
  it('blocks when an effective block finding exists at rollout block', () => {
    const g = decideGate([f()]);
    expect(g.result).toBe('block');
    expect(g.blocking).toContain('r');
    expect(exitCodeFor(g)).toBe(1);
  });
  it('passes when only warnings exist', () => {
    const g = decideGate([f({ effectiveSeverity: 'warn' })]);
    expect(g.result).toBe('pass');
    expect(exitCodeFor(g)).toBe(0);
  });
  it('block-overridden when the only blocker is overridden (exit 0)', () => {
    const g = decideGate([f({ overridden: true })]);
    expect(g.result).toBe('block-overridden');
    expect(exitCodeFor(g)).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/engine/src/run-rules.test.ts packages/engine/src/gate.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`packages/engine/src/run-rules.ts`:
```ts
import { Violation, type IR, type Rule, type RuleBinding, type ReportedFinding, type RuleContext } from '@sb/ir-schema';
import { effectiveSeverity } from './effective-severity.js';

export function requiresSatisfied(requires: Rule['requires'], ir: IR): boolean {
  return requires.every((req) => {
    switch (req) {
      case 'l1': return Object.keys(ir.l1.nodes).length > 0;
      case 'l2': return ir.l2.length > 0;
      case 'l3': return ir.l3.length > 0;
      case 'facts': return ir.facts.length > 0;
    }
  });
}

export function runRules(
  ir: IR,
  ruleset: Array<{ rule: Rule; binding: RuleBinding }>,
  ctx: RuleContext,
): ReportedFinding[] {
  const findings: ReportedFinding[] = [];
  const ordered = [...ruleset].sort((a, b) => (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0));

  for (const { rule, binding } of ordered) {
    if (!requiresSatisfied(rule.requires, ir)) continue; // auto-skip
    const raw = rule.evaluate(ir, ctx);
    for (const candidate of raw) {
      // fail-closed: a violation without authority is rejected at the schema boundary
      const v = Violation.parse(candidate);
      const eff = effectiveSeverity(v, binding, rule);
      if (eff === null) continue;
      findings.push({
        ...v,
        category: rule.category,
        effectiveSeverity: eff,
        rolloutState: binding.rolloutState,
        overridden: false,
      });
    }
  }

  findings.sort((a, b) =>
    a.ruleId !== b.ruleId ? (a.ruleId < b.ruleId ? -1 : 1)
    : a.nodeId !== b.nodeId ? (a.nodeId < b.nodeId ? -1 : 1) : 0);
  return findings;
}
```

`packages/engine/src/gate.ts`:
```ts
import type { ReportedFinding, GateDecision } from '@sb/ir-schema';

export function decideGate(findings: ReportedFinding[]): GateDecision {
  const blocking = findings.filter(
    (f) => f.effectiveSeverity === 'block' && f.rolloutState === 'block' && !f.overridden,
  );
  if (blocking.length === 0) {
    const wasOverridden = findings.some(
      (f) => f.effectiveSeverity === 'block' && f.rolloutState === 'block' && f.overridden,
    );
    return { result: wasOverridden ? 'block-overridden' : 'pass', blocking: [] };
  }
  return { result: 'block', blocking: blocking.map((f) => f.ruleId) };
}

export function exitCodeFor(gate: GateDecision): 0 | 1 {
  // pass / block-overridden → 0 ; block → 1 (tool-error exit 2 is handled by the CLI layer)
  return gate.result === 'block' ? 1 : 0;
}
```

`packages/engine/src/index.ts`:
```ts
export * from './effective-severity.js';
export * from './run-rules.js';
export * from './gate.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/engine/`  → PASS (effective-severity 8 + run-rules 5 + gate 3 = 16)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/engine/src/run-rules.ts packages/engine/src/gate.ts packages/engine/src/index.ts packages/engine/src/run-rules.test.ts packages/engine/src/gate.test.ts
git commit -m "feat(engine): add runRules (fail-closed + requires-skip) and decideGate + exit codes"
```

---

### Task 4: `@sb/rules` — axe 기반 접근성 룰

**Files:**
- Create: `packages/rules/package.json`
- Create: `packages/rules/tsconfig.json`
- Create: `packages/rules/src/axe-rule.ts`
- Create: `packages/rules/src/a11y.ts`
- Create: `packages/rules/src/index.ts`
- Modify: `tsconfig.json` (루트 — `packages/rules` 참조 추가)
- Test: `packages/rules/src/a11y.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`Rule`, `Violation`, `IR`, `AuthorityRef` 타입)
- Produces:
  - `axeBackedRule(opts: { id; axeRuleId; defaultSeverity; confidenceFloor; unknownPolicy; authority }): Rule` — `requires:['facts']`. evaluate: `ir.facts`에서 `ruleId===axeRuleId`인 fact마다 Violation 생성. `nodeStatus = observed.result==='incomplete' ? 'unknown' : ir.l1.nodes[appliesTo].status`, `confidence = node.confidence`. appliesTo 노드가 L1에 없으면 skip.
  - `a11yInputLabel`, `a11yImageAlt`, `a11yColorContrast`: 위 팩토리의 인스턴스(WCAG authority 부착)

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/rules/package.json`:
```json
{
  "name": "@sb/rules",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@sb/ir-schema": "workspace:*"
  }
}
```

`packages/rules/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../ir-schema" }],
  "include": ["src"]
}
```

루트 `tsconfig.json`의 `references`에 `{ "path": "packages/rules" }` 추가.

`packages/rules/src/a11y.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { IR, ExternalFact } from '@sb/ir-schema';
import { a11yInputLabel, a11yColorContrast } from './a11y.js';

function irWith(facts: ExternalFact[]): IR {
  return {
    irSchemaVersion: '1.0.0', tenantId: 't', runId: 'r', inputDigest: 'sha256:x',
    l1: { rootId: 'l1:a', nodes: { 'l1:a': {
      nodeId: 'l1:a', provenance: { source: { domPath: 'a' }, captureId: 'c', scenarioId: 'e' },
      confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['e'],
      tag: 'input', attributes: {}, children: [],
    } } },
    l2: [], l3: [], facts,
  } as IR;
}
const ctx = { tenantId: 't' };
function fact(over: Partial<ExternalFact>): ExternalFact {
  return { engine: 'axe-core@4.x', ruleId: 'label', appliesTo: 'l1:a', impact: 'serious',
    measurable: true, observed: {}, scenarioId: 'e', ...over };
}

describe('a11yInputLabel', () => {
  it('emits an observed (known) violation from a label fact', () => {
    const vs = a11yInputLabel.evaluate(irWith([fact({ ruleId: 'label' })]), ctx);
    expect(vs).toHaveLength(1);
    expect(vs[0].nodeStatus).toBe('known');
    expect(vs[0].confidence).toBe(1);
    expect(vs[0].authority.standard).toContain('WCAG');
  });
  it('requires facts (auto-skip handled by engine)', () => {
    expect(a11yInputLabel.requires).toContain('facts');
  });
});

describe('a11yColorContrast', () => {
  it('marks an incomplete contrast fact as nodeStatus unknown (gate will demote)', () => {
    const vs = a11yColorContrast.evaluate(
      irWith([fact({ ruleId: 'color-contrast', observed: { result: 'incomplete' } })]), ctx);
    expect(vs).toHaveLength(1);
    expect(vs[0].nodeStatus).toBe('unknown'); // P5/P6: unmeasured → unknown → demoted at gate
  });
  it('uses unknownPolicy demote so incomplete never hard-blocks', () => {
    expect(a11yColorContrast.unknownPolicy).toBe('demote');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/rules/src/a11y.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`packages/rules/src/axe-rule.ts`:
```ts
import type { Rule, Violation, IR, AuthorityRef, Severity, UnknownPolicy } from '@sb/ir-schema';

export function axeBackedRule(opts: {
  id: string;
  axeRuleId: string;
  defaultSeverity: Severity;
  confidenceFloor: number;
  unknownPolicy: UnknownPolicy;
  authority: AuthorityRef;
}): Rule {
  return {
    id: opts.id,
    version: '1.0.0',
    category: 'accessibility',
    defaultSeverity: opts.defaultSeverity,
    confidenceFloor: opts.confidenceFloor,
    unknownPolicy: opts.unknownPolicy,
    requires: ['facts'],
    authority: opts.authority,
    evaluate(ir: IR): Violation[] {
      const out: Violation[] = [];
      for (const f of ir.facts) {
        if (f.ruleId !== opts.axeRuleId) continue;
        const node = ir.l1.nodes[f.appliesTo];
        if (!node) continue; // fact must join to a real L1 node
        const incomplete = (f.observed as { result?: unknown }).result === 'incomplete';
        out.push({
          ruleId: opts.id,
          ruleVersion: '1.0.0',
          nodeId: f.appliesTo,
          nodeStatus: incomplete ? 'unknown' : node.status,
          confidence: node.confidence,
          severity: opts.defaultSeverity,
          authority: opts.authority,
          evidence: { axeRuleId: opts.axeRuleId, impact: f.impact, observed: f.observed },
        });
      }
      return out;
    },
  };
}
```

`packages/rules/src/a11y.ts`:
```ts
import { axeBackedRule } from './axe-rule.js';

export const a11yInputLabel = axeBackedRule({
  id: 'a11y.input-label',
  axeRuleId: 'label',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '4.1.2', url: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value' },
});

export const a11yImageAlt = axeBackedRule({
  id: 'a11y.image-alt',
  axeRuleId: 'image-alt',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '1.1.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content' },
});

export const a11yColorContrast = axeBackedRule({
  id: 'a11y.color-contrast',
  axeRuleId: 'color-contrast',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '1.4.3', url: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum' },
});

export const A11Y_RULES = [a11yInputLabel, a11yImageAlt, a11yColorContrast];
```

`packages/rules/src/index.ts`:
```ts
export * from './axe-rule.js';
export * from './a11y.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/rules/src/a11y.test.ts`  → PASS (4 tests)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/rules/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(rules): add axe-backed accessibility rules (label/image-alt/color-contrast)"
```

---

### Task 5: 전체 파이프라인 통합 + 결정성 골든

**Files:**
- Modify: `packages/engine/package.json` (devDependencies: lift/promoter/normalize/rules — 통합 테스트용)
- Modify: `packages/engine/tsconfig.json` (references에 lift/promoter/normalize/rules 추가 — 테스트 파일도 `tsc -b`로 타입체크되므로 필요)
- Create: `packages/engine/src/pipeline.test.ts`
- Create: `packages/engine/fixtures/gate.golden.json`

**Interfaces:**
- Consumes: `@sb/lift`(`liftHtml`), `@sb/promoter`(`promote`), `@sb/normalize`(`normalizeHtml`), `@sb/rules`(`A11Y_RULES`), `runRules`/`decideGate`/`exitCodeFor`
- Produces: (테스트만 — 게이트 회귀 기준선)

- [ ] **Step 1: devDependencies 추가 + 통합 테스트 작성**

`packages/engine/package.json`의 `devDependencies`에 추가(없으면 신설):
```json
  "devDependencies": {
    "@sb/lift": "workspace:*",
    "@sb/promoter": "workspace:*",
    "@sb/normalize": "workspace:*",
    "@sb/rules": "workspace:*"
  }
```

그리고 `packages/engine/tsconfig.json`의 `references`에 네 프로젝트를 추가한다(기존 `../ir-schema` 유지). 테스트 파일이 이들을 import하고 `tsc -b`가 src의 `*.test.ts`도 타입체크하므로 참조가 없으면 TS6307로 실패한다:
```json
  "references": [
    { "path": "../ir-schema" },
    { "path": "../lift" },
    { "path": "../promoter" },
    { "path": "../normalize" },
    { "path": "../rules" }
  ],
```

`packages/engine/src/pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from '@sb/lift';
import { normalizeHtml } from '@sb/normalize';
import { A11Y_RULES } from '@sb/rules';
import { runRules, decideGate, exitCodeFor } from './index.js';
import type { RuleBinding } from '@sb/ir-schema';

const dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(dir, '..', 'fixtures', 'gate.golden.json');

// An unlabeled input + an img without alt + a low-contrast button.
const HTML = `<form>
  <input id="dose" type="number"/>
  <img src="pill.png"/>
  <button style="color:#bbb;background:#fff">저장</button>
</form>`;

const TENANT = 'hosp-A';
const bindings: Record<string, RuleBinding> = Object.fromEntries(
  A11Y_RULES.map((r) => [r.id, { ruleId: r.id, ruleVersion: r.version, rolloutState: 'block' }]),
);

async function run() {
  const ir = liftHtml({ html: HTML, tenantId: TENANT, runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
  const facts = await normalizeHtml({ html: HTML, tenantId: TENANT, scenarioId: 'empty', l1: ir.l1 });
  const irWithFacts = { ...ir, facts };
  const ruleset = A11Y_RULES.map((rule) => ({ rule, binding: bindings[rule.id] }));
  const findings = runRules(irWithFacts, ruleset, { tenantId: TENANT });
  const gate = decideGate(findings);
  return { findings, gate, exit: exitCodeFor(gate) };
}

describe('full pipeline → gate', () => {
  it('BLOCKS on observed accessibility violations (label/image-alt)', async () => {
    const { findings, gate, exit } = await run();
    // label and image-alt are observed (known) → block-capable
    const blockers = findings.filter((f) => f.effectiveSeverity === 'block').map((f) => f.ruleId);
    expect(blockers).toContain('a11y.input-label');
    expect(blockers).toContain('a11y.image-alt');
    expect(gate.result).toBe('block');
    expect(exit).toBe(1);
  });

  it('DEMOTES incomplete color-contrast to warn (never hard-blocks — P5/P6)', async () => {
    const { findings } = await run();
    const cc = findings.find((f) => f.ruleId === 'a11y.color-contrast');
    if (cc) {
      expect(cc.nodeStatus).toBe('unknown');
      expect(cc.effectiveSeverity).not.toBe('block'); // demoted because unmeasured in jsdom
    }
  });

  it('every finding carries an authority (fail-closed held)', async () => {
    const { findings } = await run();
    for (const f of findings) expect(f.authority.standard).toContain('WCAG');
  });

  it('is deterministic and matches the committed golden', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const actual = JSON.stringify(a, null, 2);
    if (!existsSync(goldenPath)) writeFileSync(goldenPath, actual);
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });
});
```

- [ ] **Step 2: 설치 + 실패 확인 → 골든 생성**

Run: `pnpm install && pnpm vitest run packages/engine/src/pipeline.test.ts`
Expected: 최초 실행에서 골든 생성 후 PASS (4 tests). 두 번째 실행도 PASS.

- [ ] **Step 3: 골든 육안 검토**

`packages/engine/fixtures/gate.golden.json` 확인:
- `gate.result: "block"`, `exit: 1`
- findings에 `a11y.input-label`·`a11y.image-alt`가 `effectiveSeverity:"block"`, `nodeStatus:"known"`
- `a11y.color-contrast`(있다면) `nodeStatus:"unknown"`, `effectiveSeverity:"warn"`
- 모든 finding에 `authority.standard` = "WCAG 2.1"

- [ ] **Step 4: 전체 스위트 + 타입체크**

Run: `pnpm test`  → 전 패키지 green (ir-schema/lift/promoter/normalize/engine/rules)
Run: `pnpm typecheck`  → exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/engine/package.json packages/engine/src/pipeline.test.ts packages/engine/fixtures/ pnpm-lock.yaml
git commit -m "test(engine): full pipeline lift->promote->normalize->gate determinism golden"
```

---

## 완료 시 산출물

- `@sb/ir-schema`: 게이트 계약(Violation/Rule/Finding/GateDecision, authority 필수)
- `@sb/engine`: `effectiveSeverity`(단일 차단 길목, §4.4), `runRules`(fail-closed + requires-skip), `decideGate` + exit code(§5.2)
- `@sb/rules`: axe 기반 접근성 룰 3종
- 통합 실증: 관측 위반(label/image-alt)은 차단(exit 1), 미측정 color-contrast는 강등(P5/P6) — "추론·미측정으로 배포를 막지 않는다"가 코드로 성립

## 후속 플랜 (이 플랜 범위 밖)

1. **L2 기반 일관성 룰** — 폼 내부 없는 필드 참조·중복 라벨·submit 다중(§4.6)
2. **CLI + 리포트(SARIF)** — `softbowl verify` exit code 계약을 CLI로 노출(§5.3)
3. **scenarios dedup**(§3.7) + **break-glass 인가**(§4.5.1)
4. **staged rollout 전이**(shadow→warn→block) + 감사 레코드(prevHash)
