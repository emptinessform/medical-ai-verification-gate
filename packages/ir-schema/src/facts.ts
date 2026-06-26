import { z } from 'zod';

export const CaptureKind = z.enum(['runtime-dom', 'declarative', 'source-ast']);
export type CaptureKind = z.infer<typeof CaptureKind>;

export const ExternalFact = z.object({
  engine: z.string(),
  ruleId: z.string(),
  appliesTo: z.string(),
  impact: z.enum(['minor', 'moderate', 'serious', 'critical']),
  measurable: z.boolean(),
  observed: z.record(z.unknown()),
  scenarioId: z.string(),
});
export type ExternalFact = z.infer<typeof ExternalFact>;
