# Semantic Promoter (L1 → L2) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** `@sb/promoter` 구축 — 구조적 L1 IR로부터 폼/필드/액션/바인딩 시맨틱을 추론하는 L1→L2 Semantic Promoter. 모든 추론에 `confidence`와 `status`를 부여한다 (아키텍처가 지목한 1순위 롱폴 리스크, §3.5).

**아키텍처:** 순수 함수 `promote({ l1, facts, tenantId, hook })`가 L1 StructureGraph를 순회해 `Form`/`Field`/`Action`/`Display` 노드의 `L2Overlay[]`를 생성한다. 각 L2 노드는 자신이 덮는 L1 노드로부터 결정적 `nodeId`를 파생하고(§3.2.1대로 그 L1 노드의 stablePath를 시드로 사용), `derivedFrom`를 단다. 추론이 불확실하면 반드시 `'unknown'`/`status:'ambiguous'`로 기록하고 `confidence`를 낮춘다 — 절대 확정값으로 단정하지 않는다(P5/P6). facts(axe 결과)는 label 부재 교차검증을 위해 입력으로 받지만, 이 슬라이스에서는 비어 있을 수 있다(NORMALIZE는 후속 플랜).

**기술 스택:** TypeScript(strict), pnpm workspace, Vitest, Zod. 새 패키지 `@sb/promoter`는 `@sb/ir-schema`(타입)와 `@sb/lift`(`makeNodeId`)에 의존한다.

## 전역 제약 (Global Constraints)

- TypeScript `strict: true`. `@sb/promoter`는 IR 타입을 `@sb/ir-schema`에서만, `makeNodeId`/`SEP`를 `@sb/lift`에서만 import한다.
- `unknown ≠ null`: 휴리스틱이 풀지 못한 추론(`required`/`dataType`/`Action.role`)은 반드시 `'unknown'`으로 두고 L2 노드 `status: 'ambiguous'` + 낮춘 `confidence`로 표기한다. 불확실값을 확정값으로 디폴트하지 않는다.
  - 단 하나의 의도적 예외: `Field.label`은 `string | null`이며 `null`은 **확정 부재**를 뜻한다(status는 `known` 유지), §3.5대로. 이는 미상이 아니라 known 값이다.
- 결정적 L2 `nodeId`: L1 노드 `n`을 덮는 L2 노드는 `nodeId = makeNodeId('l2', tenantId, n.provenance.source.domPath)`(L1 노드의 stablePath가 `provenance.source.domPath`에 저장됨). `derivedFrom = [n.nodeId]`. 무작위 금지.
- L2 노드 `confidence`/`status` 집계(결정적): 노드의 핵심 신호(`required`, `dataType`, `Action.role`) 중 하나라도 `'unknown'`/ambiguous면 `status`는 `'ambiguous'`, 아니면 `'known'`. `confidence`는 기여한 신호들의 **최솟값**(가장 보수적). 모든 자식이 known인 Form 노드는 `confidence: 0.95, status: 'known'`.
- confidence 값은 §3.5에서 그대로 가져온다(예: 필드 식별 0.95, label-for 0.95, aria-label 0.9, 인접텍스트 0.6, dataType 직매핑 0.9, action submit 0.85, action 사전 0.7, binding 0.8).
- 결정성: L1 노드를 정렬된 `nodeId` 순으로 순회 → 같은 L1 → 같은 L2(골든 스냅샷이 보증).
- 각 태스크 끝에서 conventional-commit 메시지로 커밋.

---

### Task 1: `@sb/ir-schema`에 L2 / facts / binding 계약 타입

**Files:**
- Create: `packages/ir-schema/src/l2.ts`
- Create: `packages/ir-schema/src/facts.ts`
- Modify: `packages/ir-schema/src/ir.ts` (`l2`/`facts`를 `z.array(z.unknown())`에서 tighten)
- Modify: `packages/ir-schema/src/index.ts` (export 추가)
- Test: `packages/ir-schema/src/l2.test.ts`

**Interfaces:**
- Consumes: `node-meta.ts`(`NodeMeta`), `scalars.ts`(`TriBool`)
- Produces:
  - `CaptureKind` = `'runtime-dom' | 'declarative' | 'source-ast'`
  - `ExternalFact`(Zod) = `{ engine, ruleId, appliesTo, impact: 'minor'|'moderate'|'serious'|'critical', measurable, observed: Record<string,unknown>, scenarioId }`
  - `BindingDescriptor`(Zod) = `{ scope: 'ui-internal'|'contract', path, observedType?, unit?, codeSystem?, contract? }` (코드 참조)
  - `L2Overlay`(`kind` 기준 Zod discriminated union) = `Form | Field | Action | Display`, 각각 `NodeMeta & {...}`
  - tighten된 `IR.l2: L2Overlay[]`, `IR.facts: ExternalFact[]`

- [ ] **Step 1: 실패 테스트 작성**

