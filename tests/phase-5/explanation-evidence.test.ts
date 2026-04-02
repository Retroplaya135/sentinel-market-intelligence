import { describe, it, expect } from 'vitest';
import { ExplanationGenerator, DetailedExplanationSchema } from '../../packages/scoring-engine/src/explain/explanation-generator.js';
import { FusionEngine } from '../../packages/scoring-engine/src/fusion/fusion-engine.js';
import { ManipulationDetector } from '../../packages/scoring-engine/src/anti-manipulation/detector.js';
import type { PerSourceScore } from '../../packages/scoring-engine/src/base/base-scorer.js';
import type { ManipulationMarkers } from '../../packages/scoring-engine/src/anti-manipulation/detector.js';
import { ScoreExplanationSchema } from '../../packages/module-system/src/interfaces/scorer.js';

function makePSS(source_id: string, adj: number, refs: string[]): PerSourceScore {
  return {
    source_id, asset_id: 'BTC', raw_score: adj * 1.1, adjusted_score: adj,
    confidence: 0.7, volume_weight: 0.8, recency_weight: 0.9, manipulation_discount: 1.0,
    evidence_refs: refs, timestamp: new Date().toISOString(),
  };
}

describe('ExplanationGenerator — Evidence linkage', () => {
  const gen = new ExplanationGenerator();
  const fusion = new FusionEngine();

  it('generates detailed explanation with evidence refs from each source', () => {
    const scores = [
      makePSS('onchain_evm', 0.6, ['evm_tx_001', 'evm_tx_002']),
      makePSS('exchange_market_data', 0.3, ['exch_trade_001']),
      makePSS('licensed_news_rss', -0.1, ['news_article_001', 'news_article_002']),
    ];
    const fusionResult = fusion.fuse('BTC', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);

    const validation = DetailedExplanationSchema.safeParse(explanation);
    expect(validation.success).toBe(true);

    expect(explanation.source_breakdowns.length).toBe(3);
    expect(explanation.source_breakdowns[0].evidence_refs).toContain('evm_tx_001');
    expect(explanation.source_breakdowns[0].evidence_refs).toContain('evm_tx_002');
    expect(explanation.source_breakdowns[1].evidence_refs).toContain('exch_trade_001');
    expect(explanation.source_breakdowns[2].evidence_refs).toContain('news_article_001');
  });

  it('includes manipulation flags when markers are provided', () => {
    const scores = [makePSS('x_twitter', 0.8, ['tweet_001'])];
    const fusionResult = fusion.fuse('DOGE', scores);

    const detector = new ManipulationDetector();
    const markers = detector.analyze('x_twitter', 'DOGE', {
      unique_authors: 2, total_posts: 500, time_window_hours: 1,
      avg_account_age_days: 1, posting_burst_ratio: 20, sentiment_uniformity: 0.98,
      hashtag_coordination_ratio: 0.9, known_bot_ratio: 0.6,
    });

    const manipMap = new Map<string, ManipulationMarkers>([['x_twitter', markers]]);
    const explanation = gen.generateFromFusion(fusionResult, scores, manipMap);

    expect(explanation.source_breakdowns[0].manipulation_flags.length).toBeGreaterThan(0);
    expect(explanation.source_breakdowns[0].discount_factor).toBeLessThan(1.0);
    expect(explanation.source_breakdowns[0].narrative).toContain('⚠');
  });

  it('contribution_pct sums to ~100%', () => {
    const scores = [
      makePSS('onchain_evm', 0.5, ['ref1']),
      makePSS('exchange_market_data', 0.3, ['ref2']),
    ];
    const fusionResult = fusion.fuse('BTC', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);
    const totalPct = explanation.source_breakdowns.reduce((sum, b) => sum + b.contribution_pct, 0);
    expect(totalPct).toBeGreaterThan(99);
    expect(totalPct).toBeLessThanOrEqual(101);
  });

  it('summary_narrative includes asset, direction, and confidence', () => {
    const scores = [makePSS('onchain_evm', 0.7, ['ref1'])];
    const fusionResult = fusion.fuse('ETH', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);
    expect(explanation.summary_narrative).toContain('ETH');
    expect(explanation.summary_narrative).toContain('bullish');
    expect(explanation.summary_narrative).toContain('confidence');
  });

  it('bearish signal produces bearish narrative', () => {
    const scores = [makePSS('licensed_news_rss', -0.6, ['ref1'])];
    const fusionResult = fusion.fuse('SOL', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);
    expect(explanation.summary_narrative).toContain('bearish');
  });

  it('invalidation_conditions are always present', () => {
    const scores = [makePSS('onchain_evm', 0.5, ['ref1'])];
    const fusionResult = fusion.fuse('BTC', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);
    expect(explanation.invalidation_conditions.length).toBeGreaterThan(0);
    for (const cond of explanation.invalidation_conditions) {
      expect(cond.length).toBeGreaterThan(10);
    }
  });

  it('dominant_source is identified', () => {
    const scores = [
      makePSS('onchain_evm', 0.9, ['ref1']),
      makePSS('licensed_news_rss', 0.1, ['ref2']),
    ];
    const fusionResult = fusion.fuse('BTC', scores);
    const explanation = gen.generateFromFusion(fusionResult, scores);
    expect(explanation.dominant_source).toBe('onchain_evm');
  });

  it('toModuleExplanation produces valid ScoreExplanation', () => {
    const scores = [makePSS('onchain_evm', 0.5, ['ref1'])];
    const fusionResult = fusion.fuse('BTC', scores);
    const detailed = gen.generateFromFusion(fusionResult, scores);
    const moduleExpl = gen.toModuleExplanation(detailed);
    const validation = ScoreExplanationSchema.safeParse(moduleExpl);
    expect(validation.success).toBe(true);
    expect(moduleExpl.factors.length).toBe(1);
  });
});
