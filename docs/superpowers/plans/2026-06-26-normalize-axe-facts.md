# NORMALIZE (axe → facts) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** `@sb/normalize` 구축 — axe-core 접근성 검사 결과를 IR의 `ExternalFact[]`로 정규화하고, 각 fact를 L1 `nodeId`에 결합한다(아키텍처 §3.4). Promoter가 이미 받지만 비어 있던 `facts[]`를 실제로 채운다.

**아키텍처:** 두 겹으로 나눈다. (1) `mapAxeResults` — axe 출력 + jsdom 문서를 받아 각 결과의 `target` 셀렉터를 DOM 요소로 역참조하고, 그 요소의 `stablePath`로 L1 `nodeId`를 계산해 `appliesTo`에 결합하는 **순수 함수**(§3.4 규약). axe `incomplete`(판정 불가)는 `measurable:true, observed:{result:'incomplete'}`로 보존(침묵 누락 금지). (2) `normalizeHtml` — lift와 동일하게 `<body>${html}</body>`를 파싱하고 실제 axe-core를 jsdom에서 실행한 뒤 `mapAxeResults`로 매핑하고, L1에 실재하는 nodeId로 조인되는 fact만 남긴다(합성 래퍼 html/body 수준 결과는 제외).

**기술 스택:** TypeScript(strict), pnpm workspace, Vitest, jsdom, axe-core(검증됨: 4.12.x가 jsdom에서 동작 — label/image-alt 등은 violations, color-contrast는 레이아웃 부재로 incomplete).

## 전역 제약 (Global Constraints)

- TypeScript `strict: true`. `@sb/normalize`는 `ExternalFact` 타입을 `@sb/ir-schema`에서만, `stablePath`/`makeNodeId`를 `@sb/lift`에서만 import한다.
- `mapAxeResults`는 순수·결정적: 같은 (axe 출력, 문서) → 같은 `ExternalFact[]`. 출력은 `(appliesTo, ruleId, measurable)` 기준 정렬.
- 침묵 누락 금지(§3.4): axe `incomplete` 결과는 반드시 `measurable:true, observed:{result:'incomplete', ...}`로 fact에 보존한다.
- L1 정합: `normalizeHtml`은 lift와 **동일한 파싱**(`<body>${html}</body>`, 라인엔딩 `\r\n?`→`\n` 정규화)을 사용해 stablePath/nodeId가 lift의 L1과 비트 동일하게 맞도록 한다. axe가 합성 래퍼(html/body) 수준에서 낸 결과(예: `html-has-lang`, `document-title`, `region`)는 L1에 대응 노드가 없으므로 제외한다(사용자 아티팩트가 아닌 jsdom 래핑 산물이므로 누락이 아님).
- axe-core는 jsdom에서 globals(window/document/Node/HTMLElement/Element/getComputedStyle)를 **import 전에** 설정해야 한다(동적 import). `navigator`는 Node에서 read-only이므로 건드리지 않는다. 설정한 globals는 실행 후 복원한다.
- 각 태스크 끝에서 conventional-commit으로 커밋.

---

### Task 1: `@sb/normalize` 스캐폴드 + `mapAxeResults` 순수 매핑 (§3.4)

**Files:**
- Create: `packages/normalize/package.json`
- Create: `packages/normalize/tsconfig.json`
- Create: `packages/normalize/src/map-axe.ts`
- Modify: `tsconfig.json` (루트 — `packages/normalize` 참조 추가)
- Test: `packages/normalize/src/map-axe.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`ExternalFact` 타입), `@sb/lift`(`stablePath`, `makeNodeId`), `jsdom`(테스트에서 문서 생성)
- Produces:
  - `AxeCheck`/`AxeNode`/`AxeResult`/`AxeOutput` (axe 출력의 최소 입력 타입)
  - `mapAxeResults(axe: AxeOutput, doc: Document, opts: { tenantId: string; scenarioId: string; engine: string }): ExternalFact[]`
  - 규약: violations(measurable:true) + incomplete(measurable:true, observed.result='incomplete')를 처리. 각 node의 `target` 셀렉터(배열이면 마지막 항목)를 `doc.querySelectorAll`로 역참조해 매칭 요소마다 별도 fact 생성(복수 매칭 분해, §3.4). `appliesTo = makeNodeId('l1', tenantId, stablePath(el).path)`. `observed`는 node의 any/all/none 체크 중 첫 비어있지 않은 `.data`. 출력은 `(appliesTo, ruleId, measurable)` 정렬.

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/normalize/package.json`:
```json
{
  "name": "@sb/normalize",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@sb/ir-schema": "workspace:*",
    "@sb/lift": "workspace:*"
  },
  "devDependencies": {
    "jsdom": "^24.0.0",
    "@types/jsdom": "^21.0.0"
  }
}
```

