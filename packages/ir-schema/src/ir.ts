import { z } from 'zod';
import { L1Graph } from './l1.js';

export * from './l1.js';

export const IR = z.object({
  irSchemaVersion: z.literal('1.0.0'),
  tenantId: z.string(),
  runId: z.string(),
  inputDigest: z.string(),
  l1: L1Graph,
  l2: z.array(z.unknown()),
  l3: z.array(z.unknown()),
  facts: z.array(z.unknown()),
});
export type IR = z.infer<typeof IR>;
