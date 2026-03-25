import { BaseScorer } from '../base/base-scorer.js';
import type { SourceSignal, PerSourceScore } from '../base/base-scorer.js';
import { PerSourceScoreSchema } from '../base/base-scorer.js';

export class SentimentCascadeScorer extends BaseScorer {
  readonly scorer_id = 'sentiment_cascade_v1';

  constructor(model_version?: string) {
    super(model_version ?? 'cascade_v1.0.0');
  }

  scorePerSource(signal: SourceSignal): PerSourceScore {
    const volumeWeight = this.computeVolumeWeight(signal.volume);
    const recencyWeight = this.computeRecencyWeight(signal.recency_hours);
    const manipulationDiscount = 1.0;

    const adjustedScore = this.clamp(
      signal.raw_sentiment * volumeWeight * recencyWeight * manipulationDiscount,
      -1,
      1,
    );

    const confidence = this.clamp(
      volumeWeight * recencyWeight * manipulationDiscount * 0.85,
      0,
      1,
    );

    const result: PerSourceScore = {
      source_id: signal.source_id,
      asset_id: signal.asset_id,
      raw_score: signal.raw_sentiment,
      adjusted_score: adjustedScore,
      confidence,
      volume_weight: volumeWeight,
      recency_weight: recencyWeight,
      manipulation_discount: manipulationDiscount,
      evidence_refs: signal.evidence_refs,
      timestamp: new Date().toISOString(),
    };

    PerSourceScoreSchema.parse(result);
    return result;
  }

  protected fuseScores(asset_id: string, scores: PerSourceScore[]): { score: number; confidence: number } {
    if (scores.length === 0) return { score: 0, confidence: 0 };

    let totalWeight = 0;
    let weightedSum = 0;
    let confidenceSum = 0;

    for (const s of scores) {
      const w = s.volume_weight * s.recency_weight * s.manipulation_discount;
      weightedSum += s.adjusted_score * w;
      confidenceSum += s.confidence * w;
      totalWeight += w;
    }

    if (totalWeight === 0) return { score: 0, confidence: 0 };

    return {
      score: this.clamp(weightedSum / totalWeight, -1, 1),
      confidence: this.clamp(confidenceSum / totalWeight, 0, 1),
    };
  }

  private computeVolumeWeight(volume: number): number {
    if (volume <= 0) return 0;
    if (volume >= 1000) return 1.0;
    return Math.min(1.0, Math.log10(volume + 1) / 3);
  }

  private computeRecencyWeight(recencyHours: number): number {
    if (recencyHours <= 0) return 1.0;
    if (recencyHours >= 168) return 0.1;
    return Math.max(0.1, 1.0 - (recencyHours / 168) * 0.9);
  }
}
