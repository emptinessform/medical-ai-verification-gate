import { z } from 'zod';
import { NodeMeta } from './node-meta.js';
import { TriBool } from './scalars.js';

export * from './facts.js';

export const BindingDescriptor = z.object({
  scope: z.enum(['ui-internal', 'contract']),
  path: z.string(),
  observedType: z.string().optional(),
  unit: z.object({
    system: z.literal('UCUM'),
    code: z.string().optional(),
    status: z.enum(['known', 'unknown']),
  }).optional(),
  codeSystem: z.object({
    system: z.enum(['LOINC', 'RxNorm', 'SNOMED', 'ICD10']),
    code: z.string().optional(),
    status: z.enum(['known', 'unknown']),
  }).optional(),
  contract: z.object({
    schema: z.enum(['FHIR', 'OpenAPI']),
    resource: z.string(),
    element: z.string(),
    status: z.enum(['known', 'unknown']),
    contractRef: z.string().optional(),
  }).optional(),
});
export type BindingDescriptor = z.infer<typeof BindingDescriptor>;

const L2Form = NodeMeta.extend({
  kind: z.literal('Form'),
  fields: z.array(z.string()),
  actions: z.array(z.string()),
});
const L2Field = NodeMeta.extend({
  kind: z.literal('Field'),
  label: z.string().nullable(),
  required: TriBool,
  dataType: z.enum(['string', 'number', 'date', 'code', 'quantity', 'boolean', 'unknown']),
  binding: BindingDescriptor.optional(),
});
const L2Action = NodeMeta.extend({
  kind: z.literal('Action'),
  role: z.enum(['submit', 'cancel', 'destructive', 'navigate', 'unknown']),
  target: z.string().optional(),
});
const L2Display = NodeMeta.extend({
  kind: z.literal('Display'),
  binding: BindingDescriptor.optional(),
});

export const L2Overlay = z.discriminatedUnion('kind', [L2Form, L2Field, L2Action, L2Display]);
export type L2Overlay = z.infer<typeof L2Overlay>;
