import { z } from 'zod';
import { NodeStatus } from './scalars.js';

export const Provenance = z.object({
  source: z.union([
    z.object({ file: z.string(), line: z.number().int(), col: z.number().int() }),
    z.object({ domPath: z.string() }),
  ]),
  captureId: z.string(),
  scenarioId: z.string(),
  pathStability: z.enum(['anchored', 'index-only']).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const NodeMeta = z.object({
  nodeId: z.string(),
  provenance: Provenance,
  confidence: z.number().min(0).max(1),
  status: NodeStatus,
  derivedFrom: z.array(z.string()),
  scenarioCoverage: z.array(z.string()),
});
export type NodeMeta = z.infer<typeof NodeMeta>;
