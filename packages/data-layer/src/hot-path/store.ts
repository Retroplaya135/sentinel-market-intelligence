import { z } from 'zod';

export const HotPathRecordSchema = z.object({
  key: z.string().min(1),
  asset_id: z.string().min(1),
  record_type: z.enum(['score', 'alert', 'signal', 'fusion', 'explanation']),
  data: z.unknown(),
  source_ids: z.array(z.string().min(1)),
  version: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  ttl_ms: z.number().int().positive().optional(),
  expires_at: z.string().datetime().optional(),
});

export type HotPathRecord = z.infer<typeof HotPathRecordSchema>;

export interface HotPathStoreInterface {
  get(key: string): HotPathRecord | undefined;
  getByAsset(asset_id: string, record_type?: string): HotPathRecord[];
  put(record: HotPathRecord): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  size(): number;
  pruneExpired(): number;
  clear(): void;
}

export class InMemoryHotPathStore implements HotPathStoreInterface {
  private store: Map<string, HotPathRecord> = new Map();
  private assetIndex: Map<string, Set<string>> = new Map();

  get(key: string): HotPathRecord | undefined {
    const record = this.store.get(key);
    if (!record) return undefined;

    if (record.expires_at && new Date(record.expires_at) <= new Date()) {
      this.delete(key);
      return undefined;
    }

    return record;
  }

  getByAsset(asset_id: string, record_type?: string): HotPathRecord[] {
    const keys = this.assetIndex.get(asset_id);
    if (!keys) return [];

    const now = new Date();
    const results: HotPathRecord[] = [];

    for (const key of keys) {
      const record = this.store.get(key);
      if (!record) continue;
      if (record.expires_at && new Date(record.expires_at) <= now) {
        this.delete(key);
        continue;
      }
      if (record_type && record.record_type !== record_type) continue;
      results.push(record);
    }

    return results;
  }

  put(record: HotPathRecord): void {
    HotPathRecordSchema.parse(record);

    if (record.ttl_ms && !record.expires_at) {
      record = {
        ...record,
        expires_at: new Date(Date.now() + record.ttl_ms).toISOString(),
      };
    }

    const existing = this.store.get(record.key);
    if (existing && existing.version >= record.version) {
      throw new Error(`Version conflict: existing v${existing.version} >= new v${record.version} for key ${record.key}`);
    }

    this.store.set(record.key, record);

    if (!this.assetIndex.has(record.asset_id)) {
      this.assetIndex.set(record.asset_id, new Set());
    }
    this.assetIndex.get(record.asset_id)!.add(record.key);
  }

  delete(key: string): boolean {
    const record = this.store.get(key);
    if (!record) return false;

    this.store.delete(key);
    const assetKeys = this.assetIndex.get(record.asset_id);
    if (assetKeys) {
      assetKeys.delete(key);
      if (assetKeys.size === 0) this.assetIndex.delete(record.asset_id);
    }
    return true;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  size(): number {
    return this.store.size;
  }

  pruneExpired(): number {
    const now = new Date();
    let pruned = 0;
    for (const [key, record] of this.store.entries()) {
      if (record.expires_at && new Date(record.expires_at) <= now) {
        this.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  clear(): void {
    this.store.clear();
    this.assetIndex.clear();
  }
}
