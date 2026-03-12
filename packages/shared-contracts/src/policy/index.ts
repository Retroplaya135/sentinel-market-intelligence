import type { PolicyModeType } from '../schemas/source-policy.schema.js';

export interface SourcePolicyCheck {
  source_id: string;
  policy_mode: PolicyModeType;
  is_enabled: boolean;
  commercial_agreement_verified: boolean;
}

export interface SourcePolicyResult {
  allowed: boolean;
  reason: string;
  source_id: string;
  policy_mode: PolicyModeType;
}

export function checkSourcePolicy(check: SourcePolicyCheck): SourcePolicyResult {
  if (check.policy_mode === 'blocked') {
    return {
      allowed: false,
      reason: `Source ${check.source_id} is BLOCKED by policy. Hard guard active.`,
      source_id: check.source_id,
      policy_mode: check.policy_mode,
    };
  }

  if (check.policy_mode === 'conditional') {
    if (!check.is_enabled) {
      return {
        allowed: false,
        reason: `Source ${check.source_id} is CONDITIONAL and currently disabled.`,
        source_id: check.source_id,
        policy_mode: check.policy_mode,
      };
    }
    if (!check.commercial_agreement_verified) {
      return {
        allowed: false,
        reason: `Source ${check.source_id} requires commercial_agreement_verified before activation.`,
        source_id: check.source_id,
        policy_mode: check.policy_mode,
      };
    }
    return {
      allowed: true,
      reason: `Source ${check.source_id} is CONDITIONAL and activated with verified agreement.`,
      source_id: check.source_id,
      policy_mode: check.policy_mode,
    };
  }

  return {
    allowed: true,
    reason: `Source ${check.source_id} is ALLOWED by policy.`,
    source_id: check.source_id,
    policy_mode: check.policy_mode,
  };
}

export interface TrainingRightsCheck {
  source_id: string;
  policy_mode: PolicyModeType;
  training_allowed: boolean | string;
}

export interface TrainingRightsResult {
  allowed: boolean;
  reason: string;
}

export function checkTrainingRights(check: TrainingRightsCheck): TrainingRightsResult {
  if (check.policy_mode === 'blocked') {
    return {
      allowed: false,
      reason: `Training BLOCKED: source ${check.source_id} is a blocked source.`,
    };
  }

  if (check.policy_mode === 'conditional') {
    return {
      allowed: false,
      reason: `Training BLOCKED: source ${check.source_id} is conditional. No foundation model training on restricted-source content.`,
    };
  }

  if (check.training_allowed === false) {
    return {
      allowed: false,
      reason: `Training BLOCKED: source ${check.source_id} has training=false in policy.`,
    };
  }

  if (typeof check.training_allowed === 'string') {
    return {
      allowed: false,
      reason: `Training CONDITIONAL: source ${check.source_id} requires ${check.training_allowed} before training is allowed.`,
    };
  }

  return {
    allowed: true,
    reason: `Training ALLOWED for source ${check.source_id}.`,
  };
}
