import { z } from 'zod';

export const SignalOutputSchema = z.object({
  signal_id: z.string().uuid(),
  asset_id: z.string().min(1),
  signal_type: z.enum(['now_score', 'why_now', 'alert', 'replay', 'reliability']),
  timestamp: z.string().datetime(),
  value: z.number(),
  claim: z.object({
    claim_id: z.string().uuid(),
    evidence_ref: z.array(z.string().min(1)).min(1),
    confidence: z.number().min(0).max(1),
    invalidation_rule: z.string().min(1),
    source_provenance: z.array(z.string().min(1)).min(1),
  }),
  metadata: z.object({
    trace_id: z.string().uuid(),
    source_ids: z.array(z.string().min(1)).min(1),
    model_version: z.string().min(1),
    latency_ms: z.number().nonnegative(),
  }),
});

export type SignalOutput = z.infer<typeof SignalOutputSchema>;

export const AlertOutputSchema = SignalOutputSchema.extend({
  signal_type: z.literal('alert'),
  alert_details: z.object({
    threshold_triggered: z.string().min(1),
    expected_half_life_minutes: z.number().positive(),
    invalidation_trigger: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
  }),
});

export type AlertOutput = z.infer<typeof AlertOutputSchema>;

export const SourceIngestionRecordSchema = z.object({
  record_id: z.string().uuid(),
  source_id: z.string().min(1),
  endpoint: z.string().min(1),
  request_id: z.string().min(1),
  policy_mode: z.enum(['allow', 'conditional', 'blocked']),
  ingested_at: z.string().datetime(),
  content_hash: z.string().min(1),
  provenance: z.object({
    source: z.string().min(1),
    endpoint: z.string().min(1),
    request_id: z.string().min(1),
    policy_mode: z.enum(['allow', 'conditional', 'blocked']),
  }),
});

export type SourceIngestionRecord = z.infer<typeof SourceIngestionRecordSchema>;

export const BudgetCheckRequestSchema = z.object({
  tenant_id: z.string().min(1),
  tier_id: z.string().min(1),
  resource_type: z.enum(['request', 'llm_call', 'stream_minute', 'alert']),
  cost_estimate: z.number().nonnegative(),
});

export type BudgetCheckRequest = z.infer<typeof BudgetCheckRequestSchema>;

export const BudgetCheckResponseSchema = z.object({
  allowed: z.boolean(),
  remaining_budget: z.number(),
  action: z.enum(['proceed', 'warn', 'throttle', 'degrade', 'pause']).optional(),
  reason: z.string().optional(),
});

export type BudgetCheckResponse = z.infer<typeof BudgetCheckResponseSchema>;