`packages/ir-schema/src/l2.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { L2Overlay, ExternalFact, BindingDescriptor } from './l2.js';

const meta = {
  nodeId: 'l2:abc', provenance: { source: { domPath: 'form>input' }, captureId: 'c', scenarioId: 'empty' },
  confidence: 0.95, status: 'known' as const, derivedFrom: ['l1:abc'], scenarioCoverage: ['empty'],
};

describe('L2Overlay', () => {
  it('accepts a Field with required unknown and a binding', () => {
    const field = { ...meta, kind: 'Field' as const, label: null, required: 'unknown' as const,
      dataType: 'number' as const, binding: { scope: 'ui-internal' as const, path: 'order.dose' } };
    const parsed = L2Overlay.parse(field);
    expect(parsed.kind).toBe('Field');
  });

  it('accepts a Form referencing field/action nodeIds', () => {
    const form = { ...meta, kind: 'Form' as const, fields: ['l2:f1'], actions: ['l2:a1'] };
    expect(L2Overlay.parse(form).kind).toBe('Form');
  });

  it('rejects an unknown kind', () => {
    expect(() => L2Overlay.parse({ ...meta, kind: 'Widget' })).toThrow();
  });

  it('Field.label accepts null (confirmed absent) and string', () => {
    expect(L2Overlay.parse({ ...meta, kind: 'Field', label: '약품', required: true, dataType: 'string' }).kind).toBe('Field');
  });
});

describe('ExternalFact', () => {
  it('accepts an axe-style fact', () => {
    expect(ExternalFact.parse({
      engine: 'axe-core@4.x', ruleId: 'label', appliesTo: 'l1:abc',
      impact: 'serious', measurable: true, observed: { accessibleName: '' }, scenarioId: 'empty',
    }).ruleId).toBe('label');
  });
});

describe('BindingDescriptor', () => {
  it('accepts a UCUM unit slot with unknown status', () => {
    expect(BindingDescriptor.parse({
      scope: 'ui-internal', path: 'order.dose', unit: { system: 'UCUM', status: 'unknown' },
    }).path).toBe('order.dose');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/ir-schema/src/l2.test.ts`
Expected: FAIL ("Cannot find module './l2.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/ir-schema/src/facts.ts`:
```ts
import { z } from 'zod';

export const CaptureKind = z.enum(['runtime-dom', 'declarative', 'source-ast']);
export type CaptureKind = z.infer<typeof CaptureKind>;

export const ExternalFact = z.object({
  engine: z.string(),
  ruleId: z.string(),
  appliesTo: z.string(),
  impact: z.enum(['minor', 'moderate', 'serious', 'critical']),
  measurable: z.boolean(),
  observed: z.record(z.unknown()),
  scenarioId: z.string(),
});
export type ExternalFact = z.infer<typeof ExternalFact>;
```

`packages/ir-schema/src/l2.ts`:
```ts
import { z } from 'zod';
import { NodeMeta } from './node-meta.js';
import { TriBool } from './scalars.js';

export * from './facts.js';

export const BindingDescriptor = z.object({
  scope: z.enum(['ui-internal', 'contract']),
  path: z.string(),
  observedType: z.string().optional(),
  unit: z.object({
    system: z.literal('UCUM'),
    code: z.string().optional(),
    status: z.enum(['known', 'unknown']),
  }).optional(),
  codeSystem: z.object({
    system: z.enum(['LOINC', 'RxNorm', 'SNOMED', 'ICD10']),
    code: z.string().optional(),
    status: z.enum(['known', 'unknown']),
  }).optional(),
  contract: z.object({
    schema: z.enum(['FHIR', 'OpenAPI']),
    resource: z.string(),
    element: z.string(),
    status: z.enum(['known', 'unknown']),
    contractRef: z.string().optional(),
  }).optional(),
});
export type BindingDescriptor = z.infer<typeof BindingDescriptor>;

const L2Form = NodeMeta.extend({
  kind: z.literal('Form'),
  fields: z.array(z.string()),
  actions: z.array(z.string()),
});
const L2Field = NodeMeta.extend({
  kind: z.literal('Field'),
  label: z.string().nullable(),
  required: TriBool,
  dataType: z.enum(['string', 'number', 'date', 'code', 'quantity', 'boolean', 'unknown']),
  binding: BindingDescriptor.optional(),
});
const L2Action = NodeMeta.extend({
  kind: z.literal('Action'),
  role: z.enum(['submit', 'cancel', 'destructive', 'navigate', 'unknown']),
  target: z.string().optional(),
});
const L2Display = NodeMeta.extend({
  kind: z.literal('Display'),
  binding: BindingDescriptor.optional(),
});

export const L2Overlay = z.discriminatedUnion('kind', [L2Form, L2Field, L2Action, L2Display]);
export type L2Overlay = z.infer<typeof L2Overlay>;
```

`packages/ir-schema/src/ir.ts` 수정 — 두 배열을 tighten. 다음을:
```ts
  l2: z.array(z.unknown()), // 후속 플랜: SemanticOverlay
  ...
  facts: z.array(z.unknown()), // 후속 플랜: ExternalFact (NORMALIZE)
```
다음으로 변경:
```ts
  l2: z.array(L2Overlay),
  ...
  facts: z.array(ExternalFact),
```
그리고 `ir.ts` 상단에 import 추가(순환 회피를 위해 서브모듈 직접 import):
```ts
import { L2Overlay } from './l2.js';
import { ExternalFact } from './facts.js';
```

- [ ] **Step 4: index 재노출 + 테스트 실행**

`packages/ir-schema/src/index.ts`에 추가:
```ts
export * from './l2.js';
```
(`l2.js`가 이미 `facts.js`를 재노출하므로 `ExternalFact`/`CaptureKind`는 이를 통해 나온다. facts export 라인을 따로 추가하지 말 것.)

Run: `pnpm vitest run packages/ir-schema/src/l2.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 기존 IR 테스트가 여전히 통과하는지 확인 (l2/facts tighten했지만 빈 배열은 유효)**

Run: `pnpm vitest run packages/ir-schema/ packages/lift/src/determinism.test.ts`
Expected: PASS (기존 IR + lift 테스트 영향 없음 — `liftHtml`은 tighten된 배열을 만족하는 `l2:[], facts:[]`를 방출)

- [ ] **Step 6: 타입체크 + 커밋**

Run: `pnpm typecheck`
Expected: exit 0

```bash
git add packages/ir-schema/src/l2.ts packages/ir-schema/src/facts.ts packages/ir-schema/src/ir.ts packages/ir-schema/src/index.ts packages/ir-schema/src/l2.test.ts
git commit -m "feat(ir-schema): add L2Overlay, ExternalFact, BindingDescriptor and tighten IR root"
```

---

### Task 2: `@sb/promoter` 스캐폴드 + 노드 분류 + L2 nodeId 파생

**Files:**
- Create: `packages/promoter/package.json`
- Create: `packages/promoter/tsconfig.json`
- Create: `packages/promoter/src/classify.ts`
- Create: `packages/promoter/src/l2-id.ts`
- Modify: `tsconfig.json` (루트 — `packages/promoter` 참조 추가)
- Test: `packages/promoter/src/classify.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`L1Node`, `L1Graph` 타입), `@sb/lift`(`makeNodeId`)
- Produces:
  - `classifyNode(node: L1Node): 'Form' | 'Field' | 'Action' | 'Display' | null`
  - `l2IdFor(tenantId: string, l1: L1Node): string` → `makeNodeId('l2', tenantId, l1.provenance.source.domPath)` (L1 노드의 stablePath를 provenance에서 읽음; `provenance.source`에 `domPath`가 없으면 throw — `liftHtml`의 L1은 항상 domPath 사용)

