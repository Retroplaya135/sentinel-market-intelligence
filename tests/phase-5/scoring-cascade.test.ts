import { describe, it, expect } from 'vitest';
import { SentimentCascadeScorer } from '../../packages/scoring-engine/src/cascade/sentiment-scorer.js';
import type { SourceSignal } from '../../packages/scoring-engine/src/base/base-scorer.js';
import { ScoreResultSchema, ScoreExplanationSchema } from '../../packages/module-system/src/interfaces/scorer.js';

function makeSignal(overrides?: Partial<SourceSignal>): SourceSignal {
  return {
    source_id: 'onchain_evm',
    asset_id: 'BTC',
    raw_sentiment: 0.5,
    volume: 100,
    recency_hours: 2,
    evidence_refs: ['ref_001'],
    metadata: { sentiment: 0.5, volume: 100, recency_hours: 2, evidence_refs: ['ref_001'] },
    ...overrides,
  };
}

describe('SentimentCascadeScorer — Per-source scoring', () => {
  const scorer = new SentimentCascadeScorer();

  it('scorer_id is set correctly', () => {
    expect(scorer.scorer_id).toBe('sentiment_cascade_v1');
  });

  it('scores a single signal with correct structure', () => {
    const result = scorer.scorePerSource(makeSignal());
    expect(result.source_id).toBe('onchain_evm');
    expect(result.asset_id).toBe('BTC');
    expect(result.raw_score).toBe(0.5);
    expect(result.adjusted_score).toBeGreaterThan(0);
    expect(result.adjusted_score).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.volume_weight).toBeGreaterThan(0);
    expect(result.recency_weight).toBeGreaterThan(0);
    expect(result.manipulation_discount).toBe(1.0);
    expect(result.evidence_refs).toContain('ref_001');
  });

  it('higher volume produces higher volume_weight', () => {
    const lowVol = scorer.scorePerSource(makeSignal({ volume: 5 }));
    const highVol = scorer.scorePerSource(makeSignal({ volume: 500 }));
    expect(highVol.volume_weight).toBeGreaterThan(lowVol.volume_weight);
  });

  it('more recent data produces higher recency_weight', () => {
    const recent = scorer.scorePerSource(makeSignal({ recency_hours: 1 }));
    const stale = scorer.scorePerSource(makeSignal({ recency_hours: 100 }));
    expect(recent.recency_weight).toBeGreaterThan(stale.recency_weight);
  });

  it('zero volume produces zero volume_weight', () => {
    const result = scorer.scorePerSource(makeSignal({ volume: 0 }));
    expect(result.volume_weight).toBe(0);
  });

  it('negative sentiment produces negative adjusted_score', () => {
    const result = scorer.scorePerSource(makeSignal({ raw_sentiment: -0.8 }));
    expect(result.raw_score).toBe(-0.8);
    expect(result.adjusted_score).toBeLessThan(0);
  });

  it('zero sentiment produces zero adjusted_score', () => {
    const result = scorer.scorePerSource(makeSignal({ raw_sentiment: 0 }));
    expect(result.adjusted_score).toBe(0);
  });

  it('adjusted_score is clamped to [-1, 1]', () => {
    const result = scorer.scorePerSource(makeSignal({ raw_sentiment: 1.0, volume: 10000, recency_hours: 0 }));
    expect(result.adjusted_score).toBeGreaterThanOrEqual(-1);
    expect(result.adjusted_score).toBeLessThanOrEqual(1);
  });
});

