import { randomUUID } from 'crypto';

export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  service: string;
  operation: string;
  started_at: string;
  metadata: Record<string, unknown>;
}

export function createTraceContext(service: string, operation: string, parent?: TraceContext): TraceContext {
  return {
    trace_id: parent?.trace_id ?? `trace_${randomUUID()}`,
    span_id: `span_${randomUUID()}`,
    parent_span_id: parent?.span_id,
    service,
    operation,
    started_at: new Date().toISOString(),
    metadata: {},
  };
}

export class TraceCollector {
  private spans: TraceContext[] = [];

  record(span: TraceContext): void {
    this.spans.push(span);
  }

  getByTraceId(trace_id: string): TraceContext[] {
    return this.spans.filter((s) => s.trace_id === trace_id);
  }

  getAll(): readonly TraceContext[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }
}