`packages/normalize/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../ir-schema" }, { "path": "../lift" }],
  "include": ["src"]
}
```

루트 `tsconfig.json`의 `references` 배열에 `{ "path": "packages/normalize" }` 추가(기존 ir-schema/lift/promoter 유지).

`packages/normalize/src/map-axe.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { mapAxeResults, type AxeOutput } from './map-axe.js';

function doc(html: string): Document {
  return new JSDOM(`<body>${html}</body>`).window.document;
}
const opts = { tenantId: 'hosp-A', scenarioId: 'empty', engine: 'axe-core@4.x' };

describe('mapAxeResults', () => {
  it('maps a violation to a fact joined to the targeted L1 nodeId', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious',
        nodes: [{ target: ['#dose'], any: [{ data: { accessibleName: '' } }] }] }],
      incomplete: [],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(1);
    expect(facts[0].ruleId).toBe('label');
    expect(facts[0].impact).toBe('serious');
    expect(facts[0].measurable).toBe(true);
    expect(facts[0].observed).toEqual({ accessibleName: '' });
    expect(facts[0].appliesTo).toMatch(/^l1:[0-9a-f]{12}$/);
  });

  it('preserves incomplete results (no silent drop) with observed.result', () => {
    const d = doc('<form><button id="b">저장</button></form>');
    const axe: AxeOutput = {
      violations: [],
      incomplete: [{ id: 'color-contrast', impact: null,
        nodes: [{ target: ['#b'], any: [{ data: { fgColor: '#bbb' } }] }] }],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(1);
    expect(facts[0].ruleId).toBe('color-contrast');
    expect(facts[0].impact).toBe('moderate'); // null impact defaults to moderate
    expect(facts[0].observed).toEqual({ result: 'incomplete', fgColor: '#bbb' });
  });

  it('splits a selector matching multiple nodes into separate facts', () => {
    const d = doc('<form><input class="x"/><input class="x"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious', nodes: [{ target: ['.x'] }] }],
      incomplete: [],
    };
    const facts = mapAxeResults(axe, d, opts);
    expect(facts).toHaveLength(2);
    expect(facts[0].appliesTo).not.toBe(facts[1].appliesTo);
  });

  it('is deterministic and sorted by (appliesTo, ruleId)', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'serious', nodes: [{ target: ['#dose'] }] }],
      incomplete: [],
    };
    expect(JSON.stringify(mapAxeResults(axe, d, opts))).toBe(JSON.stringify(mapAxeResults(axe, d, opts)));
  });

  it('uses the last selector in a nested target array', () => {
    const d = doc('<form><input id="dose"/></form>');
    const axe: AxeOutput = {
      violations: [{ id: 'label', impact: 'minor', nodes: [{ target: ['#frame', '#dose'] }] }],
      incomplete: [],
    };
    expect(mapAxeResults(axe, d, opts)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/normalize/src/map-axe.test.ts`
