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
