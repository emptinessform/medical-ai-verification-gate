import type { L1Node, BindingDescriptor } from '@sb/ir-schema';

export function resolveBinding(node: L1Node): BindingDescriptor | undefined {
  const path = node.attributes['name'] ?? node.attributes['data-bind'] ?? node.attributes['id'];
  if (!path) return undefined;
  return { scope: 'ui-internal', path };
}
