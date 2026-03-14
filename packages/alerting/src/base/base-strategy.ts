import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { AlertStrategyInterface, AlertEvaluation, AlertDispatchResult, AlertInvalidation } from '@sentinel/module-system';
import { AlertEvaluationSchema, AlertDispatchResultSchema, AlertInvalidationSchema } from '@sentinel/module-system';

export const ThresholdConfigSchema = z.object({
  threshold_id: z.string().min(1),
  asset_pattern: z.string().min(1),
  metric: z.enum(['fused_score', 'confidence', 'agreement_ratio', 'manipulation_composite', 'volume_change']),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'abs_gt']),
  static_value: z.number().optional(),
  dynamic_placeholder_key: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  cooldown_minutes: z.number().positive().default(15),
  expected_half_life_minutes: z.number().positive().default(60),
  invalidation_trigger: z.string().min(1),
  enabled: z.boolean().default(true),
});

export type ThresholdConfig = z.infer<typeof ThresholdConfigSchema>;

export interface AlertRecord {
  alert_id: string;
  asset_id: string;
  threshold_id: string;
  severity: AlertEvaluation['severity'];
  triggered_at: string;
  invalidated: boolean;
  invalidated_at?: string;
  invalidation_reason?: string;
  evidence_refs: string[];
  score_at_trigger: number;
  confidence_at_trigger: number;
  dispatched: boolean;
  dispatch_channels: string[];
  tenant_id?: string;
}

export abstract class BaseAlertStrategy implements AlertStrategyInterface {
  abstract readonly strategy_id: string;
  protected thresholds: ThresholdConfig[] = [];
  protected alertHistory: Map<string, AlertRecord> = new Map();
  protected cooldownTracker: Map<string, number> = new Map();

  setThresholds(configs: ThresholdConfig[]): void {
    this.thresholds = configs.map((c) => ThresholdConfigSchema.parse(c));
  }

  setThresholdsFromPlaceholder(value: unknown): void {
    this.setThresholds(z.array(ThresholdConfigSchema).parse(value));
  }

  async evaluate(params: { asset_id: string; signals: Record<string, unknown> }): Promise<AlertEvaluation> {
    const now = new Date();
    const matching = this.findMatchingThresholds(params.asset_id, params.signals);

    if (matching.length === 0) {
      return this.noTriggerResult(params.asset_id, now);
    }

    const best = this.selectHighestSeverity(matching);
    const cooldownKey = `${params.asset_id}::${best.config.threshold_id}`;
    const lastTrigger = this.cooldownTracker.get(cooldownKey);

    if (lastTrigger && (now.getTime() - lastTrigger) < best.config.cooldown_minutes * 60000) {
      return this.noTriggerResult(params.asset_id, now);
    }

    this.cooldownTracker.set(cooldownKey, now.getTime());

    const alertId = `alert_${randomUUID()}`;
    const evidenceRefs = this.extractEvidenceRefs(params.signals);
    const confidence = typeof params.signals['confidence'] === 'number' ? params.signals['confidence'] : 0.5;

    const record: AlertRecord = {
      alert_id: alertId,
      asset_id: params.asset_id,
      threshold_id: best.config.threshold_id,
      severity: best.config.severity,
      triggered_at: now.toISOString(),
      invalidated: false,
      evidence_refs: evidenceRefs,
      score_at_trigger: best.metricValue,
      confidence_at_trigger: confidence,
      dispatched: false,
      dispatch_channels: [],
    };
    this.alertHistory.set(alertId, record);

    const evaluation: AlertEvaluation = {
      alert_id: alertId,
      asset_id: params.asset_id,
      triggered: true,
      severity: best.config.severity,
      threshold_triggered: `${best.config.metric} ${best.config.operator} ${best.config.static_value ?? 'dynamic'}`,
      confidence,
      expected_half_life_minutes: best.config.expected_half_life_minutes,
      invalidation_trigger: best.config.invalidation_trigger,
      evidence_refs: evidenceRefs,
      timestamp: now.toISOString(),
    };

    AlertEvaluationSchema.parse(evaluation);
    return evaluation;
  }

