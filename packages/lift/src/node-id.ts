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
