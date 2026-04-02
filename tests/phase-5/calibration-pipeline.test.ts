import { describe, it, expect, beforeEach } from 'vitest';
import { CalibrationPipeline, CalibrationEntrySchema, CalibrationReportSchema } from '../../packages/scoring-engine/src/calibration/pipeline.js';

describe('CalibrationPipeline — Recording entries', () => {
  let pipeline: CalibrationPipeline;

  beforeEach(() => {
    pipeline = new CalibrationPipeline();
  });

  it('records a single calibration entry', () => {
    const entry = pipeline.record({
      asset_id: 'BTC',
      predicted_score: 0.6,
      actual_outcome: 0.5,
      source_ids: ['onchain_evm'],
      model_version: 'v1',
    });
    expect(entry.entry_id).toMatch(/^cal_/);
    expect(entry.predicted_score).toBe(0.6);
    expect(entry.actual_outcome).toBe(0.5);
    const validation = CalibrationEntrySchema.safeParse(entry);
    expect(validation.success).toBe(true);
  });

  it('records a batch of entries', () => {
    const entries = pipeline.recordBatch([
      { asset_id: 'BTC', predicted_score: 0.5, actual_outcome: 0.6, source_ids: ['evm'], model_version: 'v1' },
      { asset_id: 'ETH', predicted_score: -0.3, actual_outcome: -0.2, source_ids: ['evm'], model_version: 'v1' },
      { asset_id: 'SOL', predicted_score: 0.8, actual_outcome: 0.7, source_ids: ['evm'], model_version: 'v1' },
    ]);
    expect(entries.length).toBe(3);
    expect(pipeline.getEntries().length).toBe(3);
  });

  it('getEntries filters by model_version', () => {
    pipeline.record({ asset_id: 'BTC', predicted_score: 0.5, actual_outcome: 0.5, source_ids: ['evm'], model_version: 'v1' });
    pipeline.record({ asset_id: 'ETH', predicted_score: 0.3, actual_outcome: 0.3, source_ids: ['evm'], model_version: 'v2' });
    expect(pipeline.getEntries('v1').length).toBe(1);
    expect(pipeline.getEntries('v2').length).toBe(1);
    expect(pipeline.getEntries().length).toBe(2);
  });
});

describe('CalibrationPipeline — Report generation', () => {
  let pipeline: CalibrationPipeline;

  beforeEach(() => {
    pipeline = new CalibrationPipeline();
    pipeline.recordBatch([
      { asset_id: 'BTC', predicted_score: 0.5, actual_outcome: 0.6, source_ids: ['evm'], model_version: 'v1' },
      { asset_id: 'ETH', predicted_score: -0.3, actual_outcome: -0.2, source_ids: ['evm'], model_version: 'v1' },
      { asset_id: 'SOL', predicted_score: 0.8, actual_outcome: 0.7, source_ids: ['evm'], model_version: 'v1' },
      { asset_id: 'DOGE', predicted_score: -0.6, actual_outcome: -0.5, source_ids: ['news'], model_version: 'v1' },
      { asset_id: 'ADA', predicted_score: 0.1, actual_outcome: 0.0, source_ids: ['evm'], model_version: 'v1' },
    ]);
  });

  it('generates valid CalibrationReport', () => {
    const report = pipeline.generateReport('v1', 30);
    const validation = CalibrationReportSchema.safeParse(report);
    expect(validation.success).toBe(true);
    expect(report.model_version).toBe('v1');
    expect(report.sample_count).toBe(5);
    expect(report.window_days).toBe(30);
  });

  it('RMSE is positive for imperfect predictions', () => {
    const report = pipeline.generateReport('v1');
    expect(report.rmse).toBeGreaterThan(0);
  });

  it('MAE is positive for imperfect predictions', () => {
    const report = pipeline.generateReport('v1');
    expect(report.mae).toBeGreaterThan(0);
  });

  it('correlation is high for directionally correct predictions', () => {
    const report = pipeline.generateReport('v1');
    expect(report.correlation).toBeGreaterThan(0.9);
  });

  it('bucket_calibration has 5 buckets', () => {
    const report = pipeline.generateReport('v1');
    expect(report.bucket_calibration.length).toBe(5);
    for (const b of report.bucket_calibration) {
      expect(b.bucket_label).toBeTruthy();
      expect(typeof b.predicted_mean).toBe('number');
      expect(typeof b.actual_mean).toBe('number');
      expect(typeof b.count).toBe('number');
      expect(b.abs_error).toBeGreaterThanOrEqual(0);
    }
  });

  it('drift_severity is not critical for close predictions', () => {
    const report = pipeline.generateReport('v1');
    expect(['none', 'low', 'medium']).toContain(report.drift_severity);
    expect(report.drift_severity).not.toBe('critical');
  });

  it('empty model version produces zero-sample report', () => {
    const report = pipeline.generateReport('nonexistent');
    expect(report.sample_count).toBe(0);
    expect(report.rmse).toBe(0);
    expect(report.drift_severity).toBe('none');
  });

  it('perfect predictions produce zero RMSE', () => {
    const perfect = new CalibrationPipeline();
    perfect.recordBatch([
      { asset_id: 'A', predicted_score: 0.5, actual_outcome: 0.5, source_ids: ['s'], model_version: 'perf' },
      { asset_id: 'B', predicted_score: -0.3, actual_outcome: -0.3, source_ids: ['s'], model_version: 'perf' },
    ]);
    const report = perfect.generateReport('perf');
    expect(report.rmse).toBe(0);
    expect(report.mae).toBe(0);
    expect(report.bias).toBe(0);
    expect(report.is_drifting).toBe(false);
  });

  it('high error triggers drift detection', () => {
    const bad = new CalibrationPipeline();
    bad.recordBatch([
      { asset_id: 'A', predicted_score: 0.9, actual_outcome: -0.9, source_ids: ['s'], model_version: 'bad' },
      { asset_id: 'B', predicted_score: -0.8, actual_outcome: 0.8, source_ids: ['s'], model_version: 'bad' },
    ]);
    const report = bad.generateReport('bad');
    expect(report.is_drifting).toBe(true);
    expect(report.drift_severity).toBe('critical');
  });
});

describe('CalibrationPipeline — Maintenance', () => {
  it('pruneOlderThan keeps recent entries', () => {
    const pipeline = new CalibrationPipeline();
    pipeline.record({ asset_id: 'A', predicted_score: 0.5, actual_outcome: 0.5, source_ids: ['s'], model_version: 'v1' });
    const pruned = pipeline.pruneOlderThan(365);
    expect(pruned).toBe(0);
  });

  it('clear removes all entries', () => {
    const pipeline = new CalibrationPipeline();
    pipeline.recordBatch([
      { asset_id: 'A', predicted_score: 0.5, actual_outcome: 0.5, source_ids: ['s'], model_version: 'v1' },
      { asset_id: 'B', predicted_score: 0.3, actual_outcome: 0.3, source_ids: ['s'], model_version: 'v1' },
    ]);
    pipeline.clear();
    expect(pipeline.getEntries().length).toBe(0);
  });
});
