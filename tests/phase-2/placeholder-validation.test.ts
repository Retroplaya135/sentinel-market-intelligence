import { describe, it, expect } from 'vitest';
import {
  PlaceholderValidator,
  typeCheck,
  validateSecretRef,
  rejectPlaintextSecret,
  safeRangeCheck,
} from '../../packages/placeholder-engine/src/validation/validator.js';
import type { Placeholder } from '../../packages/placeholder-engine/src/registry/schema.js';

describe('Placeholder Validation — typeCheck', () => {
  it('string type validates string value', () => {
    expect(typeCheck('hello', 'string').valid).toBe(true);
  });

  it('string type rejects number value', () => {
    expect(typeCheck(42, 'string').valid).toBe(false);
  });

  it('number type validates number value', () => {
    expect(typeCheck(3.14, 'number').valid).toBe(true);
  });

  it('number type rejects NaN', () => {
    expect(typeCheck(NaN, 'number').valid).toBe(false);
  });

  it('boolean type validates boolean value', () => {
    expect(typeCheck(true, 'boolean').valid).toBe(true);
    expect(typeCheck(false, 'boolean').valid).toBe(true);
  });

  it('json type validates object value', () => {
    expect(typeCheck({ key: 'val' }, 'json').valid).toBe(true);
  });

  it('json type rejects null', () => {
    expect(typeCheck(null, 'json').valid).toBe(false);
  });
});

describe('Placeholder Validation — Secret Reference', () => {
  it('valid secret_ref passes', () => {
    expect(validateSecretRef('secret://vault/api_keys/stripe_key_v1').valid).toBe(true);
  });

  it('REJECTS non-string secret_ref', () => {
    expect(validateSecretRef(42).valid).toBe(false);
  });

  it('REJECTS secret_ref without prefix', () => {
    expect(validateSecretRef('vault/api_keys/stripe').valid).toBe(false);
  });

  it('REJECTS too-short secret_ref', () => {
    expect(validateSecretRef('secret://x').valid).toBe(false);
  });
});

describe('Placeholder Validation — Plaintext Secret Rejection', () => {
  it('rejects values that look like API keys', () => {
    expect(rejectPlaintextSecret('sk-1234567890abcdef').valid).toBe(false);
    expect(rejectPlaintextSecret('api_key_production_abc').valid).toBe(false);
    expect(rejectPlaintextSecret('token_live_xyz').valid).toBe(false);
    expect(rejectPlaintextSecret('secret_key_main').valid).toBe(false);
  });

  it('allows normal string values', () => {
    expect(rejectPlaintextSecret('Hello world').valid).toBe(true);
    expect(rejectPlaintextSecret('fusion.weight.social').valid).toBe(true);
    expect(rejectPlaintextSecret('0.35').valid).toBe(true);
  });

  it('allows non-string values', () => {
    expect(rejectPlaintextSecret(42).valid).toBe(true);
    expect(rejectPlaintextSecret(true).valid).toBe(true);
  });
});

describe('Placeholder Validation — Safe Range', () => {
  it('value within range passes', () => {
    expect(safeRangeCheck(0.5, { min: 0, max: 1 }).valid).toBe(true);
  });

  it('value below min fails', () => {
    expect(safeRangeCheck(-1, { min: 0, max: 1 }).valid).toBe(false);
  });

  it('value above max fails', () => {
    expect(safeRangeCheck(1.5, { min: 0, max: 1 }).valid).toBe(false);
  });

  it('non-number values are skipped (valid)', () => {
    expect(safeRangeCheck('hello', { min: 0, max: 1 }).valid).toBe(true);
  });
});

describe('PlaceholderValidator — Full validation pipeline', () => {
  it('validates a valid scoring_weight placeholder', () => {
    const validator = new PlaceholderValidator();
    validator.registerSafeRange('scoring_weight', { min: 0, max: 1 });

    const placeholder: Placeholder = {
      placeholder_key: 'fusion.weight.social',
      category: 'scoring_weight',
      value_type: 'number',
      scope: 'global',
      owner: 'ml_team',
      version: 1,
      status: 'draft',
      value: 0.35,
      description: 'Social weight',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { valid, errors } = validator.validateAll(placeholder);
    expect(valid).toBe(true);
    expect(errors.length).toBe(0);
  });

  it('REJECTS scoring_weight outside safe range', () => {
    const validator = new PlaceholderValidator();
    validator.registerSafeRange('scoring_weight', { min: 0, max: 1 });

    const placeholder: Placeholder = {
      placeholder_key: 'fusion.weight.social',
      category: 'scoring_weight',
      value_type: 'number',
      scope: 'global',
      owner: 'ml_team',
      version: 1,
      status: 'draft',
      value: 5.0,
      description: 'Bad weight',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { valid, errors } = validator.validateAll(placeholder);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('REJECTS secret_ref placeholder with plaintext value', () => {
    const validator = new PlaceholderValidator();
    const placeholder: Placeholder = {
      placeholder_key: 'api.key.stripe',
      category: 'cost_cap',
      value_type: 'secret_ref',
      scope: 'global',
      owner: 'infra_team',
      version: 1,
      status: 'draft',
      value: 'sk-live-1234567890',
      description: 'Stripe key',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { valid, errors } = validator.validateAll(placeholder);
    expect(valid).toBe(false);
  });
});
