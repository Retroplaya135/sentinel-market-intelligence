import {
  Placeholder, PlaceholderSchema, PlaceholderVersionEntry,
  PlaceholderLifecycleType, isValidTransition,
} from '../registry/schema.js';
import { AuditLog } from '../audit/audit-log.js';
import { PlaceholderValidator } from '../validation/validator.js';

export interface CreatePlaceholderParams {
  placeholder_key: string;
  category: Placeholder['category'];
  value_type: Placeholder['value_type'];
  scope: Placeholder['scope'];
  owner: string;
  value: unknown;
  description: string;
  actor_id: string;
}

export interface UpdatePlaceholderParams {
  placeholder_key: string;
  value: unknown;
  actor_id: string;
  reason?: string;
}

export class PlaceholderStore {
  private placeholders: Map<string, Placeholder> = new Map();
  private history: Map<string, PlaceholderVersionEntry[]> = new Map();
  private readonly audit: AuditLog;
  private readonly validator: PlaceholderValidator;

  constructor(audit: AuditLog, validator: PlaceholderValidator) {
    this.audit = audit;
    this.validator = validator;
  }

  create(params: CreatePlaceholderParams): Placeholder {
    if (this.placeholders.has(params.placeholder_key)) {
      throw new Error(`Placeholder ${params.placeholder_key} already exists.`);
    }

    const now = new Date().toISOString();
    const placeholder: Placeholder = {
      placeholder_key: params.placeholder_key,
      category: params.category,
      value_type: params.value_type,
      scope: params.scope,
      owner: params.owner,
      version: 1,
      status: 'draft',
      value: params.value,
      description: params.description,
      created_at: now,
      updated_at: now,
    };

    PlaceholderSchema.parse(placeholder);
    const { valid, errors } = this.validator.validateAll(placeholder);
    if (!valid) {
      throw new Error(`Validation failed: ${errors.map((e) => e.message).join('; ')}`);
    }

    this.placeholders.set(params.placeholder_key, placeholder);
    this.history.set(params.placeholder_key, [{
      version: 1,
      value: params.value,
      status: 'draft',
      actor_id: params.actor_id,
      timestamp: now,
    }]);

    this.audit.append({
      actor_id: params.actor_id,
      action: 'create',
      placeholder_key: params.placeholder_key,
      new_value: params.value,
    });

    return placeholder;
  }

  read(placeholder_key: string): Placeholder {
    const p = this.placeholders.get(placeholder_key);
    if (!p) throw new Error(`Placeholder ${placeholder_key} not found.`);
    return p;
  }

  update(params: UpdatePlaceholderParams): Placeholder {
    const existing = this.read(params.placeholder_key);

    const updated: Placeholder = {
      ...existing,
      value: params.value,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    };

    PlaceholderSchema.parse(updated);
    const { valid, errors } = this.validator.validateAll(updated);
    if (!valid) {
      throw new Error(`Validation failed: ${errors.map((e) => e.message).join('; ')}`);
    }

    this.placeholders.set(params.placeholder_key, updated);

    const historyEntries = this.history.get(params.placeholder_key) ?? [];
    historyEntries.push({
      version: updated.version,
      value: params.value,
      status: updated.status,
      actor_id: params.actor_id,
      timestamp: updated.updated_at,
      reason: params.reason,
    });
    this.history.set(params.placeholder_key, historyEntries);

    this.audit.append({
      actor_id: params.actor_id,
      action: 'update',
      placeholder_key: params.placeholder_key,
      old_value: existing.value,
      new_value: params.value,
    });

    return updated;
  }

  delete(placeholder_key: string, actor_id: string): void {
    const existing = this.read(placeholder_key);
    this.placeholders.delete(placeholder_key);

    this.audit.append({
      actor_id,
      action: 'delete',
      placeholder_key,
      old_value: existing.value,
    });
  }

  transition(placeholder_key: string, to_status: PlaceholderLifecycleType, actor_id: string, reason?: string): Placeholder {
    const existing = this.read(placeholder_key);

    if (!isValidTransition(existing.status, to_status)) {
      throw new Error(`Invalid transition from '${existing.status}' to '${to_status}' for ${placeholder_key}.`);
    }

    const updated: Placeholder = {
      ...existing,
      status: to_status,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    };

    this.placeholders.set(placeholder_key, updated);

    const historyEntries = this.history.get(placeholder_key) ?? [];
    historyEntries.push({
      version: updated.version,
      value: updated.value,
      status: to_status,
      actor_id,
      timestamp: updated.updated_at,
      reason,
    });
    this.history.set(placeholder_key, historyEntries);

    this.audit.append({
      actor_id,
      action: 'transition',
      placeholder_key,
      old_value: existing.status,
      new_value: to_status,
      metadata: { reason },
    });

    return updated;
  }

  rollback(placeholder_key: string, target_version: number, actor_id: string): Placeholder {
    const existing = this.read(placeholder_key);
    const historyEntries = this.history.get(placeholder_key) ?? [];

    const target = historyEntries.find((h) => h.version === target_version);
    if (!target) {
      throw new Error(`Version ${target_version} not found for ${placeholder_key}.`);
    }

    const rolledBack: Placeholder = {
      ...existing,
      value: target.value,
      status: 'draft',
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    };

    this.placeholders.set(placeholder_key, rolledBack);

    historyEntries.push({
      version: rolledBack.version,
      value: target.value,
      status: 'draft',
      actor_id,
      timestamp: rolledBack.updated_at,
      reason: `Rollback to version ${target_version}`,
    });

    this.audit.append({
      actor_id,
      action: 'rollback',
      placeholder_key,
      old_value: existing.value,
      new_value: target.value,
      metadata: { target_version },
    });

    return rolledBack;
  }

  getHistory(placeholder_key: string): PlaceholderVersionEntry[] {
    return [...(this.history.get(placeholder_key) ?? [])];
  }

  list(filter?: { category?: string; scope?: string; status?: string }): Placeholder[] {
    let entries = Array.from(this.placeholders.values());
    if (filter?.category) entries = entries.filter((p) => p.category === filter.category);
    if (filter?.scope) entries = entries.filter((p) => p.scope === filter.scope);
    if (filter?.status) entries = entries.filter((p) => p.status === filter.status);
    return entries;
  }

  exportBundle(environment?: string): { environment: string; placeholders: Placeholder[]; exported_at: string } {
    const all = Array.from(this.placeholders.values());
    return {
      environment: environment ?? 'default',
      placeholders: all,
      exported_at: new Date().toISOString(),
    };
  }

  importBundle(
    bundle: { placeholders: Placeholder[] },
    actor_id: string,
    options?: { overwrite?: boolean },
  ): { imported: number; skipped: number; conflicts: string[] } {
    let imported = 0;
    let skipped = 0;
    const conflicts: string[] = [];

    for (const p of bundle.placeholders) {
      const exists = this.placeholders.has(p.placeholder_key);
      if (exists && !options?.overwrite) {
        conflicts.push(p.placeholder_key);
        skipped++;
        continue;
      }

      PlaceholderSchema.parse(p);
      this.placeholders.set(p.placeholder_key, p);

      this.audit.append({
        actor_id,
        action: 'import',
        placeholder_key: p.placeholder_key,
        new_value: p.value,
      });

      imported++;
    }

    return { imported, skipped, conflicts };
  }

  size(): number {
    return this.placeholders.size;
  }

  clear(): void {
    this.placeholders.clear();
    this.history.clear();
  }
}
