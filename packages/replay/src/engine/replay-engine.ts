import { z } from 'zod';
import type { EventStoreInterface, StoredEvent } from '@sentinel/data-layer';
import type { SnapshotStoreInterface, Snapshot } from '@sentinel/data-layer';

export const ReplayRequestSchema = z.object({
  replay_id: z.string().min(1),
  stream_id: z.string().min(1),
  from_sequence: z.number().int().nonnegative(),
  to_sequence: z.number().int().nonnegative(),
  asset_id: z.string().min(1),
  requested_by: z.string().min(1),
  requested_at: z.string().datetime(),
});

export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;

export const ReplayStepSchema = z.object({
  sequence_number: z.number().int().nonnegative(),
  event_type: z.string().min(1),
  original_payload: z.unknown(),
  replayed_result: z.unknown(),
  matches_original: z.boolean(),
  deviation: z.number().nonnegative().optional(),
  step_duration_ms: z.number().nonnegative(),
});

export type ReplayStep = z.infer<typeof ReplayStepSchema>;

export const ReplayResultSchema = z.object({
  replay_id: z.string().min(1),
  stream_id: z.string().min(1),
  asset_id: z.string().min(1),
  total_events: z.number().int().nonnegative(),
  replayed_events: z.number().int().nonnegative(),
  matching_events: z.number().int().nonnegative(),
  divergent_events: z.number().int().nonnegative(),
  deterministic: z.boolean(),
  steps: z.array(ReplayStepSchema),
  total_duration_ms: z.number().nonnegative(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  base_snapshot_id: z.string().optional(),
});

export type ReplayResult = z.infer<typeof ReplayResultSchema>;

export type ReplayHandler = (event: StoredEvent) => unknown;

export class ReplayEngine {
  private readonly eventStore: EventStoreInterface;
  private readonly snapshotStore?: SnapshotStoreInterface;

  constructor(eventStore: EventStoreInterface, snapshotStore?: SnapshotStoreInterface) {
    this.eventStore = eventStore;
    this.snapshotStore = snapshotStore;
  }

  async replay(request: ReplayRequest, handler: ReplayHandler): Promise<ReplayResult> {
    ReplayRequestSchema.parse(request);
    const started_at = new Date().toISOString();
    const startTime = Date.now();

    const events = this.eventStore.getStream(request.stream_id, request.from_sequence, request.to_sequence);

    let baseSnapshotId: string | undefined;
    if (this.snapshotStore) {
      const snap = this.snapshotStore.getAtSequence(request.asset_id, request.from_sequence);
      if (snap) baseSnapshotId = snap.snapshot_id;
    }

    const steps: ReplayStep[] = [];
    let matching = 0;
    let divergent = 0;

    for (const event of events) {
      const stepStart = Date.now();
      let replayed: unknown;

      try {
        replayed = await handler(event);
      } catch (err) {
        replayed = { error: err instanceof Error ? err.message : String(err) };
      }

      const matchesOriginal = this.deepEqual(event.payload, replayed);
      const deviation = this.computeDeviation(event.payload, replayed);

      if (matchesOriginal) matching++;
      else divergent++;

      steps.push({
        sequence_number: event.sequence_number,
        event_type: event.event_type,
        original_payload: event.payload,
        replayed_result: replayed,
        matches_original: matchesOriginal,
        deviation,
        step_duration_ms: Date.now() - stepStart,
      });
    }

    const completed_at = new Date().toISOString();

    const result: ReplayResult = {
      replay_id: request.replay_id,
      stream_id: request.stream_id,
      asset_id: request.asset_id,
      total_events: events.length,
      replayed_events: steps.length,
      matching_events: matching,
      divergent_events: divergent,
      deterministic: divergent === 0,
      steps,
      total_duration_ms: Date.now() - startTime,
      started_at,
      completed_at,
      base_snapshot_id: baseSnapshotId,
    };

    ReplayResultSchema.parse(result);
    return result;
  }

  reconstructState(asset_id: string, targetSequence: number): { snapshot?: Snapshot; events: StoredEvent[] } {
    let snapshot: Snapshot | undefined;
    let fromSequence = 0;

    if (this.snapshotStore) {
      snapshot = this.snapshotStore.getAtSequence(asset_id, targetSequence);
      if (snapshot) {
        fromSequence = snapshot.event_sequence + 1;
      }
    }

    const events = this.eventStore.getStream(asset_id, fromSequence, targetSequence);
    return { snapshot, events };
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private computeDeviation(original: unknown, replayed: unknown): number {
    if (typeof original === 'number' && typeof replayed === 'number') {
      return Math.abs(original - replayed);
    }

    if (original && typeof original === 'object' && replayed && typeof replayed === 'object') {
      const origObj = original as Record<string, unknown>;
      const repObj = replayed as Record<string, unknown>;
      let totalDev = 0;
      let count = 0;

      for (const key of Object.keys(origObj)) {
        if (typeof origObj[key] === 'number' && typeof repObj[key] === 'number') {
          totalDev += Math.abs((origObj[key]) - (repObj[key]));
          count++;
        }
      }

      return count > 0 ? totalDev / count : (this.deepEqual(original, replayed) ? 0 : 1);
    }

    return this.deepEqual(original, replayed) ? 0 : 1;
  }
}
