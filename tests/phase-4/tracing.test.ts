import { describe, it, expect } from 'vitest';
import { createTraceContext, TraceCollector } from '../../packages/app-layer/src/tracing/trace-context.js';

describe('Execution Tracing — Trace ID propagation', () => {
  it('creates trace context with unique IDs', () => {
    const ctx = createTraceContext('ingestion', 'fetch');
    expect(ctx.trace_id).toMatch(/^trace_/);
    expect(ctx.span_id).toMatch(/^span_/);
    expect(ctx.service).toBe('ingestion');
    expect(ctx.operation).toBe('fetch');
    expect(ctx.parent_span_id).toBeUndefined();
  });

  it('child span inherits parent trace_id', () => {
    const parent = createTraceContext('ingestion', 'fetch');
    const child = createTraceContext('normalization', 'normalize', parent);
    expect(child.trace_id).toBe(parent.trace_id);
    expect(child.parent_span_id).toBe(parent.span_id);
    expect(child.span_id).not.toBe(parent.span_id);
  });

  it('deep nesting preserves trace_id across chain', () => {
    const root = createTraceContext('ingestion', 'fetch');
    const mid = createTraceContext('scoring', 'score', root);
    const leaf = createTraceContext('fusion', 'fuse', mid);
    expect(leaf.trace_id).toBe(root.trace_id);
    expect(leaf.parent_span_id).toBe(mid.span_id);
  });
});

describe('TraceCollector', () => {
  it('records and retrieves spans', () => {
    const collector = new TraceCollector();
    const ctx = createTraceContext('ingestion', 'fetch');
    collector.record(ctx);
    expect(collector.getAll().length).toBe(1);
  });

  it('filters by trace_id', () => {
    const collector = new TraceCollector();
    const root = createTraceContext('ingestion', 'fetch');
    const child = createTraceContext('scoring', 'score', root);
    const unrelated = createTraceContext('alerting', 'eval');

    collector.record(root);
    collector.record(child);
    collector.record(unrelated);

    const related = collector.getByTraceId(root.trace_id);
    expect(related.length).toBe(2);
    expect(related[0].service).toBe('ingestion');
    expect(related[1].service).toBe('scoring');
  });

  it('clear removes all spans', () => {
    const collector = new TraceCollector();
    collector.record(createTraceContext('x', 'y'));
    collector.clear();
    expect(collector.getAll().length).toBe(0);
  });

  it('full pipeline trace propagation', () => {
    const collector = new TraceCollector();
    const services = ['ingestion', 'normalization', 'scoring', 'fusion', 'alerting'] as const;
    let parent = createTraceContext(services[0], 'process');
    collector.record(parent);

    for (let i = 1; i < services.length; i++) {
      const span = createTraceContext(services[i], 'process', parent);
      collector.record(span);
      parent = span;
    }

    const trace = collector.getByTraceId(parent.trace_id);
    expect(trace.length).toBe(5);
    // All share the same trace_id
    const traceIds = new Set(trace.map((s) => s.trace_id));
    expect(traceIds.size).toBe(1);
    // Each span has unique span_id
    const spanIds = new Set(trace.map((s) => s.span_id));
    expect(spanIds.size).toBe(5);
  });
});
