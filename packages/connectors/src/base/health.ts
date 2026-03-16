import { z } from 'zod';

export const ConnectorHealthSchema = z.object({
  source_id: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  latency_ms: z.number().nonnegative(),
  last_success_at: z.string().datetime().optional(),
  last_error_at: z.string().datetime().optional(),
  last_error_message: z.string().optional(),
  records_ingested_total: z.number().int().nonnegative(),
  checked_at: z.string().datetime(),
});

export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;

export const QuotaStatusSchema = z.object({
  source_id: z.string().min(1),
  quota_limit: z.number().positive(),
  quota_used: z.number().nonnegative(),
  quota_remaining: z.number().nonnegative(),
  reset_at: z.string().datetime(),
  checked_at: z.string().datetime(),
});

export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;

export interface HealthTelemetry {
  getHealth(): ConnectorHealth;
  getQuota(): QuotaStatus;
  recordSuccess(latency_ms: number, count: number): void;
  recordError(error: string): void;
}

export class InMemoryHealthTelemetry implements HealthTelemetry {
  private health: ConnectorHealth;
  private quota: QuotaStatus;

  constructor(source_id: string, quota_limit: number) {
    const now = new Date().toISOString();
    this.health = {
      source_id, status: 'unknown', latency_ms: 0,
      records_ingested_total: 0, checked_at: now,
    };
    this.quota = {
      source_id, quota_limit, quota_used: 0,
      quota_remaining: quota_limit,
      reset_at: new Date(Date.now() + 86400000).toISOString(),
      checked_at: now,
    };
  }

  getHealth(): ConnectorHealth {
    return { ...this.health, checked_at: new Date().toISOString() };
  }

  getQuota(): QuotaStatus {
    return { ...this.quota, checked_at: new Date().toISOString() };
  }

  recordSuccess(latency_ms: number, count: number): void {
    this.health = {
      ...this.health,
      status: 'healthy',
      latency_ms,
      last_success_at: new Date().toISOString(),
      records_ingested_total: this.health.records_ingested_total + count,
    };
    this.quota = {
      ...this.quota,
      quota_used: this.quota.quota_used + count,
      quota_remaining: Math.max(0, this.quota.quota_remaining - count),
    };
  }

  recordError(error: string): void {
    this.health = {
      ...this.health,
      status: 'unhealthy',
      last_error_at: new Date().toISOString(),
      last_error_message: error,
    };
  }
}
