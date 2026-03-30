import { describe, it, expect } from 'vitest';
import {
  ConnectorResultSchema, ConnectorMethodNames,
} from '../../packages/module-system/src/interfaces/connector.js';
import {
  ScoreResultSchema, CalibrationResultSchema, ScoreExplanationSchema, ScorerMethodNames,
} from '../../packages/module-system/src/interfaces/scorer.js';
import {
  ExplanationSchema, DecompositionSchema, InvalidationCheckResultSchema, ExplainerMethodNames,
} from '../../packages/module-system/src/interfaces/explainer.js';
import {
  AlertEvaluationSchema, AlertDispatchResultSchema, AlertInvalidationSchema, AlertStrategyMethodNames,
} from '../../packages/module-system/src/interfaces/alert-strategy.js';

describe('Connector Interface Contract', () => {
  it('ConnectorResult schema validates valid result', () => {
    const result = {
      success: true, records_count: 42, source_id: 'onchain_evm',
      request_id: 'req_001', timestamp: new Date().toISOString(), errors: [],
    };
    expect(ConnectorResultSchema.safeParse(result).success).toBe(true);
  });

  it('REJECTS ConnectorResult without source_id', () => {
    const result = { success: true, records_count: 0, request_id: 'req', timestamp: new Date().toISOString() };
    expect(ConnectorResultSchema.safeParse(result).success).toBe(false);
  });

  it('has all 6 required method names', () => {
    expect(ConnectorMethodNames).toEqual(['fetch', 'normalize', 'validate', 'persist', 'ack', 'delete_sync']);
  });
});

describe('Scorer Interface Contract', () => {
  it('ScoreResult validates valid score', () => {
    const result = {
      asset_id: 'BTC', score: 0.7, confidence: 0.85, model_version: 'v1',
      source_ids: ['onchain_evm'], timestamp: new Date().toISOString(), latency_ms: 120,
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(true);
  });

  it('REJECTS score outside [-1, 1]', () => {
    const result = {
      asset_id: 'BTC', score: 1.5, confidence: 0.5, model_version: 'v1',
      source_ids: ['x'], timestamp: new Date().toISOString(), latency_ms: 0,
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(false);
  });

  it('REJECTS confidence outside [0, 1]', () => {
    const result = {
      asset_id: 'BTC', score: 0.5, confidence: 1.1, model_version: 'v1',
      source_ids: ['x'], timestamp: new Date().toISOString(), latency_ms: 0,
    };
    expect(ScoreResultSchema.safeParse(result).success).toBe(false);
  });

  it('CalibrationResult validates', () => {
    const result = {
      model_version: 'v1', calibration_error: 0.03, sample_count: 1000,
      timestamp: new Date().toISOString(),
    };
    expect(CalibrationResultSchema.safeParse(result).success).toBe(true);
  });

  it('ScoreExplanation requires at least 1 factor', () => {
    const result = {
      asset_id: 'BTC', score: 0.5, factors: [], timestamp: new Date().toISOString(),
    };
    expect(ScoreExplanationSchema.safeParse(result).success).toBe(false);
  });

  it('has all 3 required method names', () => {
    expect(ScorerMethodNames).toEqual(['score', 'calibrate', 'explain_score']);
  });
});

describe('Explainer Interface Contract', () => {
  it('Explanation requires evidence with at least 1 entry', () => {
    const result = {
      signal_id: 's1', asset_id: 'BTC', summary: 'Test',
      evidence: [{ source_id: 'onchain_evm', evidence_ref: 'ref1', relevance: 0.9 }],
      confidence: 0.8, timestamp: new Date().toISOString(), latency_ms: 200,
    };
    expect(ExplanationSchema.safeParse(result).success).toBe(true);
  });

  it('REJECTS Explanation with empty evidence', () => {
    const result = {
      signal_id: 's1', asset_id: 'BTC', summary: 'Test', evidence: [],
      confidence: 0.8, timestamp: new Date().toISOString(), latency_ms: 200,
    };
    expect(ExplanationSchema.safeParse(result).success).toBe(false);
  });

  it('InvalidationCheckResult validates', () => {
    const result = {
      signal_id: 's1', is_invalidated: false,
      checked_at: new Date().toISOString(), invalidation_rule: 'price_move_5pct',
    };
    expect(InvalidationCheckResultSchema.safeParse(result).success).toBe(true);
  });

  it('has all 3 required method names', () => {
    expect(ExplainerMethodNames).toEqual(['explain', 'decompose', 'invalidation_check']);
  });
});

describe('AlertStrategy Interface Contract', () => {
  it('AlertEvaluation validates valid alert', () => {
    const result = {
      alert_id: 'a1', asset_id: 'BTC', triggered: true, severity: 'high',
      threshold_triggered: 'volume_spike', confidence: 0.9,
      expected_half_life_minutes: 120, invalidation_trigger: 'volume_normalize',
      evidence_refs: ['ref1', 'ref2'], timestamp: new Date().toISOString(),
    };
    expect(AlertEvaluationSchema.safeParse(result).success).toBe(true);
  });

  it('REJECTS AlertEvaluation with empty evidence_refs', () => {
    const result = {
      alert_id: 'a1', asset_id: 'BTC', triggered: true, severity: 'high',
      threshold_triggered: 'test', confidence: 0.9,
      expected_half_life_minutes: 120, invalidation_trigger: 'test',
      evidence_refs: [], timestamp: new Date().toISOString(),
    };
    expect(AlertEvaluationSchema.safeParse(result).success).toBe(false);
  });

  it('AlertDispatchResult validates', () => {
    const result = {
      alert_id: 'a1', dispatched: true, channels: ['push', 'email'],
      dispatched_at: new Date().toISOString(), tenant_id: 'tenant_001',
    };
    expect(AlertDispatchResultSchema.safeParse(result).success).toBe(true);
  });

  it('has all 3 required method names', () => {
    expect(AlertStrategyMethodNames).toEqual(['evaluate', 'dispatch', 'invalidate']);
  });
});
