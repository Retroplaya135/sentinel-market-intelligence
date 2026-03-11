import { z } from 'zod';

export const EventMetadataSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().min(1),
  timestamp: z.string().datetime(),
  source_id: z.string().min(1),
  trace_id: z.string().uuid(),
  version: z.string().min(1),
});

export type EventMetadata = z.infer<typeof EventMetadataSchema>;

export const PolicyEventSchema = EventMetadataSchema.extend({
  event_type: z.literal('policy_event'),
  payload: z.object({
    policy_id: z.string().min(1),
    action: z.enum(['source_blocked', 'source_enabled', 'source_disabled', 'policy_changed', 'exception_granted', 'exception_revoked']),
    source_id: z.string().min(1),
    actor_id: z.string().min(1),
    reason: z.string().min(1),
  }),
});

export type PolicyEvent = z.infer<typeof PolicyEventSchema>;

export const QualityEventSchema = EventMetadataSchema.extend({
  event_type: z.literal('quality_event'),
  payload: z.object({
    metric_id: z.string().min(1),
    value: z.number(),
    threshold: z.number(),
    status: z.enum(['ok', 'warning', 'critical']),
  }),
});

export type QualityEvent = z.infer<typeof QualityEventSchema>;

export const CostEventSchema = EventMetadataSchema.extend({
  event_type: z.literal('cost_event'),
  payload: z.object({
    tenant_id: z.string().min(1),
    budget_id: z.string().min(1),
    consumed: z.number().nonnegative(),
    limit: z.number().positive(),
    action: z.enum(['warn', 'throttle', 'degrade', 'pause']),
  }),
});

export type CostEvent = z.infer<typeof CostEventSchema>;

export const SecurityEventSchema = EventMetadataSchema.extend({
  event_type: z.literal('security_event'),
  payload: z.object({
    severity: z.enum(['info', 'warning', 'critical']),
    category: z.string().min(1),
    actor_id: z.string().optional(),
    details: z.string().min(1),
  }),
});

export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

export type PlatformEvent = PolicyEvent | QualityEvent | CostEvent | SecurityEvent;
