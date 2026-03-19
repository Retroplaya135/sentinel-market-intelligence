import { z } from 'zod';
import { randomUUID } from 'crypto';

export const QualityCheckType = z.enum(['freshness', 'completeness', 'schema_drift', 'volume_anomaly', 'value_range']);
export type QualityCheckTypeValue = z.infer<typeof QualityCheckType>;

export const QualityCheckResultSchema = z.object({
  check_id: z.string().min(1),
  check_type: QualityCheckType,
  source_id: z.string().min(1),
  passed: z.boolean(),
  severity: z.enum(['info', 'warning', 'critical']),
  metric_value: z.number(),
  threshold: z.number(),
  message: z.string().min(1),
  checked_at: z.string().datetime(),
});

export type QualityCheckResult = z.infer<typeof QualityCheckResultSchema>;

export const QualityReportSchema = z.object({
  report_id: z.string().min(1),
  source_id: z.string().min(1),
  total_checks: z.number().int().nonnegative(),
  passed_checks: z.number().int().nonnegative(),
  failed_checks: z.number().int().nonnegative(),
  critical_failures: z.number().int().nonnegative(),
  results: z.array(QualityCheckResultSchema),
  overall_status: z.enum(['healthy', 'degraded', 'unhealthy']),
  generated_at: z.string().datetime(),
});

export type QualityReport = z.infer<typeof QualityReportSchema>;

export interface FreshnessCheckParams {
  source_id: string;
  latest_record_timestamp: string;
  max_age_minutes: number;
}

export interface CompletenessCheckParams {
  source_id: string;
  records: unknown[];
  required_fields: string[];
}

export interface SchemaDriftCheckParams {
  source_id: string;
  records: unknown[];
  expected_fields: string[];
  tolerance_pct: number;
}

export interface VolumeAnomalyCheckParams {
  source_id: string;
  current_count: number;
  historical_avg: number;
  deviation_threshold_pct: number;
}

export class QualityCheckPipeline {
  checkFreshness(params: FreshnessCheckParams): QualityCheckResult {
    const latestTime = new Date(params.latest_record_timestamp).getTime();
    const ageMinutes = (Date.now() - latestTime) / 60000;
    const passed = ageMinutes <= params.max_age_minutes;

    return {
      check_id: `qc_${randomUUID()}`,
      check_type: 'freshness',
      source_id: params.source_id,
      passed,
      severity: passed ? 'info' : ageMinutes > params.max_age_minutes * 2 ? 'critical' : 'warning',
      metric_value: Math.round(ageMinutes * 100) / 100,
      threshold: params.max_age_minutes,
      message: passed
        ? `Data is fresh: ${ageMinutes.toFixed(1)}min old (max: ${params.max_age_minutes}min)`
        : `Data is STALE: ${ageMinutes.toFixed(1)}min old exceeds ${params.max_age_minutes}min threshold`,
      checked_at: new Date().toISOString(),
    };
  }

  checkCompleteness(params: CompletenessCheckParams): QualityCheckResult {
    let totalFields = 0;
    let presentFields = 0;

    for (const record of params.records) {
      if (!record || typeof record !== 'object') continue;
      const obj = record as Record<string, unknown>;
      for (const field of params.required_fields) {
        totalFields++;
        if (field in obj && obj[field] !== undefined && obj[field] !== null) {
          presentFields++;
        }
      }
    }

    const completeness = totalFields > 0 ? presentFields / totalFields : 0;
    const passed = completeness >= 0.95;

    return {
      check_id: `qc_${randomUUID()}`,
      check_type: 'completeness',
      source_id: params.source_id,
      passed,
      severity: passed ? 'info' : completeness < 0.8 ? 'critical' : 'warning',
      metric_value: Math.round(completeness * 10000) / 100,
      threshold: 95,
      message: passed
        ? `Completeness ${(completeness * 100).toFixed(1)}% meets 95% threshold`
        : `Completeness ${(completeness * 100).toFixed(1)}% BELOW 95% threshold`,
      checked_at: new Date().toISOString(),
    };
  }

