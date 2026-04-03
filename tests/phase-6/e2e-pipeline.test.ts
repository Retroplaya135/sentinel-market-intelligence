import { describe, it, expect } from 'vitest';
import { SentinelPipeline } from '../../packages/integration/src/pipeline/sentinel-pipeline.js';
import type { PipelineInput, SentinelPipelineConfig } from '../../packages/integration/src/pipeline/sentinel-pipeline.js';
import type { ThresholdConfig } from '../../packages/alerting/src/base/base-strategy.js';

const ALERT_THRESHOLDS: ThresholdConfig[] = [
  { threshold_id: 'bullish_alert', asset_pattern: '*', metric: 'fused_score', operator: 'gt', static_value: 0.4, severity: 'high', cooldown_minutes: 0.001, expected_half_life_minutes: 60, invalidation_trigger: 'score_drift', enabled: true },
  { threshold_id: 'critical_alert', asset_pattern: '*', metric: 'fused_score', operator: 'abs_gt', static_value: 0.8, severity: 'critical', cooldown_minutes: 0.001, expected_half_life_minutes: 30, invalidation_trigger: 'direction_reversal', enabled: true },
];

const FUSION_WEIGHTS = [
  { source_id: 'onchain_evm', base_weight: 2.0 },
  { source_id: 'exchange_market_data', base_weight: 1.5 },
  { source_id: 'licensed_news_rss', base_weight: 1.0 },
];

const CONFIG: SentinelPipelineConfig = {
  fusionWeights: FUSION_WEIGHTS,
  alertThresholds: ALERT_THRESHOLDS,
  scorer_model_version: 'cascade_e2e_v1',
};

function makeInput(overrides?: Partial<PipelineInput>): PipelineInput {
  return {
    asset_id: 'BTC',
    source_data: {
      onchain_evm: { sentiment: 0.6, volume: 200, recency_hours: 1, evidence_refs: ['evm_tx_001'] },
      exchange_market_data: { sentiment: 0.4, volume: 500, recency_hours: 2, evidence_refs: ['exch_trade_001'] },
      licensed_news_rss: { sentiment: 0.3, volume: 50, recency_hours: 4, evidence_refs: ['news_001'] },
    },
    tenant_id: 'tenant_001',
    actor_id: 'user_001',
    ...overrides,
  };
}

describe('SentinelPipeline — Full end-to-end execution', () => {
  it('completes full pipeline with all stages succeeding', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    expect(result.overall_success).toBe(true);
    expect(result.failed_at).toBeUndefined();
    expect(result.asset_id).toBe('BTC');
    expect(result.tenant_id).toBe('tenant_001');
    expect(result.trace_id).toMatch(/^trace_/);
    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);

    const stageNames = result.stages.map((s) => s.stage);
    expect(stageNames).toContain('policy_check');
    expect(stageNames).toContain('score');
    expect(stageNames).toContain('fuse');
    expect(stageNames).toContain('explain');
    expect(stageNames).toContain('alert');
    expect(stageNames).toContain('snapshot');
  });

  it('produces valid fusion result', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    expect(result.fusion_result).toBeDefined();
    expect(result.fusion_result!.fused_score).toBeGreaterThan(0);
    expect(result.fusion_result!.fused_confidence).toBeGreaterThan(0);
    expect(result.fusion_result!.total_sources).toBe(3);
    expect(result.fusion_result!.source_contributions.length).toBe(3);
  });

  it('produces valid explanation with evidence refs', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    expect(result.explanation).toBeDefined();
    expect(result.explanation!.source_breakdowns.length).toBe(3);
    expect(result.explanation!.summary_narrative).toContain('BTC');
    expect(result.explanation!.invalidation_conditions.length).toBeGreaterThan(0);

    for (const bd of result.explanation!.source_breakdowns) {
      expect(bd.evidence_refs.length).toBeGreaterThan(0);
      expect(bd.narrative.length).toBeGreaterThan(10);
    }
  });

  it('triggers alert when score exceeds threshold', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: {
        onchain_evm: { sentiment: 0.95, volume: 5000, recency_hours: 0.5, evidence_refs: ['evm_strong'] },
        exchange_market_data: { sentiment: 0.9, volume: 10000, recency_hours: 0.5, evidence_refs: ['exch_strong'] },
      },
    }));

    expect(result.alert_output).toBeDefined();
    expect(result.alert_output!.evaluation.triggered).toBe(true);
    expect(result.alert_output!.dispatch).toBeDefined();
    expect(result.alert_output!.dispatch!.dispatched).toBe(true);
    expect(result.alert_output!.dispatch!.channels.length).toBeGreaterThan(0);
  });

  it('stores events in event store after execution', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    await pipeline.execute(makeInput());

    const store = pipeline.getEventStore();
    expect(store.totalEvents()).toBeGreaterThan(0);
    expect(store.streamExists('BTC')).toBe(true);
  });

  it('captures snapshot after execution', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    await pipeline.execute(makeInput());

    const store = pipeline.getSnapshotStore();
    expect(store.size()).toBeGreaterThan(0);
    const snaps = store.getByAsset('BTC');
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].snapshot_type).toBe('full_state');
  });

  it('single source pipeline succeeds', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: { onchain_evm: { sentiment: 0.8, volume: 300, recency_hours: 1 } },
    }));

    expect(result.overall_success).toBe(true);
    expect(result.fusion_result!.total_sources).toBe(1);
  });

  it('weak signal does NOT trigger alert', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: {
        onchain_evm: { sentiment: 0.1, volume: 10, recency_hours: 100 },
        licensed_news_rss: { sentiment: 0.05, volume: 5, recency_hours: 150 },
      },
    }));

    expect(result.overall_success).toBe(true);
    expect(result.alert_output!.evaluation.triggered).toBe(false);
  });

  it('multiple sequential executions for different assets', async () => {
    const pipeline = new SentinelPipeline(CONFIG);

    const btc = await pipeline.execute(makeInput({ asset_id: 'BTC' }));
    const eth = await pipeline.execute(makeInput({ asset_id: 'ETH' }));
    const sol = await pipeline.execute(makeInput({ asset_id: 'SOL' }));

    expect(btc.overall_success).toBe(true);
    expect(eth.overall_success).toBe(true);
    expect(sol.overall_success).toBe(true);

    expect(pipeline.getEventStore().streamCount()).toBe(3);
    expect(pipeline.getSnapshotStore().size()).toBe(3);
  });
});

