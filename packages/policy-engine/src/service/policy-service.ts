import { checkAllBlockedSourceGuards } from '../blocked-sources/guards.js';
import { ExceptionRegistry } from '../blocked-sources/exceptions.js';
import { ConditionalSourceGateService } from '../conditional-gates/gates.js';
import { evaluateTrainingGate } from '../training-gate/gate.js';
import type { TrainingJobRequest, TrainingGateDecision } from '../training-gate/gate.js';
import { checkRetentionWindow, generateDeletionProof } from '../retention/enforcement.js';
import type { RetentionWindowCheck, RetentionCheckResult, DeletionProof } from '../retention/enforcement.js';
import type { EventBusInterface } from '@sentinel/module-system';

export interface PolicyCheckRequest {
  source_id: string;
  action: 'ingest' | 'query' | 'train' | 'export';
  actor_id: string;
  tenant_id?: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  source_id: string;
  action: string;
  reason: string;
  checked_at: string;
}

export interface AuditTrailEntry {
  action: string;
  source_id: string;
  actor_id: string;
  result: string;
  timestamp: string;
}

export class PolicyService {
  private readonly exceptionRegistry: ExceptionRegistry;
  private readonly conditionalGates: ConditionalSourceGateService;
  private readonly auditTrail: AuditTrailEntry[] = [];
  private eventBus?: EventBusInterface;

  constructor(options?: { eventBus?: EventBusInterface }) {
    this.exceptionRegistry = new ExceptionRegistry();
    this.conditionalGates = new ConditionalSourceGateService();
    this.eventBus = options?.eventBus;
  }

  async checkPolicy(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    const checked_at = new Date().toISOString();

    const blockedResult = checkAllBlockedSourceGuards(request.source_id);
    if (blockedResult.blocked) {
      const exceptionCheck = this.exceptionRegistry.check(request.source_id);
      if (!exceptionCheck.has_valid_override) {
        await this.emitBlockedAttempt(request);
        this.recordAudit(request, 'BLOCKED');
        return {
          allowed: false,
          source_id: request.source_id,
          action: request.action,
          reason: blockedResult.reason,
          checked_at,
        };
      }
      this.recordAudit(request, 'ALLOWED_VIA_EXCEPTION');
      return {
        allowed: true,
        source_id: request.source_id,
        action: request.action,
        reason: `Allowed via consent_scoped_override (${exceptionCheck.override!.override_id}).`,
        checked_at,
      };
    }

    const conditionalResult = this.conditionalGates.check(request.source_id);
    if (!conditionalResult.allowed) {
      this.recordAudit(request, 'CONDITIONAL_BLOCKED');
      return {
        allowed: false,
        source_id: request.source_id,
        action: request.action,
        reason: conditionalResult.reason,
        checked_at,
      };
    }

    this.recordAudit(request, 'ALLOWED');
    return {
      allowed: true,
      source_id: request.source_id,
      action: request.action,
      reason: `Source ${request.source_id} is allowed for ${request.action}.`,
      checked_at,
    };
  }

  checkTraining(request: TrainingJobRequest): TrainingGateDecision {
    const decision = evaluateTrainingGate(request);
    this.auditTrail.push({
      action: 'training_gate',
      source_id: request.source_ids.join(','),
      actor_id: request.requested_by,
      result: decision.allowed ? 'ALLOWED' : 'BLOCKED',
      timestamp: decision.timestamp,
    });
    return decision;
  }

  checkRetention(check: RetentionWindowCheck): RetentionCheckResult {
    return checkRetentionWindow(check);
  }

  createDeletionProof(params: Parameters<typeof generateDeletionProof>[0]): DeletionProof {
    return generateDeletionProof(params);
  }

  getExceptionRegistry(): ExceptionRegistry {
    return this.exceptionRegistry;
  }

  getConditionalGates(): ConditionalSourceGateService {
    return this.conditionalGates;
  }

  getAuditTrail(): readonly AuditTrailEntry[] {
    return Object.freeze([...this.auditTrail]);
  }

  private recordAudit(request: PolicyCheckRequest, result: string): void {
    this.auditTrail.push({
      action: request.action,
      source_id: request.source_id,
      actor_id: request.actor_id,
      result,
      timestamp: new Date().toISOString(),
    });
  }

  private async emitBlockedAttempt(request: PolicyCheckRequest): Promise<void> {
    if (!this.eventBus) return;
    await this.eventBus.publish('security_event', {
      event_id: `sec_${Date.now()}`,
      event_type: 'security_event',
      timestamp: new Date().toISOString(),
      source_id: 'policy_engine',
      trace_id: `trace_${Date.now()}`,
      version: '1.0.0',
      payload: {
        severity: 'critical',
        category: 'blocked_source_attempt',
        actor_id: request.actor_id,
        details: `Attempted ${request.action} on blocked source: ${request.source_id}`,
      },
    });
  }
}
