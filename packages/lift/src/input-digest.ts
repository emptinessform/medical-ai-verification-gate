import { createHash } from 'node:crypto';
import { IR_SCHEMA_VERSION } from '@sb/ir-schema';
import { SEP } from './node-id.js';

export function inputDigest(html: string, ruleSetPin: string): string {
  // Normalize line endings so the digest is identical on Windows (CRLF) and
  // Unix (LF) checkouts (FIX C).
  const normalized = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const hex = createHash('sha256')
    .update(`${normalized}${SEP}${ruleSetPin}${SEP}${IR_SCHEMA_VERSION}`)
    .digest('hex');
  return `sha256:${hex}`;
}
