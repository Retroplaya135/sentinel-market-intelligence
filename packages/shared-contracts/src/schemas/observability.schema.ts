import { z } from 'zod';

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevelType = z.infer<typeof LogLevel>;

export const StructuredLogEntrySchema = z.object({
  log_id: z.string().min(1),
  timestamp: z.string().datetime(),
  level: LogLevel,
  service: z.string().min(1),
  message: z.string().min(1),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  tenant_id: z.string().optional(),
  actor_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  error: z.object({
    code: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }).optional(),
  duration_ms: z.number().nonnegative().optional(),
});
export type StructuredLogEntry = z.infer<typeof StructuredLogEntrySchema>;

export const MetricType = z.enum(['counter', 'gauge', 'histogram', 'summary']);
export type MetricTypeValue = z.infer<typeof MetricType>;

export const MetricPointSchema = z.object({
  metric_id: z.string().min(1),
  name: z.string().min(1),
  type: MetricType,
  value: z.number(),
  timestamp: z.string().datetime(),
  service: z.string().min(1),
  tenant_id: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  unit: z.string().optional(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export const SloTargetSchema = z.object({
  slo_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  metric: z.enum(['latency_p99', 'latency_p95', 'freshness', 'correctness', 'availability', 'error_rate']),
  target_value: z.number(),
  operator: z.enum(['lte', 'gte']),
  window_seconds: z.number().positive(),
  service: z.string().min(1),
  tier: z.enum(['free', 'pro', 'trader', 'desk', 'enterprise']).optional(),
});
export type SloTarget = z.infer<typeof SloTargetSchema>;

export const SloObservationSchema = z.object({
  slo_id: z.string().min(1),
  observed_value: z.number(),
  timestamp: z.string().datetime(),
  within_target: z.boolean(),
});
export type SloObservation = z.infer<typeof SloObservationSchema>;

export const ReliabilityDimension = z.enum(['availability', 'latency', 'error_rate', 'freshness', 'correctness']);
export type ReliabilityDimensionType = z.infer<typeof ReliabilityDimension>;

export const ReliabilityScoreSchema = z.object({
  score_id: z.string().min(1),
  subject_type: z.enum(['release', 'connector', 'service']),
  subject_id: z.string().min(1),
  overall_score: z.number().min(0).max(100),
  dimensions: z.record(ReliabilityDimension, z.number().min(0).max(100)),
  pass: z.boolean(),
  pass_threshold: z.number().min(0).max(100),
  computed_at: z.string().datetime(),
  window_hours: z.number().positive(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ReliabilityScore = z.infer<typeof ReliabilityScoreSchema>;

export const ComponentHealthStatus = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export type ComponentHealthStatusType = z.infer<typeof ComponentHealthStatus>;

export const ComponentHealthSchema = z.object({
  component_id: z.string().min(1),
  name: z.string().min(1),
  status: ComponentHealthStatus,
  last_check_at: z.string().datetime(),
  latency_ms: z.number().nonnegative().optional(),
  error_message: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ComponentHealth = z.infer<typeof ComponentHealthSchema>;

export const SystemHealthSchema = z.object({
  status: ComponentHealthStatus,
  checked_at: z.string().datetime(),
  components: z.array(ComponentHealthSchema),
  summary: z.object({
    total: z.number(),
    healthy: z.number(),
    degraded: z.number(),
    unhealthy: z.number(),
    unknown: z.number(),
  }),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
