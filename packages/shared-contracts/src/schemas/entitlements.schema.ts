import { z } from 'zod';

export const BudgetAction = z.enum(['warn', 'throttle', 'degrade', 'pause']);
export type BudgetActionType = z.infer<typeof BudgetAction>;

export const TierEntitlementSchema = z.object({
  requests_per_day: z.union([z.number().int().nonnegative(), z.literal('negotiated')]),
  alerts_max: z.union([z.number().int().nonnegative(), z.literal('negotiated')]),
  realtime_depth: z.enum(['none', 'standard', 'deep', 'full']),
  llm_explain_calls_per_day: z.union([z.number().int().nonnegative(), z.literal('negotiated')]),
  stream_minutes_per_day: z.union([z.number().int().nonnegative(), z.literal('negotiated')]),
  api_access: z.boolean(),
  replay_access: z.boolean(),
  export_access: z.boolean(),
  team_seats: z.union([z.number().int().positive(), z.literal('negotiated')]).optional(),
  sla_backed: z.boolean().optional(),
  dedicated_support: z.boolean().optional(),
  audit_export: z.boolean().optional(),
  white_label: z.string().optional(),
});

export type TierEntitlement = z.infer<typeof TierEntitlementSchema>;

export const TierDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price_monthly_usd: z.union([z.number().nonnegative(), z.literal('custom')]),
  cogs_cap_usd: z.union([z.number().nonnegative(), z.literal('negotiated'), z.literal(0)]),
  target_margin: z.number().min(0).max(1).optional(),
  description: z.string().min(1),
  entitlements: TierEntitlementSchema,
  signal_delay_minutes: z.number().int().nonnegative(),
});

export type TierDefinition = z.infer<typeof TierDefinitionSchema>;

export const MarginRulesSchema = z.object({
  target_gross_margin: z.number().min(0).max(1),
  max_variable_cogs_ratio: z.number().min(0).max(1),
  formula: z.string().min(1),
  enforcement: z.array(z.string()).min(1),
});

export type MarginRules = z.infer<typeof MarginRulesSchema>;

export const BudgetActionConfigSchema = z.object({
  trigger: z.string().min(1),
  action: z.string().min(1),
});

export const RuntimeBudgetControlsSchema = z.object({
  per_request_budget: z.object({ enabled: z.literal(true), description: z.string() }),
  per_tenant_budget: z.object({ enabled: z.literal(true), description: z.string() }),
  budget_actions: z.object({
    warn: BudgetActionConfigSchema,
    throttle: BudgetActionConfigSchema,
    degrade: BudgetActionConfigSchema,
    pause: BudgetActionConfigSchema,
  }),
});

export type RuntimeBudgetControls = z.infer<typeof RuntimeBudgetControlsSchema>;

export const EntitlementsContractSchema = z.object({
  version: z.string(),
  contract_type: z.literal('entitlements'),
  margin_rules: MarginRulesSchema,
  tiers: z.record(z.string(), z.any()),
  runtime_budget_controls: RuntimeBudgetControlsSchema,
  cost_optimization_priorities: z.array(z.string()).min(1),
  enforcement_rules: z.array(z.string()).min(1),
});

export type EntitlementsContract = z.infer<typeof EntitlementsContractSchema>;

export const TIER_IDS = ['free', 'pro', 'trader', 'desk', 'enterprise'] as const;
export type TierId = (typeof TIER_IDS)[number];

export function validateMarginTarget(priceUsd: number, cogsCap: number, targetMargin: number): boolean {
  if (priceUsd <= 0) return false;
  const margin = (priceUsd - cogsCap) / priceUsd;
  return margin >= targetMargin;
}
