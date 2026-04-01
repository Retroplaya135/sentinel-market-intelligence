import { describe, it, expect } from 'vitest';
import { ManipulationDetector, ManipulationMarkersSchema } from '../../packages/scoring-engine/src/anti-manipulation/detector.js';
import type { ManipulationSignals } from '../../packages/scoring-engine/src/anti-manipulation/detector.js';

function makeSignals(overrides?: Partial<ManipulationSignals>): ManipulationSignals {
  return {
    unique_authors: 50,
    total_posts: 200,
    time_window_hours: 24,
    avg_account_age_days: 365,
    posting_burst_ratio: 1.0,
    sentiment_uniformity: 0.3,
    hashtag_coordination_ratio: 0.1,
    known_bot_ratio: 0.02,
    ...overrides,
  };
}

describe('ManipulationDetector — Bot detection', () => {
  const detector = new ManipulationDetector();

  it('low bot ratio produces low bot_score', () => {
    const markers = detector.analyze('onchain_evm', 'BTC', makeSignals({ known_bot_ratio: 0.01 }));
    expect(markers.bot_score).toBeLessThan(0.3);
  });

  it('high bot ratio produces high bot_score', () => {
    const markers = detector.analyze('x_twitter', 'DOGE', makeSignals({ known_bot_ratio: 0.6 }));
    expect(markers.bot_score).toBeGreaterThan(0.3);
    expect(markers.flags).toContain('ELEVATED_BOT_RATIO');
  });

  it('very high bot ratio flags HIGH_BOT_ACTIVITY', () => {
    const markers = detector.analyze('x_twitter', 'SHIB', makeSignals({ known_bot_ratio: 0.8, avg_account_age_days: 2 }));
    expect(markers.bot_score).toBeGreaterThan(0.5);
    expect(markers.flags).toContain('HIGH_BOT_ACTIVITY');
  });

  it('new accounts cluster is flagged', () => {
    const markers = detector.analyze('reddit', 'PEPE', makeSignals({ avg_account_age_days: 0.5 }));
    expect(markers.flags).toContain('NEW_ACCOUNTS_CLUSTER');
  });
});

describe('ManipulationDetector — Brigade detection', () => {
  const detector = new ManipulationDetector();

  it('normal posting pattern produces low brigade_score', () => {
    const markers = detector.analyze('reddit', 'BTC', makeSignals());
    expect(markers.brigade_score).toBeLessThan(0.3);
  });

  it('concentrated posting from few authors flags brigade', () => {
    const markers = detector.analyze('reddit', 'SCAM', makeSignals({
      unique_authors: 2,
      total_posts: 100,
      posting_burst_ratio: 8.0,
    }));
    expect(markers.brigade_score).toBeGreaterThan(0.3);
    expect(markers.flags).toContain('CONCENTRATED_POSTING');
  });

  it('extreme burst is flagged', () => {
    const markers = detector.analyze('x_twitter', 'PUMP', makeSignals({ posting_burst_ratio: 15.0 }));
    expect(markers.flags).toContain('EXTREME_BURST');
  });
});

describe('ManipulationDetector — Coordination detection', () => {
  const detector = new ManipulationDetector();

  it('diverse sentiment produces low coordination_score', () => {
    const markers = detector.analyze('onchain_evm', 'BTC', makeSignals({ sentiment_uniformity: 0.2 }));
    expect(markers.coordination_score).toBeLessThan(0.3);
  });

  it('uniform sentiment flags coordination', () => {
    const markers = detector.analyze('x_twitter', 'PUMP', makeSignals({
      sentiment_uniformity: 0.95,
      hashtag_coordination_ratio: 0.8,
    }));
    expect(markers.coordination_score).toBeGreaterThan(0.3);
    expect(markers.flags).toContain('COORDINATED_ACTIVITY');
    expect(markers.flags).toContain('SENTIMENT_UNIFORMITY');
  });
});

describe('ManipulationDetector — Composite and discount', () => {
  const detector = new ManipulationDetector();

  it('clean signals produce high discount_factor (close to 1)', () => {
    const markers = detector.analyze('onchain_evm', 'BTC', makeSignals());
    expect(markers.discount_factor).toBeGreaterThan(0.8);
    expect(markers.composite_manipulation_score).toBeLessThan(0.2);
  });

  it('manipulated signals produce low discount_factor', () => {
    const markers = detector.analyze('x_twitter', 'SCAM', makeSignals({
      known_bot_ratio: 0.7,
      unique_authors: 2,
      total_posts: 500,
      posting_burst_ratio: 20.0,
      sentiment_uniformity: 0.98,
      hashtag_coordination_ratio: 0.9,
      avg_account_age_days: 1,
    }));
    expect(markers.discount_factor).toBeLessThan(0.5);
    expect(markers.composite_manipulation_score).toBeGreaterThan(0.5);
  });

  it('applyDiscount reduces raw score proportionally', () => {
    const markers = detector.analyze('x_twitter', 'PUMP', makeSignals({
      known_bot_ratio: 0.5,
      sentiment_uniformity: 0.95,
    }));
    const raw = 0.8;
    const discounted = detector.applyDiscount(raw, markers);
    expect(discounted).toBeLessThan(raw);
    expect(discounted).toBe(raw * markers.discount_factor);
  });

  it('markers pass Zod validation', () => {
    const markers = detector.analyze('onchain_evm', 'ETH', makeSignals());
    const validation = ManipulationMarkersSchema.safeParse(markers);
    expect(validation.success).toBe(true);
  });

  it('all scores are clamped 0-1', () => {
    const markers = detector.analyze('x_twitter', 'TEST', makeSignals({
      known_bot_ratio: 1.0,
      unique_authors: 1,
      total_posts: 1000,
      posting_burst_ratio: 100,
      sentiment_uniformity: 1.0,
      hashtag_coordination_ratio: 1.0,
      avg_account_age_days: 0,
    }));
    expect(markers.bot_score).toBeLessThanOrEqual(1);
    expect(markers.bot_score).toBeGreaterThanOrEqual(0);
    expect(markers.brigade_score).toBeLessThanOrEqual(1);
    expect(markers.brigade_score).toBeGreaterThanOrEqual(0);
    expect(markers.coordination_score).toBeLessThanOrEqual(1);
    expect(markers.coordination_score).toBeGreaterThanOrEqual(0);
    expect(markers.composite_manipulation_score).toBeLessThanOrEqual(1);
    expect(markers.discount_factor).toBeGreaterThanOrEqual(0);
    expect(markers.discount_factor).toBeLessThanOrEqual(1);
  });
});
