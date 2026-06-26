# IR Schema 기초 슬라이스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTML 입력을 받아 결정적(deterministic)이고 Zod로 검증된 L1 IR을 생성하는 키스톤 라이브러리(`@sb/ir-schema` + `@sb/lift`)를 만든다.

**Architecture:** pnpm 모노레포에 두 패키지를 둔다. `@sb/ir-schema`는 모두가 import하는 단일 타입/검증 계약(Zod 스키마 + 파생 TS 타입)이고, `@sb/lift`는 jsdom으로 파싱한 DOM을 결정적 `stablePath`→`nodeId` 규약으로 L1 그래프로 변환한다. 정적 경로이므로 측정값(대비·포커스)은 `Measured<T>{measured:false}`로 비워두고, Playwright 런타임 경로는 후속 플랜으로 미룬다.

**Tech Stack:** TypeScript(strict), pnpm workspace, Vitest, Zod, jsdom, Node `crypto`.

## Global Constraints

- TypeScript `strict: true`. 모든 패키지는 `@sb/ir-schema`의 타입만 공유한다 (경계 드리프트 컴파일타임 차단).
- `irSchemaVersion`은 `'1.0.0'`으로 동결(리터럴 타입). 변경 금지.
- `unknown ≠ null`: 미상은 `status: 'unknown'|'ambiguous'` 또는 `TriBool`의 `'unknown'`으로 표현하고, 절대 `null`로 대체하지 않는다.
- `nodeId` 생성 함수는 순수·결정적: `nodeId = "{layer}:{sha1(tenantId ‖ stablePath).slice(0,12)}"`. 무작위 카운터 금지.
- `stablePath`는 시나리오 불변: 안정 앵커(`id`/`name`/`data-testid`) 우선, 없으면 같은 태그 형제 서수. 휘발 속성(`value`/`aria-expanded`/`checked` 등)은 경로에서 제외.
- 모든 L1 노드는 `confidence: 1.0`, `status: 'known'`(관측 사실).
- 패키지 분리자 상수: `SEP = '‖'` (‖, double vertical line).
- 커밋은 각 Task 끝에서 conventional commit으로.

---

### Task 1: 모노레포 스캐폴드

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `packages/ir-schema/package.json`
- Create: `packages/ir-schema/tsconfig.json`
- Create: `packages/ir-schema/src/index.ts`
- Test: `packages/ir-schema/src/smoke.test.ts`

**Interfaces:**
- Consumes: (없음 — 첫 태스크)
- Produces: 빌드·테스트가 도는 빈 `@sb/ir-schema` 패키지. 후속 태스크가 `packages/ir-schema/src/*`에 모듈을 추가한다.

- [ ] **Step 1: git 저장소 초기화 (이미 repo면 skip)**

Run: `git init`
Expected: `Initialized empty Git repository` (또는 이미 존재 시 reinitialized)

- [ ] **Step 2: 루트 워크스페이스 파일 작성**

