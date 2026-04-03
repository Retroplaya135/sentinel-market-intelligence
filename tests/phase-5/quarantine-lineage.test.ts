import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryQuarantineStore } from '../../packages/etl/src/quarantine/quarantine.js';
import { LineageTracker } from '../../packages/etl/src/lineage/tracker.js';

describe('InMemoryQuarantineStore — Core operations', () => {
  let store: InMemoryQuarantineStore;

  beforeEach(() => {
    store = new InMemoryQuarantineStore();
  });

  it('adds a quarantined record', () => {
    const entry = store.add({ bad: true }, {
      source_id: 'onchain_evm',
      reason_type: 'input_contract_violation',
      reason_detail: 'Missing required field: asset_id',
      job_id: 'etl_001',
      severity: 'high',
    });
    expect(entry.quarantine_id).toMatch(/^quar_/);
    expect(entry.resolution).toBe('pending');
    expect(entry.reviewed).toBe(false);
  });

  it('getById retrieves record', () => {
    const entry = store.add({ x: 1 }, {
      source_id: 'src', reason_type: 'transform_error',
      reason_detail: 'Crash', severity: 'medium',
    });
    expect(store.getById(entry.quarantine_id)).toBeDefined();
    expect(store.getById('missing')).toBeUndefined();
  });

  it('getBySource filters correctly', () => {
    store.add({}, { source_id: 'evm', reason_type: 'stale_data', reason_detail: 'old', severity: 'low' });
    store.add({}, { source_id: 'evm', reason_type: 'stale_data', reason_detail: 'old', severity: 'low' });
    store.add({}, { source_id: 'news', reason_type: 'stale_data', reason_detail: 'old', severity: 'low' });
    expect(store.getBySource('evm').length).toBe(2);
    expect(store.getBySource('news').length).toBe(1);
  });

  it('getByReason filters correctly', () => {
    store.add({}, { source_id: 's', reason_type: 'schema_drift', reason_detail: 'd', severity: 'medium' });
    store.add({}, { source_id: 's', reason_type: 'duplicate', reason_detail: 'd', severity: 'low' });
    store.add({}, { source_id: 's', reason_type: 'schema_drift', reason_detail: 'd', severity: 'medium' });
    expect(store.getByReason('schema_drift').length).toBe(2);
    expect(store.getByReason('duplicate').length).toBe(1);
  });

  it('getPending returns only unresolved records', () => {
    const e1 = store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.release(e1.quarantine_id, 'reviewer_1');
    expect(store.getPending().length).toBe(1);
    expect(store.pendingCount()).toBe(1);
  });

  it('release marks record as released', () => {
    const entry = store.add({}, { source_id: 's', reason_type: 'manual_review', reason_detail: 'd', severity: 'medium' });
    const released = store.release(entry.quarantine_id, 'admin_001');
    expect(released.resolution).toBe('released');
    expect(released.reviewed).toBe(true);
    expect(released.reviewed_by).toBe('admin_001');
    expect(released.reviewed_at).toBeTruthy();
  });

  it('discard marks record as discarded', () => {
    const entry = store.add({}, { source_id: 's', reason_type: 'manipulation_suspect', reason_detail: 'd', severity: 'high' });
    const discarded = store.discard(entry.quarantine_id, 'admin_002');
    expect(discarded.resolution).toBe('discarded');
    expect(discarded.reviewed).toBe(true);
  });

  it('cannot release already resolved record', () => {
    const entry = store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.release(entry.quarantine_id, 'admin');
    expect(() => store.release(entry.quarantine_id, 'admin')).toThrow('already resolved');
  });

  it('cannot discard already resolved record', () => {
    const entry = store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.discard(entry.quarantine_id, 'admin');
    expect(() => store.discard(entry.quarantine_id, 'admin')).toThrow('already resolved');
  });

  it('throws on release of nonexistent record', () => {
    expect(() => store.release('missing', 'admin')).toThrow('not found');
  });

  it('size tracks total records', () => {
    store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    expect(store.size()).toBe(2);
  });

  it('clear removes all records', () => {
    store.add({}, { source_id: 's', reason_type: 'stale_data', reason_detail: 'd', severity: 'low' });
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('LineageTracker — Graph construction', () => {
  let tracker: LineageTracker;

  beforeEach(() => {
    tracker = new LineageTracker();
  });

  it('adds nodes with correct types', () => {
    const src = tracker.addNode('source', 'onchain_evm');
    const transform = tracker.addNode('transform', 'normalize');
    const dest = tracker.addNode('destination', 'hot_path_store');
    expect(src.node_type).toBe('source');
    expect(transform.node_type).toBe('transform');
    expect(dest.node_type).toBe('destination');
    expect(tracker.nodeCount()).toBe(3);
  });

  it('adds edges between nodes', () => {
    const src = tracker.addNode('source', 'evm');
    const transform = tracker.addNode('transform', 'score');
    const edge = tracker.addEdge(src.node_id, transform.node_id, 'feeds_into', { record_count: 100 });
    expect(edge.from_node_id).toBe(src.node_id);
    expect(edge.to_node_id).toBe(transform.node_id);
    expect(edge.record_count).toBe(100);
    expect(tracker.edgeCount()).toBe(1);
  });

  it('throws on edge with missing node', () => {
    const src = tracker.addNode('source', 'evm');
    expect(() => tracker.addEdge(src.node_id, 'missing', 'feeds_into')).toThrow('not found');
  });

  it('builds a complete lineage graph', () => {
    const src = tracker.addNode('source', 'onchain_evm');
    const normalize = tracker.addNode('transform', 'normalize');
    const score = tracker.addNode('transform', 'score');
    const dest = tracker.addNode('destination', 'hot_path_store');
    const qc = tracker.addNode('quality_check', 'freshness_check');

    tracker.addEdge(src.node_id, normalize.node_id, 'feeds_into', { record_count: 500 });
    tracker.addEdge(normalize.node_id, qc.node_id, 'triggers');
    tracker.addEdge(normalize.node_id, score.node_id, 'feeds_into', { record_count: 490 });
    tracker.addEdge(score.node_id, dest.node_id, 'produces', { record_count: 490 });

    const graph = tracker.buildGraph('etl_job_001');
    expect(graph.nodes.length).toBe(5);
    expect(graph.edges.length).toBe(4);
    expect(graph.job_id).toBe('etl_job_001');
  });
});

describe('LineageTracker — Tracing', () => {
  let tracker: LineageTracker;
  let srcId: string;
  let normId: string;
  let scoreId: string;
  let destId: string;

  beforeEach(() => {
    tracker = new LineageTracker();
    const src = tracker.addNode('source', 'evm');
    const norm = tracker.addNode('transform', 'normalize');
    const score = tracker.addNode('transform', 'score');
    const dest = tracker.addNode('destination', 'store');
    srcId = src.node_id;
    normId = norm.node_id;
    scoreId = score.node_id;
    destId = dest.node_id;
    tracker.addEdge(srcId, normId, 'feeds_into');
    tracker.addEdge(normId, scoreId, 'feeds_into');
    tracker.addEdge(scoreId, destId, 'produces');
  });

  it('traceUpstream from destination finds all ancestors', () => {
    const upstream = tracker.traceUpstream(destId);
    expect(upstream.length).toBe(3);
    const names = upstream.map((n) => n.name);
    expect(names).toContain('evm');
    expect(names).toContain('normalize');
    expect(names).toContain('score');
  });

  it('traceDownstream from source finds all descendants', () => {
    const downstream = tracker.traceDownstream(srcId);
    expect(downstream.length).toBe(3);
    const names = downstream.map((n) => n.name);
    expect(names).toContain('normalize');
    expect(names).toContain('score');
    expect(names).toContain('store');
  });

  it('traceUpstream from source returns empty', () => {
    const upstream = tracker.traceUpstream(srcId);
    expect(upstream.length).toBe(0);
  });

  it('traceDownstream from destination returns empty', () => {
    const downstream = tracker.traceDownstream(destId);
    expect(downstream.length).toBe(0);
  });

  it('getEdgesFrom returns outgoing edges', () => {
    const edges = tracker.getEdgesFrom(normId);
    expect(edges.length).toBe(1);
    expect(edges[0].to_node_id).toBe(scoreId);
  });

  it('getEdgesTo returns incoming edges', () => {
    const edges = tracker.getEdgesTo(scoreId);
    expect(edges.length).toBe(1);
    expect(edges[0].from_node_id).toBe(normId);
  });

  it('getNode returns node by ID', () => {
    const node = tracker.getNode(srcId);
    expect(node?.name).toBe('evm');
  });

  it('clear resets everything', () => {
    tracker.clear();
    expect(tracker.nodeCount()).toBe(0);
    expect(tracker.edgeCount()).toBe(0);
  });
});
