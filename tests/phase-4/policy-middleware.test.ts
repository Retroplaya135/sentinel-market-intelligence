import { describe, it, expect } from 'vitest';
import {
  PolicyMiddlewareChain,
  authMiddleware,
  entitlementMiddleware,
  sourcePolicyMiddleware,
  idempotencyMiddleware,
} from '../../packages/app-layer/src/middleware/policy-chain.js';
import type { MiddlewareContext } from '../../packages/app-layer/src/middleware/policy-chain.js';

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    trace_id: 'trace_001',
    actor_id: 'user_001',
    tenant_id: 'tenant_001',
    source_id: 'onchain_evm',
    action: 'ingest',
    tier: 'pro',
    metadata: {},
    ...overrides,
  };
}

describe('Policy Middleware Chain', () => {
  it('passes when all middlewares pass', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('entitlement', entitlementMiddleware(['free', 'pro', 'trader']));
    chain.use('source_policy', sourcePolicyMiddleware(['telegram_public', 'discord_mining', 'tiktok_research']));

    const result = await chain.execute(makeCtx());
    expect(result.passed).toBe(true);
    expect(result.results.length).toBe(3);
    expect(result.failed_at).toBeUndefined();
  });

  it('fails at auth when actor_id is empty', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());

    const result = await chain.execute(makeCtx({ actor_id: '' }));
    expect(result.passed).toBe(false);
    expect(result.failed_at).toBe('auth');
  });

  it('fails at entitlement when tier is not allowed', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('entitlement', entitlementMiddleware(['enterprise']));

    const result = await chain.execute(makeCtx({ tier: 'free' }));
    expect(result.passed).toBe(false);
    expect(result.failed_at).toBe('entitlement');
    expect(result.results[1].reason).toContain('not entitled');
  });

  it('fails at source_policy when source is blocked', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('source_policy', sourcePolicyMiddleware(['telegram_public']));

    const result = await chain.execute(makeCtx({ source_id: 'telegram_public' }));
    expect(result.passed).toBe(false);
    expect(result.failed_at).toBe('source_policy');
  });

  it('stops at first failing middleware — does not run subsequent ones', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('entitlement', entitlementMiddleware(['enterprise']));
    chain.use('source_policy', sourcePolicyMiddleware([]));

    const result = await chain.execute(makeCtx({ tier: 'free' }));
    expect(result.passed).toBe(false);
    expect(result.results.length).toBe(2); // auth passed, entitlement failed, source_policy never ran
  });

  it('idempotency middleware detects duplicate requests', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('idempotency', idempotencyMiddleware());

    const ctx = makeCtx({ idempotency_key: 'key_001' });
    const r1 = await chain.execute(ctx);
    expect(r1.passed).toBe(true);

    const r2 = await chain.execute(ctx);
    expect(r2.passed).toBe(false);
    expect(r2.results[0].reason).toContain('Duplicate');
  });

  it('idempotency middleware allows requests without key', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('idempotency', idempotencyMiddleware());

    const r = await chain.execute(makeCtx({ idempotency_key: undefined }));
    expect(r.passed).toBe(true);
  });

  it('list returns middleware names in order', () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('entitlement', entitlementMiddleware([]));
    chain.use('source_policy', sourcePolicyMiddleware([]));
    chain.use('idempotency', idempotencyMiddleware());
    expect(chain.list()).toEqual(['auth', 'entitlement', 'source_policy', 'idempotency']);
  });

  it('handles middleware that throws', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('failing', async () => { throw new Error('Middleware crash'); });

    const result = await chain.execute(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.failed_at).toBe('failing');
    expect(result.results[0].reason).toBe('Middleware crash');
  });

  it('full production chain: auth → entitlement → source_policy → idempotency', async () => {
    const chain = new PolicyMiddlewareChain();
    chain.use('auth', authMiddleware());
    chain.use('entitlement', entitlementMiddleware(['free', 'pro', 'trader', 'desk', 'enterprise']));
    chain.use('source_policy', sourcePolicyMiddleware(['telegram_public', 'discord_mining', 'tiktok_research']));
    chain.use('idempotency', idempotencyMiddleware());

    const r = await chain.execute(makeCtx({ idempotency_key: 'unique_001' }));
    expect(r.passed).toBe(true);
    expect(r.results.length).toBe(4);
  });
});
