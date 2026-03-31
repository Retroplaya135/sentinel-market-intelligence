import { describe, it, expect } from 'vitest';
import { evaluateTrainingGate } from '../../packages/policy-engine/src/training-gate/gate.js';
import { BLOCKED_SOURCE_IDS } from '../../packages/policy-engine/src/blocked-sources/guards.js';
import { CONDITIONAL_SOURCE_IDS } from '../../packages/policy-engine/src/conditional-gates/gates.js';

function makeTrainingRequest(source_ids: string[]) {
  return {
    job_id: 'train_001',
    model_id: 'sentiment_cascade_v4',
    source_ids,
    dataset_id: 'ds_001',
    requested_by: 'ml_engineer',
    timestamp: new Date().toISOString(),
  };
}

describe('Pre-Training Gate — Blocks restricted-source training', () => {
  it('ALLOWS training on rights-clean sources', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest(['onchain_evm', 'onchain_solana', 'exchange_market_data']));
    expect(decision.allowed).toBe(true);
    expect(decision.blocked_sources.length).toBe(0);
    expect(decision.conditional_sources.length).toBe(0);
  });

  it('BLOCKS training that includes ANY blocked source', () => {
    for (const blocked of BLOCKED_SOURCE_IDS) {
      const decision = evaluateTrainingGate(makeTrainingRequest(['onchain_evm', blocked]));
      expect(decision.allowed, `Training with ${blocked} must be blocked`).toBe(false);
      expect(decision.blocked_sources).toContain(blocked);
      expect(decision.reason).toContain('REJECTED');
    }
  });

  it('BLOCKS training that includes ANY conditional source', () => {
    for (const cond of CONDITIONAL_SOURCE_IDS) {
      const decision = evaluateTrainingGate(makeTrainingRequest(['onchain_evm', cond]));
      expect(decision.allowed, `Training with ${cond} must be blocked`).toBe(false);
      expect(decision.conditional_sources).toContain(cond);
      expect(decision.reason).toContain('REJECTED');
    }
  });

  it('BLOCKS training with mixed blocked + conditional sources', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest([
      'onchain_evm', 'telegram_public', 'x_twitter',
    ]));
    expect(decision.allowed).toBe(false);
    expect(decision.blocked_sources).toContain('telegram_public');
    expect(decision.conditional_sources).toContain('x_twitter');
  });

  it('BLOCKS training on ONLY blocked sources', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest(['telegram_public', 'discord_mining']));
    expect(decision.allowed).toBe(false);
    expect(decision.blocked_sources.length).toBe(2);
  });

  it('reports all violations in the reason message', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest([
      'telegram_public', 'discord_mining', 'tiktok_research', 'x_twitter', 'reddit',
    ]));
    expect(decision.allowed).toBe(false);
    expect(decision.blocked_sources.length).toBe(3);
    expect(decision.conditional_sources.length).toBe(2);
    expect(decision.reason).toContain('foundation model training');
  });

  it('ALLOWS training on first-party + licensed news + on-chain', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest([
      'first_party', 'licensed_news_rss', 'onchain_evm',
    ]));
    expect(decision.allowed).toBe(true);
  });

  it('includes timestamp in decision', () => {
    const decision = evaluateTrainingGate(makeTrainingRequest(['onchain_evm']));
    expect(decision.timestamp).toBeTruthy();
  });
});
