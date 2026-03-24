import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ScorerInterface, ScoreResult, CalibrationResult, ScoreExplanation } from '@sentinel/module-system';
import { ScoreResultSchema, CalibrationResultSchema, ScoreExplanationSchema } from '@sentinel/module-system';

export interface SourceSignal {
  source_id: string;
  asset_id: string;
  raw_sentiment: number;
  volume: number;
  recency_hours: number;
  evidence_refs: string[];
  metadata: Record<string, unknown>;
}

export interface ScoringContext {
  asset_id: string;
  signals: SourceSignal[];
  timestamp: string;
  trace_id: string;
}

export const PerSourceScoreSchema = z.object({
  source_id: z.string().min(1),
  asset_id: z.string().min(1),
  raw_score: z.number().min(-1).max(1),
  adjusted_score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  volume_weight: z.number().min(0).max(1),
  recency_weight: z.number().min(0).max(1),
  manipulation_discount: z.number().min(0).max(1),
  evidence_refs: z.array(z.string().min(1)),
  timestamp: z.string().datetime(),
});

export type PerSourceScore = z.infer<typeof PerSourceScoreSchema>;

export abstract class BaseScorer implements ScorerInterface {
  abstract readonly scorer_id: string;
  protected model_version: string;

  constructor(model_version: string) {
    this.model_version = model_version;
  }

  abstract scorePerSource(signal: SourceSignal): PerSourceScore;

  async score(params: { asset_id: string; source_data: Record<string, unknown> }): Promise<ScoreResult> {
    const start = Date.now();
    const signals = this.extractSignals(params.asset_id, params.source_data);

    if (signals.length === 0) {
      return this.emptyResult(params.asset_id, start);
    }

    const perSourceScores = signals.map((s) => this.scorePerSource(s));
    const fused = this.fuseScores(params.asset_id, perSourceScores);

    const result: ScoreResult = {
      asset_id: params.asset_id,
      score: fused.score,
      confidence: fused.confidence,
      model_version: this.model_version,
      source_ids: perSourceScores.map((s) => s.source_id),
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
    };

    ScoreResultSchema.parse(result);
    return result;
  }

  async calibrate(params: { evaluation_set: unknown[]; model_version: string }): Promise<CalibrationResult> {
    if (params.evaluation_set.length === 0) {
      throw new Error('Calibration requires non-empty evaluation_set.');
    }

    const predictions: number[] = [];
    const actuals: number[] = [];

    for (const entry of params.evaluation_set) {
      const e = entry as { predicted: number; actual: number };
      if (typeof e.predicted !== 'number' || typeof e.actual !== 'number') {
        throw new Error('Each evaluation entry must have numeric predicted and actual fields.');
      }
      predictions.push(e.predicted);
      actuals.push(e.actual);
    }

    const calibrationError = this.computeCalibrationError(predictions, actuals);

    const result: CalibrationResult = {
      model_version: params.model_version,
      calibration_error: calibrationError,
      sample_count: params.evaluation_set.length,
      timestamp: new Date().toISOString(),
    };

    CalibrationResultSchema.parse(result);
    return result;
  }

  async explain_score(params: { asset_id: string; score_result: ScoreResult }): Promise<ScoreExplanation> {
    const factors = params.score_result.source_ids.map((source_id) => ({
      source_id,
      weight: 1 / params.score_result.source_ids.length,
      contribution: params.score_result.score / params.score_result.source_ids.length,
      description: `${source_id} signal contribution to composite score`,
    }));

    const explanation: ScoreExplanation = {
      asset_id: params.asset_id,
      score: params.score_result.score,
      factors,
      timestamp: new Date().toISOString(),
    };

    ScoreExplanationSchema.parse(explanation);
    return explanation;
  }

  protected extractSignals(asset_id: string, source_data: Record<string, unknown>): SourceSignal[] {
    const signals: SourceSignal[] = [];
    for (const [source_id, data] of Object.entries(source_data)) {
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        signals.push({
          source_id,
          asset_id,
          raw_sentiment: typeof d.sentiment === 'number' ? d.sentiment : 0,
          volume: typeof d.volume === 'number' ? d.volume : 1,
          recency_hours: typeof d.recency_hours === 'number' ? d.recency_hours : 24,
          evidence_refs: Array.isArray(d.evidence_refs) ? d.evidence_refs as string[] : [`${source_id}_ref_${randomUUID()}`],
          metadata: d,
        });
      }
    }
    return signals;
  }

  protected abstract fuseScores(asset_id: string, scores: PerSourceScore[]): { score: number; confidence: number };

  protected computeCalibrationError(predictions: number[], actuals: number[]): number {
    if (predictions.length !== actuals.length || predictions.length === 0) return 1;
    let sumSquaredError = 0;
    for (let i = 0; i < predictions.length; i++) {
      sumSquaredError += (predictions[i] - actuals[i]) ** 2;
    }
    return Math.sqrt(sumSquaredError / predictions.length);
  }

  protected emptyResult(asset_id: string, startTime: number): ScoreResult {
    return {
      asset_id,
      score: 0,
      confidence: 0,
      model_version: this.model_version,
      source_ids: ['none'],
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    };
  }

  protected clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
