import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyService } from '../../packages/policy-engine/src/service/policy-service.js';
import { InMemoryEventBus } from '../../packages/module-system/src/events/event-bus.js';
import { BLOCKED_SOURCE_IDS } from '../../packages/policy-engine/src/blocked-sources/guards.js';
import { CONDITIONAL_SOURCE_IDS } from '../../packages/policy-engine/src/conditional-gates/gates.js';

describe('Policy Service — Full integration flow', () => {
  let service: PolicyService;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    service = new PolicyService({ eventBus: bus });
  });

  describe('Blocked sources are rejected', () => {
    for (const id of BLOCKED_SOURCE_IDS) {
      it(`REJECTS ingest on blocked source: ${id}`, async () => {
        const result = await service.checkPolicy({
          source_id: id,
          action: 'ingest',
          actor_id: 'test_actor',
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('blocked');
      });

      it(`REJECTS query on blocked source: ${id}`, async () => {
        const result = await service.checkPolicy({
          source_id: id,
          action: 'query',
          actor_id: 'test_actor',
        });
        expect(result.allowed).toBe(false);
      });
    }
  });

  describe('Allowed sources pass through', () => {
    const allowedSources = ['onchain_evm', 'onchain_solana', 'exchange_market_data', 'licensed_news_rss', 'first_party'];
    for (const id of allowedSources) {
      it(`ALLOWS ingest on: ${id}`, async () => {
        const result = await service.checkPolicy({
          source_id: id,
          action: 'ingest',
          actor_id: 'test_actor',
        });
        expect(result.allowed).toBe(true);
      });
    }
  });

  describe('Conditional sources are rejected by default', () => {
    for (const id of CONDITIONAL_SOURCE_IDS) {
      it(`REJECTS ingest on inactive conditional source: ${id}`, async () => {
        const result = await service.checkPolicy({
          source_id: id,
          action: 'ingest',
          actor_id: 'test_actor',
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('missing requirements');
      });
    }
  });

  describe('Conditional sources allowed after activation', () => {
    it('allows X after full activation', async () => {
      service.getConditionalGates().activate('x_twitter', {
        commercial_agreement_verified: true,
        legal_review_complete: true,
        actor_id: 'admin',
      });
      const result = await service.checkPolicy({
        source_id: 'x_twitter',
        action: 'ingest',
        actor_id: 'test_actor',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('Blocked source with valid exception override', () => {
    it('allows blocked source when consent_scoped_override is active', async () => {
      service.getExceptionRegistry().grant({
        override_id: 'exc_test',
        source_id: 'telegram_public',
        legal_approval: true,
        approved_by: 'counsel',
        approved_at: new Date().toISOString(),
        expiry_date: new Date(Date.now() + 86400000).toISOString(),
        scope_description: 'Scoped consent test',
        conditions: ['Test only'],
        two_person_review: { reviewer_1: 'r1', reviewer_2: 'r2' },
      });

      const result = await service.checkPolicy({
        source_id: 'telegram_public',
        action: 'ingest',
        actor_id: 'test_actor',
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('consent_scoped_override');
    });
  });

  describe('Blocked source attempt emits SecurityEvent', () => {
    it('emits security event on blocked source attempt', async () => {
      const events: unknown[] = [];
      bus.subscribe('security_event', (e) => { events.push(e); });

      await service.checkPolicy({
        source_id: 'telegram_public',
        action: 'ingest',
        actor_id: 'bad_actor',
      });

      expect(events.length).toBe(1);
      const evt = events[0] as Record<string, unknown>;
      expect(evt['event_type']).toBe('security_event');
      const payload = evt['payload'] as Record<string, unknown>;
      expect(payload['severity']).toBe('critical');
      expect(payload['category']).toBe('blocked_source_attempt');
      expect(payload['details']).toContain('telegram_public');
    });

    it('does NOT emit security event for allowed sources', async () => {
      const events: unknown[] = [];
      bus.subscribe('security_event', (e) => { events.push(e); });

      await service.checkPolicy({
        source_id: 'onchain_evm',
        action: 'ingest',
        actor_id: 'good_actor',
      });

      expect(events.length).toBe(0);
    });
  });

  describe('Training gate integration', () => {
    it('BLOCKS training with blocked sources', () => {
      const decision = service.checkTraining({
        job_id: 'train_001',
        model_id: 'test_model',
        source_ids: ['onchain_evm', 'telegram_public'],
        dataset_id: 'ds_001',
        requested_by: 'ml_eng',
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(false);
    });

    it('ALLOWS training with clean sources', () => {
      const decision = service.checkTraining({
        job_id: 'train_002',
        model_id: 'test_model',
        source_ids: ['onchain_evm', 'licensed_news_rss'],
        dataset_id: 'ds_002',
        requested_by: 'ml_eng',
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(true);
    });
  });

  describe('Audit trail', () => {
    it('records all policy check decisions', async () => {
      await service.checkPolicy({ source_id: 'onchain_evm', action: 'ingest', actor_id: 'a1' });
      await service.checkPolicy({ source_id: 'telegram_public', action: 'ingest', actor_id: 'a2' });

      const trail = service.getAuditTrail();
      expect(trail.length).toBe(2);
      expect(trail[0].result).toBe('ALLOWED');
      expect(trail[1].result).toBe('BLOCKED');
    });

    it('audit trail is immutable', async () => {
      await service.checkPolicy({ source_id: 'onchain_evm', action: 'ingest', actor_id: 'a1' });
      const trail = service.getAuditTrail();
      expect(() => { (trail as any).push('fake'); }).toThrow();
    });
  });

  describe('Retention enforcement integration', () => {
    it('checks retention window through service', () => {
      const result = service.checkRetention({
        source_id: 'x_twitter',
        record_timestamp: new Date(Date.now() - 48 * 3600000).toISOString(),
        retention_class: 'time_bound',
        window_hours: 24,
      });
      expect(result.expired).toBe(true);
    });

    it('creates deletion proof through service', () => {
      const proof = service.createDeletionProof({
        source_id: 'x_twitter',
        actor_id: 'retention_job',
        dataset_description: 'Expired X content',
        rule_id: 'x_24h_sync_delete',
        method: 'hard_delete',
        count_before: 500,
        count_after: 0,
      });
      expect(proof.proof_id).toBeTruthy();
      expect(proof.hash_proof).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
