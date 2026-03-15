import { BaseAlertStrategy } from '../base/base-strategy.js';
import type { AlertRecord } from '../base/base-strategy.js';

export class ThresholdAlertStrategy extends BaseAlertStrategy {
  readonly strategy_id = 'threshold_alert_v1';

  private currentScores: Map<string, number> = new Map();
  private evidenceAvailability: Map<string, boolean> = new Map();
  private sourceAvailability: Map<string, boolean> = new Map();

  updateCurrentScore(asset_id: string, score: number): void {
    this.currentScores.set(asset_id, score);
  }

  setEvidenceAvailable(ref: string, available: boolean): void {
    this.evidenceAvailability.set(ref, available);
  }

  setSourceAvailable(source_id: string, available: boolean): void {
    this.sourceAvailability.set(source_id, available);
  }

  protected async checkInvalidationConditions(record: AlertRecord): Promise<{ invalidated: boolean; reason: string }> {
    const reasons: string[] = [];

    const currentScore = this.currentScores.get(record.asset_id);
    if (currentScore !== undefined) {
      const drift = Math.abs(currentScore - record.score_at_trigger);
      if (drift > 0.3) {
        reasons.push(`Score drift: trigger=${record.score_at_trigger.toFixed(3)}, current=${currentScore.toFixed(3)}, drift=${drift.toFixed(3)} > 0.3 threshold`);
      }

      const directionFlipped =
        (record.score_at_trigger >= 0 && currentScore < 0) ||
        (record.score_at_trigger < 0 && currentScore >= 0);
      if (directionFlipped) {
        reasons.push(`Direction reversal: was ${record.score_at_trigger >= 0 ? 'bullish' : 'bearish'}, now ${currentScore >= 0 ? 'bullish' : 'bearish'}`);
      }
    }

    for (const ref of record.evidence_refs) {
      const available = this.evidenceAvailability.get(ref);
      if (available === false) {
        reasons.push(`Evidence unavailable: ${ref}`);
        break;
      }
    }

    const ageMs = Date.now() - new Date(record.triggered_at).getTime();
    const thresholdConfig = this.thresholds.find((t) => t.threshold_id === record.threshold_id);
    if (thresholdConfig) {
      const halfLifeMs = thresholdConfig.expected_half_life_minutes * 60000;
      if (ageMs > halfLifeMs * 3) {
        reasons.push(`Alert expired: age ${Math.round(ageMs / 60000)}min > 3x half-life ${thresholdConfig.expected_half_life_minutes * 3}min`);
      }
    }

    if (reasons.length > 0) {
      return { invalidated: true, reason: reasons.join('; ') };
    }

    return { invalidated: false, reason: 'All invalidation checks passed.' };
  }
}
