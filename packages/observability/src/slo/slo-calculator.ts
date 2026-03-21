import { z } from 'zod';
import { randomUUID } from 'crypto';

export const SloMetric = z.enum(['latency_p99', 'latency_p95', 'freshness', 'correctness', 'availability', 'error_rate']);
export type SloMetricType = z.infer<typeof SloMetric>;

export const SloTargetSchema = z.object({
  slo_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  metric: SloMetric,
  target_value: z.number(),
  operator: z.enum(['lte', 'gte']),
  window_seconds: z.number().positive(),
  service: z.string().min(1),
  tier: z.enum(['free', 'pro', 'trader', 'desk', 'enterprise']).optional(),
});
export type SloTarget = z.infer<typeof SloTargetSchema>;

export interface SloObservation {
  slo_id: string;
  observed_value: number;
  timestamp: string;
  within_target: boolean;
}

export interface SloStatus {
  slo_id: string;
  name: string;
  metric: SloMetricType;
  target_value: number;
  operator: string;
  current_value: number | null;
  compliance_pct: number;
  total_observations: number;
  passing_observations: number;
  budget_remaining_pct: number;
  breached: boolean;
}

export class SloCalculator {
  private targets: Map<string, SloTarget> = new Map();
  private observations: Map<string, SloObservation[]> = new Map();

  defineTarget(params: Omit<SloTarget, 'slo_id'>): SloTarget {
    const target: SloTarget = { slo_id: `slo_${randomUUID()}`, ...params };
    SloTargetSchema.parse(target);
    this.targets.set(target.slo_id, target);
    this.observations.set(target.slo_id, []);
    return target;
  }

  observe(sloId: string, value: number): SloObservation {
    const target = this.targets.get(sloId);
    if (!target) throw new Error(`SLO target ${sloId} not found.`);

    const withinTarget = target.operator === 'lte' ? value <= target.target_value : value >= target.target_value;

    const obs: SloObservation = {
      slo_id: sloId,
      observed_value: value,
      timestamp: new Date().toISOString(),
      within_target: withinTarget,
    };

    this.observations.get(sloId)!.push(obs);
    return obs;
  }

  getStatus(sloId: string): SloStatus {
    const target = this.targets.get(sloId);
    if (!target) throw new Error(`SLO target ${sloId} not found.`);

    const obs = this.observations.get(sloId) ?? [];
    const windowCutoff = new Date(Date.now() - target.window_seconds * 1000).toISOString();
    const windowObs = obs.filter((o) => o.timestamp >= windowCutoff);

    const total = windowObs.length;
    const passing = windowObs.filter((o) => o.within_target).length;
    const compliancePct = total === 0 ? 100 : (passing / total) * 100;
    const currentValue = windowObs.length > 0 ? windowObs[windowObs.length - 1].observed_value : null;

    const budgetTotal = 100;
    const budgetUsed = 100 - compliancePct;
    const budgetRemaining = Math.max(0, budgetTotal - budgetUsed);

    return {
      slo_id: sloId,
      name: target.name,
      metric: target.metric,
      target_value: target.target_value,
      operator: target.operator,
      current_value: currentValue,
      compliance_pct: Math.round(compliancePct * 100) / 100,
      total_observations: total,
      passing_observations: passing,
      budget_remaining_pct: Math.round(budgetRemaining * 100) / 100,
      breached: compliancePct < 99,
    };
  }

  getBreachedSlos(): SloStatus[] {
    return Array.from(this.targets.keys())
      .map((id) => this.getStatus(id))
      .filter((s) => s.breached);
  }

  getAllStatuses(): SloStatus[] {
    return Array.from(this.targets.keys()).map((id) => this.getStatus(id));
  }

  getObservations(sloId: string): SloObservation[] {
    return [...(this.observations.get(sloId) ?? [])];
  }

  getTarget(sloId: string): SloTarget | undefined {
    return this.targets.get(sloId);
  }

  size(): number { return this.targets.size; }
  clear(): void { this.targets.clear(); this.observations.clear(); }
}
