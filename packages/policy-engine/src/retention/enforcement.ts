import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';

export const RetentionWindowCheckSchema = z.object({
  source_id: z.string().min(1),
  record_timestamp: z.string().datetime(),
  retention_class: z.enum(['unlimited', 'time_bound', 'on_request', 'refresh_cycle']),
  window_hours: z.number().positive().optional(),
  window_days: z.number().positive().optional(),
});

export type RetentionWindowCheck = z.infer<typeof RetentionWindowCheckSchema>;

export interface RetentionCheckResult {
  source_id: string;
  expired: boolean;
  reason: string;
  record_timestamp: string;
  checked_at: string;
}

export function checkRetentionWindow(check: RetentionWindowCheck): RetentionCheckResult {
  RetentionWindowCheckSchema.parse(check);
  const now = new Date();
  const recordTime = new Date(check.record_timestamp);
  const checked_at = now.toISOString();

  if (check.retention_class === 'unlimited') {
    return { source_id: check.source_id, expired: false, reason: 'Unlimited retention.', record_timestamp: check.record_timestamp, checked_at };
  }

  if (check.retention_class === 'on_request') {
    return { source_id: check.source_id, expired: false, reason: 'On-request retention; not time-expired.', record_timestamp: check.record_timestamp, checked_at };
  }

  let windowMs = 0;
  if (check.window_hours) {
    windowMs = check.window_hours * 60 * 60 * 1000;
  } else if (check.window_days) {
    windowMs = check.window_days * 24 * 60 * 60 * 1000;
  }

  if (windowMs === 0) {
    return { source_id: check.source_id, expired: false, reason: 'No window specified.', record_timestamp: check.record_timestamp, checked_at };
  }

  const elapsed = now.getTime() - recordTime.getTime();
  const expired = elapsed >= windowMs;

  return {
    source_id: check.source_id,
    expired,
    reason: expired
      ? `Record expired: ${Math.round(elapsed / 3600000)}h elapsed, window is ${check.window_hours ?? (check.window_days! * 24)}h.`
      : `Record within retention window.`,
    record_timestamp: check.record_timestamp,
    checked_at,
  };
}

export const DeletionProofSchema = z.object({
  proof_id: z.string().min(1),
  source_id: z.string().min(1),
  who: z.string().min(1),
  what: z.string().min(1),
  when: z.string().datetime(),
  rule_id: z.string().min(1),
  method: z.enum(['hard_delete', 'crypto_shred', 'tombstone']),
  count_before: z.number().int().nonnegative(),
  count_after: z.number().int().nonnegative(),
  hash_proof: z.string().min(1),
});

export type DeletionProof = z.infer<typeof DeletionProofSchema>;

export function generateDeletionProof(params: {
  source_id: string;
  actor_id: string;
  dataset_description: string;
  rule_id: string;
  method: DeletionProof['method'];
  count_before: number;
  count_after: number;
}): DeletionProof {
  const payload = JSON.stringify({
    source_id: params.source_id,
    actor: params.actor_id,
    what: params.dataset_description,
    when: new Date().toISOString(),
    count_before: params.count_before,
    count_after: params.count_after,
  });
  const hash = createHash('sha256').update(payload).digest('hex');

  return {
    proof_id: `dp_${randomUUID()}`,
    source_id: params.source_id,
    who: params.actor_id,
    what: params.dataset_description,
    when: new Date().toISOString(),
    rule_id: params.rule_id,
    method: params.method,
    count_before: params.count_before,
    count_after: params.count_after,
    hash_proof: hash,
  };
}
