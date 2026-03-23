import { z } from 'zod';
import { isBlockedSource } from '../blocked-sources/guards.js';
import { CONDITIONAL_SOURCE_IDS } from '../conditional-gates/gates.js';

export const TrainingJobRequestSchema = z.object({
  job_id: z.string().min(1),
  model_id: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  dataset_id: z.string().min(1),
  requested_by: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type TrainingJobRequest = z.infer<typeof TrainingJobRequestSchema>;

export interface TrainingGateDecision {
  allowed: boolean;
  job_id: string;
  blocked_sources: string[];
  conditional_sources: string[];
  reason: string;
  timestamp: string;
}

export function evaluateTrainingGate(request: TrainingJobRequest): TrainingGateDecision {
  TrainingJobRequestSchema.parse(request);

  const blocked: string[] = [];
  const conditional: string[] = [];

  for (const source_id of request.source_ids) {
    if (isBlockedSource(source_id)) {
      blocked.push(source_id);
    } else if ((CONDITIONAL_SOURCE_IDS as readonly string[]).includes(source_id)) {
      conditional.push(source_id);
    }
  }

  const violations = [...blocked, ...conditional];

  if (violations.length > 0) {
    const parts: string[] = [];
    if (blocked.length > 0) {
      parts.push(`BLOCKED sources: ${blocked.join(', ')}`);
    }
    if (conditional.length > 0) {
      parts.push(`CONDITIONAL sources (no training allowed): ${conditional.join(', ')}`);
    }

    return {
      allowed: false,
      job_id: request.job_id,
      blocked_sources: blocked,
      conditional_sources: conditional,
      reason: `Training REJECTED — ${parts.join('; ')}. No foundation model training on restricted-source content.`,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    allowed: true,
    job_id: request.job_id,
    blocked_sources: [],
    conditional_sources: [],
    reason: 'Training ALLOWED — all sources are rights-clean.',
    timestamp: new Date().toISOString(),
  };
}
