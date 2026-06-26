import { createHash } from 'node:crypto';
import { IR_SCHEMA_VERSION } from '@sb/ir-schema';
import { SEP } from './node-id.js';

export function inputDigest(html: string, ruleSetPin: string): string {
  const hex = createHash('sha256')
    .update(`${html}${SEP}${ruleSetPin}${SEP}${IR_SCHEMA_VERSION}`)
    .digest('hex');
  return `sha256:${hex}`;
}
