import { z } from 'zod';

export const ConsentScopedOverrideSchema = z.object({
  override_id: z.string().min(1),
  source_id: z.string().min(1),
  legal_approval: z.literal(true),
  approved_by: z.string().min(1),
  approved_at: z.string().datetime(),
  expiry_date: z.string().datetime(),
  scope_description: z.string().min(1),
  conditions: z.array(z.string().min(1)).min(1),
  two_person_review: z.object({
    reviewer_1: z.string().min(1),
    reviewer_2: z.string().min(1),
  }),
});

export type ConsentScopedOverride = z.infer<typeof ConsentScopedOverrideSchema>;

export class ExceptionRegistry {
  private overrides: Map<string, ConsentScopedOverride> = new Map();

  grant(override: ConsentScopedOverride): ConsentScopedOverride {
    ConsentScopedOverrideSchema.parse(override);

    if (override.two_person_review.reviewer_1 === override.two_person_review.reviewer_2) {
      throw new Error('Two-person review requires different reviewers.');
    }

    const expiry = new Date(override.expiry_date);
    if (expiry <= new Date()) {
      throw new Error('Override expiry_date must be in the future.');
    }

    this.overrides.set(override.override_id, override);
    return override;
  }

  revoke(override_id: string): void {
    if (!this.overrides.has(override_id)) {
      throw new Error(`Override ${override_id} not found.`);
    }
    this.overrides.delete(override_id);
  }

  check(source_id: string): { has_valid_override: boolean; override?: ConsentScopedOverride } {
    const now = new Date();
    for (const override of this.overrides.values()) {
      if (override.source_id === source_id) {
        const expiry = new Date(override.expiry_date);
        if (expiry > now) {
          return { has_valid_override: true, override };
        }
      }
    }
    return { has_valid_override: false };
  }

  pruneExpired(): number {
    const now = new Date();
    let pruned = 0;
    for (const [id, override] of this.overrides.entries()) {
      if (new Date(override.expiry_date) <= now) {
        this.overrides.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  listAll(): ConsentScopedOverride[] {
    return Array.from(this.overrides.values());
  }
}