describe('SentimentCascadeScorer — End-to-end score()', () => {
  const scorer = new SentimentCascadeScorer();

  it('returns valid ScoreResult for multi-source input', async () => {
    const result = await scorer.score({
      asset_id: 'BTC',
      source_data: {
        onchain_evm: { sentiment: 0.6, volume: 200, recency_hours: 1, evidence_refs: ['evm_ref'] },
        exchange_market_data: { sentiment: 0.4, volume: 500, recency_hours: 2, evidence_refs: ['exch_ref'] },
        licensed_news_rss: { sentiment: -0.2, volume: 50, recency_hours: 4, evidence_refs: ['news_ref'] },
      },
    });

    const validation = ScoreResultSchema.safeParse(result);
    expect(validation.success).toBe(true);
    expect(result.asset_id).toBe('BTC');
    expect(result.source_ids.length).toBe(3);
    expect(result.score).toBeGreaterThan(-1);
    expect(result.score).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns zero score/confidence for empty source_data', async () => {
    const result = await scorer.score({ asset_id: 'ETH', source_data: {} });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.source_ids).toContain('none');
  });

  it('single source produces valid result', async () => {
    const result = await scorer.score({
      asset_id: 'SOL',
      source_data: { first_party: { sentiment: 0.9, volume: 300, recency_hours: 0.5, evidence_refs: ['fp_ref'] } },
    });
    expect(result.source_ids).toEqual(['first_party']);
    expect(result.score).toBeGreaterThan(0);
  });

  it('conflicting sources produce moderated score', async () => {
    const result = await scorer.score({
      asset_id: 'DOGE',
      source_data: {
        onchain_evm: { sentiment: 0.9, volume: 100, recency_hours: 1 },
        licensed_news_rss: { sentiment: -0.9, volume: 100, recency_hours: 1 },
      },
    });
    expect(Math.abs(result.score)).toBeLessThan(0.9);
  });
});

describe('SentimentCascadeScorer — calibrate()', () => {
  const scorer = new SentimentCascadeScorer();

  it('computes calibration error from evaluation set', async () => {
    const evalSet = [
      { predicted: 0.5, actual: 0.6 },
      { predicted: -0.3, actual: -0.2 },
      { predicted: 0.8, actual: 0.7 },
    ];
    const result = await scorer.calibrate({ evaluation_set: evalSet, model_version: 'cascade_v1.0.0' });
    expect(result.calibration_error).toBeGreaterThan(0);
    expect(result.calibration_error).toBeLessThan(1);
    expect(result.sample_count).toBe(3);
    expect(result.model_version).toBe('cascade_v1.0.0');
  });

  it('perfect predictions produce zero calibration error', async () => {
    const evalSet = [
      { predicted: 0.5, actual: 0.5 },
      { predicted: -0.3, actual: -0.3 },
    ];
    const result = await scorer.calibrate({ evaluation_set: evalSet, model_version: 'v1' });
    expect(result.calibration_error).toBe(0);
  });

  it('throws on empty evaluation set', async () => {
    await expect(scorer.calibrate({ evaluation_set: [], model_version: 'v1' })).rejects.toThrow('non-empty');
  });

  it('throws on invalid entries', async () => {
    await expect(scorer.calibrate({ evaluation_set: [{ bad: true }], model_version: 'v1' })).rejects.toThrow('numeric');
  });
});

describe('SentimentCascadeScorer — explain_score()', () => {
  const scorer = new SentimentCascadeScorer();

  it('generates valid ScoreExplanation', async () => {
    const scoreResult = await scorer.score({
      asset_id: 'BTC',
      source_data: {
        onchain_evm: { sentiment: 0.6, volume: 200, recency_hours: 1 },
        exchange_market_data: { sentiment: 0.4, volume: 300, recency_hours: 2 },
      },
    });

    const explanation = await scorer.explain_score({ asset_id: 'BTC', score_result: scoreResult });
    const validation = ScoreExplanationSchema.safeParse(explanation);
    expect(validation.success).toBe(true);
    expect(explanation.factors.length).toBe(2);
    expect(explanation.score).toBe(scoreResult.score);
    for (const f of explanation.factors) {
      expect(f.source_id).toBeTruthy();
      expect(f.description).toBeTruthy();
      expect(typeof f.weight).toBe('number');
      expect(typeof f.contribution).toBe('number');
    }
  });
});
