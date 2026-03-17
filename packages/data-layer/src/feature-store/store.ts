import { z } from 'zod';

export const FeatureSchema = z.object({
  feature_id: z.string().min(1),
  asset_id: z.string().min(1),
  feature_name: z.string().min(1),
  feature_type: z.enum(['online', 'offline']),
  value: z.unknown(),
  source_ids: z.array(z.string().min(1)),
  computed_at: z.string().datetime(),
  valid_from: z.string().datetime(),
  valid_to: z.string().datetime().optional(),
  version: z.number().int().positive(),
});

export type Feature = z.infer<typeof FeatureSchema>;

export interface FeatureStoreInterface {
  putOnline(feature: Feature): void;
  putOffline(feature: Feature): void;
  getOnline(asset_id: string, feature_name: string): Feature | undefined;
  getOffline(asset_id: string, feature_name: string): Feature | undefined;
  getPointInTime(asset_id: string, feature_name: string, timestamp: string): Feature | undefined;
  listForAsset(asset_id: string, type?: 'online' | 'offline'): Feature[];
  deleteFeature(feature_id: string): boolean;
  size(): number;
  clear(): void;
}

export class InMemoryFeatureStore implements FeatureStoreInterface {
  private online: Map<string, Feature> = new Map();
  private offline: Map<string, Feature[]> = new Map();

  private onlineKey(asset_id: string, feature_name: string): string {
    return `${asset_id}::${feature_name}`;
  }

  private offlineKey(asset_id: string, feature_name: string): string {
    return `${asset_id}::${feature_name}`;
  }

  putOnline(feature: Feature): void {
    if (feature.feature_type !== 'online') {
      throw new Error('Feature must be of type "online" for putOnline.');
    }
    FeatureSchema.parse(feature);
    const key = this.onlineKey(feature.asset_id, feature.feature_name);
    const existing = this.online.get(key);
    if (existing && existing.version >= feature.version) {
      throw new Error(`Version conflict: existing v${existing.version} >= new v${feature.version}`);
    }
    this.online.set(key, feature);
  }

  putOffline(feature: Feature): void {
    if (feature.feature_type !== 'offline') {
      throw new Error('Feature must be of type "offline" for putOffline.');
    }
    FeatureSchema.parse(feature);
    const key = this.offlineKey(feature.asset_id, feature.feature_name);
    if (!this.offline.has(key)) {
      this.offline.set(key, []);
    }
    this.offline.get(key)!.push(feature);
    this.offline.get(key)!.sort(
      (a, b) => new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime(),
    );
  }

  getOnline(asset_id: string, feature_name: string): Feature | undefined {
    return this.online.get(this.onlineKey(asset_id, feature_name));
  }

  getOffline(asset_id: string, feature_name: string): Feature | undefined {
    const entries = this.offline.get(this.offlineKey(asset_id, feature_name));
    return entries && entries.length > 0 ? entries[entries.length - 1] : undefined;
  }

  getPointInTime(asset_id: string, feature_name: string, timestamp: string): Feature | undefined {
    const entries = this.offline.get(this.offlineKey(asset_id, feature_name));
    if (!entries) return undefined;

    const ts = new Date(timestamp).getTime();
    let result: Feature | undefined;

    for (const f of entries) {
      const from = new Date(f.valid_from).getTime();
      const to = f.valid_to ? new Date(f.valid_to).getTime() : Infinity;
      if (ts >= from && ts < to) {
        result = f;
      }
    }

    return result;
  }

  listForAsset(asset_id: string, type?: 'online' | 'offline'): Feature[] {
    const results: Feature[] = [];

    if (!type || type === 'online') {
      for (const f of this.online.values()) {
        if (f.asset_id === asset_id) results.push(f);
      }
    }

    if (!type || type === 'offline') {
      for (const entries of this.offline.values()) {
        for (const f of entries) {
          if (f.asset_id === asset_id) results.push(f);
        }
      }
    }

    return results;
  }

  deleteFeature(feature_id: string): boolean {
    for (const [key, f] of this.online.entries()) {
      if (f.feature_id === feature_id) {
        this.online.delete(key);
        return true;
      }
    }

    for (const [key, entries] of this.offline.entries()) {
      const idx = entries.findIndex((f) => f.feature_id === feature_id);
      if (idx !== -1) {
        entries.splice(idx, 1);
        if (entries.length === 0) this.offline.delete(key);
        return true;
      }
    }

    return false;
  }

  size(): number {
    let total = this.online.size;
    for (const entries of this.offline.values()) {
      total += entries.length;
    }
    return total;
  }

  clear(): void {
    this.online.clear();
    this.offline.clear();
  }
}
