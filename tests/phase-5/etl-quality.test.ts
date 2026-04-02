import { describe, it, expect } from 'vitest';
import { QualityCheckPipeline, QualityReportSchema } from '../../packages/etl/src/quality/checks.js';
import { TransformJob } from '../../packages/etl/src/transform/job.js';
import type { DataContract } from '../../packages/etl/src/transform/job.js';

describe('QualityCheckPipeline — Freshness', () => {
  const pipeline = new QualityCheckPipeline();

  it('passes when data is fresh', () => {
    const result = pipeline.checkFreshness({
      source_id: 'onchain_evm',
      latest_record_timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
      max_age_minutes: 30,
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('fails when data is stale', () => {
    const result = pipeline.checkFreshness({
      source_id: 'onchain_evm',
      latest_record_timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      max_age_minutes: 30,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('STALE');
  });

  it('critical severity for very stale data', () => {
    const result = pipeline.checkFreshness({
      source_id: 'onchain_evm',
      latest_record_timestamp: new Date(Date.now() - 120 * 60000).toISOString(),
      max_age_minutes: 30,
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('critical');
  });
});

describe('QualityCheckPipeline — Completeness', () => {
  const pipeline = new QualityCheckPipeline();

  it('passes when all required fields present', () => {
    const result = pipeline.checkCompleteness({
      source_id: 'onchain_evm',
      records: [
        { asset_id: 'BTC', score: 0.5, timestamp: '2025-01-01T00:00:00Z' },
        { asset_id: 'ETH', score: 0.3, timestamp: '2025-01-01T00:00:00Z' },
      ],
      required_fields: ['asset_id', 'score', 'timestamp'],
    });
    expect(result.passed).toBe(true);
    expect(result.metric_value).toBe(100);
  });

  it('fails when fields are missing', () => {
    const result = pipeline.checkCompleteness({
      source_id: 'onchain_evm',
      records: [
        { asset_id: 'BTC' },
        { asset_id: 'ETH', score: 0.3 },
      ],
      required_fields: ['asset_id', 'score', 'timestamp'],
    });
    expect(result.passed).toBe(false);
    expect(result.metric_value).toBeLessThan(95);
  });

  it('critical severity for very incomplete data', () => {
    const result = pipeline.checkCompleteness({
      source_id: 'onchain_evm',
      records: [{ bad: true }, { worse: true }],
      required_fields: ['asset_id', 'score', 'timestamp', 'source_id'],
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('critical');
  });
});

describe('QualityCheckPipeline — Schema drift', () => {
  const pipeline = new QualityCheckPipeline();

  it('passes when schema matches expected fields', () => {
    const result = pipeline.checkSchemaDrift({
      source_id: 'onchain_evm',
      records: [
        { asset_id: 'BTC', score: 0.5 },
        { asset_id: 'ETH', score: 0.3 },
      ],
      expected_fields: ['asset_id', 'score'],
      tolerance_pct: 10,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when unexpected fields appear', () => {
    const result = pipeline.checkSchemaDrift({
      source_id: 'onchain_evm',
      records: [
        { asset_id: 'BTC', score: 0.5, new_field_1: 'x', new_field_2: 'y', new_field_3: 'z' },
      ],
      expected_fields: ['asset_id', 'score'],
      tolerance_pct: 10,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('EXCEEDS');
  });

  it('passes for empty records', () => {
    const result = pipeline.checkSchemaDrift({
      source_id: 'onchain_evm',
      records: [],
      expected_fields: ['asset_id'],
      tolerance_pct: 10,
    });
    expect(result.passed).toBe(true);
  });
});

describe('QualityCheckPipeline — Volume anomaly', () => {
  const pipeline = new QualityCheckPipeline();

  it('passes when volume is within normal range', () => {
    const result = pipeline.checkVolumeAnomaly({
      source_id: 'onchain_evm',
      current_count: 105,
      historical_avg: 100,
      deviation_threshold_pct: 20,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when volume deviates significantly', () => {
    const result = pipeline.checkVolumeAnomaly({
      source_id: 'onchain_evm',
      current_count: 10,
      historical_avg: 100,
      deviation_threshold_pct: 20,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('EXCEEDS');
  });
});

describe('QualityCheckPipeline — runAll report', () => {
  const pipeline = new QualityCheckPipeline();

  it('generates valid QualityReport from multiple checks', () => {
    const report = pipeline.runAll('onchain_evm', {
      freshness: {
        source_id: 'onchain_evm',
        latest_record_timestamp: new Date().toISOString(),
        max_age_minutes: 30,
      },
      completeness: {
        source_id: 'onchain_evm',
        records: [{ a: 1, b: 2 }],
        required_fields: ['a', 'b'],
      },
      volumeAnomaly: {
        source_id: 'onchain_evm',
        current_count: 100,
        historical_avg: 100,
        deviation_threshold_pct: 20,
      },
    });

    const validation = QualityReportSchema.safeParse(report);
    expect(validation.success).toBe(true);
    expect(report.total_checks).toBe(3);
    expect(report.passed_checks).toBe(3);
    expect(report.overall_status).toBe('healthy');
  });

  it('overall_status is degraded when some checks fail', () => {
    const report = pipeline.runAll('src', {
      freshness: {
        source_id: 'src',
        latest_record_timestamp: new Date(Date.now() - 999999999).toISOString(),
        max_age_minutes: 1,
      },
    });
    expect(report.overall_status).not.toBe('healthy');
  });
});

describe('TransformJob — Data contract validation', () => {
  const inputContract: DataContract = {
    contract_id: 'input_v1',
    name: 'Raw Record Input',
    version: '1.0.0',
    required_fields: ['asset_id', 'value'],
    field_types: { asset_id: 'string', value: 'number' },
    nullable_fields: [],
    constraints: [{ field: 'value', rule: 'min', value: 0 }],
  };

  const outputContract: DataContract = {
    contract_id: 'output_v1',
    name: 'Scored Output',
    version: '1.0.0',
    required_fields: ['asset_id', 'score'],
    field_types: { asset_id: 'string', score: 'number' },
    nullable_fields: [],
    constraints: [
      { field: 'score', rule: 'min', value: -1 },
      { field: 'score', rule: 'max', value: 1 },
    ],
  };

  it('transforms valid records successfully', () => {
    const job = new TransformJob({
      transformFn: (r: any) => ({ asset_id: r.asset_id, score: r.value / 100 }),
      inputContract,
      outputContract,
    });
    const result = job.execute([
      { asset_id: 'BTC', value: 50 },
      { asset_id: 'ETH', value: 30 },
    ]);
    expect(result.status).toBe('completed');
    expect(result.output_count).toBe(2);
    expect(result.error_count).toBe(0);
    expect(result.quarantined_count).toBe(0);
  });

  it('quarantines records that fail input contract', () => {
    const job = new TransformJob({
      transformFn: (r: any) => ({ asset_id: r.asset_id, score: 0.5 }),
      inputContract,
    });
    const result = job.execute([
      { asset_id: 'BTC', value: 50 },
      { value: 30 },
      { asset_id: 'SOL', value: -5 },
    ]);
    expect(result.output_count).toBe(1);
    expect(result.quarantined_count).toBe(2);
  });

  it('quarantines records that fail output contract', () => {
    const job = new TransformJob({
      transformFn: (r: any) => ({ asset_id: r.asset_id, score: r.value }),
      inputContract,
      outputContract,
    });
    const result = job.execute([{ asset_id: 'BTC', value: 5 }]);
    expect(result.quarantined_count).toBe(1);
    expect(result.output_count).toBe(0);
  });

  it('handles transform errors gracefully', () => {
    const job = new TransformJob({
      transformFn: () => { throw new Error('Transform crash'); },
    });
    const result = job.execute([{ data: 1 }]);
    expect(result.status).toBe('failed');
    expect(result.quarantined_count).toBe(1);
    expect(result.errors[0].error).toBe('Transform crash');
  });

  it('null return from transform filters the record', () => {
    const job = new TransformJob({
      transformFn: (r: any) => r.keep ? { out: true } : null,
    });
    const result = job.execute([{ keep: true }, { keep: false }, { keep: true }]);
    expect(result.output_count).toBe(2);
    expect(result.quarantined_count).toBe(1);
  });

  it('partial status when some succeed and some fail', () => {
    const job = new TransformJob({
      transformFn: (r: any, i: number) => {
        if (i === 1) throw new Error('bad');
        return { ok: true };
      },
    });
    const result = job.execute([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(result.status).toBe('partial');
    expect(result.output_count).toBe(2);
    expect(result.error_count).toBe(1);
  });

  it('records duration_ms', () => {
    const job = new TransformJob({ transformFn: (r) => r });
    const result = job.execute([{ a: 1 }]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
