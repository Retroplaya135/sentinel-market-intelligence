import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from '../../packages/module-system/src/events/event-bus.js';

describe('InMemoryEventBus — Publish/Subscribe', () => {
  it('subscriber receives published events', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];

    bus.subscribe<string>('test.topic', (event) => { received.push(event); });
    await bus.publish('test.topic', 'hello');

    expect(received).toEqual(['hello']);
  });

  it('multiple subscribers all receive the event', async () => {
    const bus = new InMemoryEventBus();
    const r1: number[] = [];
    const r2: number[] = [];

    bus.subscribe<number>('numbers', (e) => { r1.push(e); });
    bus.subscribe<number>('numbers', (e) => { r2.push(e); });
    await bus.publish('numbers', 42);

    expect(r1).toEqual([42]);
    expect(r2).toEqual([42]);
  });

  it('unsubscribe removes handler', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];

    const unsub = bus.subscribe<string>('topic', (e) => { received.push(e); });
    await bus.publish('topic', 'first');
    unsub();
    await bus.publish('topic', 'second');

    expect(received).toEqual(['first']);
  });

  it('unsubscribeAll removes all handlers for topic', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];

    bus.subscribe<string>('topic', (e) => { received.push(e); });
    bus.subscribe<string>('topic', (e) => { received.push(e + '!'); });
    bus.unsubscribeAll('topic');
    await bus.publish('topic', 'test');

    expect(received).toEqual([]);
  });

  it('publish to topic with no subscribers is a no-op', async () => {
    const bus = new InMemoryEventBus();
    await expect(bus.publish('empty.topic', 'data')).resolves.toBeUndefined();
  });

  it('listTopics returns active topics', () => {
    const bus = new InMemoryEventBus();
    bus.subscribe('a', () => {});
    bus.subscribe('b', () => {});
    expect(bus.listTopics().sort()).toEqual(['a', 'b']);
  });

  it('topic removed from list when last subscriber unsubscribes', () => {
    const bus = new InMemoryEventBus();
    const unsub = bus.subscribe('temp', () => {});
    expect(bus.listTopics()).toContain('temp');
    unsub();
    expect(bus.listTopics()).not.toContain('temp');
  });

  it('clear removes all topics and handlers', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.subscribe<string>('a', (e) => { received.push(e); });
    bus.clear();
    await bus.publish('a', 'test');
    expect(received).toEqual([]);
    expect(bus.listTopics()).toEqual([]);
  });

  it('handles async subscribers', async () => {
    const bus = new InMemoryEventBus();
    const received: number[] = [];

    bus.subscribe<number>('async', async (e) => {
      await new Promise((r) => setTimeout(r, 5));
      received.push(e);
    });
    await bus.publish('async', 99);

    expect(received).toEqual([99]);
  });
});
