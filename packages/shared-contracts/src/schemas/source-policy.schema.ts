import { z } from 'zod';

export const PolicyMode = z.enum(['allow', 'conditional', 'blocked']);
export type PolicyModeType = z.infer<typeof PolicyMode>;

export const ModelUsageSchema = z.object({
  inference: z.boolean(),
  training: z.union([z.boolean(), z.string()]),
  calibration: z.union([z.boolean(), z.string()]),
});

export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const SourceDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  policy_mode: PolicyMode,
  phase: z.string().min(1),
  default_enabled: z.boolean().optional(),
  blocked_reason: z.string().optional(),
  hard_guard: z.boolean().optional(),
  model_usage: ModelUsageSchema,
  notes: z.string().optional(),
}).refine(
  (data) => {
    if (data.policy_mode === 'blocked') {
      return data.hard_guard === true && typeof data.blocked_reason === 'string' && data.blocked_reason.length > 0;
    }
    return true;
  },
  { message: 'Blocked sources must have hard_guard=true and a blocked_reason' },
).refine(
  (data) => {
    if (data.policy_mode === 'blocked') {
      return data.model_usage.inference === false && data.model_usage.training === false && data.model_usage.calibration === false;
    }
    return true;
  },
  { message: 'Blocked sources must have all model_usage set to false' },
).refine(
  (data) => {
    if (data.policy_mode === 'conditional') {
      return data.default_enabled === false;
    }
    return true;
  },
  { message: 'Conditional sources must be disabled by default (default_enabled=false)' },
);

export type SourceDefinition = z.input<typeof SourceDefinitionSchema>;

export const ForbiddenSourceGuardrailSchema = z.object({
  rule_id: z.string().min(1),
  name: z.string().min(1),
  source_id: z.string().min(1),
  action: z.literal('hard_block'),
  ci_test_required: z.literal(true),
});

export type ForbiddenSourceGuardrail = z.infer<typeof ForbiddenSourceGuardrailSchema>;

export const BlockedSourceAlertSchema = z.object({
  targets: z.array(z.string()).min(1),
  log_fields: z.array(z.string()).min(1),
});

export const SourcePolicyContractSchema = z.object({
  version: z.string(),
  contract_type: z.literal('source_policy'),
  policy_modes: z.object({
    allow: z.object({ description: z.string(), default_enabled: z.literal(true), requires_legal_review: z.literal(false) }),
    conditional: z.object({ description: z.string(), default_enabled: z.literal(false), requires_legal_review: z.literal(true), requires_commercial_agreement_verified: z.literal(true) }),
    blocked: z.object({ description: z.string(), default_enabled: z.literal(false), requires_legal_review: z.literal(true), requires_exception_approval: z.literal(true), exception_mechanism: z.literal('consent_scoped_override'), exception_requires: z.array(z.record(z.boolean())) }),
  }),
  sources: z.record(z.string(), z.any()),
  forbidden_source_guardrails: z.array(ForbiddenSourceGuardrailSchema).min(3),
  blocked_source_alerts: BlockedSourceAlertSchema,
});

export type SourcePolicyContract = z.infer<typeof SourcePolicyContractSchema>;

export const BLOCKED_SOURCE_IDS = ['telegram_public', 'discord_mining', 'tiktok_research'] as const;
export const CONDITIONAL_SOURCE_IDS = ['x_twitter', 'reddit', 'youtube'] as const;
export const ALLOWED_SOURCE_IDS = ['onchain_evm', 'onchain_solana', 'exchange_market_data', 'licensed_news_rss', 'first_party'] as const;
