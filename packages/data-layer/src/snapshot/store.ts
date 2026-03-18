import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';

export const SnapshotSchema = z.object({
  snapshot_id: z.string().min(1),
  asset_id: z.string().min(1),
  snapshot_type: z.enum(['score', 'fusion', 'alert', 'explanation', 'full_state']),
  data: z.unknown(),
  source_ids: z.array(z.string().min(1)),
  model_version: z.string().min(1),
  event_sequence: z.number().int().nonnegative(),
  content_hash: z.string().min(1),
  created_at: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

export interface SnapshotStoreInterface {
  capture(params: Omit<Snapshot, 'snapshot_id' | 'content_hash' | 'created_at'>): Snapshot;
  getById(snapshot_id: string): Snapshot | undefined;
  getByAsset(asset_id: string, snapshot_type?: string): Snapshot[];
  getAtSequence(asset_id: string, sequence: number): Snapshot | undefined;
  getLatest(asset_id: string, snapshot_type?: string): Snapshot | undefined;
  list(limit?: number): Snapshot[];
  pruneOlderThan(days: number): number;
  size(): number;
  clear(): void;
}

export class InMemorySnapshotStore implements SnapshotStoreInterface {
  private snapshots: Map<string, Snapshot> = new Map();
  private assetIndex: Map<string, string[]> = new Map();

  capture(params: Omit<Snapshot, 'snapshot_id' | 'content_hash' | 'created_at'>): Snapshot {
    const contentHash = createHash('sha256')
      .update(JSON.stringify({ asset_id: params.asset_id, data: params.data, event_sequence: params.event_sequence }))
      .digest('hex');

    const snapshot: Snapshot = {
      ...params,
      snapshot_id: `snap_${randomUUID()}`,
      content_hash: contentHash,
      created_at: new Date().toISOString(),
    };

    SnapshotSchema.parse(snapshot);
    this.snapshots.set(snapshot.snapshot_id, snapshot);

    if (!this.assetIndex.has(params.asset_id)) {
      this.assetIndex.set(params.asset_id, []);
    }
    this.assetIndex.get(params.asset_id)!.push(snapshot.snapshot_id);

    return snapshot;
  }

  getById(snapshot_id: string): Snapshot | undefined {
    return this.snapshots.get(snapshot_id);
  }

  getByAsset(asset_id: string, snapshot_type?: string): Snapshot[] {
    const ids = this.assetIndex.get(asset_id) ?? [];
    let results = ids.map((id) => this.snapshots.get(id)!).filter(Boolean);
    if (snapshot_type) {
      results = results.filter((s) => s.snapshot_type === snapshot_type);
    }
    return results.sort((a, b) => a.event_sequence - b.event_sequence);
  }

  getAtSequence(asset_id: string, sequence: number): Snapshot | undefined {
    const snaps = this.getByAsset(asset_id);
    let closest: Snapshot | undefined;
    for (const s of snaps) {
      if (s.event_sequence <= sequence) {
        closest = s;
      }
    }
    return closest;
  }

  getLatest(asset_id: string, snapshot_type?: string): Snapshot | undefined {
    const snaps = this.getByAsset(asset_id, snapshot_type);
    return snaps.length > 0 ? snaps[snaps.length - 1] : undefined;
  }

  list(limit?: number): Snapshot[] {
    const all = Array.from(this.snapshots.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return limit ? all.slice(0, limit) : all;
  }

  pruneOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 3600000);
    let pruned = 0;
    for (const [id, snap] of this.snapshots.entries()) {
      if (new Date(snap.created_at) < cutoff) {
        this.snapshots.delete(id);
        const assetIds = this.assetIndex.get(snap.asset_id);
        if (assetIds) {
          const idx = assetIds.indexOf(id);
          if (idx !== -1) assetIds.splice(idx, 1);
        }
        pruned++;
      }
    }
    return pruned;
  }

  size(): number {
    return this.snapshots.size;
  }

  clear(): void {
    this.snapshots.clear();
    this.assetIndex.clear();
  }
}