`package.json`:
```json
{
  "name": "softbowl-verify",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 3: `@sb/ir-schema` 패키지 파일 작성**

`packages/ir-schema/package.json`:
```json
{
  "name": "@sb/ir-schema",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

`packages/ir-schema/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/ir-schema/src/index.ts`:
```ts
export const IR_SCHEMA_VERSION = '1.0.0' as const;
```

- [ ] **Step 4: 스모크 테스트 작성**

`packages/ir-schema/src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { IR_SCHEMA_VERSION } from './index.js';

describe('smoke', () => {
  it('exports the frozen schema version', () => {
    expect(IR_SCHEMA_VERSION).toBe('1.0.0');
  });
});
```

- [ ] **Step 5: 의존성 설치 및 테스트 실행**

Run: `pnpm install && pnpm test`
Expected: PASS (1 test passed)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with @sb/ir-schema and vitest"
```

---

### Task 2: 스칼라 타입 (TriBool · NodeStatus · Measured)

**Files:**
- Create: `packages/ir-schema/src/scalars.ts`
- Test: `packages/ir-schema/src/scalars.test.ts`
- Modify: `packages/ir-schema/src/index.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  - `TriBool` (Zod) + `TriBool` 타입 = `true | false | 'unknown'`
  - `NodeStatus` (Zod) + 타입 = `'known' | 'unknown' | 'ambiguous'`
  - `Measured<T>(inner)` 팩토리 → `z.object({ value: T|null, measured: boolean })`

- [ ] **Step 1: Write the failing test**

`packages/ir-schema/src/scalars.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ir-schema/src/scalars.test.ts`
Expected: FAIL ("Cannot find module './scalars.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/ir-schema/src/scalars.ts`:
```ts
import { z } from 'zod';

export const TriBool = z.union([z.literal(true), z.literal(false), z.literal('unknown')]);
export type TriBool = z.infer<typeof TriBool>;

export const NodeStatus = z.enum(['known', 'unknown', 'ambiguous']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const Measured = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ value: inner.nullable(), measured: z.boolean() });
export type Measured<T> = { value: T | null; measured: boolean };
```

- [ ] **Step 4: index 재노출 + 테스트 통과 확인**

`packages/ir-schema/src/index.ts`에 추가:
```ts
export * from './scalars.js';
```

Run: `pnpm vitest run packages/ir-schema/src/scalars.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ir-schema/src/scalars.ts packages/ir-schema/src/scalars.test.ts packages/ir-schema/src/index.ts
git commit -m "feat(ir-schema): add TriBool, NodeStatus, Measured scalar types"
```

---

### Task 3: NodeMeta · Provenance 스키마

**Files:**
- Create: `packages/ir-schema/src/node-meta.ts`
- Test: `packages/ir-schema/src/node-meta.test.ts`
- Modify: `packages/ir-schema/src/index.ts`

**Interfaces:**
- Consumes: `scalars.ts` (`NodeStatus`)
- Produces:
  - `Provenance` (Zod): `{ source: {file,line,col} | {domPath}, captureId, scenarioId, pathStability?: 'anchored'|'index-only' }`
  - `NodeMeta` (Zod): `{ nodeId, provenance, confidence(0..1), status, derivedFrom: string[], scenarioCoverage: string[] }`

- [ ] **Step 1: Write the failing test**

`packages/ir-schema/src/node-meta.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NodeMeta, Provenance } from './node-meta.js';

const validMeta = {
  nodeId: 'l1:0a1b2c3d4e5f',
  provenance: { source: { domPath: 'form>input' }, captureId: 'cap1', scenarioId: 'empty' },
  confidence: 1.0,
  status: 'known' as const,
  derivedFrom: [],
  scenarioCoverage: ['empty'],
};

describe('NodeMeta', () => {
  it('accepts a well-formed observed node', () => {
    expect(NodeMeta.parse(validMeta).nodeId).toBe('l1:0a1b2c3d4e5f');
  });

  it('rejects confidence outside 0..1', () => {
    expect(() => NodeMeta.parse({ ...validMeta, confidence: 1.5 })).toThrow();
  });

  it('Provenance accepts source-map form', () => {
    expect(Provenance.parse({
      source: { file: 'a.tsx', line: 12, col: 4 }, captureId: 'c', scenarioId: 's',
    })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ir-schema/src/node-meta.test.ts`
Expected: FAIL ("Cannot find module './node-meta.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/ir-schema/src/node-meta.ts`:
```ts
import { z } from 'zod';
import { NodeStatus } from './scalars.js';

export const Provenance = z.object({
  source: z.union([
    z.object({ file: z.string(), line: z.number(), col: z.number() }),
    z.object({ domPath: z.string() }),
  ]),
  captureId: z.string(),
  scenarioId: z.string(),
  pathStability: z.enum(['anchored', 'index-only']).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const NodeMeta = z.object({
  nodeId: z.string(),
  provenance: Provenance,
  confidence: z.number().min(0).max(1),
  status: NodeStatus,
  derivedFrom: z.array(z.string()),
  scenarioCoverage: z.array(z.string()),
});
export type NodeMeta = z.infer<typeof NodeMeta>;
```

- [ ] **Step 4: index 재노출 + 테스트 통과 확인**

`packages/ir-schema/src/index.ts`에 추가:
```ts
export * from './node-meta.js';
```

Run: `pnpm vitest run packages/ir-schema/src/node-meta.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ir-schema/src/node-meta.ts packages/ir-schema/src/node-meta.test.ts packages/ir-schema/src/index.ts
git commit -m "feat(ir-schema): add NodeMeta and Provenance schemas"
```

---

### Task 4: L1Node · L1Graph · IR 루트 스키마

**Files:**
- Create: `packages/ir-schema/src/l1.ts`
- Create: `packages/ir-schema/src/ir.ts`
- Test: `packages/ir-schema/src/ir.test.ts`
- Modify: `packages/ir-schema/src/index.ts`

**Interfaces:**
- Consumes: `node-meta.ts` (`NodeMeta`), `scalars.ts` (`Measured`)
- Produces:
  - `L1Node` (Zod) = `NodeMeta & { tag, attributes: Record<string,string>, text?, computed?: {contrast?,focusable?,tabOrder?,fontSizePx? as Measured}, a11y?: {role?, name?: Measured<string>}, children: string[] }`
  - `L1Graph` (Zod) = `{ rootId: string, nodes: Record<string, L1Node> }`
  - `IR` (Zod) = `{ irSchemaVersion: '1.0.0', tenantId, runId, inputDigest, l1: L1Graph, l2: unknown[], l3: unknown[], facts: unknown[] }`

- [ ] **Step 1: Write the failing test**

`packages/ir-schema/src/ir.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { IR, L1Node } from './ir.js';

const node = {
  nodeId: 'l1:abc', provenance: { source: { domPath: 'form' }, captureId: 'c', scenarioId: 'empty' },
  confidence: 1, status: 'known' as const, derivedFrom: [], scenarioCoverage: ['empty'],
  tag: 'input', attributes: { name: 'order.dose' },
  computed: { contrast: { value: null, measured: false } },
  children: [],
};

describe('IR root', () => {
  it('accepts an L1Node with unmeasured computed field', () => {
    expect(L1Node.parse(node).tag).toBe('input');
  });

  it('pins irSchemaVersion to 1.0.0', () => {
    const ir = {
      irSchemaVersion: '1.0.0', tenantId: 'hosp-A', runId: 'run1', inputDigest: 'sha256:x',
      l1: { rootId: 'l1:abc', nodes: { 'l1:abc': node } },
      l2: [], l3: [], facts: [],
    };
    expect(IR.parse(ir).irSchemaVersion).toBe('1.0.0');
    expect(() => IR.parse({ ...ir, irSchemaVersion: '2.0.0' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ir-schema/src/ir.test.ts`
Expected: FAIL ("Cannot find module './ir.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/ir-schema/src/l1.ts` (순환참조 회피를 위해 `./index.js`가 아니라 모듈을 직접 import):
```ts
import { z } from 'zod';
import { NodeMeta } from './node-meta.js';
import { Measured } from './scalars.js';

export const L1Node = NodeMeta.extend({
  tag: z.string(),
  attributes: z.record(z.string()),
  text: z.string().optional(),
  computed: z.object({
    contrast: Measured(z.number()).optional(),
    focusable: Measured(z.boolean()).optional(),
    tabOrder: Measured(z.number()).optional(),
    fontSizePx: Measured(z.number()).optional(),
  }).optional(),
  a11y: z.object({
    role: z.string().optional(),
    name: Measured(z.string()).optional(),
  }).optional(),
  children: z.array(z.string()),
});
export type L1Node = z.infer<typeof L1Node>;

export const L1Graph = z.object({
  rootId: z.string(),
  nodes: z.record(L1Node),
});
export type L1Graph = z.infer<typeof L1Graph>;
```

`packages/ir-schema/src/ir.ts`:
```ts
import { z } from 'zod';
import { L1Graph } from './l1.js';

export * from './l1.js';

export const IR = z.object({
  irSchemaVersion: z.literal('1.0.0'),
  tenantId: z.string(),
  runId: z.string(),
  inputDigest: z.string(),
  l1: L1Graph,
  l2: z.array(z.unknown()), // 후속 플랜: SemanticOverlay
  l3: z.array(z.unknown()), // 후속 플랜: DomainAnnotation (1단계 빈 배열)
  facts: z.array(z.unknown()), // 후속 플랜: ExternalFact (NORMALIZE)
});
export type IR = z.infer<typeof IR>;
```

- [ ] **Step 4: index 재노출 + 테스트 통과 확인**

`packages/ir-schema/src/index.ts`에 추가:
```ts
export * from './ir.js';
```

Run: `pnpm vitest run packages/ir-schema/src/ir.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 타입체크**

Run: `pnpm typecheck`
Expected: 오류 없음 (exit 0)

- [ ] **Step 6: Commit**

```bash
git add packages/ir-schema/src/l1.ts packages/ir-schema/src/ir.ts packages/ir-schema/src/ir.test.ts packages/ir-schema/src/index.ts
git commit -m "feat(ir-schema): add L1Node, L1Graph, and pinned IR root schema"
```

---

### Task 5: `@sb/lift` — stablePath 계산

**Files:**
- Create: `packages/lift/package.json`
- Create: `packages/lift/tsconfig.json`
- Create: `packages/lift/src/stable-path.ts`
- Test: `packages/lift/src/stable-path.test.ts`

**Interfaces:**
- Consumes: `jsdom` (`Element` 타입)
- Produces:
  - `stablePath(el: Element): { path: string; indexOnly: boolean }`
  - 규약: 안정 앵커(`id`/`name`/`data-testid`) 있으면 `tag[attr=val]`, 없으면 같은 태그 형제 서수 `tag[N]` (단일이면 `tag`). `html` 루트 제외. 세그먼트는 `>`로 결합.

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/lift/package.json`:
```json
{
  "name": "@sb/lift",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@sb/ir-schema": "workspace:*",
    "jsdom": "^24.0.0"
  },
  "devDependencies": {
    "@types/jsdom": "^21.0.0"
  }
}
```

`packages/lift/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/lift/src/stable-path.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm install && pnpm vitest run packages/lift/src/stable-path.test.ts`
Expected: FAIL ("Cannot find module './stable-path.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/lift/src/stable-path.ts`:
```ts
const STABLE_ATTRS = ['id', 'name', 'data-testid'] as const;

function segment(el: Element): { seg: string; anchored: boolean } {
  const tag = el.tagName.toLowerCase();
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (v) return { seg: `${tag}[${a}=${v}]`, anchored: true };
  }
  const parent = el.parentElement;
  if (!parent) return { seg: tag, anchored: true };
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length === 1) return { seg: tag, anchored: true };
  const idx = sameTag.indexOf(el) + 1;
  return { seg: `${tag}[${idx}]`, anchored: false };
}

export function stablePath(el: Element): { path: string; indexOnly: boolean } {
  const segs: string[] = [];
  let indexOnly = false;
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'html') {
    const { seg, anchored } = segment(cur);
    segs.unshift(seg);
    if (!anchored) indexOnly = true;
    cur = cur.parentElement;
  }
  return { path: segs.join('>'), indexOnly };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/lift/src/stable-path.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/lift/
git commit -m "feat(lift): add scenario-invariant stablePath computation"
```

---

### Task 6: `@sb/lift` — 결정적 nodeId 생성

**Files:**
- Create: `packages/lift/src/node-id.ts`
- Test: `packages/lift/src/node-id.test.ts`

**Interfaces:**
- Consumes: Node `crypto` (`createHash`)
- Produces:
  - `SEP = '‖'` 상수
  - `makeNodeId(layer: 'l1'|'l2'|'l3', tenantId: string, stablePath: string): string`
  - 규약: `"{layer}:" + sha1(tenantId ‖ stablePath).hex.slice(0,12)`. 순수·결정적.

- [ ] **Step 1: Write the failing test**

`packages/lift/src/node-id.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/lift/src/node-id.test.ts`
Expected: FAIL ("Cannot find module './node-id.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/lift/src/node-id.ts`:
```ts
import { createHash } from 'node:crypto';

export const SEP = '‖'; // ‖ double vertical line

export function makeNodeId(
  layer: 'l1' | 'l2' | 'l3',
  tenantId: string,
  stablePath: string,
): string {
  const hex = createHash('sha1').update(`${tenantId}${SEP}${stablePath}`).digest('hex');
  return `${layer}:${hex.slice(0, 12)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/lift/src/node-id.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/lift/src/node-id.ts packages/lift/src/node-id.test.ts
git commit -m "feat(lift): add deterministic makeNodeId with ‖ separator"
```

---

### Task 7: `@sb/lift` — DOM → L1Graph 빌더 (정적 경로)

**Files:**
- Create: `packages/lift/src/lift-dom.ts`
- Create: `packages/lift/src/input-digest.ts`
- Create: `packages/lift/src/index.ts`
- Test: `packages/lift/src/lift-dom.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema` (`IR`, `L1Graph`, `L1Node` 타입), `stable-path.ts`, `node-id.ts`, `jsdom`
- Produces:
  - `inputDigest(html: string, ruleSetPin: string): string` → `"sha256:" + sha256(html ‖ ruleSetPin ‖ irSchemaVersion).hex`
  - `liftHtml(args: { html: string; tenantId: string; runId: string; scenarioId: string; ruleSetPin: string }): IR` — jsdom으로 파싱, `body` 하위 모든 Element를 L1Node로(정적이라 `computed.*`는 `{value:null,measured:false}`, `status:'known'`, `confidence:1.0`), 결과를 `IR.parse()`로 검증해 반환.

- [ ] **Step 1: Write the failing test**

`packages/lift/src/lift-dom.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { liftHtml } from './lift-dom.js';

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug"></select>
  <input id="dose" name="order.dose" type="number"/>
</form>`;

const args = { html: HTML, tenantId: 'hosp-A', runId: 'run1', scenarioId: 'empty', ruleSetPin: 'rs@1' };

describe('liftHtml', () => {
  it('produces a schema-valid IR pinned to 1.0.0', () => {
    const ir = liftHtml(args);
    expect(ir.irSchemaVersion).toBe('1.0.0');
    expect(ir.tenantId).toBe('hosp-A');
    expect(Object.keys(ir.l1.nodes).length).toBeGreaterThan(0);
  });

  it('marks static computed fields as unmeasured (measured:false)', () => {
    const ir = liftHtml(args);
    const select = Object.values(ir.l1.nodes).find((n) => n.tag === 'select')!;
    expect(select.computed?.contrast).toEqual({ value: null, measured: false });
    expect(select.status).toBe('known');
    expect(select.confidence).toBe(1);
  });

  it('keeps L2/L3/facts empty in this slice', () => {
    const ir = liftHtml(args);
    expect(ir.l2).toEqual([]);
    expect(ir.l3).toEqual([]);
    expect(ir.facts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/lift/src/lift-dom.test.ts`
Expected: FAIL ("Cannot find module './lift-dom.js'")

- [ ] **Step 3: Write minimal implementation**

`packages/lift/src/input-digest.ts`:
```ts
import { createHash } from 'node:crypto';
import { IR_SCHEMA_VERSION } from '@sb/ir-schema';
import { SEP } from './node-id.js';

export function inputDigest(html: string, ruleSetPin: string): string {
  const hex = createHash('sha256')
    .update(`${html}${SEP}${ruleSetPin}${SEP}${IR_SCHEMA_VERSION}`)
    .digest('hex');
  return `sha256:${hex}`;
}
```

`packages/lift/src/lift-dom.ts`:
```ts
import { JSDOM } from 'jsdom';
import { IR, type L1Node } from '@sb/ir-schema';
import { stablePath } from './stable-path.js';
import { makeNodeId } from './node-id.js';
import { inputDigest } from './input-digest.js';

interface LiftArgs {
  html: string;
  tenantId: string;
  runId: string;
  scenarioId: string;
  ruleSetPin: string;
}

const unmeasuredNumber = { value: null, measured: false };

export function liftHtml(args: LiftArgs) {
  const { html, tenantId, runId, scenarioId, ruleSetPin } = args;
  const dom = new JSDOM(`<body>${html}</body>`);
  const doc = dom.window.document;
  const captureId = runId;

  const nodes: Record<string, L1Node> = {};

  function visit(el: Element): string {
    const { path, indexOnly } = stablePath(el);
    const id = makeNodeId('l1', tenantId, path);
    const attributes: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attributes[a.name] = a.value;

    const childIds: string[] = [];
    for (const child of Array.from(el.children)) childIds.push(visit(child));

    nodes[id] = {
      nodeId: id,
      provenance: {
        source: { domPath: path },
        captureId,
        scenarioId,
        ...(indexOnly ? { pathStability: 'index-only' as const } : {}),
      },
      confidence: 1,
      status: 'known',
      derivedFrom: [],
      scenarioCoverage: [scenarioId],
      tag: el.tagName.toLowerCase(),
      attributes,
      ...(el.children.length === 0 && el.textContent?.trim()
        ? { text: el.textContent.trim() }
        : {}),
      computed: {
        contrast: unmeasuredNumber,
        focusable: { value: null, measured: false },
        tabOrder: unmeasuredNumber,
        fontSizePx: unmeasuredNumber,
      },
      children: childIds,
    };
    return id;
  }

  const root = doc.body.firstElementChild!;
  const rootId = visit(root);

  return IR.parse({
    irSchemaVersion: '1.0.0',
    tenantId,
    runId,
    inputDigest: inputDigest(html, ruleSetPin),
    l1: { rootId, nodes },
    l2: [],
    l3: [],
    facts: [],
  });
}
```

`packages/lift/src/index.ts`:
```ts
export * from './stable-path.js';
export * from './node-id.js';
export * from './input-digest.js';
export * from './lift-dom.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/lift/src/lift-dom.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 전체 타입체크**

Run: `pnpm typecheck`
Expected: 오류 없음 (exit 0)

- [ ] **Step 6: Commit**

```bash
git add packages/lift/src/lift-dom.ts packages/lift/src/input-digest.ts packages/lift/src/index.ts packages/lift/src/lift-dom.test.ts
git commit -m "feat(lift): add static DOM→L1Graph builder with inputDigest"
```

---

### Task 8: 결정성 골든 테스트 (재실행 안정성)

**Files:**
- Create: `packages/lift/src/determinism.test.ts`
- Create: `packages/lift/fixtures/prescription.html`
- Create: `packages/lift/fixtures/prescription.golden.json`

**Interfaces:**
- Consumes: `liftHtml` (Task 7)
- Produces: (테스트만 — 후속 플랜의 회귀 기준선)

- [ ] **Step 1: 픽스처 HTML 작성**

`packages/lift/fixtures/prescription.html`:
```html
<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug"><option>Amoxicillin</option></select>
  <input id="dose" name="order.dose" type="number" value="500"/>
  <button>처방 저장</button>
</form>
```

- [ ] **Step 2: Write the failing determinism test**

`packages/lift/src/determinism.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from './lift-dom.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fixtures = join(dir, '..', 'fixtures');
const html = readFileSync(join(fixtures, 'prescription.html'), 'utf8');
const goldenPath = join(fixtures, 'prescription.golden.json');

const args = { html, tenantId: 'hosp-A', runId: 'run1', scenarioId: 'empty', ruleSetPin: 'rs@1' };

describe('determinism', () => {
  it('produces a bit-identical IR across two runs', () => {
    const a = JSON.stringify(liftHtml(args));
    const b = JSON.stringify(liftHtml(args));
    expect(a).toBe(b);
  });

  it('matches the committed golden snapshot', () => {
    const ir = liftHtml(args);
    const actual = JSON.stringify(ir, null, 2);
    if (!existsSync(goldenPath)) {
      writeFileSync(goldenPath, actual); // 최초 1회 생성
    }
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });

  it('every nodeId is the deterministic l1:<12hex> form', () => {
    const ir = liftHtml(args);
    for (const id of Object.keys(ir.l1.nodes)) {
      expect(id).toMatch(/^l1:[0-9a-f]{12}$/);
    }
  });
});
```

- [ ] **Step 3: Run test (생성 + 통과 확인)**

Run: `pnpm vitest run packages/lift/src/determinism.test.ts`
Expected: 최초 실행에서 골든 파일 생성 후 PASS (3 tests). 다시 실행해도 PASS.

- [ ] **Step 4: 골든 스냅샷 육안 검토**

`packages/lift/fixtures/prescription.golden.json`을 열어 확인:
- `irSchemaVersion: "1.0.0"`, `l1.nodes`에 form/label/select/option/input/button 노드 존재
- 각 노드 `nodeId`가 `l1:` 접두 12-hex
- `computed.contrast.measured === false` (정적 경로)
- `index-only` 경로가 있으면 `provenance.pathStability` 표기됨

- [ ] **Step 5: Commit**

```bash
git add packages/lift/fixtures/ packages/lift/src/determinism.test.ts
git commit -m "test(lift): add determinism + golden snapshot for prescription fixture"
```

---

## 완료 시 산출물

- `@sb/ir-schema`: 동결된 IR 계약 (scalars, NodeMeta, L1, IR 루트) — Zod 검증 + TS 타입, 단일 패키지로 전 모듈 공유
- `@sb/lift`: HTML → 결정적·검증된 L1 IR 변환 (stablePath + makeNodeId + liftHtml + inputDigest)
- 골든 스냅샷 기반 결정성 회귀 테스트 — "같은 입력 → 비트 동일 IR" 보증

## 후속 플랜 (이 플랜 범위 밖 — 별도 plan으로)

1. **런타임 Capture (Playwright)** — `computed.*`를 `measured:true`로 채우고 a11y 트리·대비비·포커스순서 확보
2. **NORMALIZE** — axe-core → `facts[]` 매핑 (`appliesTo` nodeId 결합)
3. **Semantic Promoter** — L1→L2 추론 + confidence/status (★1순위 리스크, 가장 큰 투자)
4. **규칙 엔진 + 게이트** — 순수함수 룰 5종 + effectiveSeverity 불변식 + exit-code 계약
5. **DEDUP + 리포트 + 감사** — scenarios dedup + SARIF + prevHash 체인
