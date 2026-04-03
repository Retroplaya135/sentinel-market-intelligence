import { describe, it, expect, beforeEach } from 'vitest';
import { ThresholdAlertStrategy } from '../../packages/alerting/src/strategies/threshold-strategy.js';
import type { ThresholdConfig } from '../../packages/alerting/src/base/base-strategy.js';
import { AlertEvaluationSchema } from '../../packages/module-system/src/interfaces/alert-strategy.js';

const THRESHOLDS: ThresholdConfig[] = [
  { threshold_id: 'strong_bullish', asset_pattern: '*', metric: 'fused_score', operator: 'gt', static_value: 0.7, severity: 'high', cooldown_minutes: 15, expected_half_life_minutes: 60, invalidation_trigger: 'score_drift > 0.3', enabled: true },
  { threshold_id: 'strong_bearish', asset_pattern: '*', metric: 'fused_score', operator: 'lt', static_value: -0.7, severity: 'high', cooldown_minutes: 15, expected_half_life_minutes: 60, invalidation_trigger: 'score_drift > 0.3', enabled: true },
  { threshold_id: 'critical_move', asset_pattern: '*', metric: 'fused_score', operator: 'abs_gt', static_value: 0.9, severity: 'critical', cooldown_minutes: 5, expected_half_life_minutes: 30, invalidation_trigger: 'direction_reversal', enabled: true },
  { threshold_id: 'low_confidence', asset_pattern: '*', metric: 'confidence', operator: 'lt', static_value: 0.3, severity: 'low', cooldown_minutes: 60, expected_half_life_minutes: 120, invalidation_trigger: 'confidence_recovery', enabled: true },
  { threshold_id: 'manipulation_warn', asset_pattern: '*', metric: 'manipulation_composite', operator: 'gt', static_value: 0.5, severity: 'medium', cooldown_minutes: 30, expected_half_life_minutes: 90, invalidation_trigger: 'manipulation_resolved', enabled: true },
  { threshold_id: 'disabled_rule', asset_pattern: '*', metric: 'fused_score', operator: 'gt', static_value: 0.1, severity: 'low', cooldown_minutes: 5, expected_half_life_minutes: 30, invalidation_trigger: 'n/a', enabled: false },
  { threshold_id: 'btc_specific', asset_pattern: 'BTC', metric: 'fused_score', operator: 'gt', static_value: 0.5, severity: 'medium', cooldown_minutes: 10, expected_half_life_minutes: 45, invalidation_trigger: 'score_drift', enabled: true },
];

describe('ThresholdAlertStrategy — Static threshold evaluation', () => {
  let strategy: ThresholdAlertStrategy;

  beforeEach(() => {
    strategy = new ThresholdAlertStrategy();
    strategy.setThresholds(THRESHOLDS);
  });

  it('triggers on strong bullish signal', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['ref1'] } });
    expect(eval_.triggered).toBe(true);
    expect(eval_.severity).toBe('high');
    expect(eval_.threshold_triggered).toContain('fused_score');
    const v = AlertEvaluationSchema.safeParse(eval_);
    expect(v.success).toBe(true);
  });

  it('triggers critical on extreme move', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.95, confidence: 0.9, evidence_refs: ['ref1'] } });
    expect(eval_.triggered).toBe(true);
    expect(eval_.severity).toBe('critical');
  });

  it('triggers on strong bearish signal', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'SOL', signals: { fused_score: -0.8, confidence: 0.6, evidence_refs: ['ref1'] } });
    expect(eval_.triggered).toBe(true);
    expect(eval_.severity).toBe('high');
  });

  it('triggers low_confidence alert', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'DOGE', signals: { fused_score: 0.2, confidence: 0.1, evidence_refs: ['ref1'] } });
    expect(eval_.triggered).toBe(true);
    expect(eval_.severity).toBe('low');
  });

  it('triggers manipulation warning', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'SHIB', signals: { fused_score: 0.3, manipulation_composite: 0.7, evidence_refs: ['ref1'] } });
    expect(eval_.triggered).toBe(true);
    expect(eval_.severity).toBe('medium');
  });

  it('does NOT trigger when below all thresholds', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'ADA', signals: { fused_score: 0.3, confidence: 0.5, manipulation_composite: 0.1 } });
    expect(eval_.triggered).toBe(false);
  });

  it('disabled thresholds are ignored', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'TEST', signals: { fused_score: 0.2 } });
    expect(eval_.triggered).toBe(false);
  });

  it('asset-specific threshold only triggers for matching asset', async () => {
    const btcEval = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.6, confidence: 0.5, evidence_refs: ['ref1'] } });
    expect(btcEval.triggered).toBe(true);

    const ethEval = await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.6, confidence: 0.5 } });
    expect(ethEval.triggered).toBe(false);
  });

  it('selects highest severity when multiple thresholds match', async () => {
    const eval_ = await strategy.evaluate({
      asset_id: 'BTC', signals: { fused_score: 0.95, confidence: 0.9, evidence_refs: ['ref1'] },
    });
    expect(eval_.severity).toBe('critical');
  });
});

