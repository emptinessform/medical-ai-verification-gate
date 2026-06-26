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
