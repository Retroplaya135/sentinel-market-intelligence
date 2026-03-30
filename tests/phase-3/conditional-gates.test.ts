import { describe, it, expect, beforeEach } from 'vitest';
import { ConditionalSourceGateService, CONDITIONAL_SOURCE_IDS } from '../../packages/policy-engine/src/conditional-gates/gates.js';

describe('Conditional Source Gates — X/Reddit/YouTube disabled-by-default', () => {
  let gates: ConditionalSourceGateService;

  beforeEach(() => {
    gates = new ConditionalSourceGateService();
  });

  it('all conditional sources are disabled by default', () => {
    for (const id of CONDITIONAL_SOURCE_IDS) {
      const state = gates.getState(id);
      expect(state?.enabled, `${id} must be disabled by default`).toBe(false);
      expect(state?.commercial_agreement_verified).toBe(false);
      expect(state?.legal_review_complete).toBe(false);
    }
  });

  it('check REJECTS disabled conditional source', () => {
    for (const id of CONDITIONAL_SOURCE_IDS) {
      const result = gates.check(id);
      expect(result.allowed, `${id} must be rejected when disabled`).toBe(false);
      expect(result.missing_requirements.length).toBeGreaterThan(0);
    }
  });

  it('check allows non-conditional sources', () => {
    const result = gates.check('onchain_evm');
    expect(result.allowed).toBe(true);
  });

  it('activate requires commercial_agreement_verified', () => {
    expect(() => gates.activate('x_twitter', {
      commercial_agreement_verified: false,
      legal_review_complete: true,
      actor_id: 'admin',
    })).toThrow('commercial_agreement_verified');
  });

  it('activate requires legal_review_complete', () => {
    expect(() => gates.activate('x_twitter', {
      commercial_agreement_verified: true,
      legal_review_complete: false,
      actor_id: 'admin',
    })).toThrow('legal_review_complete');
  });

  it('activate succeeds with all requirements met', () => {
    const state = gates.activate('x_twitter', {
      commercial_agreement_verified: true,
      legal_review_complete: true,
      actor_id: 'admin_001',
    });
    expect(state.enabled).toBe(true);
    expect(state.commercial_agreement_verified).toBe(true);
    expect(state.activated_by).toBe('admin_001');
  });

  it('check allows activated conditional source', () => {
    gates.activate('reddit', {
      commercial_agreement_verified: true,
      legal_review_complete: true,
      actor_id: 'admin',
    });
    const result = gates.check('reddit');
    expect(result.allowed).toBe(true);
    expect(result.missing_requirements.length).toBe(0);
  });

  it('deactivate disables an active source', () => {
    gates.activate('youtube', {
      commercial_agreement_verified: true,
      legal_review_complete: true,
      actor_id: 'admin',
    });
    gates.deactivate('youtube');
    const result = gates.check('youtube');
    expect(result.allowed).toBe(false);
  });

  it('listAll returns all 3 conditional source states', () => {
    const all = gates.listAll();
    expect(all.length).toBe(3);
  });

  it('THROWS on activate unknown source', () => {
    expect(() => gates.activate('nonexistent', {
      commercial_agreement_verified: true,
      legal_review_complete: true,
      actor_id: 'admin',
    })).toThrow('Unknown');
  });
});

describe('Conditional Source Gates — Query budget calculator', () => {
  let gates: ConditionalSourceGateService;

  beforeEach(() => {
    gates = new ConditionalSourceGateService();
  });

  it('allows query within budget', () => {
    const result = gates.checkQueryBudget({
      source_id: 'x_twitter',
      tenant_id: 'tenant_001',
      estimated_cost: 5,
      budget_remaining: 100,
    });
    expect(result.allowed).toBe(true);
  });

  it('REJECTS query exceeding budget', () => {
    const result = gates.checkQueryBudget({
      source_id: 'x_twitter',
      tenant_id: 'tenant_001',
      estimated_cost: 150,
      budget_remaining: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeded');
  });
});
