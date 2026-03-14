import { randomUUID } from 'crypto';
import type { AlertEvaluation, AlertDispatchResult, AlertInvalidation } from '@sentinel/module-system';
import { ThresholdAlertStrategy } from '../strategies/threshold-strategy.js';
import type { ThresholdConfig, AlertRecord } from '../base/base-strategy.js';
import type { FusionResult } from '@sentinel/scoring-engine';
import type { ManipulationMarkers } from '@sentinel/scoring-engine';
import type { EventBusInterface } from '@sentinel/module-system';

export interface AlertServiceConfig {
  thresholds: ThresholdConfig[];
  eventBus?: EventBusInterface;
}

export interface AlertPipelineInput {
  asset_id: string;
  fusion_result: FusionResult;
  manipulation_markers?: Map<string, ManipulationMarkers>;
  tenant_id: string;
  trace_id: string;
}

export interface AlertPipelineOutput {
  evaluation: AlertEvaluation;
  dispatch?: AlertDispatchResult;
  trace_id: string;
  pipeline_duration_ms: number;
}

export class AlertService {
  private readonly strategy: ThresholdAlertStrategy;
  private readonly eventBus?: EventBusInterface;

  constructor(config: AlertServiceConfig) {
    this.strategy = new ThresholdAlertStrategy();
    this.strategy.setThresholds(config.thresholds);
    this.eventBus = config.eventBus;
  }

  async processFusionResult(input: AlertPipelineInput): Promise<AlertPipelineOutput> {
    const start = Date.now();

    const maxManipulation = input.manipulation_markers
      ? Math.max(...Array.from(input.manipulation_markers.values()).map((m) => m.composite_manipulation_score), 0)
      : 0;

    const signals: Record<string, unknown> = {
      fused_score: input.fusion_result.fused_score,
      confidence: input.fusion_result.fused_confidence,
      agreement_ratio: input.fusion_result.agreement_ratio,
      manipulation_composite: maxManipulation,
      evidence_refs: input.fusion_result.source_contributions.flatMap((c) => [`${c.source_id}_contrib`]),
      total_sources: input.fusion_result.total_sources,
      dominant_source: input.fusion_result.dominant_source,
    };

    const evaluation = await this.strategy.evaluate({ asset_id: input.asset_id, signals });

    let dispatch: AlertDispatchResult | undefined;
    if (evaluation.triggered) {
      dispatch = await this.strategy.dispatch({ evaluation, tenant_id: input.tenant_id });
      await this.emitAlertEvent(evaluation, input.trace_id);
    }

    return {
      evaluation,
      dispatch,
      trace_id: input.trace_id,
      pipeline_duration_ms: Date.now() - start,
    };
  }

  async checkInvalidation(alert_id: string): Promise<AlertInvalidation> {
    return this.strategy.invalidate({ alert_id });
  }

  async batchCheckInvalidation(alert_ids: string[]): Promise<AlertInvalidation[]> {
    const results: AlertInvalidation[] = [];
    for (const id of alert_ids) {
      results.push(await this.strategy.invalidate({ alert_id: id }));
    }
    return results;
  }

  updateCurrentScore(asset_id: string, score: number): void {
    this.strategy.updateCurrentScore(asset_id, score);
  }

  setEvidenceAvailable(ref: string, available: boolean): void {
    this.strategy.setEvidenceAvailable(ref, available);
  }

  setSourceAvailable(source_id: string, available: boolean): void {
    this.strategy.setSourceAvailable(source_id, available);
  }

  getAlertHistory(): AlertRecord[] {
    return this.strategy.getAlertHistory();
  }

  getAlert(alert_id: string): AlertRecord | undefined {
    return this.strategy.getAlert(alert_id);
  }

  getActiveAlerts(): AlertRecord[] {
    return this.strategy.getAlertHistory().filter((a) => !a.invalidated && a.dispatched);
  }

  getTriggeredCount(): number {
    return this.strategy.getAlertHistory().filter((a) => a.dispatched).length;
  }

  clearHistory(): void {
    this.strategy.clearHistory();
  }

  private async emitAlertEvent(evaluation: AlertEvaluation, trace_id: string): Promise<void> {
    if (!this.eventBus) return;
    await this.eventBus.publish('quality_event', {
      event_id: randomUUID(),
      event_type: 'quality_event',
      timestamp: new Date().toISOString(),
      source_id: 'alerting_engine',
      trace_id,
      version: '1.0.0',
      payload: {
        metric_id: `alert_${evaluation.severity}_${evaluation.asset_id}`,
        value: 1,
        threshold: 0,
        status: evaluation.severity === 'critical' ? 'critical' : 'warning',
      },
    });
  }
}