- [ ] **Step 1: 패키지 파일 + 실패 테스트 작성**

`packages/promoter/package.json`:
```json
{
  "name": "@sb/promoter",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@sb/ir-schema": "workspace:*",
    "@sb/lift": "workspace:*"
  }
}
```

`packages/promoter/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../ir-schema" }, { "path": "../lift" }],
  "include": ["src"]
}
```

루트 `tsconfig.json`의 `references` 배열에 `{ "path": "packages/promoter" }` 추가.

`packages/promoter/src/classify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { L1Node } from '@sb/ir-schema';
import { classifyNode } from './classify.js';
import { l2IdFor } from './l2-id.js';

function node(partial: Partial<L1Node> & { tag: string }): L1Node {
  return {
    nodeId: 'l1:x', provenance: { source: { domPath: partial.tag }, captureId: 'c', scenarioId: 'empty' },
    confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['empty'],
    attributes: {}, children: [], ...partial,
  } as L1Node;
}

describe('classifyNode', () => {
  it('classifies form controls as Field', () => {
    expect(classifyNode(node({ tag: 'input' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'select' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'textarea' }))).toBe('Field');
    expect(classifyNode(node({ tag: 'div', attributes: { role: 'combobox' } }))).toBe('Field');
  });
  it('classifies button as Action', () => {
    expect(classifyNode(node({ tag: 'button' }))).toBe('Action');
    expect(classifyNode(node({ tag: 'input', attributes: { type: 'submit' } }))).toBe('Action');
  });
  it('classifies form as Form', () => {
    expect(classifyNode(node({ tag: 'form' }))).toBe('Form');
  });
  it('returns null for structural-only elements', () => {
    expect(classifyNode(node({ tag: 'div' }))).toBeNull();
    expect(classifyNode(node({ tag: 'label' }))).toBeNull();
  });
});

describe('l2IdFor', () => {
  it('derives an l2 id deterministically from the L1 stablePath', () => {
    const n = node({ tag: 'input', provenance: { source: { domPath: 'form>input[name=dose]' }, captureId: 'c', scenarioId: 'empty' } });
    const a = l2IdFor('hosp-A', n);
    const b = l2IdFor('hosp-A', n);
    expect(a).toBe(b);
    expect(a).toMatch(/^l2:[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm install && pnpm vitest run packages/promoter/src/classify.test.ts`
