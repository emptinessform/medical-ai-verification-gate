# Semantic Promoter (L1 → L2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@sb/promoter` — the L1→L2 Semantic Promoter that infers form/field/action/binding semantics from the structural L1 IR, emitting `confidence` and `status` on every inference (the architecture's #1 long-pole risk, §3.5).

**Architecture:** A pure function `promote({ l1, facts, tenantId, hook })` walks the L1 StructureGraph and produces an `L2Overlay[]` of `Form`/`Field`/`Action`/`Display` nodes. Each L2 node derives its deterministic `nodeId` from the L1 node it covers (using that L1 node's stablePath as seed, per §3.2.1) and carries `derivedFrom`. Every inference that is uncertain MUST be recorded as `'unknown'`/`status:'ambiguous'` with lowered `confidence` — never guessed as a definite value (P5/P6). facts (axe results) are accepted for cross-checking label absence but may be empty in this slice (NORMALIZE is a later plan).

**Tech Stack:** TypeScript(strict), pnpm workspace, Vitest, Zod. New package `@sb/promoter` depends on `@sb/ir-schema` (types) and `@sb/lift` (`makeNodeId`).

## Global Constraints

- TypeScript `strict: true`. `@sb/promoter` imports IR types only from `@sb/ir-schema` and `makeNodeId`/`SEP` only from `@sb/lift`.
- `unknown ≠ null`: any inference the heuristics cannot resolve MUST be `'unknown'` (for `required`/`dataType`/`Action.role`) with the L2 node's `status: 'ambiguous'` and lowered `confidence`. Do NOT default uncertain values to a definite one.
  - The SINGLE deliberate exception: `Field.label` is `string | null` where `null` means **confirmed absent** (status stays `known`), per §3.5. This is a known value, not an unknown.
- Deterministic L2 `nodeId`: for an L2 node covering L1 node `n`, `nodeId = makeNodeId('l2', tenantId, n.provenance.source.domPath)` (the L1 node's stablePath is stored in `provenance.source.domPath`). `derivedFrom = [n.nodeId]`. No randomness.
- L2 node `confidence`/`status` aggregation (deterministic): `status` is `'ambiguous'` if ANY of the node's resolved core signals (`required`, `dataType`, `Action.role`) is `'unknown'`/ambiguous; else `'known'`. `confidence` is the MINIMUM confidence across the signals that contributed (most conservative). A Form node with all-known children is `confidence: 0.95, status: 'known'`.
- Confidence values come verbatim from §3.5 (e.g. field-kind 0.95, label-for 0.95, aria-label 0.9, adjacent-text 0.6, dataType direct 0.9, action submit 0.85, action dict 0.7, binding 0.8).
- Determinism: walking L1 nodes in sorted `nodeId` order; same L1 → same L2 (golden snapshot guards this).
- Commit at the end of each task with a conventional-commit message.

---

### Task 1: L2 / facts / binding contract types in `@sb/ir-schema`

**Files:**
- Create: `packages/ir-schema/src/l2.ts`
- Create: `packages/ir-schema/src/facts.ts`
- Modify: `packages/ir-schema/src/ir.ts` (tighten `l2`/`facts` from `z.array(z.unknown())`)
- Modify: `packages/ir-schema/src/index.ts` (append exports)
- Test: `packages/ir-schema/src/l2.test.ts`

**Interfaces:**
- Consumes: `node-meta.ts` (`NodeMeta`), `scalars.ts` (`TriBool`)
- Produces:
  - `CaptureKind` = `'runtime-dom' | 'declarative' | 'source-ast'`
  - `ExternalFact` (Zod) = `{ engine, ruleId, appliesTo, impact: 'minor'|'moderate'|'serious'|'critical', measurable, observed: Record<string,unknown>, scenarioId }`
  - `BindingDescriptor` (Zod) = `{ scope: 'ui-internal'|'contract', path, observedType?, unit?, codeSystem?, contract? }` (see code)
  - `L2Overlay` (Zod discriminated union on `kind`) of `Form | Field | Action | Display`, each `NodeMeta & {...}`
  - Tightened `IR.l2: L2Overlay[]`, `IR.facts: ExternalFact[]`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ir-schema/src/l2.test.ts`
Expected: FAIL ("Cannot find module './l2.js'")

- [ ] **Step 3: Write minimal implementation**

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

Modify `packages/ir-schema/src/ir.ts` — tighten the two arrays. Change:
```ts
  l2: z.array(z.unknown()), // 후속 플랜: SemanticOverlay
  ...
  facts: z.array(z.unknown()), // 후속 플랜: ExternalFact (NORMALIZE)
```
to:
```ts
  l2: z.array(L2Overlay),
  ...
  facts: z.array(ExternalFact),
```
and add the imports at the top of `ir.ts` (direct submodule imports to avoid cycles):
```ts
import { L2Overlay } from './l2.js';
import { ExternalFact } from './facts.js';
```

- [ ] **Step 4: index re-export + run test**

Append to `packages/ir-schema/src/index.ts`:
```ts
export * from './l2.js';
```
(`l2.js` already re-exports `facts.js`, so `ExternalFact`/`CaptureKind` come through it. Do not add a second `facts.js` export line.)

Run: `pnpm vitest run packages/ir-schema/src/l2.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Confirm existing IR tests still pass (l2/facts now tightened but empty arrays still valid)**

Run: `pnpm vitest run packages/ir-schema/ packages/lift/src/determinism.test.ts`
Expected: PASS (existing IR + lift tests unaffected — `liftHtml` emits `l2:[], facts:[]` which satisfy the tightened arrays)

- [ ] **Step 6: Typecheck + Commit**

Run: `pnpm typecheck`
Expected: exit 0

```bash
git add packages/ir-schema/src/l2.ts packages/ir-schema/src/facts.ts packages/ir-schema/src/ir.ts packages/ir-schema/src/index.ts packages/ir-schema/src/l2.test.ts
git commit -m "feat(ir-schema): add L2Overlay, ExternalFact, BindingDescriptor and tighten IR root"
```

---

### Task 2: `@sb/promoter` scaffold + node classification + L2 nodeId derivation

**Files:**
- Create: `packages/promoter/package.json`
- Create: `packages/promoter/tsconfig.json`
- Create: `packages/promoter/src/classify.ts`
- Create: `packages/promoter/src/l2-id.ts`
- Modify: `tsconfig.json` (root — add `packages/promoter` reference)
- Test: `packages/promoter/src/classify.test.ts`

**Interfaces:**
- Consumes: `@sb/ir-schema` (`L1Node`, `L1Graph` types), `@sb/lift` (`makeNodeId`)
- Produces:
  - `classifyNode(node: L1Node): 'Form' | 'Field' | 'Action' | 'Display' | null`
  - `l2IdFor(tenantId: string, l1: L1Node): string` → `makeNodeId('l2', tenantId, l1.provenance.source.domPath)` (reads the L1 node's stablePath from provenance; if provenance.source has no `domPath`, throw — L1 from `liftHtml` always uses domPath)

- [ ] **Step 1: Create package files + failing test**

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

Add `{ "path": "packages/promoter" }` to the `references` array in the root `tsconfig.json`.

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm install && pnpm vitest run packages/promoter/src/classify.test.ts`
Expected: FAIL ("Cannot find module './classify.js'")

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run packages/promoter/src/classify.test.ts`
Expected: PASS (6 tests)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/promoter/ tsconfig.json pnpm-lock.yaml
git commit -m "feat(promoter): scaffold @sb/promoter with node classification and l2 nodeId derivation"
```

---

### Task 3: Field semantics — label, required, dataType heuristics

**Files:**
- Create: `packages/promoter/src/promote-field.ts`
- Test: `packages/promoter/src/promote-field.test.ts`

**Interfaces:**
- Consumes: `classify.ts`, `l2-id.ts`, `@sb/ir-schema` (`L1Node`, `L1Graph`, `ExternalFact`, `TriBool`, `BindingDescriptor` types)
- Produces:
  - `resolveLabel(field: L1Node, l1: L1Graph): { label: string | null; confidence: number; ambiguous: boolean }`
  - `resolveRequired(field: L1Node, label: string | null): { required: TriBool; confidence: number; ambiguous: boolean }`
  - `resolveDataType(field: L1Node): { dataType: string; confidence: number; ambiguous: boolean }`

Heuristics are exactly §3.5. `ambiguous: true` means this signal forces the L2 node status to `'ambiguous'`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/promoter/src/promote-field.test.ts`
Expected: FAIL ("Cannot find module './promote-field.js'")

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/promoter/src/promote-field.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

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
- Consumes: `@sb/ir-schema` (`L1Node`, `L1Graph`, `BindingDescriptor` types)
- Produces:
  - `resolveActionRole(action: L1Node, l1: L1Graph): { role: 'submit'|'cancel'|'destructive'|'navigate'|'unknown'; confidence: number; ambiguous: boolean }`
  - `resolveBinding(node: L1Node): BindingDescriptor | undefined` — from `name`/`data-bind`/`id` (0.8), else undefined

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/promoter/src/promote-action.test.ts`
Expected: FAIL ("Cannot find module './promote-action.js'")

- [ ] **Step 3: Write minimal implementation**

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

> Note on test "sole button in a form" (button text "처방 저장"): both the text dictionary ("처방"/"저장") and the sole-button rule yield `submit`. The dictionary check runs first and returns `submit` at 0.7 — the test only asserts `.role === 'submit'`, so either path satisfies it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/promoter/src/promote-action.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/promoter/src/promote-action.ts packages/promoter/src/binding.ts packages/promoter/src/promote-action.test.ts
git commit -m "feat(promoter): add Action role inference and binding.path extraction"
```

---

### Task 5: `promote()` orchestration — assemble L2 graph

**Files:**
- Create: `packages/promoter/src/promote.ts`
- Create: `packages/promoter/src/index.ts`
- Test: `packages/promoter/src/promote.test.ts`

**Interfaces:**
- Consumes: `classify.ts`, `l2-id.ts`, `promote-field.ts`, `promote-action.ts`, `binding.ts`, `@sb/ir-schema` (`L1Graph`, `L2Overlay`, `ExternalFact`, `CaptureKind`, `NodeStatus` types)
- Produces:
  - `interface PromoterHook { captureKind: CaptureKind }`
  - `promote(args: { l1: L1Graph; facts: ExternalFact[]; tenantId: string; hook: PromoterHook }): L2Overlay[]`
  - Aggregation: an L2 node's `status` is `'ambiguous'` if any contributing signal was ambiguous, else `'known'`; `confidence` is the MINIMUM contributing confidence. Field-kind base confidence is 0.95. Walks L1 nodes in sorted nodeId order for determinism. A Form's `fields`/`actions` hold the l2 nodeIds of its Field/Action descendants.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/promoter/src/promote.test.ts`
Expected: FAIL ("Cannot find module './promote.js'")

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run packages/promoter/src/promote.test.ts`
Expected: PASS (5 tests)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/promoter/src/promote.ts packages/promoter/src/index.ts packages/promoter/src/promote.test.ts
git commit -m "feat(promoter): assemble L1->L2 overlay with deterministic ids and status aggregation"
```

---

### Task 6: Determinism golden for L1→L2 + full integration

**Files:**
- Create: `packages/promoter/src/determinism.test.ts`
- Create: `packages/promoter/fixtures/prescription-l2.golden.json`

**Interfaces:**
- Consumes: `@sb/lift` (`liftHtml`), `promote.ts`
- Produces: (tests only — the L2 regression baseline)

- [ ] **Step 1: Write the determinism test**

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

- [ ] **Step 2: Run test (generates golden, then passes)**

Run: `pnpm vitest run packages/promoter/src/determinism.test.ts`
Expected: golden file generated on first run, then PASS (3 tests). Run a SECOND time → still PASS.

- [ ] **Step 3: Sanity-check the golden**

Open `packages/promoter/fixtures/prescription-l2.golden.json`:
- One `Form`, two `Field`, one `Action`
- `order.drug` Field: `label:"약품"`, `required:true`, `status:"known"`
- `order.dose` Field: `dataType:"number"`, `required:"unknown"`, `status:"ambiguous"`
- Every `nodeId` is `l2:<12hex>`, every `derivedFrom[0]` is `l1:<12hex>`

- [ ] **Step 4: Full suite + typecheck**

Run: `pnpm test`
Expected: all packages green (ir-schema + lift + promoter)
Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

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
