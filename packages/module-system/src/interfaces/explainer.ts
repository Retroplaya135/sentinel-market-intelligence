import { z } from 'zod';

export const ExplanationSchema = z.object({
  signal_id: z.string().min(1),
  asset_id: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(z.object({
    source_id: z.string().min(1),
    evidence_ref: z.string().min(1),
    relevance: z.number().min(0).max(1),
    snippet: z.string().optional(),
  })).min(1),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  latency_ms: z.number().nonnegative(),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

export const DecompositionSchema = z.object({
  signal_id: z.string().min(1),
  components: z.array(z.object({
    component_id: z.string().min(1),
    source_id: z.string().min(1),
    weight: z.number(),
    value: z.number(),
    description: z.string().min(1),
  })).min(1),
  timestamp: z.string().datetime(),
});

export type Decomposition = z.infer<typeof DecompositionSchema>;

export const InvalidationCheckResultSchema = z.object({
  signal_id: z.string().min(1),
  is_invalidated: z.boolean(),
  reason: z.string().optional(),
  checked_at: z.string().datetime(),
  invalidation_rule: z.string().min(1),
});

export type InvalidationCheckResult = z.infer<typeof InvalidationCheckResultSchema>;

export interface ExplainerInterface {
  readonly explainer_id: string;
  explain(params: { signal_id: string; asset_id: string }): Promise<Explanation>;
  decompose(params: { signal_id: string }): Promise<Decomposition>;
  invalidation_check(params: { signal_id: string; invalidation_rule: string }): Promise<InvalidationCheckResult>;
}

export const ExplainerMethodNames = ['explain', 'decompose', 'invalidation_check'] as const;
