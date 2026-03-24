import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../../packages/data-layer/src/event-store/store.js';
import { InMemorySnapshotStore } from '../../packages/data-layer/src/snapshot/store.js';
import { ReplayEngine } from '../../packages/replay/src/engine/replay-engine.js';
import { ReplayAuditProofGenerator, ReplayComparisonEngine } from '../../packages/replay/src/audit/proof.js';

describe('ReplayEngine — Deterministic replay', () => {
  let eventStore: InMemoryEventStore;
  let snapshotStore: InMemorySnapshotStore;
  let engine: ReplayEngine;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    snapshotStore = new InMemorySnapshotStore();
    engine = new ReplayEngine(eventStore, snapshotStore);
  });

  it('replays all events in stream order', async () => {
    eventStore.append('btc', 'score', { score: 0.5 }, { trace_id: 't1', source_id: 's1' });
    eventStore.append('btc', 'fuse', { fused: 0.6 }, { trace_id: 't1', source_id: 's1' });
    eventStore.append('btc', 'alert', { triggered: true }, { trace_id: 't1', source_id: 's1' });

    const result = await engine.replay({
      replay_id: 'rep_001', stream_id: 'btc', from_sequence: 0, to_sequence: 2,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (event) => event.payload);

    expect(result.total_events).toBe(3);
    expect(result.replayed_events).toBe(3);
    expect(result.matching_events).toBe(3);
    expect(result.divergent_events).toBe(0);
    expect(result.deterministic).toBe(true);
  });

  it('detects divergent replay when handler returns different result', async () => {
    eventStore.append('btc', 'score', { score: 0.5 }, { trace_id: 't1', source_id: 's1' });
    eventStore.append('btc', 'score', { score: 0.6 }, { trace_id: 't1', source_id: 's1' });

    const result = await engine.replay({
      replay_id: 'rep_002', stream_id: 'btc', from_sequence: 0, to_sequence: 1,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, () => ({ score: 0.99 }));

    expect(result.deterministic).toBe(false);
    expect(result.divergent_events).toBe(2);
  });

  it('computes deviation for numeric differences', async () => {
    eventStore.append('btc', 'score', { score: 0.5 }, { trace_id: 't1', source_id: 's1' });

    const result = await engine.replay({
      replay_id: 'rep_003', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, () => ({ score: 0.55 }));

    expect(result.steps[0].deviation).toBeCloseTo(0.05, 2);
  });

  it('handles handler errors gracefully', async () => {
    eventStore.append('btc', 'score', { score: 0.5 }, { trace_id: 't1', source_id: 's1' });

    const result = await engine.replay({
      replay_id: 'rep_004', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, () => { throw new Error('Handler crash'); });

    expect(result.replayed_events).toBe(1);
    expect(result.divergent_events).toBe(1);
    expect(result.steps[0].matches_original).toBe(false);
  });

  it('empty stream produces empty result', async () => {
    const result = await engine.replay({
      replay_id: 'rep_005', stream_id: 'empty', from_sequence: 0, to_sequence: 0,
      asset_id: 'X', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    expect(result.total_events).toBe(0);
    expect(result.deterministic).toBe(true);
  });

  it('range filtering works correctly', async () => {
    for (let i = 0; i < 10; i++) {
      eventStore.append('btc', 'tick', { i }, { trace_id: 't1', source_id: 's1' });
    }

    const result = await engine.replay({
      replay_id: 'rep_006', stream_id: 'btc', from_sequence: 3, to_sequence: 5,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    expect(result.total_events).toBe(3);
    expect(result.steps[0].sequence_number).toBe(3);
    expect(result.steps[2].sequence_number).toBe(5);
  });

  it('records step duration for each event', async () => {
    eventStore.append('btc', 'score', { s: 1 }, { trace_id: 't1', source_id: 's1' });
    const result = await engine.replay({
      replay_id: 'rep_007', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    expect(result.steps[0].step_duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('ReplayEngine — Point-in-time reconstruction', () => {
  let eventStore: InMemoryEventStore;
  let snapshotStore: InMemorySnapshotStore;
  let engine: ReplayEngine;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    snapshotStore = new InMemorySnapshotStore();
    engine = new ReplayEngine(eventStore, snapshotStore);
  });

  it('reconstructs state from snapshot + subsequent events', () => {
    for (let i = 0; i < 5; i++) {
      eventStore.append('btc', 'tick', { i }, { trace_id: 't', source_id: 's' });
    }

    snapshotStore.capture({
      asset_id: 'btc', snapshot_type: 'score', data: { snapshot_state: true },
      source_ids: ['evm'], model_version: 'v1', event_sequence: 2, metadata: {},
    });

    const state = engine.reconstructState('btc', 4);
    expect(state.snapshot).toBeDefined();
    expect(state.snapshot!.event_sequence).toBe(2);
    expect(state.events.length).toBe(2);
  });

  it('reconstructs from beginning when no snapshot exists', () => {
    for (let i = 0; i < 3; i++) {
      eventStore.append('eth', 'tick', { i }, { trace_id: 't', source_id: 's' });
    }

    const state = engine.reconstructState('eth', 2);
    expect(state.snapshot).toBeUndefined();
    expect(state.events.length).toBe(3);
  });
});

describe('ReplayAuditProofGenerator', () => {
  let eventStore: InMemoryEventStore;
  let engine: ReplayEngine;
  const proofGen = new ReplayAuditProofGenerator();

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    engine = new ReplayEngine(eventStore);
  });

  it('generates valid audit proof with hash chain', async () => {
    eventStore.append('btc', 'a', { x: 1 }, { trace_id: 't', source_id: 's' });
    eventStore.append('btc', 'b', { x: 2 }, { trace_id: 't', source_id: 's' });

    const result = await engine.replay({
      replay_id: 'rep_p1', stream_id: 'btc', from_sequence: 0, to_sequence: 1,
      asset_id: 'BTC', requested_by: 'auditor', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    const proof = proofGen.generateProof(result, 'auditor');
    expect(proof.proof_id).toMatch(/^rproof_/);
    expect(proof.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.step_hashes.length).toBe(2);
    expect(proof.deterministic).toBe(true);
    expect(proof.matching_ratio).toBe(1);
    expect(proof.chain_valid).toBe(true);
  });

  it('verifyProof returns true for untampered results', async () => {
    eventStore.append('btc', 'a', { x: 1 }, { trace_id: 't', source_id: 's' });
    const result = await engine.replay({
      replay_id: 'rep_p2', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'aud', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    const proof = proofGen.generateProof(result, 'aud');
    expect(proofGen.verifyProof(proof, result)).toBe(true);
  });

  it('matching_ratio reflects divergence correctly', async () => {
    eventStore.append('btc', 'a', { x: 1 }, { trace_id: 't', source_id: 's' });
    eventStore.append('btc', 'b', { x: 2 }, { trace_id: 't', source_id: 's' });

    const result = await engine.replay({
      replay_id: 'rep_p3', stream_id: 'btc', from_sequence: 0, to_sequence: 1,
      asset_id: 'BTC', requested_by: 'aud', requested_at: new Date().toISOString(),
    }, (e) => {
      const p = e.payload as Record<string, unknown>;
      return p.x === 1 ? p : { x: 99 };
    });

    const proof = proofGen.generateProof(result, 'aud');
    expect(proof.matching_ratio).toBe(0.5);
    expect(proof.deterministic).toBe(false);
  });
});

describe('ReplayComparisonEngine', () => {
  const compEngine = new ReplayComparisonEngine();

  it('detects matching original and replayed results', async () => {
    const eventStore = new InMemoryEventStore();
    eventStore.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    const replayEngine = new ReplayEngine(eventStore);
    const result = await replayEngine.replay({
      replay_id: 'cmp1', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    const comparison = compEngine.compare(result,
      { score: 0.5, alert_triggered: true, explanation_summary: 'bullish' },
      { score: 0.5, alert_triggered: true, explanation_summary: 'bullish' },
    );
    expect(comparison.overall_match).toBe(true);
    expect(comparison.score_deviation).toBe(0);
    expect(comparison.score_direction_match).toBe(true);
    expect(comparison.alert_match).toBe(true);
  });

  it('detects score divergence', async () => {
    const eventStore = new InMemoryEventStore();
    eventStore.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    const replayEngine = new ReplayEngine(eventStore);
    const result = await replayEngine.replay({
      replay_id: 'cmp2', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    const comparison = compEngine.compare(result,
      { score: 0.5, alert_triggered: true },
      { score: -0.3, alert_triggered: false },
    );
    expect(comparison.overall_match).toBe(false);
    expect(comparison.score_direction_match).toBe(false);
    expect(comparison.alert_match).toBe(false);
    expect(comparison.score_deviation).toBeGreaterThan(0.5);
  });

  it('comparison details track each metric', async () => {
    const eventStore = new InMemoryEventStore();
    eventStore.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    const replayEngine = new ReplayEngine(eventStore);
    const result = await replayEngine.replay({
      replay_id: 'cmp3', stream_id: 'btc', from_sequence: 0, to_sequence: 0,
      asset_id: 'BTC', requested_by: 'test', requested_at: new Date().toISOString(),
    }, (e) => e.payload);

    const comparison = compEngine.compare(result,
      { score: 0.5, alert_triggered: true, explanation_summary: 'test' },
      { score: 0.5, alert_triggered: true, explanation_summary: 'different' },
    );
    expect(comparison.details.length).toBe(3);
    expect(comparison.explanation_match).toBe(false);
  });
});
