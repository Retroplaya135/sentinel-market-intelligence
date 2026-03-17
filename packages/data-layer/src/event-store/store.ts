import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';

export const StoredEventSchema = z.object({
  event_id: z.string().min(1),
  sequence_number: z.number().int().nonnegative(),
  stream_id: z.string().min(1),
  event_type: z.string().min(1),
  payload: z.unknown(),
  metadata: z.object({
    trace_id: z.string().min(1),
    source_id: z.string().min(1),
    actor_id: z.string().optional(),
    correlation_id: z.string().optional(),
  }),
  timestamp: z.string().datetime(),
  hash: z.string().min(1),
});

export type StoredEvent = z.infer<typeof StoredEventSchema>;

export interface EventStoreInterface {
  append(stream_id: string, event_type: string, payload: unknown, metadata: StoredEvent['metadata']): StoredEvent;
  getStream(stream_id: string, fromSequence?: number, toSequence?: number): StoredEvent[];
  getByType(event_type: string, limit?: number): StoredEvent[];
  getAll(fromSequence?: number, limit?: number): StoredEvent[];
  getLastSequence(): number;
  streamExists(stream_id: string): boolean;
  streamCount(): number;
  totalEvents(): number;
  replay(stream_id: string, handler: (event: StoredEvent) => void): number;
  clear(): void;
}

export class InMemoryEventStore implements EventStoreInterface {
  private events: StoredEvent[] = [];
  private streams: Map<string, number[]> = new Map();
  private globalSequence = 0;

  append(stream_id: string, event_type: string, payload: unknown, metadata: StoredEvent['metadata']): StoredEvent {
    const sequence_number = this.globalSequence++;
    const previousHash = this.events.length > 0
      ? this.events[this.events.length - 1].hash
      : '0000000000000000000000000000000000000000000000000000000000000000';

    const eventData = JSON.stringify({
      sequence_number,
      stream_id,
      event_type,
      payload,
      metadata,
      previous_hash: previousHash,
    });

    const hash = createHash('sha256').update(eventData).digest('hex');

    const event: StoredEvent = {
      event_id: `evt_${randomUUID()}`,
      sequence_number,
      stream_id,
      event_type,
      payload,
      metadata,
      timestamp: new Date().toISOString(),
      hash,
    };

    StoredEventSchema.parse(event);
    this.events.push(event);

    if (!this.streams.has(stream_id)) {
      this.streams.set(stream_id, []);
    }
    this.streams.get(stream_id)!.push(this.events.length - 1);

    return event;
  }

  getStream(stream_id: string, fromSequence?: number, toSequence?: number): StoredEvent[] {
    const indices = this.streams.get(stream_id);
    if (!indices) return [];

    let events = indices.map((i) => this.events[i]);

    if (fromSequence !== undefined) {
      events = events.filter((e) => e.sequence_number >= fromSequence);
    }
    if (toSequence !== undefined) {
      events = events.filter((e) => e.sequence_number <= toSequence);
    }

    return events;
  }

  getByType(event_type: string, limit?: number): StoredEvent[] {
    const filtered = this.events.filter((e) => e.event_type === event_type);
    return limit ? filtered.slice(-limit) : filtered;
  }

  getAll(fromSequence?: number, limit?: number): StoredEvent[] {
    let result = this.events;
    if (fromSequence !== undefined) {
      result = result.filter((e) => e.sequence_number >= fromSequence);
    }
    if (limit) {
      result = result.slice(0, limit);
    }
    return result;
  }

  getLastSequence(): number {
    return this.globalSequence - 1;
  }

  streamExists(stream_id: string): boolean {
    return this.streams.has(stream_id);
  }

  streamCount(): number {
    return this.streams.size;
  }

  totalEvents(): number {
    return this.events.length;
  }

  replay(stream_id: string, handler: (event: StoredEvent) => void): number {
    const events = this.getStream(stream_id);
    for (const event of events) {
      handler(event);
    }
    return events.length;
  }

  verifyIntegrity(): { valid: boolean; broken_at?: number } {
    if (this.events.length === 0) return { valid: true };

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      const previousHash = i > 0
        ? this.events[i - 1].hash
        : '0000000000000000000000000000000000000000000000000000000000000000';

      const expectedData = JSON.stringify({
        sequence_number: event.sequence_number,
        stream_id: event.stream_id,
        event_type: event.event_type,
        payload: event.payload,
        metadata: event.metadata,
        previous_hash: previousHash,
      });

      const expectedHash = createHash('sha256').update(expectedData).digest('hex');

      if (event.hash !== expectedHash) {
        return { valid: false, broken_at: i };
      }
    }

    return { valid: true };
  }

  clear(): void {
    this.events = [];
    this.streams.clear();
    this.globalSequence = 0;
  }
}