describe('ThresholdAlertStrategy — Cooldown deduplication', () => {
  let strategy: ThresholdAlertStrategy;

  beforeEach(() => {
    strategy = new ThresholdAlertStrategy();
    strategy.setThresholds(THRESHOLDS);
  });

  it('second trigger within cooldown is suppressed', async () => {
    const first = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['r1'] } });
    expect(first.triggered).toBe(true);

    const second = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.85, confidence: 0.7, evidence_refs: ['r2'] } });
    expect(second.triggered).toBe(false);
  });

  it('different assets are NOT affected by each others cooldowns', async () => {
    await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['r1'] } });
    const ethEval = await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['r1'] } });
    expect(ethEval.triggered).toBe(true);
  });

  it('different thresholds for same asset have independent cooldowns', async () => {
    await strategy.evaluate({ asset_id: 'TEST', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['r1'] } });
    const manipEval = await strategy.evaluate({ asset_id: 'TEST', signals: { fused_score: 0.3, manipulation_composite: 0.7, evidence_refs: ['r1'] } });
    expect(manipEval.triggered).toBe(true);
  });
});

describe('ThresholdAlertStrategy — Dispatch routing', () => {
  let strategy: ThresholdAlertStrategy;

  beforeEach(() => {
    strategy = new ThresholdAlertStrategy();
    strategy.setThresholds(THRESHOLDS);
  });

  it('critical alerts route to push+email+webhook+sms', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.95, confidence: 0.9, evidence_refs: ['r'] } });
    const dispatch = await strategy.dispatch({ evaluation: eval_, tenant_id: 'tenant_1' });
    expect(dispatch.dispatched).toBe(true);
    expect(dispatch.channels).toContain('push');
    expect(dispatch.channels).toContain('email');
    expect(dispatch.channels).toContain('webhook');
    expect(dispatch.channels).toContain('sms');
  });

  it('high alerts route to push+email+webhook', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.8, confidence: 0.7, evidence_refs: ['r'] } });
    const dispatch = await strategy.dispatch({ evaluation: eval_, tenant_id: 'tenant_1' });
    expect(dispatch.channels).toEqual(['push', 'email', 'webhook']);
  });

  it('low alerts route to push only', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'TEST', signals: { fused_score: 0.1, confidence: 0.1, evidence_refs: ['r'] } });
    const dispatch = await strategy.dispatch({ evaluation: eval_, tenant_id: 'tenant_1' });
    expect(dispatch.channels).toEqual(['push']);
  });

  it('non-triggered evaluation is not dispatched', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'TEST', signals: { fused_score: 0.3, confidence: 0.5 } });
    const dispatch = await strategy.dispatch({ evaluation: eval_, tenant_id: 'tenant_1' });
    expect(dispatch.dispatched).toBe(false);
    expect(dispatch.channels).toEqual([]);
  });
});
