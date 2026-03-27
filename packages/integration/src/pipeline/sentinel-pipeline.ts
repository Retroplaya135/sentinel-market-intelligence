import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createTraceContext, TraceCollector } from '@sentinel/app-layer';
import type { TraceContext } from '@sentinel/app-layer';
import { PolicyService } from '@sentinel/policy-engine';
import { SentimentCascadeScorer } from '@sentinel/scoring-engine';
import { FusionEngine } from '@sentinel/scoring-engine';
import { ManipulationDetector } from '@sentinel/scoring-engine';
import { ExplanationGenerator } from '@sentinel/scoring-engine';
import type { FusionResult, PerSourceScore, ManipulationMarkers, DetailedExplanation } from '@sentinel/scoring-engine';
import { InMemoryEventStore } from '@sentinel/data-layer';
import { InMemorySnapshotStore } from '@sentinel/data-layer';
import { AlertService } from '@sentinel/alerting';
import type { AlertPipelineOutput, ThresholdConfig } from '@sentinel/alerting';
import { createPlatformError } from '@sentinel/shared-contracts';
import type { PlatformError } from '@sentinel/shared-contracts';

export const PipelineStageSchema = z.enum([
  'policy_check', 'ingest', 'normalize', 'score', 'manipulate_check',
  'fuse', 'explain', 'alert', 'snapshot', 'complete',
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export interface PipelineInput {
  asset_id: string;
  source_data: Record<string, { sentiment: number; volume: number; recency_hours: number; evidence_refs?: string[] }>;
  tenant_id: string;
  actor_id: string;
}

export interface PipelineStageResult {
  stage: PipelineStage;
  success: boolean;
  duration_ms: number;
  trace: TraceContext;
  error?: PlatformError;
  output?: unknown;
}

export interface PipelineResult {
  pipeline_id: string;
  asset_id: string;
  tenant_id: string;
  trace_id: string;
  stages: PipelineStageResult[];
  overall_success: boolean;
  failed_at?: PipelineStage;
  fusion_result?: FusionResult;
  explanation?: DetailedExplanation;
  alert_output?: AlertPipelineOutput;
  total_duration_ms: number;
  started_at: string;
  completed_at: string;
}

export interface SentinelPipelineConfig {
  fusionWeights?: unknown[];
  alertThresholds?: ThresholdConfig[];
  scorer_model_version?: string;
}

export class SentinelPipeline {
  private readonly policy: PolicyService;
  private readonly scorer: SentimentCascadeScorer;
  private readonly fusionEngine: FusionEngine;
  private readonly manipulationDetector: ManipulationDetector;
  private readonly explanationGenerator: ExplanationGenerator;
  private readonly eventStore: InMemoryEventStore;
  private readonly snapshotStore: InMemorySnapshotStore;
  private readonly alertService: AlertService;
  private readonly traceCollector: TraceCollector;

  constructor(config?: SentinelPipelineConfig) {
    this.policy = new PolicyService();
    this.scorer = new SentimentCascadeScorer(config?.scorer_model_version);
    this.fusionEngine = new FusionEngine();
    if (config?.fusionWeights) {
      this.fusionEngine.setWeightsFromPlaceholder(config.fusionWeights);
    }
    this.manipulationDetector = new ManipulationDetector();
    this.explanationGenerator = new ExplanationGenerator();
    this.eventStore = new InMemoryEventStore();
    this.snapshotStore = new InMemorySnapshotStore();
    this.alertService = new AlertService({
      thresholds: config?.alertThresholds ?? [],
    });
    this.traceCollector = new TraceCollector();
  }

  async execute(input: PipelineInput): Promise<PipelineResult> {
    const pipeline_id = `pipe_${randomUUID()}`;
    const started_at = new Date().toISOString();
    const startTime = Date.now();
    const rootTrace = createTraceContext('pipeline', 'execute');
    this.traceCollector.record(rootTrace);

    const stages: PipelineStageResult[] = [];
    let overallSuccess = true;
    let failedAt: PipelineStage | undefined;
    let fusionResult: FusionResult | undefined;
    let explanation: DetailedExplanation | undefined;
    let alertOutput: AlertPipelineOutput | undefined;

    const policyResults = await this.runPolicyChecks(input, rootTrace);
    stages.push(policyResults.stageResult);
    if (!policyResults.stageResult.success) {
      overallSuccess = false;
      failedAt = 'policy_check';
      return this.buildResult(pipeline_id, input, rootTrace.trace_id, stages, overallSuccess, failedAt, startTime, started_at);
    }

    const allowedSources = policyResults.allowedSources;
    const filteredSourceData: Record<string, unknown> = {};
    for (const sid of allowedSources) {
      if (input.source_data[sid]) filteredSourceData[sid] = input.source_data[sid];
    }

    const scoreStage = await this.runStage('score', rootTrace, async () => {
      return this.scorer.score({ asset_id: input.asset_id, source_data: filteredSourceData });
    });
    stages.push(scoreStage);
    if (!scoreStage.success) { overallSuccess = false; failedAt = 'score'; return this.buildResult(pipeline_id, input, rootTrace.trace_id, stages, overallSuccess, failedAt, startTime, started_at); }
    const scoreResult = scoreStage.output as Awaited<ReturnType<typeof this.scorer.score>>;

    const perSourceScores: PerSourceScore[] = Object.keys(filteredSourceData).map((source_id) => {
      const d = filteredSourceData[source_id] as Record<string, unknown>;
      return this.scorer.scorePerSource({
        source_id,
        asset_id: input.asset_id,
        raw_sentiment: typeof d.sentiment === 'number' ? d.sentiment : 0,
        volume: typeof d.volume === 'number' ? d.volume : 1,
        recency_hours: typeof d.recency_hours === 'number' ? d.recency_hours : 24,
        evidence_refs: Array.isArray(d.evidence_refs) ? d.evidence_refs as string[] : [`${source_id}_ref`],
        metadata: d,
      });
    });

    const manipMap = new Map<string, ManipulationMarkers>();
    const manipStage = await this.runStage('manipulate_check', rootTrace, async () => {
      for (const pss of perSourceScores) {
        const markers = this.manipulationDetector.analyze(pss.source_id, input.asset_id, {
          unique_authors: 50, total_posts: 200, time_window_hours: 24,
          avg_account_age_days: 365, posting_burst_ratio: 1.0, sentiment_uniformity: 0.3,
          hashtag_coordination_ratio: 0.1, known_bot_ratio: 0.02,
        });
        manipMap.set(pss.source_id, markers);
      }
      return manipMap;
    });
    stages.push(manipStage);

    const fuseStage = await this.runStage('fuse', rootTrace, async () => {
      fusionResult = this.fusionEngine.fuse(input.asset_id, perSourceScores);
      return fusionResult;
    });
    stages.push(fuseStage);
    if (!fuseStage.success) { overallSuccess = false; failedAt = 'fuse'; return this.buildResult(pipeline_id, input, rootTrace.trace_id, stages, overallSuccess, failedAt, startTime, started_at); }

    const explainStage = await this.runStage('explain', rootTrace, async () => {
      explanation = this.explanationGenerator.generateFromFusion(fusionResult!, perSourceScores, manipMap);
      return explanation;
    });
    stages.push(explainStage);

    const alertStage = await this.runStage('alert', rootTrace, async () => {
      alertOutput = await this.alertService.processFusionResult({
        asset_id: input.asset_id,
        fusion_result: fusionResult!,
        manipulation_markers: manipMap,
        tenant_id: input.tenant_id,
        trace_id: rootTrace.trace_id,
      });
      return alertOutput;
    });
    stages.push(alertStage);

    const snapshotStage = await this.runStage('snapshot', rootTrace, async () => {
      this.eventStore.append(
        input.asset_id, 'pipeline_complete',
        { score: scoreResult.score, fusion: fusionResult, alert: alertOutput?.evaluation.triggered },
        { trace_id: rootTrace.trace_id, source_id: 'pipeline' },
      );

      const snap = this.snapshotStore.capture({
        asset_id: input.asset_id,
        snapshot_type: 'full_state',
        data: { score: scoreResult, fusion: fusionResult, explanation, alert: alertOutput },
        source_ids: scoreResult.source_ids,
        model_version: scoreResult.model_version,
        event_sequence: this.eventStore.getLastSequence(),
        metadata: { tenant_id: input.tenant_id, trace_id: rootTrace.trace_id },
      });
      return snap;
    });
    stages.push(snapshotStage);

    return this.buildResult(pipeline_id, input, rootTrace.trace_id, stages, overallSuccess, failedAt, startTime, started_at, fusionResult, explanation, alertOutput);
  }

  getEventStore(): InMemoryEventStore { return this.eventStore; }
  getSnapshotStore(): InMemorySnapshotStore { return this.snapshotStore; }
  getAlertService(): AlertService { return this.alertService; }
  getPolicyService(): PolicyService { return this.policy; }
  getTraceCollector(): TraceCollector { return this.traceCollector; }

  private async runPolicyChecks(input: PipelineInput, parent: TraceContext): Promise<{
    stageResult: PipelineStageResult;
    allowedSources: string[];
  }> {
    const trace = createTraceContext('pipeline', 'policy_check', parent);
    this.traceCollector.record(trace);
    const start = Date.now();
    const allowedSources: string[] = [];
    const blockedSources: string[] = [];

    for (const source_id of Object.keys(input.source_data)) {
      const result = await this.policy.checkPolicy({
        source_id, action: 'ingest', actor_id: input.actor_id, tenant_id: input.tenant_id,
      });
      if (result.allowed) {
        allowedSources.push(source_id);
      } else {
        blockedSources.push(source_id);
      }
    }

    if (allowedSources.length === 0) {
      return {
        stageResult: {
          stage: 'policy_check', success: false, duration_ms: Date.now() - start, trace,
          error: createPlatformError('SRC_POLICY_BLOCKED', `All sources blocked: ${blockedSources.join(', ')}`),
        },
        allowedSources,
      };
    }

    return {
      stageResult: {
        stage: 'policy_check', success: true, duration_ms: Date.now() - start, trace,
        output: { allowed: allowedSources, blocked: blockedSources },
      },
      allowedSources,
    };
  }

  private async runStage(stage: PipelineStage, parent: TraceContext, fn: () => Promise<unknown>): Promise<PipelineStageResult> {
    const trace = createTraceContext('pipeline', stage, parent);
    this.traceCollector.record(trace);
    const start = Date.now();

    try {
      const output = await fn();
      return { stage, success: true, duration_ms: Date.now() - start, trace, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stage, success: false, duration_ms: Date.now() - start, trace,
        error: createPlatformError('SYSTEM_INTERNAL', msg),
      };
    }
  }

  private buildResult(
    pipeline_id: string, input: PipelineInput, trace_id: string,
    stages: PipelineStageResult[], overallSuccess: boolean, failedAt: PipelineStage | undefined,
    startTime: number, started_at: string,
    fusionResult?: FusionResult, explanation?: DetailedExplanation, alertOutput?: AlertPipelineOutput,
  ): PipelineResult {
    return {
      pipeline_id, asset_id: input.asset_id, tenant_id: input.tenant_id, trace_id,
      stages, overall_success: overallSuccess, failed_at: failedAt,
      fusion_result: fusionResult, explanation, alert_output: alertOutput,
      total_duration_ms: Date.now() - startTime,
      started_at, completed_at: new Date().toISOString(),
    };
  }
}
