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
