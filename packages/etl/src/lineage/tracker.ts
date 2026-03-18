import { z } from 'zod';
import { randomUUID } from 'crypto';

export const LineageNodeType = z.enum(['source', 'transform', 'destination', 'quality_check', 'quarantine']);
export type LineageNodeTypeValue = z.infer<typeof LineageNodeType>;

export const LineageNodeSchema = z.object({
  node_id: z.string().min(1),
  node_type: LineageNodeType,
  name: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
});

export type LineageNode = z.infer<typeof LineageNodeSchema>;

export const LineageEdgeSchema = z.object({
  edge_id: z.string().min(1),
  from_node_id: z.string().min(1),
  to_node_id: z.string().min(1),
  relationship: z.enum(['feeds_into', 'produces', 'triggers', 'quarantines']),
  record_count: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
});

export type LineageEdge = z.infer<typeof LineageEdgeSchema>;

export const LineageGraphSchema = z.object({
  graph_id: z.string().min(1),
  job_id: z.string().min(1),
  nodes: z.array(LineageNodeSchema),
  edges: z.array(LineageEdgeSchema),
  created_at: z.string().datetime(),
});

export type LineageGraph = z.infer<typeof LineageGraphSchema>;

export class LineageTracker {
  private nodes: Map<string, LineageNode> = new Map();
  private edges: LineageEdge[] = [];
  private graphs: Map<string, LineageGraph> = new Map();

  addNode(node_type: LineageNodeTypeValue, name: string, metadata?: Record<string, unknown>): LineageNode {
    const node: LineageNode = {
      node_id: `ln_${randomUUID()}`,
      node_type,
      name,
      metadata: metadata ?? {},
      created_at: new Date().toISOString(),
    };
    LineageNodeSchema.parse(node);
    this.nodes.set(node.node_id, node);
    return node;
  }

  addEdge(from_node_id: string, to_node_id: string, relationship: LineageEdge['relationship'], params?: {
    record_count?: number;
    metadata?: Record<string, unknown>;
  }): LineageEdge {
    if (!this.nodes.has(from_node_id)) throw new Error(`Source node ${from_node_id} not found.`);
    if (!this.nodes.has(to_node_id)) throw new Error(`Target node ${to_node_id} not found.`);

    const edge: LineageEdge = {
      edge_id: `le_${randomUUID()}`,
      from_node_id,
      to_node_id,
      relationship,
      record_count: params?.record_count,
      metadata: params?.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    LineageEdgeSchema.parse(edge);
    this.edges.push(edge);
    return edge;
  }

  buildGraph(job_id: string): LineageGraph {
    const graph: LineageGraph = {
      graph_id: `lg_${randomUUID()}`,
      job_id,
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
      created_at: new Date().toISOString(),
    };
    LineageGraphSchema.parse(graph);
    this.graphs.set(graph.graph_id, graph);
    return graph;
  }

  traceUpstream(node_id: string): LineageNode[] {
    const visited = new Set<string>();
    const result: LineageNode[] = [];
    this.traceUpstreamRecursive(node_id, visited, result);
    return result;
  }

  traceDownstream(node_id: string): LineageNode[] {
    const visited = new Set<string>();
    const result: LineageNode[] = [];
    this.traceDownstreamRecursive(node_id, visited, result);
    return result;
  }

  getNode(node_id: string): LineageNode | undefined {
    return this.nodes.get(node_id);
  }

  getEdgesFrom(node_id: string): LineageEdge[] {
    return this.edges.filter((e) => e.from_node_id === node_id);
  }

  getEdgesTo(node_id: string): LineageEdge[] {
    return this.edges.filter((e) => e.to_node_id === node_id);
  }

  getGraph(graph_id: string): LineageGraph | undefined {
    return this.graphs.get(graph_id);
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    return this.edges.length;
  }

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.graphs.clear();
  }

  private traceUpstreamRecursive(node_id: string, visited: Set<string>, result: LineageNode[]): void {
    if (visited.has(node_id)) return;
    visited.add(node_id);

    const incomingEdges = this.edges.filter((e) => e.to_node_id === node_id);
    for (const edge of incomingEdges) {
      const upstream = this.nodes.get(edge.from_node_id);
      if (upstream) {
        result.push(upstream);
        this.traceUpstreamRecursive(edge.from_node_id, visited, result);
      }
    }
  }

  private traceDownstreamRecursive(node_id: string, visited: Set<string>, result: LineageNode[]): void {
    if (visited.has(node_id)) return;
    visited.add(node_id);

    const outgoingEdges = this.edges.filter((e) => e.from_node_id === node_id);
    for (const edge of outgoingEdges) {
      const downstream = this.nodes.get(edge.to_node_id);
      if (downstream) {
        result.push(downstream);
        this.traceDownstreamRecursive(edge.to_node_id, visited, result);
      }
    }
  }
}
