import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createPlatformError,
  ErrorCode,
  ErrorCategory,
  RetryClass,
} from '../../packages/shared-contracts/src/errors/index.js';
import {
  PolicyEventSchema,
  QualityEventSchema,
  CostEventSchema,
  SecurityEventSchema,
} from '../../packages/shared-contracts/src/events/index.js';
import {
  BudgetCheckRequestSchema,
  BudgetCheckResponseSchema,
} from '../../packages/shared-contracts/src/dto/index.js';

describe('Error Taxonomy — Machine-actionable error codes with retry semantics', () => {
  it('creates SRC_POLICY_BLOCKED error with no-retry class', () => {
    const err = createPlatformError(ErrorCode.SRC_POLICY_BLOCKED, 'Telegram mining is blocked');
    expect(err.code).toBe('SRC_POLICY_BLOCKED');
    expect(err.category).toBe(ErrorCategory.SOURCE_POLICY);
    expect(err.retry_class).toBe(RetryClass.NO_RETRY);
  });

  it('creates BUDGET_EXCEEDED error with no-retry class', () => {
    const err = createPlatformError(ErrorCode.BUDGET_EXCEEDED, 'Daily budget exhausted', {
      request_id: randomUUID(),
      details: { tenant_id: 'tenant_001', consumed: 100, limit: 100 },
    });
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.category).toBe(ErrorCategory.BUDGET);
    expect(err.retry_class).toBe(RetryClass.NO_RETRY);
    expect(err.request_id).toBeDefined();
    expect(err.details).toHaveProperty('tenant_id');
  });

  it('creates CONNECTOR_UNAVAILABLE error with backoff-retry class', () => {
    const err = createPlatformError(ErrorCode.CONNECTOR_UNAVAILABLE, 'RPC provider timeout');
    expect(err.code).toBe('CONNECTOR_UNAVAILABLE');
    expect(err.category).toBe(ErrorCategory.CONNECTOR);
    expect(err.retry_class).toBe(RetryClass.BACKOFF_RETRY);
  });

  it('creates COMPLIANCE_TRAINING_BLOCKED error with no-retry class', () => {
    const err = createPlatformError(ErrorCode.COMPLIANCE_TRAINING_BLOCKED, 'Training on restricted source');
    expect(err.code).toBe('COMPLIANCE_TRAINING_BLOCKED');
    expect(err.category).toBe(ErrorCategory.COMPLIANCE);
    expect(err.retry_class).toBe(RetryClass.NO_RETRY);
  });

  it('creates VALIDATION_EVIDENCE_MISSING error with no-retry class', () => {
    const err = createPlatformError(ErrorCode.VALIDATION_EVIDENCE_MISSING, 'Signal missing evidence_ref');
    expect(err.code).toBe('VALIDATION_EVIDENCE_MISSING');
    expect(err.category).toBe(ErrorCategory.VALIDATION);
    expect(err.retry_class).toBe(RetryClass.NO_RETRY);
  });

  it('all error codes are defined and unique', () => {
    const codes = Object.values(ErrorCode);
    const unique = new Set(codes);
    expect(codes.length).toBe(unique.size);
    expect(codes.length).toBeGreaterThanOrEqual(15);
  });
});

describe('Event Schema Validation — All platform events conform to schemas', () => {
  const baseEvent = {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    source_id: 'policy_engine',
    trace_id: randomUUID(),
    version: '1.0.0',
  };

  it('valid PolicyEvent passes schema', () => {
    const event = {
      ...baseEvent,
      event_type: 'policy_event',
      payload: {
        policy_id: 'FSG-001',
        action: 'source_blocked',
        source_id: 'telegram_public',
        actor_id: 'system',
        reason: 'Hard guard triggered',
      },
    };
    expect(PolicyEventSchema.safeParse(event).success).toBe(true);
  });

  it('REJECTS PolicyEvent with invalid action', () => {
    const event = {
      ...baseEvent,
      event_type: 'policy_event',
      payload: {
        policy_id: 'FSG-001',
        action: 'invalid_action',
        source_id: 'telegram_public',
        actor_id: 'system',
        reason: 'test',
      },
    };
    expect(PolicyEventSchema.safeParse(event).success).toBe(false);
  });

  it('valid QualityEvent passes schema', () => {
    const event = {
      ...baseEvent,
      event_type: 'quality_event',
      payload: {
        metric_id: 'alert_precision_6h',
        value: 0.72,
        threshold: 0.70,
        status: 'ok',
      },
    };
    expect(QualityEventSchema.safeParse(event).success).toBe(true);
  });

  it('valid CostEvent passes schema', () => {
    const event = {
      ...baseEvent,
      event_type: 'cost_event',
      payload: {
        tenant_id: 'tenant_001',
        budget_id: 'tier_pro_budget_v1',
        consumed: 85,
        limit: 100,
        action: 'warn',
      },
    };
    expect(CostEventSchema.safeParse(event).success).toBe(true);
  });

  it('valid SecurityEvent passes schema', () => {
    const event = {
      ...baseEvent,
      event_type: 'security_event',
      payload: {
        severity: 'critical',
        category: 'blocked_source_attempt',
        actor_id: 'user_123',
        details: 'Attempted to enable telegram_public connector',
      },
    };
    expect(SecurityEventSchema.safeParse(event).success).toBe(true);
  });

  it('REJECTS CostEvent with negative consumed', () => {
    const event = {
      ...baseEvent,
      event_type: 'cost_event',
      payload: {
        tenant_id: 'tenant_001',
        budget_id: 'test',
        consumed: -5,
        limit: 100,
        action: 'warn',
      },
    };
    expect(CostEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('Budget DTO Validation — Budget check request/response contracts', () => {
  it('valid BudgetCheckRequest passes', () => {
    const req = {
      tenant_id: 'tenant_001',
      tier_id: 'pro',
      resource_type: 'llm_call',
      cost_estimate: 0.05,
    };
    expect(BudgetCheckRequestSchema.safeParse(req).success).toBe(true);
  });

  it('valid BudgetCheckResponse passes', () => {
    const res = {
      allowed: true,
      remaining_budget: 95.5,
      action: 'proceed',
    };
    expect(BudgetCheckResponseSchema.safeParse(res).success).toBe(true);
  });

  it('BudgetCheckResponse with pause action passes', () => {
    const res = {
      allowed: false,
      remaining_budget: 0,
      action: 'pause',
      reason: 'Budget exhausted for tenant_001',
    };
    expect(BudgetCheckResponseSchema.safeParse(res).success).toBe(true);
  });
});
