import { z } from 'zod';
import { randomUUID } from 'crypto';

export const TransformJobStatus = z.enum(['pending', 'running', 'completed', 'failed', 'partial']);
export type TransformJobStatusType = z.infer<typeof TransformJobStatus>;

export const DataContractSchema = z.object({
  contract_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  required_fields: z.array(z.string().min(1)),
  field_types: z.record(z.enum(['string', 'number', 'boolean', 'array', 'object', 'datetime'])),
  nullable_fields: z.array(z.string()).default([]),
  constraints: z.array(z.object({
    field: z.string().min(1),
    rule: z.enum(['min', 'max', 'min_length', 'max_length', 'pattern', 'enum', 'not_empty']),
    value: z.unknown(),
  })).default([]),
});

export type DataContract = z.infer<typeof DataContractSchema>;

export const TransformJobResultSchema = z.object({
  job_id: z.string().min(1),
  status: TransformJobStatus,
  input_count: z.number().int().nonnegative(),
  output_count: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
  quarantined_count: z.number().int().nonnegative(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  duration_ms: z.number().nonnegative().optional(),
  errors: z.array(z.object({
    record_index: z.number().int().nonnegative(),
    error: z.string().min(1),
    field: z.string().optional(),
  })).default([]),
});

export type TransformJobResult = z.infer<typeof TransformJobResultSchema>;

export type TransformFn<TIn = unknown, TOut = unknown> = (record: TIn, index: number) => TOut | null;

export class TransformJob<TIn = unknown, TOut = unknown> {
  readonly job_id: string;
  private readonly transformFn: TransformFn<TIn, TOut>;
  private readonly inputContract?: DataContract;
  private readonly outputContract?: DataContract;

  constructor(params: {
    transformFn: TransformFn<TIn, TOut>;
    inputContract?: DataContract;
    outputContract?: DataContract;
    job_id?: string;
  }) {
    this.job_id = params.job_id ?? `etl_${randomUUID()}`;
    this.transformFn = params.transformFn;
    this.inputContract = params.inputContract;
    this.outputContract = params.outputContract;
  }

  execute(records: TIn[]): TransformJobResult & { output: TOut[]; quarantined: { record: TIn; reason: string }[] } {
    const started_at = new Date().toISOString();
    const output: TOut[] = [];
    const quarantined: { record: TIn; reason: string }[] = [];
    const errors: TransformJobResult['errors'] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      if (this.inputContract) {
        const validation = this.validateAgainstContract(record, this.inputContract);
        if (!validation.valid) {
          quarantined.push({ record, reason: `Input contract violation: ${validation.errors.join('; ')}` });
          errors.push({ record_index: i, error: validation.errors.join('; ') });
          continue;
        }
      }

      try {
        const transformed = this.transformFn(record, i);
        if (transformed === null) {
          quarantined.push({ record, reason: 'Transform returned null (filtered)' });
          continue;
        }

        if (this.outputContract) {
          const validation = this.validateAgainstContract(transformed, this.outputContract);
          if (!validation.valid) {
            quarantined.push({ record, reason: `Output contract violation: ${validation.errors.join('; ')}` });
            errors.push({ record_index: i, error: `Output: ${validation.errors.join('; ')}` });
            continue;
          }
        }

        output.push(transformed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        quarantined.push({ record, reason: `Transform error: ${msg}` });
        errors.push({ record_index: i, error: msg });
      }
    }

    const completed_at = new Date().toISOString();
    const status: TransformJobStatusType =
      errors.length === 0 ? 'completed' :
      output.length === 0 ? 'failed' : 'partial';

    return {
      job_id: this.job_id,
      status,
      input_count: records.length,
      output_count: output.length,
      error_count: errors.length,
      quarantined_count: quarantined.length,
      started_at,
      completed_at,
      duration_ms: new Date(completed_at).getTime() - new Date(started_at).getTime(),
      errors,
      output,
      quarantined,
    };
  }

  private validateAgainstContract(record: unknown, contract: DataContract): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!record || typeof record !== 'object') {
      return { valid: false, errors: ['Record is not an object'] };
    }

    const obj = record as Record<string, unknown>;

    for (const field of contract.required_fields) {
      if (!(field in obj) || (obj[field] === undefined && !contract.nullable_fields.includes(field))) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    for (const [field, expectedType] of Object.entries(contract.field_types)) {
      if (!(field in obj)) continue;
      const val = obj[field];
      if (val === null && contract.nullable_fields.includes(field)) continue;

      const actualType = Array.isArray(val) ? 'array' : typeof val;
      if (expectedType === 'datetime') {
        if (typeof val !== 'string' || isNaN(Date.parse(val))) {
          errors.push(`Field ${field}: expected datetime, got ${actualType}`);
        }
      } else if (actualType !== expectedType) {
        errors.push(`Field ${field}: expected ${expectedType}, got ${actualType}`);
      }
    }

    for (const constraint of contract.constraints) {
      if (!(constraint.field in obj)) continue;
      const val = obj[constraint.field];
      switch (constraint.rule) {
        case 'min':
          if (typeof val === 'number' && val < (constraint.value as number))
            errors.push(`${constraint.field}: value ${val} < min ${String(constraint.value)}`);
          break;
        case 'max':
          if (typeof val === 'number' && val > (constraint.value as number))
            errors.push(`${constraint.field}: value ${val} > max ${String(constraint.value)}`);
          break;
        case 'not_empty':
          if (typeof val === 'string' && val.length === 0)
            errors.push(`${constraint.field}: must not be empty`);
          break;
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
