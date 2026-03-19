export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface EventBusInterface {
  publish<T>(topic: string, event: T): Promise<void>;
  subscribe<T>(topic: string, handler: EventHandler<T>): () => void;
  unsubscribeAll(topic: string): void;
  listTopics(): string[];
}

export class InMemoryEventBus implements EventBusInterface {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  async publish<T>(topic: string, event: T): Promise<void> {
    const topicHandlers = this.handlers.get(topic);
    if (!topicHandlers) return;
    const promises = Array.from(topicHandlers, async (handler) => {
      await handler(event);
    });
    await Promise.all(promises);
  }

  subscribe<T>(topic: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
    }
    const topicHandlers = this.handlers.get(topic)!;
    const wrappedHandler = handler as EventHandler;
    topicHandlers.add(wrappedHandler);

    return () => {
      topicHandlers.delete(wrappedHandler);
      if (topicHandlers.size === 0) {
        this.handlers.delete(topic);
      }
    };
  }

  unsubscribeAll(topic: string): void {
    this.handlers.delete(topic);
  }

  listTopics(): string[] {
    return Array.from(this.handlers.keys());
  }

  clear(): void {
    this.handlers.clear();
  }
}
