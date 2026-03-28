import { describe, it, expect } from 'vitest';
import {
  checkSourcePolicy,
  checkTrainingRights,
} from '../../packages/shared-contracts/src/policy/index.js';
import {
  BLOCKED_SOURCE_IDS,
  CONDITIONAL_SOURCE_IDS,
  ALLOWED_SOURCE_IDS,
} from '../../packages/shared-contracts/src/schemas/source-policy.schema.js';

describe('Blocked Source Enforcement — Tests that FAIL if blocked sources are enabled', () => {
  for (const sourceId of BLOCKED_SOURCE_IDS) {
    it(`BLOCKS ${sourceId} — policy check must reject`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'blocked',
        is_enabled: false,
        commercial_agreement_verified: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.policy_mode).toBe('blocked');
    });

    it(`BLOCKS ${sourceId} — even if someone tries to enable it`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'blocked',
        is_enabled: true,
        commercial_agreement_verified: true,
      });
      expect(result.allowed).toBe(false);
    });

    it(`BLOCKS ${sourceId} training — no model training on blocked sources`, () => {
      const result = checkTrainingRights({
        source_id: sourceId,
        policy_mode: 'blocked',
        training_allowed: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('BLOCKED');
    });
  }
});

describe('Conditional Source Enforcement — Tests that conditional sources are disabled-by-default', () => {
  for (const sourceId of CONDITIONAL_SOURCE_IDS) {
    it(`${sourceId} is REJECTED when disabled (default state)`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'conditional',
        is_enabled: false,
        commercial_agreement_verified: false,
      });
      expect(result.allowed).toBe(false);
    });

    it(`${sourceId} is REJECTED when enabled but agreement not verified`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'conditional',
        is_enabled: true,
        commercial_agreement_verified: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('commercial_agreement_verified');
    });

    it(`${sourceId} is ALLOWED only when enabled AND agreement verified`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'conditional',
        is_enabled: true,
        commercial_agreement_verified: true,
      });
      expect(result.allowed).toBe(true);
    });

    it(`${sourceId} training is BLOCKED — no foundation model training on conditional sources`, () => {
      const result = checkTrainingRights({
        source_id: sourceId,
        policy_mode: 'conditional',
        training_allowed: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('BLOCKED');
    });
  }
});

describe('Allowed Source Enforcement — Tests that allowed sources work correctly', () => {
  for (const sourceId of ALLOWED_SOURCE_IDS) {
    it(`${sourceId} is ALLOWED by policy`, () => {
      const result = checkSourcePolicy({
        source_id: sourceId,
        policy_mode: 'allow',
        is_enabled: true,
        commercial_agreement_verified: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.policy_mode).toBe('allow');
    });
  }
});

describe('Training Rights Enforcement — No restricted-source training paths', () => {
  it('training allowed for sources with explicit training=true', () => {
    const result = checkTrainingRights({
      source_id: 'onchain_evm',
      policy_mode: 'allow',
      training_allowed: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('training blocked for sources with training=false', () => {
    const result = checkTrainingRights({
      source_id: 'licensed_news_rss',
      policy_mode: 'allow',
      training_allowed: false,
    });
    expect(result.allowed).toBe(false);
  });

  it('training conditional when training requires license check', () => {
    const result = checkTrainingRights({
      source_id: 'licensed_news_rss',
      policy_mode: 'allow',
      training_allowed: 'per_license_terms',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('CONDITIONAL');
    expect(result.reason).toContain('per_license_terms');
  });

  it('training blocked for ALL blocked sources regardless of training flag', () => {
    for (const sourceId of BLOCKED_SOURCE_IDS) {
      const result = checkTrainingRights({
        source_id: sourceId,
        policy_mode: 'blocked',
        training_allowed: true,
      });
      expect(result.allowed).toBe(false);
    }
  });

  it('training blocked for ALL conditional sources regardless of training flag', () => {
    for (const sourceId of CONDITIONAL_SOURCE_IDS) {
      const result = checkTrainingRights({
        source_id: sourceId,
        policy_mode: 'conditional',
        training_allowed: true,
      });
      expect(result.allowed).toBe(false);
    }
  });
});