describe('SentinelPipeline — Policy enforcement at boundaries', () => {
  it('BLOCKS pipeline when ALL sources are blocked', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: {
        telegram_public: { sentiment: 0.9, volume: 1000, recency_hours: 1 },
        discord_mining: { sentiment: 0.8, volume: 500, recency_hours: 2 },
      },
    }));

    expect(result.overall_success).toBe(false);
    expect(result.failed_at).toBe('policy_check');
    const policyStage = result.stages.find((s) => s.stage === 'policy_check');
    expect(policyStage!.success).toBe(false);
    expect(policyStage!.error!.code).toBe('SRC_POLICY_BLOCKED');
  });

  it('filters out blocked sources but continues with allowed ones', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: {
        onchain_evm: { sentiment: 0.7, volume: 200, recency_hours: 1 },
        telegram_public: { sentiment: 0.9, volume: 1000, recency_hours: 1 },
      },
    }));

    expect(result.overall_success).toBe(true);
    const policyOutput = result.stages.find((s) => s.stage === 'policy_check')!.output as any;
    expect(policyOutput.allowed).toContain('onchain_evm');
    expect(policyOutput.blocked).toContain('telegram_public');
    expect(result.fusion_result!.total_sources).toBe(1);
  });

  it('BLOCKS all 3 forbidden sources: telegram_public, discord_mining, tiktok_research', async () => {
    const pipeline = new SentinelPipeline(CONFIG);

    for (const blocked of ['telegram_public', 'discord_mining', 'tiktok_research']) {
      const result = await pipeline.execute(makeInput({
        source_data: { [blocked]: { sentiment: 0.5, volume: 100, recency_hours: 1 } },
      }));
      expect(result.overall_success).toBe(false);
      expect(result.failed_at).toBe('policy_check');
    }
  });

  it('conditional sources are blocked by default', async () => {
    const pipeline = new SentinelPipeline(CONFIG);

    for (const cond of ['x_twitter', 'reddit', 'youtube']) {
      const result = await pipeline.execute(makeInput({
        source_data: { [cond]: { sentiment: 0.5, volume: 100, recency_hours: 1 } },
      }));
      expect(result.overall_success).toBe(false);
    }
  });

  it('mixed allowed + conditional: only allowed sources processed', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: {
        onchain_evm: { sentiment: 0.6, volume: 200, recency_hours: 1 },
        x_twitter: { sentiment: 0.8, volume: 1000, recency_hours: 0.5 },
      },
    }));

    expect(result.overall_success).toBe(true);
    expect(result.fusion_result!.total_sources).toBe(1);
  });
});

describe('SentinelPipeline — Trace ID propagation', () => {
  it('all stages share the same root trace_id', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    const rootTraceId = result.trace_id;
    for (const stage of result.stages) {
      expect(stage.trace.trace_id).toBe(rootTraceId);
    }
  });

  it('each stage has a unique span_id', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    const spanIds = result.stages.map((s) => s.trace.span_id);
    const unique = new Set(spanIds);
    expect(unique.size).toBe(spanIds.length);
  });

  it('all stages have parent_span_id linking to root', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    const collector = pipeline.getTraceCollector();
    const allSpans = collector.getAll();
    expect(allSpans.length).toBeGreaterThan(result.stages.length);

    const rootSpan = allSpans.find((s) => !s.parent_span_id);
    expect(rootSpan).toBeDefined();

    for (const stage of result.stages) {
      expect(stage.trace.parent_span_id).toBe(rootSpan!.span_id);
    }
  });

  it('trace_id in alert output matches pipeline trace_id', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    if (result.alert_output) {
      expect(result.alert_output.trace_id).toBe(result.trace_id);
    }
  });

  it('each stage records duration_ms', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput());

    for (const stage of result.stages) {
      expect(stage.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('SentinelPipeline — Error taxonomy integration', () => {
  it('policy failure produces SRC_POLICY_BLOCKED error code', async () => {
    const pipeline = new SentinelPipeline(CONFIG);
    const result = await pipeline.execute(makeInput({
      source_data: { telegram_public: { sentiment: 0.5, volume: 100, recency_hours: 1 } },
    }));

    expect(result.stages[0].error).toBeDefined();
    expect(result.stages[0].error!.code).toBe('SRC_POLICY_BLOCKED');
    expect(result.stages[0].error!.category).toBe('SRC_POLICY');
    expect(result.stages[0].error!.retry_class).toBe('no_retry');
  });
});
