import { z } from 'zod';
import { randomUUID } from 'crypto';

export const QuarantineReasonType = z.enum([
  'input_contract_violation',
  'output_contract_violation',
  'transform_error',
  'quality_check_failure',
  'schema_drift',
  'manipulation_suspect',
  'stale_data',
  'duplicate',
  'manual_review',
]);
export type QuarantineReason = z.infer<typeof QuarantineReasonType>;

export const QuarantinedRecordSchema = z.object({
  quarantine_id: z.string().min(1),
  record: z.unknown(),
  source_id: z.string().min(1),
  reason_type: QuarantineReasonType,
  reason_detail: z.string().min(1),
  job_id: z.string().min(1).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  quarantined_at: z.string().datetime(),
  reviewed: z.boolean().default(false),
  reviewed_by: z.string().optional(),
  reviewed_at: z.string().datetime().optional(),
  resolution: z.enum(['released', 'discarded', 'pending']).default('pending'),
});

export type QuarantinedRecord = z.infer<typeof QuarantinedRecordSchema>;

export interface QuarantineStoreInterface {
  add(record: unknown, params: {
    source_id: string;
    reason_type: QuarantineReason;
    reason_detail: string;
    job_id?: string;
    severity: QuarantinedRecord['severity'];
  }): QuarantinedRecord;

  getById(quarantine_id: string): QuarantinedRecord | undefined;
  getBySource(source_id: string): QuarantinedRecord[];
  getByReason(reason_type: QuarantineReason): QuarantinedRecord[];
  getPending(): QuarantinedRecord[];
  release(quarantine_id: string, reviewer_id: string): QuarantinedRecord;
  discard(quarantine_id: string, reviewer_id: string): QuarantinedRecord;
  size(): number;
  pendingCount(): number;
  clear(): void;
}

export class InMemoryQuarantineStore implements QuarantineStoreInterface {
  private records: Map<string, QuarantinedRecord> = new Map();

  add(record: unknown, params: {
    source_id: string;
    reason_type: QuarantineReason;
    reason_detail: string;
    job_id?: string;
    severity: QuarantinedRecord['severity'];
  }): QuarantinedRecord {
    const entry: QuarantinedRecord = {
      quarantine_id: `quar_${randomUUID()}`,
      record,
      source_id: params.source_id,
      reason_type: params.reason_type,
      reason_detail: params.reason_detail,
      job_id: params.job_id,
      severity: params.severity,
      quarantined_at: new Date().toISOString(),
      reviewed: false,
      resolution: 'pending',
    };

    QuarantinedRecordSchema.parse(entry);
    this.records.set(entry.quarantine_id, entry);
    return entry;
  }

  getById(quarantine_id: string): QuarantinedRecord | undefined {
    return this.records.get(quarantine_id);
  }

  getBySource(source_id: string): QuarantinedRecord[] {
    return Array.from(this.records.values()).filter((r) => r.source_id === source_id);
  }

  getByReason(reason_type: QuarantineReason): QuarantinedRecord[] {
    return Array.from(this.records.values()).filter((r) => r.reason_type === reason_type);
  }

  getPending(): QuarantinedRecord[] {
    return Array.from(this.records.values()).filter((r) => r.resolution === 'pending');
  }

  release(quarantine_id: string, reviewer_id: string): QuarantinedRecord {
    const entry = this.records.get(quarantine_id);
    if (!entry) throw new Error(`Quarantine record ${quarantine_id} not found.`);
    if (entry.resolution !== 'pending') throw new Error(`Record already resolved: ${entry.resolution}`);

    const updated: QuarantinedRecord = {
      ...entry,
      reviewed: true,
      reviewed_by: reviewer_id,
      reviewed_at: new Date().toISOString(),
      resolution: 'released',
    };

    this.records.set(quarantine_id, updated);
    return updated;
  }

  discard(quarantine_id: string, reviewer_id: string): QuarantinedRecord {
    const entry = this.records.get(quarantine_id);
    if (!entry) throw new Error(`Quarantine record ${quarantine_id} not found.`);
    if (entry.resolution !== 'pending') throw new Error(`Record already resolved: ${entry.resolution}`);

    const updated: QuarantinedRecord = {
      ...entry,
      reviewed: true,
      reviewed_by: reviewer_id,
      reviewed_at: new Date().toISOString(),
      resolution: 'discarded',
    };

    this.records.set(quarantine_id, updated);
    return updated;
  }

  size(): number {
    return this.records.size;
  }

  pendingCount(): number {
    return this.getPending().length;
  }

  clear(): void {
    this.records.clear();
  }
}
