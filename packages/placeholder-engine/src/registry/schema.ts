import { z } from 'zod';

export const PlaceholderCategory = z.enum([
  'prompt', 'scoring_weight', 'threshold', 'template', 'feature_flag', 'cost_cap',
]);
export type PlaceholderCategoryType = z.infer<typeof PlaceholderCategory>;

export const PlaceholderScope = z.enum(['global', 'tenant', 'tier', 'region']);
export type PlaceholderScopeType = z.infer<typeof PlaceholderScope>;

export const PlaceholderValueType = z.enum(['string', 'number', 'boolean', 'json', 'secret_ref']);
export type PlaceholderValueTypeType = z.infer<typeof PlaceholderValueType>;

export const PlaceholderLifecycle = z.enum(['draft', 'review', 'approved', 'published', 'reverted', 'archived']);
export type PlaceholderLifecycleType = z.infer<typeof PlaceholderLifecycle>;

export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['review', 'archived'],
  review: ['approved', 'draft'],
  approved: ['published', 'draft'],
  published: ['reverted', 'archived'],
  reverted: ['draft', 'published', 'archived'],
  archived: [],
};

export const PlaceholderSchema = z.object({
  placeholder_key: z.string().min(1).regex(/^[a-z][a-z0-9_.]*$/, 'Key must be lowercase alphanumeric with dots/underscores'),
  category: PlaceholderCategory,
  value_type: PlaceholderValueType,
  scope: PlaceholderScope,
  owner: z.string().min(1),
  version: z.number().int().positive(),
  status: PlaceholderLifecycle,
  value: z.unknown(),
  description: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Placeholder = z.infer<typeof PlaceholderSchema>;

export const PlaceholderVersionEntrySchema = z.object({
  version: z.number().int().positive(),
  value: z.unknown(),
  status: PlaceholderLifecycle,
  actor_id: z.string().min(1),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export type PlaceholderVersionEntry = z.infer<typeof PlaceholderVersionEntrySchema>;

export function isValidTransition(from: PlaceholderLifecycleType, to: PlaceholderLifecycleType): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
