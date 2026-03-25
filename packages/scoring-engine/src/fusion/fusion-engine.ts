import { z } from 'zod';
import type { PerSourceScore } from '../base/base-scorer.js';

export const FusionWeightConfigSchema = z.object({
  source_id: z.string().min(1),
  base_weight: z.number().min(0).max(10),
  trust_multiplier: z.number().min(0).max(2).default(1),
  recency_decay_rate: z.number().min(0).max(1).default(0.1),
});

export type FusionWeightConfig = z.infer<typeof FusionWeightConfigSchema>;

export const FusionResultSchema = z.object({
  asset_id: z.string().min(1),
  fused_score: z.number().min(-1).max(1),
  fused_confidence: z.number().min(0).max(1),
  source_contributions: z.array(z.object({
    source_id: z.string().min(1),
    raw_score: z.number(),
    adjusted_score: z.number(),
    effective_weight: z.number(),
    contribution: z.number(),
  })),
  total_sources: z.number().int().nonnegative(),
  dominant_source: z.string().min(1).optional(),
  agreement_ratio: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
});

export type FusionResult = z.infer<typeof FusionResultSchema>;

export class FusionEngine {
  private weightConfigs: Map<string, FusionWeightConfig> = new Map();

  setWeights(configs: FusionWeightConfig[]): void {
    this.weightConfigs.clear();
    for (const c of configs) {
      FusionWeightConfigSchema.parse(c);
      this.weightConfigs.set(c.source_id, c);
    }
  }

  setWeightsFromPlaceholder(placeholderValue: unknown): void {
    if (!Array.isArray(placeholderValue)) {
      throw new Error('Placeholder value must be an array of FusionWeightConfig objects.');
    }
    const configs = placeholderValue.map((v) => FusionWeightConfigSchema.parse(v));
    this.setWeights(configs);
  }

  getWeight(source_id: string): FusionWeightConfig {
    return this.weightConfigs.get(source_id) ?? {
      source_id,
      base_weight: 1.0,
      trust_multiplier: 1.0,
      recency_decay_rate: 0.1,
    };
  }

  fuse(asset_id: string, perSourceScores: PerSourceScore[]): FusionResult {
    if (perSourceScores.length === 0) {
      return this.emptyFusionResult(asset_id);
    }

    const contributions: FusionResult['source_contributions'] = [];
    let totalWeight = 0;
    let weightedScoreSum = 0;
    let weightedConfidenceSum = 0;

    for (const pss of perSourceScores) {
      const wc = this.getWeight(pss.source_id);
      const effectiveWeight = wc.base_weight
        * wc.trust_multiplier
        * pss.volume_weight
        * pss.recency_weight
        * pss.manipulation_discount;

      const contribution = pss.adjusted_score * effectiveWeight;
      weightedScoreSum += contribution;
      weightedConfidenceSum += pss.confidence * effectiveWeight;
      totalWeight += effectiveWeight;

      contributions.push({
        source_id: pss.source_id,
        raw_score: pss.raw_score,
        adjusted_score: pss.adjusted_score,
        effective_weight: effectiveWeight,
        contribution,
      });
    }

    const fusedScore = totalWeight > 0
      ? Math.max(-1, Math.min(1, weightedScoreSum / totalWeight))
      : 0;

    const fusedConfidence = totalWeight > 0
      ? Math.max(0, Math.min(1, weightedConfidenceSum / totalWeight))
      : 0;

    const agreementRatio = this.computeAgreementRatio(perSourceScores);

    const dominant = contributions.reduce((max, c) =>
      Math.abs(c.contribution) > Math.abs(max.contribution) ? c : max,
    );

    const result: FusionResult = {
      asset_id,
      fused_score: fusedScore,
      fused_confidence: fusedConfidence,
      source_contributions: contributions,
      total_sources: perSourceScores.length,
      dominant_source: dominant.source_id,
      agreement_ratio: agreementRatio,
      timestamp: new Date().toISOString(),
    };

    FusionResultSchema.parse(result);
    return result;
  }

  private computeAgreementRatio(scores: PerSourceScore[]): number {
    if (scores.length <= 1) return 1.0;

    let agreements = 0;
    let comparisons = 0;

    for (let i = 0; i < scores.length; i++) {
      for (let j = i + 1; j < scores.length; j++) {
        comparisons++;
        const sameDirection =
          (scores[i].adjusted_score >= 0 && scores[j].adjusted_score >= 0) ||
          (scores[i].adjusted_score < 0 && scores[j].adjusted_score < 0);
        if (sameDirection) agreements++;
      }
    }

    return comparisons > 0 ? agreements / comparisons : 1.0;
  }

  private emptyFusionResult(asset_id: string): FusionResult {
    return {
      asset_id,
      fused_score: 0,
      fused_confidence: 0,
      source_contributions: [],
      total_sources: 0,
      agreement_ratio: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
