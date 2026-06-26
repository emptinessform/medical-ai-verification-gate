import type { L1Node } from '@sb/ir-schema';
import { makeNodeId } from '@sb/lift';

export function l2IdFor(tenantId: string, l1: L1Node): string {
  const src = l1.provenance.source;
  if (!('domPath' in src)) {
    throw new Error(`l2IdFor: L1 node ${l1.nodeId} has no domPath provenance`);
  }
  return makeNodeId('l2', tenantId, src.domPath);
}
