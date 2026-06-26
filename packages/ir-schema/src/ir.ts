import { z } from 'zod';
import { L1Graph } from './l1.js';
import { L2Overlay } from './l2.js';
import { ExternalFact } from './facts.js';

export * from './l1.js';

export const IR = z.object({
  irSchemaVersion: z.literal('1.0.0'),
  tenantId: z.string(),
  runId: z.string(),
  inputDigest: z.string(),
  l1: L1Graph,
  l2: z.array(L2Overlay),
  l3: z.array(z.unknown()),
  facts: z.array(ExternalFact),
});
export type IR = z.infer<typeof IR>;
