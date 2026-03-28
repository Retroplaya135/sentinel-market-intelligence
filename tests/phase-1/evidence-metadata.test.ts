import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { SignalOutputSchema, AlertOutputSchema } from '../../packages/shared-contracts/src/dto/index.js';
import { ClaimSchema } from '../../packages/shared-contracts/src/schemas/product-contract.schema.js';

function makeValidClaim() {
  return {
    claim_id: randomUUID(),
    evidence_ref: ['source:onchain_evm:tx:0xabc123', 'source:licensed_news:article:456'],
    confidence: 0.85,
    invalidation_rule: 'If BTC price moves >5% against direction within 6h',
    source_provenance: ['onchain_evm', 'licensed_news_rss'],
  };
}

function makeValidSignal() {
  return {
    signal_id: randomUUID(),
    asset_id: 'BTC',
    signal_type: 'now_score' as const,
    timestamp: new Date().toISOString(),
    value: 0.72,
    claim: makeValidClaim(),
    metadata: {
      trace_id: randomUUID(),
      source_ids: ['onchain_evm', 'licensed_news_rss'],
      model_version: 'sentiment_cascade_v1',
      latency_ms: 245,
    },
  };
}

describe('Evidence Metadata Presence — Every signal must include evidence metadata', () => {
  it('valid signal with complete claim passes validation', () => {
    const signal = makeValidSignal();
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(true);
  });

  it('REJECTS signal without claim_id', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.claim.claim_id;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal without evidence_ref', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.claim.evidence_ref;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal with empty evidence_ref array', () => {
    const signal = makeValidSignal();
    signal.claim.evidence_ref = [];
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal without confidence', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.claim.confidence;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal with confidence > 1.0', () => {
    const signal = makeValidSignal();
    signal.claim.confidence = 1.5;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal with confidence < 0.0', () => {
    const signal = makeValidSignal();
    signal.claim.confidence = -0.1;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal without invalidation_rule', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.claim.invalidation_rule;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal with empty invalidation_rule', () => {
    const signal = makeValidSignal();
    signal.claim.invalidation_rule = '';
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal without source_provenance', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.claim.source_provenance;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal with empty source_provenance', () => {
    const signal = makeValidSignal();
    signal.claim.source_provenance = [];
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });

  it('REJECTS signal without trace_id in metadata', () => {
    const signal = makeValidSignal();
    // @ts-expect-error — intentionally breaking the schema
    delete signal.metadata.trace_id;
    const result = SignalOutputSchema.safeParse(signal);
    expect(result.success).toBe(false);
  });
});

describe('Claim Schema Validation — Standalone claim integrity', () => {
  it('valid claim passes', () => {
    const claim = makeValidClaim();
    const result = ClaimSchema.safeParse(claim);
    expect(result.success).toBe(true);
  });

  it('REJECTS claim with non-UUID claim_id', () => {
    const claim = { ...makeValidClaim(), claim_id: 'not-a-uuid' };
    const result = ClaimSchema.safeParse(claim);
    expect(result.success).toBe(false);
  });

  it('REJECTS claim with zero evidence refs', () => {
    const claim = { ...makeValidClaim(), evidence_ref: [] };
    const result = ClaimSchema.safeParse(claim);
    expect(result.success).toBe(false);
  });
});

describe('Alert Output Validation — Alerts must include alert_details', () => {
  it('valid alert with all required fields passes', () => {
    const alert = {
      ...makeValidSignal(),
      signal_type: 'alert' as const,
      alert_details: {
        threshold_triggered: 'social_volume_spike > 3_sigma',
        expected_half_life_minutes: 120,
        invalidation_trigger: 'If volume normalizes within 2h',
        severity: 'high' as const,
      },
    };
    const result = AlertOutputSchema.safeParse(alert);
    expect(result.success).toBe(true);
  });

  it('REJECTS alert without alert_details', () => {
    const alert = {
      ...makeValidSignal(),
      signal_type: 'alert' as const,
    };
    const result = AlertOutputSchema.safeParse(alert);
    expect(result.success).toBe(false);
  });

  it('REJECTS alert without invalidation_trigger in alert_details', () => {
    const alert = {
      ...makeValidSignal(),
      signal_type: 'alert' as const,
      alert_details: {
        threshold_triggered: 'test',
        expected_half_life_minutes: 120,
        severity: 'high' as const,
      },
    };
    const result = AlertOutputSchema.safeParse(alert);
    expect(result.success).toBe(false);
  });
});
