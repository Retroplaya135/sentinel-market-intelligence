import { z } from 'zod';

export const ConnectorResultSchema = z.object({
  success: z.boolean(),
  records_count: z.number().int().nonnegative(),
  source_id: z.string().min(1),
  request_id: z.string().min(1),
  timestamp: z.string().datetime(),
  errors: z.array(z.string()).default([]),
});

export type ConnectorResult = z.infer<typeof ConnectorResultSchema>;

export interface ConnectorInterface {
  readonly source_id: string;
  fetch(params: { asset_ids?: string[]; since?: string; limit?: number }): Promise<ConnectorResult>;
  normalize(raw: unknown[]): Promise<unknown[]>;
  validate(records: unknown[]): Promise<{ valid: unknown[]; invalid: unknown[] }>;
  persist(records: unknown[]): Promise<ConnectorResult>;
  ack(request_id: string): Promise<void>;
  delete_sync(params: { record_ids?: string[]; before?: string }): Promise<ConnectorResult>;
}

export const ConnectorMethodNames = ['fetch', 'normalize', 'validate', 'persist', 'ack', 'delete_sync'] as const;
