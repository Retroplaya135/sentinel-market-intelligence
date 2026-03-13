import { z } from 'zod';

export const ClaimSchema = z.object({
  claim_id: z.string().uuid(),
  evidence_ref: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  invalidation_rule: z.string().min(1),
  source_provenance: z.array(z.string().min(1)).min(1),
});

export type Claim = z.infer<typeof ClaimSchema>;

export const EvidenceStandard = z.enum(['verified', 'provisional', 'unverified']);
export type EvidenceStandardType = z.infer<typeof EvidenceStandard>;

export const ProductPositioning = z.enum(['decision_support_only']);
export const ProhibitedPositioning = z.enum([
  'guaranteed_trade_execution',
  'guaranteed_profit',
  'auto_trade_advice',
  'financial_advice',
]);

export const ProductOutputSchema = z.object({
  description: z.string().min(1),
  evidence_required: z.literal(true),
});

export const ProductContractSchema = z.object({
  version: z.string(),
  contract_type: z.literal('product'),
  product: z.object({
    name: z.string().min(1),
    classification: z.literal('decision_support_intelligence_platform'),
    positioning: ProductPositioning,
    prohibited_positioning: z.array(ProhibitedPositioning).min(1),
  }),
  claim_mode: z.object({
    type: z.literal('evidence_linked'),
    requirements: z.object({
      every_signal_has_claim_id: z.literal(true),
      every_signal_has_evidence_ref: z.literal(true),
      every_signal_has_confidence: z.literal(true),
      every_signal_has_invalidation_rule: z.literal(true),
    }),
    claim_schema: z.object({
      claim_id: z.object({ type: z.literal('string'), format: z.literal('uuid'), required: z.literal(true) }),
      evidence_ref: z.object({ type: z.literal('array'), items: z.object({ type: z.literal('string'), format: z.literal('uri_or_id') }), min_items: z.literal(1), required: z.literal(true) }),
      confidence: z.object({ type: z.literal('number'), min: z.literal(0.0), max: z.literal(1.0), required: z.literal(true) }),
      invalidation_rule: z.object({ type: z.literal('string'), min_length: z.literal(1), required: z.literal(true) }),
      source_provenance: z.object({ type: z.literal('array'), items: z.object({ type: z.literal('string') }), min_items: z.literal(1), required: z.literal(true) }),
    }),
  }),
  product_outputs: z.object({
    now_score: ProductOutputSchema,
    why_now: ProductOutputSchema,
    alert: ProductOutputSchema,
    replay: ProductOutputSchema,
    reliability: ProductOutputSchema,
  }),
  evidence_standard: z.object({
    verified: z.string(),
    provisional: z.string(),
    unverified: z.string(),
  }),
  adr_template: z.object({
    fields: z.array(z.string()).min(1),
    placeholder_prefix: z.string(),
    placeholder_suffix: z.string(),
  }),
  language_rollout: z.object({
    phase_mvp: z.literal('en'),
    phase_2: z.literal('en_zh'),
    phase_2_gate: z.string(),
    other_languages: z.string(),
  }),
  messaging_rules: z.array(z.string()).min(1),
});

export type ProductContract = z.infer<typeof ProductContractSchema>;
