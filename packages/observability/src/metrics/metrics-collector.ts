import { z } from 'zod';
import { randomUUID } from 'crypto';

export const MetricType = z.enum(['counter', 'gauge', 'histogram', 'summary']);
export type MetricTypeValue = z.infer<typeof MetricType>;

export const MetricPointSchema = z.object({
  metric_id: z.string().min(1),
  name: z.string().min(1),
  type: MetricType,
  value: z.number(),
  timestamp: z.string().datetime(),
  service: z.string().min(1),
  tenant_id: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  unit: z.string().optional(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export interface MetricAggregation {
  name: string;
  service: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export class MetricsCollector {
  private points: MetricPoint[] = [];

  record(params: {
    name: string; type: MetricTypeValue; value: number; service: string;
    tenant_id?: string; labels?: Record<string, string>; unit?: string;
  }): MetricPoint {
    const point: MetricPoint = {
      metric_id: `met_${randomUUID()}`,
      name: params.name,
      type: params.type,
      value: params.value,
      timestamp: new Date().toISOString(),
      service: params.service,
      tenant_id: params.tenant_id,
      labels: params.labels ?? {},
      unit: params.unit,
    };
    MetricPointSchema.parse(point);
    this.points.push(point);
    return point;
  }

  recordLatency(service: string, durationMs: number, labels?: Record<string, string>): MetricPoint {
    return this.record({ name: 'latency_ms', type: 'histogram', value: durationMs, service, labels, unit: 'ms' });
  }

  recordThroughput(service: string, count: number, labels?: Record<string, string>): MetricPoint {
    return this.record({ name: 'throughput', type: 'counter', value: count, service, labels, unit: 'req' });
  }

  recordErrorRate(service: string, rate: number, labels?: Record<string, string>): MetricPoint {
    return this.record({ name: 'error_rate', type: 'gauge', value: rate, service, labels, unit: 'ratio' });
  }

  recordCost(service: string, costUsd: number, labels?: Record<string, string>): MetricPoint {
    return this.record({ name: 'cost_usd', type: 'counter', value: costUsd, service, labels, unit: 'usd' });
  }

  getByName(name: string): MetricPoint[] {
    return this.points.filter((p) => p.name === name);
  }

  getByService(service: string): MetricPoint[] {
    return this.points.filter((p) => p.service === service);
  }

  getByTenant(tenantId: string): MetricPoint[] {
    return this.points.filter((p) => p.tenant_id === tenantId);
  }

  aggregate(name: string, service: string, windowMs?: number): MetricAggregation | null {
    const cutoff = windowMs ? new Date(Date.now() - windowMs).toISOString() : undefined;
    const filtered = this.points.filter((p) =>
      p.name === name && p.service === service && (!cutoff || p.timestamp >= cutoff),
    );
    if (filtered.length === 0) return null;

    const values = filtered.map((p) => p.value).sort((a, b) => a - b);
    const sum = values.reduce((s, v) => s + v, 0);
    const count = values.length;

    return {
      name, service, count, sum,
      avg: sum / count,
      min: values[0],
      max: values[count - 1],
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
    };
  }

  getAll(): MetricPoint[] { return [...this.points]; }
  size(): number { return this.points.length; }
  clear(): void { this.points = []; }
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
