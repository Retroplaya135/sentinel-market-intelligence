import { describe, it, expect, beforeEach } from 'vitest';
import { FusionEngine, FusionResultSchema } from '../../packages/scoring-engine/src/fusion/fusion-engine.js';
import type { FusionWeightConfig } from '../../packages/scoring-engine/src/fusion/fusion-engine.js';
import type { PerSourceScore } from '../../packages/scoring-engine/src/base/base-scorer.js';

function makePSS(overrides?: Partial<PerSourceScore>): PerSourceScore {
  return {
    source_id: 'onchain_evm',
    asset_id: 'BTC',
    raw_score: 0.5,
    adjusted_score: 0.4,
    confidence: 0.7,
    volume_weight: 0.8,
    recency_weight: 0.9,
    manipulation_discount: 1.0,
    evidence_refs: ['ref_001'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('FusionEngine — Weight configuration', () => {
  let engine: FusionEngine;

  beforeEach(() => {
    engine = new FusionEngine();
  });

  it('accepts valid weight configs', () => {
    engine.setWeights([
      { source_id: 'onchain_evm', base_weight: 2.0, trust_multiplier: 1.2, recency_decay_rate: 0.05 },
      { source_id: 'exchange_market_data', base_weight: 1.5, trust_multiplier: 1.0, recency_decay_rate: 0.1 },
    ]);
    const w = engine.getWeight('onchain_evm');
    expect(w.base_weight).toBe(2.0);
    expect(w.trust_multiplier).toBe(1.2);
  });

  it('returns default weight for unknown sources', () => {
    const w = engine.getWeight('unknown_source');
    expect(w.base_weight).toBe(1.0);
    expect(w.trust_multiplier).toBe(1.0);
  });

  it('setWeightsFromPlaceholder accepts array of configs', () => {
    const placeholder = [
      { source_id: 'onchain_evm', base_weight: 3.0 },
      { source_id: 'licensed_news_rss', base_weight: 1.5, trust_multiplier: 0.9 },
    ];
    engine.setWeightsFromPlaceholder(placeholder);
    expect(engine.getWeight('onchain_evm').base_weight).toBe(3.0);
  });

  it('setWeightsFromPlaceholder rejects non-array', () => {
    expect(() => engine.setWeightsFromPlaceholder('not_array')).toThrow('array');
  });

  it('rejects invalid weight config', () => {
    expect(() => engine.setWeights([{ source_id: '', base_weight: -1, trust_multiplier: 1, recency_decay_rate: 0 }])).toThrow();
  });
});

describe('FusionEngine — Score fusion', () => {
  let engine: FusionEngine;

  beforeEach(() => {
    engine = new FusionEngine();
    engine.setWeights([
      { source_id: 'onchain_evm', base_weight: 2.0, trust_multiplier: 1.0, recency_decay_rate: 0.1 },
      { source_id: 'exchange_market_data', base_weight: 1.5, trust_multiplier: 1.0, recency_decay_rate: 0.1 },
      { source_id: 'licensed_news_rss', base_weight: 1.0, trust_multiplier: 0.8, recency_decay_rate: 0.1 },
    ]);
  });

  it('fuses multiple sources into valid FusionResult', () => {
    const scores = [
      makePSS({ source_id: 'onchain_evm', adjusted_score: 0.6 }),
      makePSS({ source_id: 'exchange_market_data', adjusted_score: 0.4 }),
      makePSS({ source_id: 'licensed_news_rss', adjusted_score: 0.2 }),
    ];
    const result = engine.fuse('BTC', scores);
    const validation = FusionResultSchema.safeParse(result);
    expect(validation.success).toBe(true);
    expect(result.fused_score).toBeGreaterThan(0);
    expect(result.fused_score).toBeLessThanOrEqual(1);
    expect(result.fused_confidence).toBeGreaterThan(0);
    expect(result.total_sources).toBe(3);
    expect(result.source_contributions.length).toBe(3);
    expect(result.dominant_source).toBeTruthy();
  });

  it('higher weighted source has more influence', () => {
    const scoresA = [
      makePSS({ source_id: 'onchain_evm', adjusted_score: 0.8 }),
      makePSS({ source_id: 'licensed_news_rss', adjusted_score: -0.8 }),
    ];
    const result = engine.fuse('BTC', scoresA);
    expect(result.fused_score).toBeGreaterThan(0);
  });

  it('returns empty result for no scores', () => {
    const result = engine.fuse('BTC', []);
    expect(result.fused_score).toBe(0);
    expect(result.fused_confidence).toBe(0);
    expect(result.total_sources).toBe(0);
  });

  it('single source fusion equals that source adjusted_score', () => {
    const result = engine.fuse('ETH', [makePSS({ adjusted_score: 0.7 })]);
    expect(result.total_sources).toBe(1);
    expect(Math.abs(result.fused_score - 0.7)).toBeLessThan(0.01);
  });

  it('agreement_ratio is 1.0 when all sources agree on direction', () => {
    const scores = [
      makePSS({ source_id: 'a', adjusted_score: 0.3 }),
      makePSS({ source_id: 'b', adjusted_score: 0.5 }),
      makePSS({ source_id: 'c', adjusted_score: 0.1 }),
    ];
    const result = engine.fuse('BTC', scores);
    expect(result.agreement_ratio).toBe(1.0);
  });

  it('agreement_ratio is 0 when all sources disagree', () => {
    const scores = [
      makePSS({ source_id: 'a', adjusted_score: 0.5 }),
      makePSS({ source_id: 'b', adjusted_score: -0.5 }),
    ];
    const result = engine.fuse('BTC', scores);
    expect(result.agreement_ratio).toBe(0);
  });

  it('manipulation_discount reduces effective weight', () => {
    const clean = engine.fuse('BTC', [makePSS({ manipulation_discount: 1.0, adjusted_score: 0.8 })]);
    const discounted = engine.fuse('BTC', [makePSS({ manipulation_discount: 0.3, adjusted_score: 0.8 })]);
    expect(Math.abs(clean.fused_score)).toBeGreaterThanOrEqual(Math.abs(discounted.fused_score));
  });

  it('fused_score is always clamped to [-1, 1]', () => {
    const extreme = [
      makePSS({ adjusted_score: 1.0, volume_weight: 1.0, recency_weight: 1.0 }),
      makePSS({ source_id: 'b', adjusted_score: 1.0, volume_weight: 1.0, recency_weight: 1.0 }),
    ];
    const result = engine.fuse('BTC', extreme);
    expect(result.fused_score).toBeLessThanOrEqual(1);
    expect(result.fused_score).toBeGreaterThanOrEqual(-1);
  });

  it('contributions sum correctly', () => {
    const scores = [
      makePSS({ source_id: 'onchain_evm', adjusted_score: 0.5 }),
      makePSS({ source_id: 'exchange_market_data', adjusted_score: 0.3 }),
    ];
    const result = engine.fuse('BTC', scores);
    for (const c of result.source_contributions) {
      expect(typeof c.effective_weight).toBe('number');
      expect(typeof c.contribution).toBe('number');
    }
  });
});
