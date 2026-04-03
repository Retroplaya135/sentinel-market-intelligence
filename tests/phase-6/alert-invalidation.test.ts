import { describe, it, expect, beforeEach } from 'vitest';
import { ThresholdAlertStrategy } from '../../packages/alerting/src/strategies/threshold-strategy.js';
import type { ThresholdConfig } from '../../packages/alerting/src/base/base-strategy.js';
import { AlertInvalidationSchema } from '../../packages/module-system/src/interfaces/alert-strategy.js';

const THRESHOLDS: ThresholdConfig[] = [
  { threshold_id: 'bullish', asset_pattern: '*', metric: 'fused_score', operator: 'gt', static_value: 0.5, severity: 'high', cooldown_minutes: 0.001, expected_half_life_minutes: 0.001, invalidation_trigger: 'score_drift > 0.3', enabled: true },
];

describe('ThresholdAlertStrategy — Invalidation checks', () => {
  let strategy: ThresholdAlertStrategy;

  beforeEach(() => {
    strategy = new ThresholdAlertStrategy();
    strategy.setThresholds(THRESHOLDS);
  });

  it('alert is NOT invalidated when conditions are stable', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ref1'] } });
    strategy.updateCurrentScore('BTC', 0.65);
    const inv = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv.invalidated).toBe(false);
    expect(inv.reason).toContain('passed');
    const v = AlertInvalidationSchema.safeParse(inv);
    expect(v.success).toBe(true);
  });

  it('alert IS invalidated on score drift > 0.3', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ref1'] } });
    strategy.updateCurrentScore('BTC', 0.2);
    const inv = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv.invalidated).toBe(true);
    expect(inv.reason).toContain('drift');
  });

  it('alert IS invalidated on direction reversal', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ref1'] } });
    strategy.updateCurrentScore('ETH', -0.1);
    const inv = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv.invalidated).toBe(true);
    expect(inv.reason).toContain('reversal');
  });

  it('alert IS invalidated when evidence becomes unavailable', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'SOL', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ev_001'] } });
    strategy.setEvidenceAvailable('ev_001', false);
    const inv = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv.invalidated).toBe(true);
    expect(inv.reason).toContain('Evidence unavailable');
  });

  it('already invalidated alert returns cached invalidation on second check', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ref1'] } });
    strategy.updateCurrentScore('BTC', -0.5);
    const inv1 = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv1.invalidated).toBe(true);
    const inv2 = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv2.invalidated).toBe(true);
    const record = strategy.getAlert(eval_.alert_id);
    expect(record!.invalidated).toBe(true);
    expect(record!.invalidated_at).toBeTruthy();
  });

  it('nonexistent alert_id returns not-found invalidation', async () => {
    const inv = await strategy.invalidate({ alert_id: 'fake_id' });
    expect(inv.invalidated).toBe(false);
    expect(inv.reason).toContain('not found');
  });

  it('alert IS invalidated when expired past 3x half-life', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'DOGE', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['ref1'] } });
    const record = strategy.getAlert(eval_.alert_id)!;
    (record as any).triggered_at = new Date(Date.now() - 999999999).toISOString();
    const inv = await strategy.invalidate({ alert_id: eval_.alert_id });
    expect(inv.invalidated).toBe(true);
    expect(inv.reason).toContain('expired');
  });
});

describe('ThresholdAlertStrategy — Alert history', () => {
  let strategy: ThresholdAlertStrategy;

  beforeEach(() => {
    strategy = new ThresholdAlertStrategy();
    strategy.setThresholds(THRESHOLDS);
  });

  it('getAlertHistory returns all triggered alerts', async () => {
    await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['r1'] } });
    await strategy.evaluate({ asset_id: 'ETH', signals: { fused_score: 0.8, confidence: 0.9, evidence_refs: ['r2'] } });
    const history = strategy.getAlertHistory();
    expect(history.length).toBe(2);
    expect(history[0].asset_id).toBe('BTC');
    expect(history[1].asset_id).toBe('ETH');
  });

  it('getAlert returns specific alert by ID', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['r1'] } });
    const record = strategy.getAlert(eval_.alert_id);
    expect(record).toBeDefined();
    expect(record!.asset_id).toBe('BTC');
    expect(record!.threshold_id).toBe('bullish');
  });

  it('clearHistory removes all alerts and cooldowns', async () => {
    await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['r1'] } });
    strategy.clearHistory();
    expect(strategy.getAlertHistory().length).toBe(0);
  });

  it('alert record tracks dispatch state', async () => {
    const eval_ = await strategy.evaluate({ asset_id: 'BTC', signals: { fused_score: 0.7, confidence: 0.8, evidence_refs: ['r1'] } });
    await strategy.dispatch({ evaluation: eval_, tenant_id: 'tenant_1' });
    const record = strategy.getAlert(eval_.alert_id);
    expect(record!.dispatched).toBe(true);
    expect(record!.dispatch_channels.length).toBeGreaterThan(0);
    expect(record!.tenant_id).toBe('tenant_1');
  });
});
