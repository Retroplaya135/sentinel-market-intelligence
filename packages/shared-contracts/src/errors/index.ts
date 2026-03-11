export const ErrorCategory = {
  SOURCE_POLICY: 'SRC_POLICY',
  BUDGET: 'BUDGET',
  AUTH: 'AUTH',
  VALIDATION: 'VALIDATION',
  CONNECTOR: 'CONNECTOR',
  SCORING: 'SCORING',
  COMPLIANCE: 'COMPLIANCE',
  SYSTEM: 'SYSTEM',
} as const;

export type ErrorCategoryType = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const ErrorCode = {
  SRC_POLICY_BLOCKED: 'SRC_POLICY_BLOCKED',
  SRC_POLICY_CONDITIONAL_DISABLED: 'SRC_POLICY_CONDITIONAL_DISABLED',
  SRC_POLICY_AGREEMENT_MISSING: 'SRC_POLICY_AGREEMENT_MISSING',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  BUDGET_WARN: 'BUDGET_WARN',
  BUDGET_THROTTLED: 'BUDGET_THROTTLED',
  BUDGET_DEGRADED: 'BUDGET_DEGRADED',
  BUDGET_PAUSED: 'BUDGET_PAUSED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  VALIDATION_SCHEMA: 'VALIDATION_SCHEMA',
  VALIDATION_EVIDENCE_MISSING: 'VALIDATION_EVIDENCE_MISSING',
  VALIDATION_CLAIM_INCOMPLETE: 'VALIDATION_CLAIM_INCOMPLETE',
  CONNECTOR_UNAVAILABLE: 'CONNECTOR_UNAVAILABLE',
  CONNECTOR_RATE_LIMITED: 'CONNECTOR_RATE_LIMITED',
  CONNECTOR_CIRCUIT_OPEN: 'CONNECTOR_CIRCUIT_OPEN',
  SCORING_TIMEOUT: 'SCORING_TIMEOUT',
  SCORING_CALIBRATION_DRIFT: 'SCORING_CALIBRATION_DRIFT',
  COMPLIANCE_RETENTION_VIOLATION: 'COMPLIANCE_RETENTION_VIOLATION',
  COMPLIANCE_TRAINING_BLOCKED: 'COMPLIANCE_TRAINING_BLOCKED',
  COMPLIANCE_DELETION_FAILED: 'COMPLIANCE_DELETION_FAILED',
  SYSTEM_INTERNAL: 'SYSTEM_INTERNAL',
  SYSTEM_DEPENDENCY_FAILURE: 'SYSTEM_DEPENDENCY_FAILURE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export const RetryClass = {
  NO_RETRY: 'no_retry',
  IMMEDIATE_RETRY: 'immediate_retry',
  BACKOFF_RETRY: 'backoff_retry',
  DEFERRED_RETRY: 'deferred_retry',
} as const;

export type RetryClassType = (typeof RetryClass)[keyof typeof RetryClass];

export interface PlatformError {
  code: ErrorCodeType;
  category: ErrorCategoryType;
  message: string;
  request_id?: string;
  retry_class: RetryClassType;
  details?: Record<string, unknown>;
}

export function createPlatformError(
  code: ErrorCodeType,
  message: string,
  options?: {
    request_id?: string;
    details?: Record<string, unknown>;
  },
): PlatformError {
  const categoryMap: Record<string, ErrorCategoryType> = {
    SRC_POLICY: ErrorCategory.SOURCE_POLICY,
    BUDGET: ErrorCategory.BUDGET,
    AUTH: ErrorCategory.AUTH,
    VALIDATION: ErrorCategory.VALIDATION,
    CONNECTOR: ErrorCategory.CONNECTOR,
    SCORING: ErrorCategory.SCORING,
    COMPLIANCE: ErrorCategory.COMPLIANCE,
    SYSTEM: ErrorCategory.SYSTEM,
  };

  const retryMap: Record<string, RetryClassType> = {
    SRC_POLICY: RetryClass.NO_RETRY,
    BUDGET: RetryClass.NO_RETRY,
    AUTH: RetryClass.NO_RETRY,
    VALIDATION: RetryClass.NO_RETRY,
    CONNECTOR: RetryClass.BACKOFF_RETRY,
    SCORING: RetryClass.IMMEDIATE_RETRY,
    COMPLIANCE: RetryClass.NO_RETRY,
    SYSTEM: RetryClass.BACKOFF_RETRY,
  };

  const knownPrefixes = ['SRC_POLICY', 'BUDGET', 'AUTH', 'VALIDATION', 'CONNECTOR', 'SCORING', 'COMPLIANCE', 'SYSTEM'];
  const prefix = knownPrefixes.find((p) => code.startsWith(p)) ?? 'SYSTEM';
  const category = categoryMap[prefix] ?? ErrorCategory.SYSTEM;
  const retry_class = retryMap[prefix] ?? RetryClass.NO_RETRY;

  return {
    code,
    category,
    message,
    retry_class,
    request_id: options?.request_id,
    details: options?.details,
  };
}
