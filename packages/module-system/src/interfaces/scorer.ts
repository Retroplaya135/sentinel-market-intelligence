import { z } from 'zod';

export const ScoreResultSchema = z.object({
  asset_id: z.string().min(1),
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  model_version: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  timestamp: z.string().datetime(),
  latency_ms: z.number().nonnegative(),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export const CalibrationResultSchema = z.object({
  model_version: z.string().min(1),
  calibration_error: z.number().nonnegative(),
  sample_count: z.number().int().positive(),
  timestamp: z.string().datetime(),
});

export type CalibrationResult = z.infer<typeof CalibrationResultSchema>;

export const ScoreExplanationSchema = z.object({
  asset_id: z.string().min(1),
  score: z.number(),
  factors: z.array(z.object({
    source_id: z.string().min(1),
    weight: z.number(),
    contribution: z.number(),
    description: z.string().min(1),
  })).min(1),
  timestamp: z.string().datetime(),
});

export type ScoreExplanation = z.infer<typeof ScoreExplanationSchema>;

export interface ScorerInterface {
  readonly scorer_id: string;
  score(params: { asset_id: string; source_data: Record<string, unknown> }): Promise<ScoreResult>;
  calibrate(params: { evaluation_set: unknown[]; model_version: string }): Promise<CalibrationResult>;
  explain_score(params: { asset_id: string; score_result: ScoreResult }): Promise<ScoreExplanation>;
}

export const ScorerMethodNames = ['score', 'calibrate', 'explain_score'] as const;
