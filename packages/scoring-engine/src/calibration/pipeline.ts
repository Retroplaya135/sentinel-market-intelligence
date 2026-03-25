import { z } from 'zod';
import { randomUUID } from 'crypto';

export const CalibrationEntrySchema = z.object({
  entry_id: z.string().min(1),
  asset_id: z.string().min(1),
  predicted_score: z.number().min(-1).max(1),
  actual_outcome: z.number().min(-1).max(1),
  source_ids: z.array(z.string().min(1)),
  model_version: z.string().min(1),
  recorded_at: z.string().datetime(),
});

export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;

export const CalibrationReportSchema = z.object({
  report_id: z.string().min(1),
  model_version: z.string().min(1),
  window_days: z.number().int().positive(),
  sample_count: z.number().int().nonnegative(),
  rmse: z.number().nonnegative(),
  mae: z.number().nonnegative(),
  bias: z.number(),
  correlation: z.number().min(-1).max(1),
  bucket_calibration: z.array(z.object({
    bucket_label: z.string().min(1),
    predicted_mean: z.number(),
    actual_mean: z.number(),
    count: z.number().int().nonnegative(),
    abs_error: z.number().nonnegative(),
  })),
  is_drifting: z.boolean(),
  drift_severity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
  generated_at: z.string().datetime(),
});

export type CalibrationReport = z.infer<typeof CalibrationReportSchema>;

export class CalibrationPipeline {
  private entries: CalibrationEntry[] = [];
  private readonly driftThresholds = {
    low: 0.05,
    medium: 0.10,
    high: 0.20,
    critical: 0.35,
  };

  record(entry: Omit<CalibrationEntry, 'entry_id' | 'recorded_at'>): CalibrationEntry {
    const full: CalibrationEntry = {
      ...entry,
      entry_id: `cal_${randomUUID()}`,
      recorded_at: new Date().toISOString(),
    };
    CalibrationEntrySchema.parse(full);
    this.entries.push(full);
    return full;
  }

  recordBatch(entries: Omit<CalibrationEntry, 'entry_id' | 'recorded_at'>[]): CalibrationEntry[] {
    return entries.map((e) => this.record(e));
  }

  generateReport(model_version: string, windowDays: number = 30): CalibrationReport {
    const cutoff = new Date(Date.now() - windowDays * 24 * 3600000);
    const windowEntries = this.entries.filter(
      (e) => e.model_version === model_version && new Date(e.recorded_at) >= cutoff,
    );

    const predicted = windowEntries.map((e) => e.predicted_score);
    const actual = windowEntries.map((e) => e.actual_outcome);

    const rmse = this.computeRMSE(predicted, actual);
    const mae = this.computeMAE(predicted, actual);
    const bias = this.computeBias(predicted, actual);
    const correlation = this.computeCorrelation(predicted, actual);
    const buckets = this.computeBucketCalibration(windowEntries);
    const driftSeverity = this.classifyDrift(rmse);

    const report: CalibrationReport = {
      report_id: `calrep_${randomUUID()}`,
      model_version,
      window_days: windowDays,
      sample_count: windowEntries.length,
      rmse,
      mae,
      bias,
      correlation,
      bucket_calibration: buckets,
      is_drifting: driftSeverity !== 'none',
      drift_severity: driftSeverity,
      generated_at: new Date().toISOString(),
    };

    CalibrationReportSchema.parse(report);
    return report;
  }

  getEntries(model_version?: string): CalibrationEntry[] {
    if (!model_version) return [...this.entries];
    return this.entries.filter((e) => e.model_version === model_version);
  }

  pruneOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 3600000);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => new Date(e.recorded_at) >= cutoff);
    return before - this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }

  private computeRMSE(predicted: number[], actual: number[]): number {
    if (predicted.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < predicted.length; i++) {
      sum += (predicted[i] - actual[i]) ** 2;
    }
    return Math.sqrt(sum / predicted.length);
  }

  private computeMAE(predicted: number[], actual: number[]): number {
    if (predicted.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < predicted.length; i++) {
      sum += Math.abs(predicted[i] - actual[i]);
    }
    return sum / predicted.length;
  }

  private computeBias(predicted: number[], actual: number[]): number {
    if (predicted.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < predicted.length; i++) {
      sum += predicted[i] - actual[i];
    }
    return sum / predicted.length;
  }

  private computeCorrelation(predicted: number[], actual: number[]): number {
    const n = predicted.length;
    if (n < 2) return 0;

    const meanP = predicted.reduce((a, b) => a + b, 0) / n;
    const meanA = actual.reduce((a, b) => a + b, 0) / n;

    let cov = 0;
    let varP = 0;
    let varA = 0;

    for (let i = 0; i < n; i++) {
      const dp = predicted[i] - meanP;
      const da = actual[i] - meanA;
      cov += dp * da;
      varP += dp * dp;
      varA += da * da;
    }

    const denom = Math.sqrt(varP * varA);
    if (denom === 0) return 0;
    return Math.max(-1, Math.min(1, cov / denom));
  }

  private computeBucketCalibration(entries: CalibrationEntry[]): CalibrationReport['bucket_calibration'] {
    const bucketDefs = [
      { label: 'strong_bearish', min: -1, max: -0.5 },
      { label: 'bearish', min: -0.5, max: -0.1 },
      { label: 'neutral', min: -0.1, max: 0.1 },
      { label: 'bullish', min: 0.1, max: 0.5 },
      { label: 'strong_bullish', min: 0.5, max: 1 },
    ];

    return bucketDefs.map((b) => {
      const inBucket = entries.filter(
        (e) => e.predicted_score >= b.min && e.predicted_score < (b.max === 1 ? 1.01 : b.max),
      );
      const pMean = inBucket.length > 0
        ? inBucket.reduce((s, e) => s + e.predicted_score, 0) / inBucket.length
        : (b.min + b.max) / 2;
      const aMean = inBucket.length > 0
        ? inBucket.reduce((s, e) => s + e.actual_outcome, 0) / inBucket.length
        : (b.min + b.max) / 2;

      return {
        bucket_label: b.label,
        predicted_mean: Math.round(pMean * 1000) / 1000,
        actual_mean: Math.round(aMean * 1000) / 1000,
        count: inBucket.length,
        abs_error: Math.round(Math.abs(pMean - aMean) * 1000) / 1000,
      };
    });
  }

  private classifyDrift(rmse: number): CalibrationReport['drift_severity'] {
    if (rmse >= this.driftThresholds.critical) return 'critical';
    if (rmse >= this.driftThresholds.high) return 'high';
    if (rmse >= this.driftThresholds.medium) return 'medium';
    if (rmse >= this.driftThresholds.low) return 'low';
    return 'none';
  }
}
