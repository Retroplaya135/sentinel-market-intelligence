import { z } from 'zod';

export const CONDITIONAL_SOURCE_IDS = ['x_twitter', 'reddit', 'youtube'] as const;
export type ConditionalSourceId = (typeof CONDITIONAL_SOURCE_IDS)[number];

export const ConditionalSourceStateSchema = z.object({
  source_id: z.string().min(1),
  enabled: z.boolean().default(false),
  commercial_agreement_verified: z.boolean().default(false),
  legal_review_complete: z.boolean().default(false),
  activated_at: z.string().datetime().optional(),
  activated_by: z.string().optional(),
});

export type ConditionalSourceState = z.infer<typeof ConditionalSourceStateSchema>;

export interface ConditionalGateResult {
  allowed: boolean;
  source_id: string;
  reason: string;
  missing_requirements: string[];
}

export interface QueryBudgetCheck {
  source_id: string;
  tenant_id: string;
  estimated_cost: number;
  budget_remaining: number;
}

export interface QueryBudgetResult {
  allowed: boolean;
  source_id: string;
  reason: string;
}

export class ConditionalSourceGateService {
  private states: Map<string, ConditionalSourceState> = new Map();

  constructor() {
    for (const id of CONDITIONAL_SOURCE_IDS) {
      this.states.set(id, {
        source_id: id,
        enabled: false,
        commercial_agreement_verified: false,
        legal_review_complete: false,
      });
    }
  }

  check(source_id: string): ConditionalGateResult {
    if (!(CONDITIONAL_SOURCE_IDS as readonly string[]).includes(source_id)) {
      return { allowed: true, source_id, reason: 'Not a conditional source.', missing_requirements: [] };
    }

    const state = this.states.get(source_id);
    if (!state) {
      return { allowed: false, source_id, reason: 'Unknown conditional source.', missing_requirements: ['registration'] };
    }

    const missing: string[] = [];
    if (!state.enabled) missing.push('enabled');
    if (!state.commercial_agreement_verified) missing.push('commercial_agreement_verified');
    if (!state.legal_review_complete) missing.push('legal_review_complete');

    if (missing.length > 0) {
      return {
        allowed: false,
        source_id,
        reason: `Conditional source ${source_id} missing requirements: ${missing.join(', ')}`,
        missing_requirements: missing,
      };
    }

    return { allowed: true, source_id, reason: `Conditional source ${source_id} is fully activated.`, missing_requirements: [] };
  }

  activate(source_id: string, params: {
    commercial_agreement_verified: boolean;
    legal_review_complete: boolean;
    actor_id: string;
  }): ConditionalSourceState {
    const state = this.states.get(source_id);
    if (!state) throw new Error(`Unknown conditional source: ${source_id}`);

    if (!params.commercial_agreement_verified) {
      throw new Error(`Cannot activate ${source_id}: commercial_agreement_verified is required.`);
    }
    if (!params.legal_review_complete) {
      throw new Error(`Cannot activate ${source_id}: legal_review_complete is required.`);
    }

    const updated: ConditionalSourceState = {
      ...state,
      enabled: true,
      commercial_agreement_verified: true,
      legal_review_complete: true,
      activated_at: new Date().toISOString(),
      activated_by: params.actor_id,
    };

    this.states.set(source_id, updated);
    return updated;
  }

  deactivate(source_id: string): ConditionalSourceState {
    const state = this.states.get(source_id);
    if (!state) throw new Error(`Unknown conditional source: ${source_id}`);

    const updated: ConditionalSourceState = {
      ...state,
      enabled: false,
      activated_at: undefined,
      activated_by: undefined,
    };
    this.states.set(source_id, updated);
    return updated;
  }

  getState(source_id: string): ConditionalSourceState | undefined {
    return this.states.get(source_id);
  }

  listAll(): ConditionalSourceState[] {
    return Array.from(this.states.values());
  }

  checkQueryBudget(check: QueryBudgetCheck): QueryBudgetResult {
    if (check.estimated_cost > check.budget_remaining) {
      return {
        allowed: false,
        source_id: check.source_id,
        reason: `Query budget exceeded: cost ${check.estimated_cost} > remaining ${check.budget_remaining}`,
      };
    }
    return { allowed: true, source_id: check.source_id, reason: 'Within budget.' };
  }
}
