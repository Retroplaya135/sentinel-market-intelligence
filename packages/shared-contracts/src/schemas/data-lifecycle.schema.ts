import { z } from 'zod';

export const RetentionClass = z.enum(['unlimited', 'time_bound', 'on_request', 'refresh_cycle']);
export type RetentionClassType = z.infer<typeof RetentionClass>;

export const RetentionEntrySchema = z.object({
  class: RetentionClass,
  default_window_days: z.number().positive().optional(),
  window_hours: z.number().positive().optional(),
  window_days: z.number().positive().optional(),
  refresh_interval_days: z.number().positive().optional(),
  sync_pattern: z.string().optional(),
  sync_frequency: z.string().optional(),
  notes: z.string().optional(),
});

export type RetentionEntry = z.infer<typeof RetentionEntrySchema>;

export const DeletionProofSchema = z.object({
  who: z.string().min(1),
  what: z.string().min(1),
  when: z.string().datetime(),
  rule_id: z.string().min(1),
  method: z.enum(['hard_delete', 'crypto_shred', 'tombstone']),
  verification: z.object({
    count_before: z.number().int().nonnegative(),
    count_after: z.number().int().nonnegative(),
    hash_proof: z.string().min(1),
  }),
});

export type DeletionProof = z.infer<typeof DeletionProofSchema>;

export const SourceRetentionConfigSchema = z.object({
  source_id: z.string().min(1),
  retention_entries: z.record(z.string(), RetentionEntrySchema),
  deletion_obligation: z.string().min(1),
});

export type SourceRetentionConfig = z.infer<typeof SourceRetentionConfigSchema>;

export const DataLifecycleContractSchema = z.object({
  version: z.string(),
  contract_type: z.literal('data_lifecycle'),
  principles: z.array(z.string()).min(1),
  retention_classes: z.record(z.string(), z.object({
    description: z.string(),
    auto_delete: z.boolean(),
    requires_proof: z.boolean().optional(),
    requires_manual_trigger: z.boolean().optional(),
    requires_refresh: z.boolean().optional(),
  })),
  source_retention_matrix: z.record(z.string(), z.any()),
  deletion_proof_schema: z.object({
    fields: z.array(z.any()).min(1),
  }),
  automated_jobs: z.record(z.string(), z.object({
    schedule: z.string().optional(),
    trigger: z.string().optional(),
    sources: z.array(z.string()),
    action: z.string(),
    produces: z.string(),
  })),
  backtesting_compliance: z.array(z.string()).min(1),
});

export type DataLifecycleContract = z.infer<typeof DataLifecycleContractSchema>;