  checkSchemaDrift(params: SchemaDriftCheckParams): QualityCheckResult {
    if (params.records.length === 0) {
      return {
        check_id: `qc_${randomUUID()}`,
        check_type: 'schema_drift',
        source_id: params.source_id,
        passed: true,
        severity: 'info',
        metric_value: 0,
        threshold: params.tolerance_pct,
        message: 'No records to check for schema drift.',
        checked_at: new Date().toISOString(),
      };
    }

    const unexpectedFieldCounts = new Map<string, number>();
    const missingFieldCounts = new Map<string, number>();

    for (const record of params.records) {
      if (!record || typeof record !== 'object') continue;
      const obj = record as Record<string, unknown>;
      const recordKeys = Object.keys(obj);

      for (const key of recordKeys) {
        if (!params.expected_fields.includes(key)) {
          unexpectedFieldCounts.set(key, (unexpectedFieldCounts.get(key) ?? 0) + 1);
        }
      }

      for (const field of params.expected_fields) {
        if (!(field in obj)) {
          missingFieldCounts.set(field, (missingFieldCounts.get(field) ?? 0) + 1);
        }
      }
    }

    const totalAnomalies = unexpectedFieldCounts.size + missingFieldCounts.size;
    const driftPct = (totalAnomalies / Math.max(1, params.expected_fields.length)) * 100;
    const passed = driftPct <= params.tolerance_pct;

    return {
      check_id: `qc_${randomUUID()}`,
      check_type: 'schema_drift',
      source_id: params.source_id,
      passed,
      severity: passed ? 'info' : driftPct > params.tolerance_pct * 2 ? 'critical' : 'warning',
      metric_value: Math.round(driftPct * 100) / 100,
      threshold: params.tolerance_pct,
      message: passed
        ? `Schema drift ${driftPct.toFixed(1)}% within ${params.tolerance_pct}% tolerance`
        : `Schema drift ${driftPct.toFixed(1)}% EXCEEDS ${params.tolerance_pct}% tolerance (${unexpectedFieldCounts.size} unexpected, ${missingFieldCounts.size} missing fields)`,
      checked_at: new Date().toISOString(),
    };
  }

  checkVolumeAnomaly(params: VolumeAnomalyCheckParams): QualityCheckResult {
    const deviationPct = params.historical_avg > 0
      ? Math.abs(params.current_count - params.historical_avg) / params.historical_avg * 100
      : 0;
    const passed = deviationPct <= params.deviation_threshold_pct;

    return {
      check_id: `qc_${randomUUID()}`,
      check_type: 'volume_anomaly',
      source_id: params.source_id,
      passed,
      severity: passed ? 'info' : deviationPct > params.deviation_threshold_pct * 2 ? 'critical' : 'warning',
      metric_value: Math.round(deviationPct * 100) / 100,
      threshold: params.deviation_threshold_pct,
      message: passed
        ? `Volume deviation ${deviationPct.toFixed(1)}% within ${params.deviation_threshold_pct}% threshold`
        : `Volume deviation ${deviationPct.toFixed(1)}% EXCEEDS ${params.deviation_threshold_pct}% threshold (current: ${params.current_count}, avg: ${params.historical_avg})`,
      checked_at: new Date().toISOString(),
    };
  }

  runAll(source_id: string, params: {
    freshness?: FreshnessCheckParams;
    completeness?: CompletenessCheckParams;
    schemaDrift?: SchemaDriftCheckParams;
    volumeAnomaly?: VolumeAnomalyCheckParams;
  }): QualityReport {
    const results: QualityCheckResult[] = [];

    if (params.freshness) results.push(this.checkFreshness(params.freshness));
    if (params.completeness) results.push(this.checkCompleteness(params.completeness));
    if (params.schemaDrift) results.push(this.checkSchemaDrift(params.schemaDrift));
    if (params.volumeAnomaly) results.push(this.checkVolumeAnomaly(params.volumeAnomaly));

    const failed = results.filter((r) => !r.passed);
    const critical = failed.filter((r) => r.severity === 'critical');

    const overall: QualityReport['overall_status'] =
      critical.length > 0 ? 'unhealthy' :
      failed.length > 0 ? 'degraded' : 'healthy';

    return {
      report_id: `qr_${randomUUID()}`,
      source_id,
      total_checks: results.length,
      passed_checks: results.filter((r) => r.passed).length,
      failed_checks: failed.length,
      critical_failures: critical.length,
      results,
      overall_status: overall,
      generated_at: new Date().toISOString(),
    };
  }
}
