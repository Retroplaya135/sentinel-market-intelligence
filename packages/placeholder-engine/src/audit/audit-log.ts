import { z } from 'zod';
import { createHash } from 'crypto';

export const AuditEntrySchema = z.object({
  change_id: z.string().min(1),
  actor_id: z.string().min(1),
  timestamp: z.string().datetime(),
  action: z.enum(['create', 'update', 'delete', 'transition', 'rollback', 'export', 'import']),
  placeholder_key: z.string().min(1),
  old_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
  diff_hash: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export function computeDiffHash(oldVal: unknown, newVal: unknown): string {
  const payload = JSON.stringify({ old: oldVal, new: newVal });
  return createHash('sha256').update(payload).digest('hex');
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private counter = 0;

  append(params: {
    actor_id: string;
    action: AuditEntry['action'];
    placeholder_key: string;
    old_value?: unknown;
    new_value?: unknown;
    metadata?: Record<string, unknown>;
  }): AuditEntry {
    const entry: AuditEntry = {
      change_id: `audit_${++this.counter}_${Date.now()}`,
      actor_id: params.actor_id,
      timestamp: new Date().toISOString(),
      action: params.action,
      placeholder_key: params.placeholder_key,
      old_value: params.old_value,
      new_value: params.new_value,
      diff_hash: computeDiffHash(params.old_value, params.new_value),
      metadata: params.metadata,
    };

    AuditEntrySchema.parse(entry);
    this.entries.push(Object.freeze(entry) as AuditEntry);
    return entry;
  }

  getAll(): readonly AuditEntry[] {
    return Object.freeze([...this.entries]);
  }

  getByKey(placeholder_key: string): AuditEntry[] {
    return this.entries.filter((e) => e.placeholder_key === placeholder_key);
  }

  getByActor(actor_id: string): AuditEntry[] {
    return this.entries.filter((e) => e.actor_id === actor_id);
  }

  size(): number {
    return this.entries.length;
  }
}
