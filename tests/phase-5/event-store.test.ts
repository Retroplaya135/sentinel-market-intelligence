import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore, StoredEventSchema } from '../../packages/data-layer/src/event-store/store.js';

describe('InMemoryEventStore — Append-only + replay', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('appends event with auto-incrementing sequence', () => {
    const e1 = store.append('stream_btc', 'score_computed', { score: 0.5 }, { trace_id: 't1', source_id: 'scorer' });
    const e2 = store.append('stream_btc', 'alert_fired', { threshold: 0.8 }, { trace_id: 't1', source_id: 'alerter' });
    expect(e1.sequence_number).toBe(0);
    expect(e2.sequence_number).toBe(1);
    expect(e1.event_id).toMatch(/^evt_/);
  });

  it('each event passes Zod validation', () => {
    const e = store.append('s1', 'test', { data: 1 }, { trace_id: 't', source_id: 's' });
    expect(StoredEventSchema.safeParse(e).success).toBe(true);
  });

  it('events have SHA-256 hash chain', () => {
    store.append('s1', 'a', {}, { trace_id: 't', source_id: 's' });
    store.append('s1', 'b', {}, { trace_id: 't', source_id: 's' });
    store.append('s1', 'c', {}, { trace_id: 't', source_id: 's' });
    const events = store.getAll();
    for (const e of events) {
      expect(e.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('verifyIntegrity passes for untampered store', () => {
    store.append('s1', 'a', { x: 1 }, { trace_id: 't', source_id: 's' });
    store.append('s1', 'b', { x: 2 }, { trace_id: 't', source_id: 's' });
    store.append('s2', 'c', { x: 3 }, { trace_id: 't', source_id: 's' });
    expect(store.verifyIntegrity().valid).toBe(true);
  });

  it('getStream returns events for specific stream', () => {
    store.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    store.append('eth', 'b', {}, { trace_id: 't', source_id: 's' });
    store.append('btc', 'c', {}, { trace_id: 't', source_id: 's' });
    expect(store.getStream('btc').length).toBe(2);
    expect(store.getStream('eth').length).toBe(1);
    expect(store.getStream('sol').length).toBe(0);
  });

  it('getStream with range filters correctly', () => {
    store.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    store.append('btc', 'b', {}, { trace_id: 't', source_id: 's' });
    store.append('btc', 'c', {}, { trace_id: 't', source_id: 's' });
    const range = store.getStream('btc', 1, 1);
    expect(range.length).toBe(1);
    expect(range[0].event_type).toBe('b');
  });

  it('getByType filters correctly', () => {
    store.append('s1', 'score', {}, { trace_id: 't', source_id: 's' });
    store.append('s1', 'alert', {}, { trace_id: 't', source_id: 's' });
    store.append('s2', 'score', {}, { trace_id: 't', source_id: 's' });
    expect(store.getByType('score').length).toBe(2);
    expect(store.getByType('alert').length).toBe(1);
  });

  it('getByType with limit returns most recent', () => {
    for (let i = 0; i < 10; i++) {
      store.append('s1', 'tick', { i }, { trace_id: 't', source_id: 's' });
    }
    const last3 = store.getByType('tick', 3);
    expect(last3.length).toBe(3);
  });

  it('replay calls handler for each event in order', () => {
    store.append('btc', 'a', { n: 1 }, { trace_id: 't', source_id: 's' });
    store.append('btc', 'b', { n: 2 }, { trace_id: 't', source_id: 's' });
    store.append('btc', 'c', { n: 3 }, { trace_id: 't', source_id: 's' });

    const replayed: unknown[] = [];
    const count = store.replay('btc', (e) => replayed.push(e.payload));
    expect(count).toBe(3);
    expect(replayed).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('streamExists and streamCount work', () => {
    store.append('btc', 'a', {}, { trace_id: 't', source_id: 's' });
    store.append('eth', 'b', {}, { trace_id: 't', source_id: 's' });
    expect(store.streamExists('btc')).toBe(true);
    expect(store.streamExists('sol')).toBe(false);
    expect(store.streamCount()).toBe(2);
  });

  it('totalEvents tracks count', () => {
    expect(store.totalEvents()).toBe(0);
    store.append('s1', 'a', {}, { trace_id: 't', source_id: 's' });
    store.append('s1', 'b', {}, { trace_id: 't', source_id: 's' });
    expect(store.totalEvents()).toBe(2);
  });

  it('getLastSequence returns -1 for empty store', () => {
    expect(store.getLastSequence()).toBe(-1);
  });

  it('getLastSequence increments correctly', () => {
    store.append('s1', 'a', {}, { trace_id: 't', source_id: 's' });
    expect(store.getLastSequence()).toBe(0);
    store.append('s1', 'b', {}, { trace_id: 't', source_id: 's' });
    expect(store.getLastSequence()).toBe(1);
  });

  it('clear resets everything', () => {
    store.append('s1', 'a', {}, { trace_id: 't', source_id: 's' });
    store.clear();
    expect(store.totalEvents()).toBe(0);
    expect(store.streamCount()).toBe(0);
    expect(store.getLastSequence()).toBe(-1);
  });
});
