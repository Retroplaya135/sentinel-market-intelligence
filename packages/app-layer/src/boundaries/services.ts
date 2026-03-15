import { z } from 'zod';

export const ServiceName = z.enum([
  'ingestion', 'normalization', 'scoring', 'fusion', 'alerting', 'explain', 'replay',
]);
export type ServiceNameType = z.infer<typeof ServiceName>;

export const ServiceBoundarySchema = z.object({
  name: ServiceName,
  description: z.string().min(1),
  inputs: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)).min(1),
  dependencies: z.array(ServiceName).default([]),
  policy_checks: z.array(z.string().min(1)).default([]),
});

export type ServiceBoundary = z.infer<typeof ServiceBoundarySchema>;

export const SERVICE_BOUNDARIES: ServiceBoundary[] = [
  {
    name: 'ingestion',
    description: 'Collects raw data from connectors, deduplicates, tags provenance',
    inputs: ['connector_output'],
    outputs: ['raw_record'],
    dependencies: [],
    policy_checks: ['source_policy', 'retention_policy'],
  },
  {
    name: 'normalization',
    description: 'Normalizes raw records into canonical schema',
    inputs: ['raw_record'],
    outputs: ['normalized_record'],
    dependencies: ['ingestion'],
    policy_checks: [],
  },
  {
    name: 'scoring',
    description: 'Scores normalized records using scorer modules',
    inputs: ['normalized_record'],
    outputs: ['scored_signal'],
    dependencies: ['normalization'],
    policy_checks: ['entitlement'],
  },
  {
    name: 'fusion',
    description: 'Fuses multi-source scores into composite signal',
    inputs: ['scored_signal'],
    outputs: ['fused_signal'],
    dependencies: ['scoring'],
    policy_checks: ['entitlement'],
  },
  {
    name: 'alerting',
    description: 'Evaluates alert conditions and dispatches notifications',
    inputs: ['fused_signal'],
    outputs: ['alert_event'],
    dependencies: ['fusion'],
    policy_checks: ['entitlement'],
  },
  {
    name: 'explain',
    description: 'Generates evidence-linked explanations for signals',
    inputs: ['fused_signal', 'scored_signal'],
    outputs: ['explanation'],
    dependencies: ['fusion'],
    policy_checks: [],
  },
  {
    name: 'replay',
    description: 'Snapshots signal state for point-in-time replay',
    inputs: ['fused_signal', 'explanation'],
    outputs: ['snapshot'],
    dependencies: ['fusion', 'explain'],
    policy_checks: ['retention_policy'],
  },
];

export function getServiceBoundary(name: ServiceNameType): ServiceBoundary | undefined {
  return SERVICE_BOUNDARIES.find((s) => s.name === name);
}

export function getServiceDependencyOrder(): ServiceNameType[] {
  return ['ingestion', 'normalization', 'scoring', 'fusion', 'alerting', 'explain', 'replay'];
}
