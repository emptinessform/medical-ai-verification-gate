import { z } from 'zod';
import { NodeMeta } from './node-meta.js';
import { Measured } from './scalars.js';

export const L1Node = NodeMeta.extend({
  tag: z.string(),
  attributes: z.record(z.string()),
  text: z.string().optional(),
  computed: z.object({
    contrast: Measured(z.number()).optional(),
    focusable: Measured(z.boolean()).optional(),
    tabOrder: Measured(z.number()).optional(),
    fontSizePx: Measured(z.number()).optional(),
  }).optional(),
  a11y: z.object({
    role: z.string().optional(),
    name: Measured(z.string()).optional(),
  }).optional(),
  children: z.array(z.string()),
});
export type L1Node = z.infer<typeof L1Node>;

export const L1Graph = z.object({
  rootId: z.string(),
  nodes: z.record(L1Node),
});
export type L1Graph = z.infer<typeof L1Graph>;