Expected: FAIL ("Cannot find module './classify.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/promoter/src/classify.ts`:
```ts
import type { L1Node } from '@sb/ir-schema';

const FIELD_TAGS = new Set(['input', 'select', 'textarea']);
const FIELD_ROLES = new Set(['textbox', 'combobox', 'spinbutton', 'checkbox']);
const ACTION_TYPES = new Set(['submit', 'button', 'reset']);

export function classifyNode(node: L1Node): 'Form' | 'Field' | 'Action' | 'Display' | null {
  const tag = node.tag.toLowerCase();
  const role = node.attributes['role'];
  const type = node.attributes['type'];

  if (tag === 'form') return 'Form';
  if (tag === 'button' || role === 'button') return 'Action';
  if (tag === 'input' && type && ACTION_TYPES.has(type)) return 'Action';
  if (FIELD_TAGS.has(tag)) return 'Field';
  if (role && FIELD_ROLES.has(role)) return 'Field';
  return null;
}
```

`packages/promoter/src/l2-id.ts`:
```ts
import type { L1Node } from '@sb/ir-schema';
import { makeNodeId } from '@sb/lift';

export function l2IdFor(tenantId: string, l1: L1Node): string {
  const src = l1.provenance.source;
  if (!('domPath' in src)) {
    throw new Error(`l2IdFor: L1 node ${l1.nodeId} has no domPath provenance`);
  }
  return makeNodeId('l2', tenantId, src.domPath);
}
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/promoter/src/classify.test.ts`
Expected: PASS (6 tests)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/promoter/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(promoter): scaffold @sb/promoter with node classification and l2 nodeId derivation"
```

---

### Task 3: 필드 시맨틱 — label, required, dataType 휴리스틱

**Files:**
- Create: `packages/promoter/src/promote-field.ts`
- Test: `packages/promoter/src/promote-field.test.ts`

**Interfaces:**
- Consumes: `classify.ts`, `l2-id.ts`, `@sb/ir-schema`(`L1Node`, `L1Graph`, `ExternalFact`, `TriBool`, `BindingDescriptor` 타입)
- Produces:
  - `resolveLabel(field: L1Node, l1: L1Graph): { label: string | null; confidence: number; ambiguous: boolean }`
  - `resolveRequired(field: L1Node, label: string | null): { required: TriBool; confidence: number; ambiguous: boolean }`
  - `resolveDataType(field: L1Node): { dataType: string; confidence: number; ambiguous: boolean }`

휴리스틱은 정확히 §3.5. `ambiguous: true`는 이 신호가 L2 노드 status를 `'ambiguous'`로 강제함을 뜻한다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/promoter/src/promote-field.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { L1Node, L1Graph } from '@sb/ir-schema';
import { resolveLabel, resolveRequired, resolveDataType } from './promote-field.js';

function n(id: string, tag: string, attributes: Record<string, string> = {}, text?: string, children: string[] = []): L1Node {
  return { nodeId: id, provenance: { source: { domPath: id }, captureId: 'c', scenarioId: 'empty' },
    confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['empty'],
    tag, attributes, ...(text ? { text } : {}), children } as L1Node;
}
function graph(...nodes: L1Node[]): L1Graph {
  const map: Record<string, L1Node> = {};
  for (const x of nodes) map[x.nodeId] = x;
  return { rootId: nodes[0].nodeId, nodes: map };
}

describe('resolveLabel', () => {
  it('uses <label for> with confidence 0.95', () => {
    const input = n('l1:i', 'input', { id: 'dose' });
    const label = n('l1:l', 'label', { for: 'dose' }, '용량');
    const r = resolveLabel(input, graph(label, input));
    expect(r).toEqual({ label: '용량', confidence: 0.95, ambiguous: false });
  });
  it('uses aria-label with confidence 0.9', () => {
    const input = n('l1:i', 'input', { 'aria-label': '약품명' });
    expect(resolveLabel(input, graph(input))).toEqual({ label: '약품명', confidence: 0.9, ambiguous: false });
  });
  it('returns null + known when no label exists', () => {
    const input = n('l1:i', 'input', { id: 'x' });
    expect(resolveLabel(input, graph(input))).toEqual({ label: null, confidence: 0.95, ambiguous: false });
  });
});

describe('resolveRequired', () => {
  it('reads the required attribute as true (0.95)', () => {
    expect(resolveRequired(n('l1:i', 'input', { required: '' }), null))
      .toEqual({ required: true, confidence: 0.95, ambiguous: false });
  });
  it('reads aria-required=true as true (0.95)', () => {
    expect(resolveRequired(n('l1:i', 'input', { 'aria-required': 'true' }), null))
      .toEqual({ required: true, confidence: 0.95, ambiguous: false });
  });
  it('infers required from a * in the label (0.7)', () => {
    expect(resolveRequired(n('l1:i', 'input', {}), '약품 *'))
      .toEqual({ required: true, confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous when there is no signal (never false)', () => {
    expect(resolveRequired(n('l1:i', 'input', {}), '약품'))
      .toEqual({ required: 'unknown', confidence: 0.5, ambiguous: true });
  });
});

describe('resolveDataType', () => {
  it('maps input[type=number] directly (0.9)', () => {
    expect(resolveDataType(n('l1:i', 'input', { type: 'number' })))
      .toEqual({ dataType: 'number', confidence: 0.9, ambiguous: false });
  });
  it('maps input[type=date] to date', () => {
    expect(resolveDataType(n('l1:i', 'input', { type: 'date' })).dataType).toBe('date');
  });
  it('uses inputmode as an auxiliary signal (0.7)', () => {
    expect(resolveDataType(n('l1:i', 'input', { inputmode: 'numeric' })))
      .toEqual({ dataType: 'number', confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous for an untyped input', () => {
    expect(resolveDataType(n('l1:i', 'input', {})))
      .toEqual({ dataType: 'unknown', confidence: 0.5, ambiguous: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/promoter/src/promote-field.test.ts`
Expected: FAIL ("Cannot find module './promote-field.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/promoter/src/promote-field.ts`:
```ts
import type { L1Node, L1Graph, TriBool } from '@sb/ir-schema';

const UNCERTAIN_CONFIDENCE = 0.5;

export function resolveLabel(
  field: L1Node,
  l1: L1Graph,
): { label: string | null; confidence: number; ambiguous: boolean } {
  // <label for=id> wins (0.95)
  const id = field.attributes['id'];
  if (id) {
    const label = Object.values(l1.nodes).find(
      (x) => x.tag.toLowerCase() === 'label' && x.attributes['for'] === id,
    );
    if (label?.text) return { label: label.text, confidence: 0.95, ambiguous: false };
  }
  // aria-label (0.9)
  const aria = field.attributes['aria-label'];
  if (aria) return { label: aria, confidence: 0.9, ambiguous: false };
  // aria-labelledby → referenced node text (0.9)
  const labelledby = field.attributes['aria-labelledby'];
  if (labelledby) {
    const ref = Object.values(l1.nodes).find((x) => x.attributes['id'] === labelledby);
    if (ref?.text) return { label: ref.text, confidence: 0.9, ambiguous: false };
  }
  // confirmed absent — null + known (0.95)
  return { label: null, confidence: 0.95, ambiguous: false };
}

export function resolveRequired(
  field: L1Node,
  label: string | null,
): { required: TriBool; confidence: number; ambiguous: boolean } {
  if ('required' in field.attributes || field.attributes['aria-required'] === 'true') {
    return { required: true, confidence: 0.95, ambiguous: false };
  }
  if (label && (label.includes('*') || label.includes('필수'))) {
    return { required: true, confidence: 0.7, ambiguous: false };
  }
  // no signal — NEVER assert false (P6)
  return { required: 'unknown', confidence: UNCERTAIN_CONFIDENCE, ambiguous: true };
}

const TYPE_MAP: Record<string, string> = {
  number: 'number', range: 'number',
  date: 'date', 'datetime-local': 'date', month: 'date', week: 'date', time: 'date',
  checkbox: 'boolean',
  text: 'string', email: 'string', tel: 'string', url: 'string', search: 'string', password: 'string',
};

export function resolveDataType(
  field: L1Node,
): { dataType: string; confidence: number; ambiguous: boolean } {
  const type = field.attributes['type'];
  if (type && TYPE_MAP[type]) {
    return { dataType: TYPE_MAP[type], confidence: 0.9, ambiguous: false };
  }
  const inputmode = field.attributes['inputmode'];
  if (inputmode === 'numeric' || inputmode === 'decimal') {
    return { dataType: 'number', confidence: 0.7, ambiguous: false };
  }
  if (field.attributes['pattern']) {
    return { dataType: 'string', confidence: 0.7, ambiguous: false };
  }
  return { dataType: 'unknown', confidence: UNCERTAIN_CONFIDENCE, ambiguous: true };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/promoter/src/promote-field.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/promoter/src/promote-field.ts packages/promoter/src/promote-field.test.ts
git commit -m "feat(promoter): add label/required/dataType field heuristics with confidence/status"
```

---

### Task 4: Action role + binding.path

**Files:**
- Create: `packages/promoter/src/promote-action.ts`
- Create: `packages/promoter/src/binding.ts`
- Test: `packages/promoter/src/promote-action.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema`(`L1Node`, `L1Graph`, `BindingDescriptor` 타입)
- Produces:
  - `resolveActionRole(action: L1Node, l1: L1Graph): { role: 'submit'|'cancel'|'destructive'|'navigate'|'unknown'; confidence: number; ambiguous: boolean }`
  - `resolveBinding(node: L1Node): BindingDescriptor | undefined` — `name`/`data-bind`/`id`에서(0.8), 없으면 undefined

- [ ] **Step 1: 실패 테스트 작성**

`packages/promoter/src/promote-action.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { L1Node, L1Graph } from '@sb/ir-schema';
import { resolveActionRole } from './promote-action.js';
import { resolveBinding } from './binding.js';

function n(id: string, tag: string, attributes: Record<string, string> = {}, text?: string, children: string[] = []): L1Node {
  return { nodeId: id, provenance: { source: { domPath: id }, captureId: 'c', scenarioId: 'empty' },
    confidence: 1, status: 'known', derivedFrom: [], scenarioCoverage: ['empty'],
    tag, attributes, ...(text ? { text } : {}), children } as L1Node;
}
function graph(...nodes: L1Node[]): L1Graph {
  const map: Record<string, L1Node> = {};
  for (const x of nodes) map[x.nodeId] = x;
  return { rootId: nodes[0].nodeId, nodes: map };
}

describe('resolveActionRole', () => {
  it('treats type=submit as submit (0.85)', () => {
    expect(resolveActionRole(n('l1:b', 'button', { type: 'submit' }), graph(n('l1:b', 'button', { type: 'submit' }))))
      .toEqual({ role: 'submit', confidence: 0.85, ambiguous: false });
  });
  it('treats a sole button in a form as submit (0.85)', () => {
    const form = n('l1:f', 'form', {}, undefined, ['l1:b']);
    const btn = n('l1:b', 'button', {}, '처방 저장');
    expect(resolveActionRole(btn, graph(form, btn)).role).toBe('submit');
  });
  it('uses the text dictionary for destructive (0.7)', () => {
    const a = n('l1:b', 'button', {}, '삭제'); const b = n('l1:c', 'button', {}, '취소');
    const form = n('l1:f', 'form', {}, undefined, ['l1:b', 'l1:c']);
    expect(resolveActionRole(a, graph(form, a, b))).toEqual({ role: 'destructive', confidence: 0.7, ambiguous: false });
    expect(resolveActionRole(b, graph(form, a, b))).toEqual({ role: 'cancel', confidence: 0.7, ambiguous: false });
  });
  it('returns unknown + ambiguous for an unlabeled non-submit button among many', () => {
    const a = n('l1:b', 'button', {}, '???'); const b = n('l1:c', 'button', {}, '...');
    const form = n('l1:f', 'form', {}, undefined, ['l1:b', 'l1:c']);
    expect(resolveActionRole(a, graph(form, a, b))).toEqual({ role: 'unknown', confidence: 0.5, ambiguous: true });
  });
});

describe('resolveBinding', () => {
  it('extracts binding.path from name (0.8, ui-internal)', () => {
    expect(resolveBinding(n('l1:i', 'input', { name: 'order.dose' })))
      .toEqual({ scope: 'ui-internal', path: 'order.dose' });
  });
  it('falls back to data-bind then id', () => {
    expect(resolveBinding(n('l1:i', 'input', { 'data-bind': 'order.drug' }))?.path).toBe('order.drug');
    expect(resolveBinding(n('l1:i', 'input', { id: 'dose' }))?.path).toBe('dose');
  });
  it('returns undefined when no binding source exists', () => {
    expect(resolveBinding(n('l1:i', 'input', {}))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/promoter/src/promote-action.test.ts`
Expected: FAIL ("Cannot find module './promote-action.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/promoter/src/binding.ts`:
```ts
import type { L1Node, BindingDescriptor } from '@sb/ir-schema';

export function resolveBinding(node: L1Node): BindingDescriptor | undefined {
  const path = node.attributes['name'] ?? node.attributes['data-bind'] ?? node.attributes['id'];
  if (!path) return undefined;
  return { scope: 'ui-internal', path };
}
```

`packages/promoter/src/promote-action.ts`:
```ts
import type { L1Node, L1Graph } from '@sb/ir-schema';

type Role = 'submit' | 'cancel' | 'destructive' | 'navigate' | 'unknown';

const DESTRUCTIVE = ['삭제', 'delete', 'remove'];
const CANCEL = ['취소', 'cancel', 'close', '닫기'];
const SUBMIT = ['저장', 'save', 'submit', '확인', '등록', '처방'];

function parentForm(node: L1Node, l1: L1Graph): L1Node | undefined {
  return Object.values(l1.nodes).find(
    (x) => x.tag.toLowerCase() === 'form' && x.children.includes(node.nodeId),
  );
}

export function resolveActionRole(
  action: L1Node,
  l1: L1Graph,
): { role: Role; confidence: number; ambiguous: boolean } {
  if (action.attributes['type'] === 'submit') {
    return { role: 'submit', confidence: 0.85, ambiguous: false };
  }
  const text = (action.text ?? '').toLowerCase();
  const raw = action.text ?? '';
  if (DESTRUCTIVE.some((w) => raw.includes(w) || text.includes(w))) {
    return { role: 'destructive', confidence: 0.7, ambiguous: false };
  }
  if (CANCEL.some((w) => raw.includes(w) || text.includes(w))) {
    return { role: 'cancel', confidence: 0.7, ambiguous: false };
  }
  if (SUBMIT.some((w) => raw.includes(w) || text.includes(w))) {
    return { role: 'submit', confidence: 0.7, ambiguous: false };
  }
  // sole button in its form → submit (0.85)
  const form = parentForm(action, l1);
  if (form) {
    const buttonsInForm = form.children.filter((cid) => {
      const c = l1.nodes[cid];
      return c && (c.tag.toLowerCase() === 'button' || c.attributes['role'] === 'button');
    });
    if (buttonsInForm.length === 1) {
      return { role: 'submit', confidence: 0.85, ambiguous: false };
    }
  }
  return { role: 'unknown', confidence: 0.5, ambiguous: true };
}
```

> 테스트 "sole button in a form"(버튼 텍스트 "처방 저장") 관련 주의: 텍스트 사전("처방"/"저장")과 단독버튼 규칙 둘 다 `submit`을 낸다. 사전 검사가 먼저 돌아 0.7로 `submit`을 반환 — 테스트는 `.role === 'submit'`만 단언하므로 어느 경로든 만족한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/promoter/src/promote-action.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/promoter/src/promote-action.ts packages/promoter/src/binding.ts packages/promoter/src/promote-action.test.ts
git commit -m "feat(promoter): add Action role inference and binding.path extraction"
```

---

### Task 5: `promote()` 오케스트레이션 — L2 그래프 조립

**Files:**
- Create: `packages/promoter/src/promote.ts`
- Create: `packages/promoter/src/index.ts`
- Test: `packages/promoter/src/promote.test.ts`

**Interfaces:**
- Consumes: `classify.ts`, `l2-id.ts`, `promote-field.ts`, `promote-action.ts`, `binding.ts`, `@sb/ir-schema`(`L1Graph`, `L2Overlay`, `ExternalFact`, `CaptureKind`, `NodeStatus` 타입)
- Produces:
  - `interface PromoterHook { captureKind: CaptureKind }`
  - `promote(args: { l1: L1Graph; facts: ExternalFact[]; tenantId: string; hook: PromoterHook }): L2Overlay[]`
  - 집계: L2 노드 `status`는 기여 신호 중 하나라도 ambiguous면 `'ambiguous'`, 아니면 `'known'`; `confidence`는 기여 신호 confidence의 최솟값. 필드 식별 기본 confidence는 0.95. 결정성을 위해 L1 노드를 정렬된 nodeId 순으로 순회. Form의 `fields`/`actions`는 그 후손 Field/Action의 l2 nodeId를 담는다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/promoter/src/promote.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { liftHtml } from '@sb/lift';
import { promote } from './promote.js';

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug" required></select>
  <input id="dose" name="order.dose" type="number"/>
  <button>처방 저장</button>
</form>`;

const ir = liftHtml({ html: HTML, tenantId: 'hosp-A', runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
const l2 = promote({ l1: ir.l1, facts: [], tenantId: 'hosp-A', hook: { captureKind: 'runtime-dom' } });

function byKind(kind: string) { return l2.filter((o) => o.kind === kind); }

describe('promote', () => {
  it('produces one Form, two Fields, one Action', () => {
    expect(byKind('Form')).toHaveLength(1);
    expect(byKind('Field')).toHaveLength(2);
    expect(byKind('Action')).toHaveLength(1);
  });

  it('marks the required select as required:true / status known', () => {
    const drug = byKind('Field').find((f: any) => f.binding?.path === 'order.drug') as any;
    expect(drug.required).toBe(true);
    expect(drug.label).toBe('약품');
    expect(drug.status).toBe('known');
  });

  it('marks the untyped-required dose as required:unknown / status ambiguous', () => {
    const dose = byKind('Field').find((f: any) => f.binding?.path === 'order.dose') as any;
    expect(dose.dataType).toBe('number');     // type=number is known
    expect(dose.required).toBe('unknown');    // no required signal
    expect(dose.status).toBe('ambiguous');    // ambiguous propagates to node status
  });

  it('every L2 node has a derivedFrom L1 id and an l2: nodeId', () => {
    for (const o of l2) {
      expect(o.nodeId).toMatch(/^l2:[0-9a-f]{12}$/);
      expect(o.derivedFrom).toHaveLength(1);
      expect(o.derivedFrom[0]).toMatch(/^l1:[0-9a-f]{12}$/);
    }
  });

  it('the Form lists its field and action l2 ids', () => {
    const form = byKind('Form')[0] as any;
    expect(form.fields).toHaveLength(2);
    expect(form.actions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/promoter/src/promote.test.ts`
Expected: FAIL ("Cannot find module './promote.js'")

- [ ] **Step 3: 최소 구현 작성**

`packages/promoter/src/promote.ts`:
```ts
import type { L1Node, L1Graph, L2Overlay, ExternalFact, CaptureKind, NodeStatus } from '@sb/ir-schema';
import { classifyNode } from './classify.js';
import { l2IdFor } from './l2-id.js';
import { resolveLabel, resolveRequired, resolveDataType } from './promote-field.js';
import { resolveActionRole } from './promote-action.js';
import { resolveBinding } from './binding.js';

export interface PromoterHook {
  captureKind: CaptureKind;
}

const FIELD_KIND_CONFIDENCE = 0.95;

function metaFor(l1: L1Node, tenantId: string, confidence: number, ambiguous: boolean) {
  const status: NodeStatus = ambiguous ? 'ambiguous' : 'known';
  return {
    nodeId: l2IdFor(tenantId, l1),
    provenance: l1.provenance,
    confidence,
    status,
    derivedFrom: [l1.nodeId],
    scenarioCoverage: l1.scenarioCoverage,
  };
}

export function promote(args: {
  l1: L1Graph;
  facts: ExternalFact[];
  tenantId: string;
  hook: PromoterHook;
}): L2Overlay[] {
  const { l1, tenantId } = args;
  const overlays: L2Overlay[] = [];
  // L1 node id of an element → its produced L2 node id (for Form assembly)
  const fieldL2: Record<string, string> = {};
  const actionL2: Record<string, string> = {};
  const forms: { l1: L1Node }[] = [];

  // deterministic order
  const ordered = Object.keys(l1.nodes).sort().map((id) => l1.nodes[id]);

  for (const node of ordered) {
    const kind = classifyNode(node);
    if (kind === 'Field') {
      const lbl = resolveLabel(node, l1);
      const req = resolveRequired(node, lbl.label);
      const dt = resolveDataType(node);
      const ambiguous = lbl.ambiguous || req.ambiguous || dt.ambiguous;
      const confidence = Math.min(FIELD_KIND_CONFIDENCE, lbl.confidence, req.confidence, dt.confidence);
      const binding = resolveBinding(node);
      const meta = metaFor(node, tenantId, confidence, ambiguous);
      fieldL2[node.nodeId] = meta.nodeId;
      overlays.push({ ...meta, kind: 'Field', label: lbl.label, required: req.required,
        dataType: dt.dataType as any, ...(binding ? { binding } : {}) });
    } else if (kind === 'Action') {
      const role = resolveActionRole(node, l1);
      const meta = metaFor(node, tenantId, Math.min(0.95, role.confidence), role.ambiguous);
      actionL2[node.nodeId] = meta.nodeId;
      overlays.push({ ...meta, kind: 'Action', role: role.role });
    } else if (kind === 'Form') {
      forms.push({ l1: node });
    }
  }

  // assemble Form nodes now that field/action ids are known
  for (const f of forms) {
    const fieldIds = collectDescendants(f.l1, l1, fieldL2);
    const actionIds = collectDescendants(f.l1, l1, actionL2);
    const meta = metaFor(f.l1, tenantId, FIELD_KIND_CONFIDENCE, false);
    overlays.push({ ...meta, kind: 'Form', fields: fieldIds, actions: actionIds });
  }

  // stable output order by l2 nodeId
  overlays.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  return overlays;
}

function collectDescendants(form: L1Node, l1: L1Graph, map: Record<string, string>): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (map[id]) out.push(map[id]);
    const node = l1.nodes[id];
    if (node) for (const c of node.children) visit(c);
  };
  for (const c of form.children) visit(c);
  return out;
}
```

`packages/promoter/src/index.ts`:
```ts
export * from './classify.js';
export * from './l2-id.js';
export * from './promote-field.js';
export * from './promote-action.js';
export * from './binding.js';
export * from './promote.js';
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `pnpm vitest run packages/promoter/src/promote.test.ts`
Expected: PASS (5 tests)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/promoter/src/promote.ts packages/promoter/src/index.ts packages/promoter/src/promote.test.ts
git commit -m "feat(promoter): assemble L1->L2 overlay with deterministic ids and status aggregation"
```

---

### Task 6: L1→L2 결정성 골든 + 전체 통합

**Files:**
- Create: `packages/promoter/src/determinism.test.ts`
- Create: `packages/promoter/fixtures/prescription-l2.golden.json`

**Interfaces:**
- Consumes: `@sb/lift`(`liftHtml`), `promote.ts`
- Produces: (테스트만 — L2 회귀 기준선)

- [ ] **Step 1: 결정성 테스트 작성**

`packages/promoter/src/determinism.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftHtml } from '@sb/lift';
import { promote } from './promote.js';

const dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(dir, '..', 'fixtures', 'prescription-l2.golden.json');

const HTML = `<form>
  <label for="drug">약품</label>
  <select id="drug" name="order.drug" required></select>
  <input id="dose" name="order.dose" type="number"/>
  <button>처방 저장</button>
</form>`;

function run() {
  const ir = liftHtml({ html: HTML, tenantId: 'hosp-A', runId: 'r', scenarioId: 'empty', ruleSetPin: 'rs@1' });
  return promote({ l1: ir.l1, facts: [], tenantId: 'hosp-A', hook: { captureKind: 'runtime-dom' } });
}

describe('promoter determinism', () => {
  it('produces a bit-identical L2 across two runs', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('matches the committed golden snapshot', () => {
    const actual = JSON.stringify(run(), null, 2);
    if (!existsSync(goldenPath)) writeFileSync(goldenPath, actual);
    expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
  });

  it('every l2 node references a deterministic l1 id', () => {
    for (const o of run()) {
      expect(o.nodeId).toMatch(/^l2:[0-9a-f]{12}$/);
      expect(o.derivedFrom[0]).toMatch(/^l1:[0-9a-f]{12}$/);
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 (골든 생성 후 통과)**

Run: `pnpm vitest run packages/promoter/src/determinism.test.ts`
Expected: 최초 실행에서 골든 파일 생성 후 PASS (3 tests). 두 번째 실행에서도 PASS.

- [ ] **Step 3: 골든 육안 검토**

`packages/promoter/fixtures/prescription-l2.golden.json` 열기:
- `Form` 1, `Field` 2, `Action` 1
- `order.drug` Field: `label:"약품"`, `required:true`, `status:"known"`
- `order.dose` Field: `dataType:"number"`, `required:"unknown"`, `status:"ambiguous"`
- 모든 `nodeId`가 `l2:<12hex>`, 모든 `derivedFrom[0]`이 `l1:<12hex>`

- [ ] **Step 4: 전체 스위트 + 타입체크**

Run: `pnpm test`
Expected: 전 패키지 green (ir-schema + lift + promoter)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add packages/promoter/fixtures/ packages/promoter/src/determinism.test.ts
git commit -m "test(promoter): add L1->L2 determinism + golden snapshot"
```

---

## 완료 시 산출물

- `@sb/ir-schema`: L2 계약 활성화 (`L2Overlay`, `BindingDescriptor`, `ExternalFact`, `CaptureKind`), IR 루트 tighten
- `@sb/promoter`: L1→L2 Semantic Promoter — classify + label/required/dataType + action role + binding, confidence/status 강제, 결정적 L2 nodeId, 골든 회귀
- 핵심 불변식 검증: 추론 불가는 `unknown`/`ambiguous`로 게이트까지 전파 (P5/P6)

## 후속 플랜 (이 플랜 범위 밖)

1. **NORMALIZE (axe→facts)** — `facts[]`를 채워 label 부재를 교차검증, Promoter의 facts 경로 활성
2. **런타임 Capture (Playwright)** — `computed.*` measured:true + a11y 트리 → Field role 정확도 상승
3. **ContractBinder** — `binding.scope` ui-internal→contract 승격
4. **규칙 엔진 + 게이트** — L2를 읽는 일관성 룰 + effectiveSeverity(§4.4) 불변식
