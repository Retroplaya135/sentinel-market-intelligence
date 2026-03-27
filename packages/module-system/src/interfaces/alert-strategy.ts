import { z } from 'zod';

export const AlertEvaluationSchema = z.object({
  alert_id: z.string().min(1),
  asset_id: z.string().min(1),
  triggered: z.boolean(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  threshold_triggered: z.string().min(1),
  confidence: z.number().min(0).max(1),
  expected_half_life_minutes: z.number().positive(),
  invalidation_trigger: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)).min(1),
  timestamp: z.string().datetime(),
});

export type AlertEvaluation = z.infer<typeof AlertEvaluationSchema>;

export const AlertDispatchResultSchema = z.object({
  alert_id: z.string().min(1),
  dispatched: z.boolean(),
  channels: z.array(z.string().min(1)),
  dispatched_at: z.string().datetime(),
  tenant_id: z.string().min(1),
});

export type AlertDispatchResult = z.infer<typeof AlertDispatchResultSchema>;

export const AlertInvalidationSchema = z.object({
  alert_id: z.string().min(1),
  invalidated: z.boolean(),
  reason: z.string().min(1),
  checked_at: z.string().datetime(),
});

export type AlertInvalidation = z.infer<typeof AlertInvalidationSchema>;

export interface AlertStrategyInterface {
  readonly strategy_id: string;
  evaluate(params: { asset_id: string; signals: Record<string, unknown> }): Promise<AlertEvaluation>;
  dispatch(params: { evaluation: AlertEvaluation; tenant_id: string }): Promise<AlertDispatchResult>;
  invalidate(params: { alert_id: string }): Promise<AlertInvalidation>;
}

export const AlertStrategyMethodNames = ['evaluate', 'dispatch', 'invalidate'] as const;