Expected: FAIL ("Cannot find module './map-axe.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/normalize/src/map-axe.ts`:
```ts
import type { ExternalFact } from '@sb/ir-schema';
import { stablePath, makeNodeId } from '@sb/lift';

export interface AxeCheck {
  data?: unknown;
}
export interface AxeNode {
  target: string | string[];
  any?: AxeCheck[];
  all?: AxeCheck[];
  none?: AxeCheck[];
}
export interface AxeResult {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  nodes: AxeNode[];
}
export interface AxeOutput {
  violations: AxeResult[];
  incomplete: AxeResult[];
}

function selectorOf(target: string | string[]): string {
  return Array.isArray(target) ? target[target.length - 1] : target;
}

function observedOf(node: AxeNode): Record<string, unknown> {
  for (const group of [node.any, node.all, node.none]) {
    if (group) {
      for (const c of group) {
        if (c.data && typeof c.data === 'object') return c.data as Record<string, unknown>;
      }
    }
  }
  return {};
}

export function mapAxeResults(
  axe: AxeOutput,
  doc: Document,
  opts: { tenantId: string; scenarioId: string; engine: string },
): ExternalFact[] {
  const facts: ExternalFact[] = [];

  const consume = (results: AxeResult[], incomplete: boolean) => {
    for (const r of results) {
      for (const node of r.nodes) {
        const selector = selectorOf(node.target);
        // axe ran on this doc, so selectors resolve; an unresolvable selector yields no
        // element and is skipped (it is not an incomplete result, so §3.4 no-silent-drop holds).
        const els = Array.from(doc.querySelectorAll(selector));
        const data = observedOf(node);
        for (const el of els) {
          const { path } = stablePath(el);
          facts.push({
            engine: opts.engine,
            ruleId: r.id,
            appliesTo: makeNodeId('l1', opts.tenantId, path),
            impact: r.impact ?? 'moderate',
            measurable: true,
            observed: incomplete ? { result: 'incomplete', ...data } : data,
            scenarioId: opts.scenarioId,
          });
        }
      }
    }
  };

  consume(axe.violations, false);
  consume(axe.incomplete, true); // §3.4: incomplete preserved, never dropped

  facts.sort((a, b) => {
    if (a.appliesTo !== b.appliesTo) return a.appliesTo < b.appliesTo ? -1 : 1;
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    if (a.measurable !== b.measurable) return a.measurable ? -1 : 1;
    return 0;
  });
  return facts;
}
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/normalize/src/map-axe.test.ts`
Expected: PASS (5 tests)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/normalize/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(normalize): add @sb/normalize with pure mapAxeResults (axe->facts join)"
```

---

### Task 2: `runAxe` + `normalizeHtml` — 실제 axe-core 실행 + L1 조인

**Files:**
- Create: `packages/normalize/src/run-axe.ts`
- Create: `packages/normalize/src/normalize.ts`
- Create: `packages/normalize/src/index.ts`
- Modify: `packages/normalize/package.json` (axe-core 의존성 추가)
- Test: `packages/normalize/src/normalize.test.ts`

**Interfaces:**
- Consumes: `map-axe.ts`, `@sb/ir-schema`(`ExternalFact`, `L1Graph` 타입), `@sb/lift`(`liftHtml` — 테스트), `jsdom`, `axe-core`
- Produces:
  - `runAxe(doc: Document): Promise<AxeOutput>` — jsdom 문서에 axe-core 실행(globals 설정→동적 import→실행→globals 복원). `resultTypes: ['violations','incomplete']`.
  - `normalizeHtml(args: { html: string; tenantId: string; scenarioId: string; l1: L1Graph }): Promise<ExternalFact[]>` — lift와 동일 파싱으로 문서 생성 → `runAxe` → `mapAxeResults` → `appliesTo`가 `l1.nodes`에 실재하는 fact만 필터.

- [ ] **Step 1: axe-core 의존성 추가 + 실패 테스트 작성**

`packages/normalize/package.json`의 `dependencies`에 axe-core 추가(jsdom/@types/jsdom는 devDependencies 유지):
```json
  "dependencies": {
    "@sb/ir-schema": "workspace:*",
    "@sb/lift": "workspace:*",
    "axe-core": "^4.12.0"
  },
```

`packages/normalize/src/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { liftHtml } from '@sb/lift';
import { normalizeHtml } from './normalize.js';

const HTML = `<form>
  <input id="dose" type="number"/>
  <img src="pill.png"/>
  <button>저장</button>
</form>`;

const args = { html: HTML, tenantId: 'hosp-A', scenarioId: 'empty' };

describe('normalizeHtml', () => {
  it('produces facts that all join to an existing L1 node', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(facts.length).toBeGreaterThan(0);
    const l1Ids = new Set(Object.keys(ir.l1.nodes));
    for (const f of facts) {
      expect(l1Ids.has(f.appliesTo)).toBe(true); // every fact joins to a real L1 node
      expect(f.appliesTo).toMatch(/^l1:[0-9a-f]{12}$/);
      expect(f.engine).toContain('axe-core');
    }
  });

  it('surfaces the missing-alt finding on the img (image-alt) joined to its L1 node', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    const imgNode = Object.values(ir.l1.nodes).find((n) => n.tag === 'img')!;
    const imgFacts = facts.filter((f) => f.appliesTo === imgNode.nodeId);
    expect(imgFacts.some((f) => f.ruleId === 'image-alt')).toBe(true);
  });

  it('is deterministic across two runs', async () => {
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const a = await normalizeHtml({ ...args, l1: ir.l1 });
    const b = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces a schema-valid IR when fed back into the IR root', async () => {
    const { IR } = await import('@sb/ir-schema');
    const ir = liftHtml({ ...args, runId: 'r', ruleSetPin: 'rs@1' });
    const facts = await normalizeHtml({ ...args, l1: ir.l1 });
    expect(() => IR.parse({ ...ir, facts })).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/normalize/src/normalize.test.ts`
Expected: FAIL ("Cannot find module './normalize.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/normalize/src/run-axe.ts`:
```ts
import type { AxeOutput } from './map-axe.js';

// axe-core needs DOM globals set BEFORE it is imported, and deduces its context then.
// We set them, dynamically import axe, run, and restore the prior globals.
export async function runAxe(doc: Document): Promise<AxeOutput> {
  const win = (doc.defaultView ?? (doc as unknown as { window?: unknown }).window) as
    | (Window & typeof globalThis)
    | undefined;
  if (!win) throw new Error('runAxe: document has no associated window');

  const g = globalThis as Record<string, unknown>;
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'Element', 'getComputedStyle'] as const;
  const prior: Record<string, unknown> = {};
  for (const k of keys) prior[k] = g[k];

  g['window'] = win;
  g['document'] = doc;
  g['Node'] = (win as unknown as { Node: unknown }).Node;
  g['HTMLElement'] = (win as unknown as { HTMLElement: unknown }).HTMLElement;
  g['Element'] = (win as unknown as { Element: unknown }).Element;
  g['getComputedStyle'] = win.getComputedStyle.bind(win);

  try {
    const axe = (await import('axe-core')).default;
    const results = await axe.run(doc, { resultTypes: ['violations', 'incomplete'] });
    // axe's Result[] is structurally compatible with our minimal AxeResult[]; adapt at this boundary.
    return {
      violations: results.violations as unknown as AxeOutput['violations'],
      incomplete: results.incomplete as unknown as AxeOutput['incomplete'],
    };
  } finally {
    for (const k of keys) g[k] = prior[k];
  }
}
```

`packages/normalize/src/normalize.ts`:
```ts
import { JSDOM } from 'jsdom';
import type { ExternalFact, L1Graph } from '@sb/ir-schema';
import { mapAxeResults } from './map-axe.js';
import { runAxe } from './run-axe.js';

const AXE_ENGINE = 'axe-core@4.x';

export async function normalizeHtml(args: {
  html: string;
  tenantId: string;
  scenarioId: string;
  l1: L1Graph;
}): Promise<ExternalFact[]> {
  // Parse identically to liftHtml so stablePath/nodeId align with the L1 graph.
  const html = args.html.replace(/\r\n?/g, '\n');
  const dom = new JSDOM(`<body>${html}</body>`);
  const doc = dom.window.document;

  const axe = await runAxe(doc);
  const facts = mapAxeResults(axe, doc, {
    tenantId: args.tenantId,
    scenarioId: args.scenarioId,
    engine: AXE_ENGINE,
  });

  // Keep only facts that join to a real L1 node. axe also reports document-level
  // findings on the synthetic <html>/<body> wrapper (e.g. html-has-lang, region);
  // those have no corresponding L1 node and are wrapper artifacts, not findings
  // about the user artifact.
  const l1Ids = new Set(Object.keys(args.l1.nodes));
  return facts.filter((f) => l1Ids.has(f.appliesTo));
}
```

`packages/normalize/src/index.ts`:
```ts
export * from './map-axe.js';
export * from './run-axe.js';
export * from './normalize.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/normalize/src/normalize.test.ts`
Expected: PASS (4 tests). (axe-core 4.12.x는 jsdom에서 `image-alt`/`label`을 violations로, `color-contrast`를 incomplete로 낸다.)
Run: `pnpm typecheck`
Expected: exit 0

> 주의: `runAxe`가 전역(window/document 등)을 일시 설정한다. vitest는 파일별로 환경을 격리하지만, 안전을 위해 `finally`에서 이전 값을 복원한다. axe-core import는 globals 설정 이후 동적으로 수행해야 한다(정적 import 금지).

- [ ] **Step 5: 전체 스위트 + 커밋**

Run: `pnpm test`
Expected: 전 패키지 green (ir-schema + lift + promoter + normalize)

```bash
git add packages/normalize/src/run-axe.ts packages/normalize/src/normalize.ts packages/normalize/src/index.ts packages/normalize/package.json pnpm-lock.yaml packages/normalize/src/normalize.test.ts
git commit -m "feat(normalize): run axe-core in jsdom and join facts to L1 (normalizeHtml)"
```

---

## 완료 시 산출물

- `@sb/normalize`: axe-core → `ExternalFact[]` 정규화. 순수 매핑(`mapAxeResults`, §3.4)과 실제 실행(`normalizeHtml`) 분리. incomplete 보존(침묵 누락 금지), L1 nodeId 정합 결합.
- 파이프라인 `LIFT → NORMALIZE` 활성: `IR.facts`가 실제 axe 사실로 채워지고 스키마 검증 통과.

## 후속 플랜 (이 플랜 범위 밖)

1. **Promoter facts 소비** — `resolveLabel`이 axe `label` fact로 라벨 부재를 교차검증(§3.5의 "axe label fact와 교차검증")
2. **런타임 Capture (Playwright)** — `color-contrast`를 incomplete가 아닌 measurable로 측정
3. **규칙 엔진** — facts + L2를 읽는 접근성/일관성 룰 + effectiveSeverity(§4.4)
4. **scenarios별 facts 합성·dedup** (§3.7)
