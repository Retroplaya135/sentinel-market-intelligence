import { z } from 'zod';

export const SloLayer = z.enum(['interactive', 'stream', 'background']);
export type SloLayerType = z.infer<typeof SloLayer>;

export const LatencyTargetSchema = z.object({
  description: z.string().min(1),
  p95_ms: z.number().positive(),
  p99_ms: z.number().positive(),
  layer: SloLayer,
}).refine(
  (data) => data.p99_ms >= data.p95_ms,
  { message: 'p99 must be >= p95' },
);

export type LatencyTarget = z.input<typeof LatencyTargetSchema>;

export const AvailabilityTargetSchema = z.object({
  target: z.number().min(0).max(1),
  measurement_window: z.string().min(1),
});

export type AvailabilityTarget = z.infer<typeof AvailabilityTargetSchema>;

export const FreshnessTargetSchema = z.object({
  max_staleness_seconds: z.number().positive(),
});

export type FreshnessTarget = z.infer<typeof FreshnessTargetSchema>;

export const DegradationMode = z.enum(['read_only', 'core_only', 'conditional_sources_off']);

export const DegradationModeConfigSchema = z.object({
  description: z.string().min(1),
  trigger: z.string().min(1),
});

export type DegradationModeConfig = z.infer<typeof DegradationModeConfigSchema>;

export const RecoveryObjectiveSchema = z.record(z.string(), z.string().min(1)).refine(
  (data) => Object.keys(data).length >= 2,
  { message: 'Recovery objective must have at least 2 entries (critical + standard)' },
);

export const CorrectnessTargetSchema = z.object({
  description: z.string().min(1),
  target: z.union([z.number(), z.string()]),
  measurement: z.string().min(1),
});

export type CorrectnessTarget = z.infer<typeof CorrectnessTargetSchema>;

export const SloPolicyContractSchema = z.object({
  version: z.string(),
  contract_type: z.literal('slo_policy'),
  slo_layers: z.record(z.string(), z.object({ description: z.string() })),
  latency_targets: z.record(z.string(), z.any()),
  availability_targets: z.record(z.string(), AvailabilityTargetSchema),
  freshness_targets: z.record(z.string(), FreshnessTargetSchema),
  correctness_targets: z.record(z.string(), CorrectnessTargetSchema).optional(),
  degradation_modes: z.record(z.string(), DegradationModeConfigSchema),
  slo_enforcement: z.array(z.string()).min(1),
  recovery_objectives: z.object({
    rto: RecoveryObjectiveSchema,
    rpo: RecoveryObjectiveSchema,
  }),
});

export type SloPolicyContract = z.infer<typeof SloPolicyContractSchema>;

export function isWithinLatencySlo(actualMs: number, target: LatencyTarget, percentile: 'p95' | 'p99'): boolean {
  const limit = percentile === 'p95' ? target.p95_ms : target.p99_ms;
  return actualMs <= limit;
}
