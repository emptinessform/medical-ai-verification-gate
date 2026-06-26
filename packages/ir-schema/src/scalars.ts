import { z } from 'zod';

export const TriBool = z.union([z.literal(true), z.literal(false), z.literal('unknown')]);
export type TriBool = z.infer<typeof TriBool>;

export const NodeStatus = z.enum(['known', 'unknown', 'ambiguous']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const Measured = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ value: inner.nullable(), measured: z.boolean() });
export type Measured<T> = { value: T | null; measured: boolean };