  async dispatch(params: { evaluation: AlertEvaluation; tenant_id: string }): Promise<AlertDispatchResult> {
    if (!params.evaluation.triggered) {
      return {
        alert_id: params.evaluation.alert_id,
        dispatched: false,
        channels: [],
        dispatched_at: new Date().toISOString(),
        tenant_id: params.tenant_id,
      };
    }

    const channels = this.routeBySeverity(params.evaluation.severity);
    const record = this.alertHistory.get(params.evaluation.alert_id);
    if (record) {
      record.dispatched = true;
      record.dispatch_channels = channels;
      record.tenant_id = params.tenant_id;
    }

    const result: AlertDispatchResult = {
      alert_id: params.evaluation.alert_id,
      dispatched: true,
      channels,
      dispatched_at: new Date().toISOString(),
      tenant_id: params.tenant_id,
    };

    AlertDispatchResultSchema.parse(result);
    return result;
  }

  async invalidate(params: { alert_id: string }): Promise<AlertInvalidation> {
    const record = this.alertHistory.get(params.alert_id);
    if (!record) {
      return {
        alert_id: params.alert_id,
        invalidated: false,
        reason: 'Alert not found in history.',
        checked_at: new Date().toISOString(),
      };
    }

    if (record.invalidated) {
      return {
        alert_id: params.alert_id,
        invalidated: true,
        reason: record.invalidation_reason ?? 'Previously invalidated.',
        checked_at: new Date().toISOString(),
      };
    }

    const invalidationResult = await this.checkInvalidationConditions(record);

    if (invalidationResult.invalidated) {
      record.invalidated = true;
      record.invalidated_at = new Date().toISOString();
      record.invalidation_reason = invalidationResult.reason;
    }

    const result: AlertInvalidation = {
      alert_id: params.alert_id,
      invalidated: invalidationResult.invalidated,
      reason: invalidationResult.reason,
      checked_at: new Date().toISOString(),
    };

    AlertInvalidationSchema.parse(result);
    return result;
  }

  getAlertHistory(): AlertRecord[] {
    return Array.from(this.alertHistory.values());
  }

  getAlert(alert_id: string): AlertRecord | undefined {
    return this.alertHistory.get(alert_id);
  }

  clearHistory(): void {
    this.alertHistory.clear();
    this.cooldownTracker.clear();
  }

  protected routeBySeverity(severity: AlertEvaluation['severity']): string[] {
    switch (severity) {
      case 'critical': return ['push', 'email', 'webhook', 'sms'];
      case 'high': return ['push', 'email', 'webhook'];
      case 'medium': return ['push', 'email'];
      case 'low': return ['push'];
      default: return ['push'];
    }
  }

  protected abstract checkInvalidationConditions(record: AlertRecord): Promise<{ invalidated: boolean; reason: string }>;

  protected noTriggerResult(asset_id: string, now: Date): AlertEvaluation {
    return {
      alert_id: `noop_${randomUUID()}`,
      asset_id,
      triggered: false,
      severity: 'low',
      threshold_triggered: 'none',
      confidence: 0,
      expected_half_life_minutes: 0,
      invalidation_trigger: 'n/a',
      evidence_refs: ['none'],
      timestamp: now.toISOString(),
    };
  }

  private findMatchingThresholds(asset_id: string, signals: Record<string, unknown>): { config: ThresholdConfig; metricValue: number }[] {
    const results: { config: ThresholdConfig; metricValue: number }[] = [];

    for (const config of this.thresholds) {
      if (!config.enabled) continue;
      if (config.asset_pattern !== '*' && config.asset_pattern !== asset_id) continue;

      const metricValue = typeof signals[config.metric] === 'number' ? signals[config.metric] as number : undefined;
      if (metricValue === undefined) continue;

      const threshold = config.static_value ?? 0;
      let triggered = false;

      switch (config.operator) {
        case 'gt': triggered = metricValue > threshold; break;
        case 'gte': triggered = metricValue >= threshold; break;
        case 'lt': triggered = metricValue < threshold; break;
        case 'lte': triggered = metricValue <= threshold; break;
        case 'abs_gt': triggered = Math.abs(metricValue) > threshold; break;
      }

      if (triggered) results.push({ config, metricValue });
    }

    return results;
  }

  private selectHighestSeverity(matches: { config: ThresholdConfig; metricValue: number }[]): { config: ThresholdConfig; metricValue: number } {
    const order: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return matches.sort((a, b) => (order[b.config.severity] ?? 0) - (order[a.config.severity] ?? 0))[0];
  }

  private extractEvidenceRefs(signals: Record<string, unknown>): string[] {
    const refs: string[] = [];
    for (const [key, val] of Object.entries(signals)) {
      if (key === 'evidence_refs' && Array.isArray(val)) {
        refs.push(...(val as string[]));
      }
    }
    if (refs.length === 0) refs.push(`signal_snapshot_${randomUUID()}`);
    return refs;
  }
}
