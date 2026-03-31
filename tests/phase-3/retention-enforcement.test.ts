import { describe, it, expect } from 'vitest';
import {
  checkRetentionWindow,
  generateDeletionProof,
  DeletionProofSchema,
} from '../../packages/policy-engine/src/retention/enforcement.js';

describe('Retention Window Enforcement', () => {
  it('unlimited retention is never expired', () => {
    const result = checkRetentionWindow({
      source_id: 'onchain_evm',
      record_timestamp: new Date(Date.now() - 365 * 24 * 3600000).toISOString(),
      retention_class: 'unlimited',
    });
    expect(result.expired).toBe(false);
  });

  it('on_request retention is not time-expired', () => {
    const result = checkRetentionWindow({
      source_id: 'first_party',
      record_timestamp: new Date(Date.now() - 365 * 24 * 3600000).toISOString(),
      retention_class: 'on_request',
    });
    expect(result.expired).toBe(false);
  });

  it('time_bound record within window is not expired', () => {
    const result = checkRetentionWindow({
      source_id: 'x_twitter',
      record_timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
      retention_class: 'time_bound',
      window_hours: 24,
    });
    expect(result.expired).toBe(false);
  });

  it('time_bound record past window IS expired', () => {
    const result = checkRetentionWindow({
      source_id: 'x_twitter',
      record_timestamp: new Date(Date.now() - 48 * 3600000).toISOString(),
      retention_class: 'time_bound',
      window_hours: 24,
    });
    expect(result.expired).toBe(true);
    expect(result.reason).toContain('expired');
  });

  it('time_bound with window_days works', () => {
    const result = checkRetentionWindow({
      source_id: 'exchange_market_data',
      record_timestamp: new Date(Date.now() - 100 * 24 * 3600000).toISOString(),
      retention_class: 'time_bound',
      window_days: 90,
    });
    expect(result.expired).toBe(true);
  });

  it('refresh_cycle with no window specified is not expired', () => {
    const result = checkRetentionWindow({
      source_id: 'youtube',
      record_timestamp: new Date().toISOString(),
      retention_class: 'refresh_cycle',
    });
    expect(result.expired).toBe(false);
  });

  it('includes checked_at timestamp', () => {
    const result = checkRetentionWindow({
      source_id: 'onchain_evm',
      record_timestamp: new Date().toISOString(),
      retention_class: 'unlimited',
    });
    expect(result.checked_at).toBeTruthy();
  });
});

describe('Deletion Proof Generator', () => {
  it('generates a valid deletion proof', () => {
    const proof = generateDeletionProof({
      source_id: 'x_twitter',
      actor_id: 'retention_job_001',
      dataset_description: 'X content older than 24h',
      rule_id: 'x_24h_sync_delete',
      method: 'hard_delete',
      count_before: 1000,
      count_after: 0,
    });

    expect(proof.proof_id).toBeTruthy();
    expect(proof.source_id).toBe('x_twitter');
    expect(proof.method).toBe('hard_delete');
    expect(proof.count_before).toBe(1000);
    expect(proof.count_after).toBe(0);
    expect(proof.hash_proof).toMatch(/^[a-f0-9]{64}$/);

    const validation = DeletionProofSchema.safeParse(proof);
    expect(validation.success).toBe(true);
  });

  it('different inputs produce different hash proofs', () => {
    const proof1 = generateDeletionProof({
      source_id: 'x_twitter', actor_id: 'job1', dataset_description: 'batch1',
      rule_id: 'r1', method: 'hard_delete', count_before: 100, count_after: 0,
    });
    const proof2 = generateDeletionProof({
      source_id: 'reddit', actor_id: 'job2', dataset_description: 'batch2',
      rule_id: 'r2', method: 'tombstone', count_before: 50, count_after: 0,
    });
    expect(proof1.hash_proof).not.toBe(proof2.hash_proof);
  });

  it('supports all deletion methods', () => {
    for (const method of ['hard_delete', 'crypto_shred', 'tombstone'] as const) {
      const proof = generateDeletionProof({
        source_id: 'test', actor_id: 'actor', dataset_description: 'test',
        rule_id: 'rule', method, count_before: 10, count_after: 0,
      });
      expect(proof.method).toBe(method);
    }
  });
});
