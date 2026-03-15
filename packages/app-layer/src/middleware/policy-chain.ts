export interface MiddlewareContext {
  trace_id: string;
  actor_id: string;
  tenant_id: string;
  source_id: string;
  action: string;
  tier?: string;
  idempotency_key?: string;
  metadata: Record<string, unknown>;
}

export interface MiddlewareResult {
  passed: boolean;
  middleware_name: string;
  reason?: string;
  duration_ms: number;
}

export type MiddlewareFn = (ctx: MiddlewareContext) => Promise<MiddlewareResult> | MiddlewareResult;

export class PolicyMiddlewareChain {
  private middlewares: { name: string; fn: MiddlewareFn }[] = [];

  use(name: string, fn: MiddlewareFn): void {
    this.middlewares.push({ name, fn });
  }

  async execute(ctx: MiddlewareContext): Promise<{ passed: boolean; results: MiddlewareResult[]; failed_at?: string }> {
    const results: MiddlewareResult[] = [];

    for (const mw of this.middlewares) {
      const start = Date.now();
      try {
        const result = await mw.fn(ctx);
        result.duration_ms = Date.now() - start;
        result.middleware_name = mw.name;
        results.push(result);

        if (!result.passed) {
          return { passed: false, results, failed_at: mw.name };
        }
      } catch (err) {
        results.push({
          passed: false,
          middleware_name: mw.name,
          reason: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - start,
        });
        return { passed: false, results, failed_at: mw.name };
      }
    }

    return { passed: true, results };
  }

  list(): string[] {
    return this.middlewares.map((m) => m.name);
  }
}

export function authMiddleware(): MiddlewareFn {
  return (ctx) => ({
    passed: !!ctx.actor_id && ctx.actor_id.length > 0,
    middleware_name: 'auth',
    reason: !ctx.actor_id ? 'Missing actor_id' : undefined,
    duration_ms: 0,
  });
}

export function entitlementMiddleware(allowedTiers: string[]): MiddlewareFn {
  return (ctx) => ({
    passed: !ctx.tier || allowedTiers.includes(ctx.tier),
    middleware_name: 'entitlement',
    reason: ctx.tier && !allowedTiers.includes(ctx.tier) ? `Tier ${ctx.tier} not entitled` : undefined,
    duration_ms: 0,
  });
}

export function sourcePolicyMiddleware(blockedSources: string[]): MiddlewareFn {
  return (ctx) => ({
    passed: !blockedSources.includes(ctx.source_id),
    middleware_name: 'source_policy',
    reason: blockedSources.includes(ctx.source_id) ? `Source ${ctx.source_id} is blocked` : undefined,
    duration_ms: 0,
  });
}

export function idempotencyMiddleware(): MiddlewareFn {
  const seen = new Set<string>();
  return (ctx) => {
    if (!ctx.idempotency_key) {
      return { passed: true, middleware_name: 'idempotency', duration_ms: 0 };
    }
    if (seen.has(ctx.idempotency_key)) {
      return { passed: false, middleware_name: 'idempotency', reason: 'Duplicate request', duration_ms: 0 };
    }
    seen.add(ctx.idempotency_key);
    return { passed: true, middleware_name: 'idempotency', duration_ms: 0 };
  };
}
