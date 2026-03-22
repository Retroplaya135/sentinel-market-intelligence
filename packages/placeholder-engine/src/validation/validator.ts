import { z } from 'zod';
import type { Placeholder, PlaceholderValueTypeType } from '../registry/schema.js';

export interface ValidationRule {
  rule_id: string;
  check: (value: unknown, placeholder: Placeholder) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  rule_id: string;
  message?: string;
}

export function typeCheck(value: unknown, expected_type: PlaceholderValueTypeType): ValidationResult {
  const rule_id = 'type_check';
  switch (expected_type) {
    case 'string':
      return { valid: typeof value === 'string', rule_id, message: typeof value !== 'string' ? `Expected string, got ${typeof value}` : undefined };
    case 'number':
      return { valid: typeof value === 'number' && !Number.isNaN(value), rule_id, message: typeof value !== 'number' ? `Expected number, got ${typeof value}` : undefined };
    case 'boolean':
      return { valid: typeof value === 'boolean', rule_id, message: typeof value !== 'boolean' ? `Expected boolean, got ${typeof value}` : undefined };
    case 'json':
      return { valid: typeof value === 'object' && value !== null, rule_id, message: typeof value !== 'object' ? `Expected object, got ${typeof value}` : undefined };
    case 'secret_ref':
      return validateSecretRef(value);
    default:
      return { valid: false, rule_id, message: `Unknown type: ${expected_type as string}` };
  }
}

export function validateSecretRef(value: unknown): ValidationResult {
  const rule_id = 'secret_ref_check';
  if (typeof value !== 'string') {
    return { valid: false, rule_id, message: 'secret_ref must be a string' };
  }
  if (!value.startsWith('secret://')) {
    return { valid: false, rule_id, message: 'secret_ref must start with secret://' };
  }
  if (value.includes(' ') || value.length < 12) {
    return { valid: false, rule_id, message: 'secret_ref format invalid' };
  }
  return { valid: true, rule_id };
}

export function rejectPlaintextSecret(value: unknown): ValidationResult {
  const rule_id = 'plaintext_rejection';
  if (typeof value !== 'string') {
    return { valid: true, rule_id };
  }
  const suspiciousPatterns = [
    /^sk[-_]/i, /^api[-_]?key/i, /^token[-_]/i, /^secret[-_]/i,
    /^password/i, /^bearer\s/i, /^basic\s/i,
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(value)) {
      return { valid: false, rule_id, message: 'Value appears to be a plaintext secret. Use secret_ref pattern instead.' };
    }
  }
  return { valid: true, rule_id };
}

export interface SafeRangeConfig {
  min?: number;
  max?: number;
}

export function safeRangeCheck(value: unknown, range: SafeRangeConfig): ValidationResult {
  const rule_id = 'safe_range';
  if (typeof value !== 'number') {
    return { valid: true, rule_id };
  }
  if (range.min !== undefined && value < range.min) {
    return { valid: false, rule_id, message: `Value ${value} is below minimum ${range.min}` };
  }
  if (range.max !== undefined && value > range.max) {
    return { valid: false, rule_id, message: `Value ${value} is above maximum ${range.max}` };
  }
  return { valid: true, rule_id };
}

export function schemaCheck(value: unknown, schema: z.ZodSchema): ValidationResult {
  const rule_id = 'schema_check';
  const result = schema.safeParse(value);
  if (result.success) {
    return { valid: true, rule_id };
  }
  return { valid: false, rule_id, message: result.error.issues.map((i) => i.message).join('; ') };
}

export class PlaceholderValidator {
  private rules: Map<string, SafeRangeConfig> = new Map();

  registerSafeRange(category: string, range: SafeRangeConfig): void {
    this.rules.set(category, range);
  }

  validate(placeholder: Placeholder): ValidationResult[] {
    const results: ValidationResult[] = [];

    results.push(typeCheck(placeholder.value, placeholder.value_type));

    if (placeholder.value_type === 'secret_ref') {
      results.push(validateSecretRef(placeholder.value));
    } else {
      results.push(rejectPlaintextSecret(placeholder.value));
    }

    const range = this.rules.get(placeholder.category);
    if (range) {
      results.push(safeRangeCheck(placeholder.value, range));
    }

    return results;
  }

  validateAll(placeholder: Placeholder): { valid: boolean; errors: ValidationResult[] } {
    const results = this.validate(placeholder);
    const errors = results.filter((r) => !r.valid);
    return { valid: errors.length === 0, errors };
  }
}
