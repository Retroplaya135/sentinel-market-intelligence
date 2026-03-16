import type { ConnectorInterface, ConnectorResult } from '@sentinel/module-system';
import { CircuitBreaker } from './circuit-breaker.js';
import type { CircuitState } from './circuit-breaker.js';
import { InMemoryHealthTelemetry } from './health.js';
import type { ConnectorHealth, QuotaStatus } from './health.js';
import { DedupeIndex, tagProvenance } from './dedupe.js';
import type { ProvenanceTag } from './dedupe.js';

export interface BaseConnectorConfig {
  source_id: string;
  endpoint: string;
  policy_mode: 'allow' | 'conditional' | 'blocked';
  quota_limit?: number;
  circuit_breaker?: Partial<{ failure_threshold: number; recovery_timeout_ms: number; half_open_max_attempts: number }>;
}

export abstract class BaseConnector implements ConnectorInterface {
  readonly source_id: string;
  protected readonly endpoint: string;
  protected readonly policy_mode: string;
  protected readonly circuitBreaker: CircuitBreaker;
  protected readonly telemetry: InMemoryHealthTelemetry;
  protected readonly dedupe: DedupeIndex;
  private request_counter = 0;

  constructor(config: BaseConnectorConfig) {
    this.source_id = config.source_id;
    this.endpoint = config.endpoint;
    this.policy_mode = config.policy_mode;
    this.circuitBreaker = new CircuitBreaker(config.circuit_breaker);
    this.telemetry = new InMemoryHealthTelemetry(config.source_id, config.quota_limit ?? 10000);
    this.dedupe = new DedupeIndex();
  }

  protected nextRequestId(): string {
    return `${this.source_id}_req_${++this.request_counter}_${Date.now()}`;
  }

  protected makeResult(params: { success: boolean; records_count: number; request_id: string; errors?: string[] }): ConnectorResult {
    return {
      success: params.success,
      records_count: params.records_count,
      source_id: this.source_id,
      request_id: params.request_id,
      timestamp: new Date().toISOString(),
      errors: params.errors ?? [],
    };
  }

  protected tagRecord(record: unknown, request_id: string): ProvenanceTag {
    return tagProvenance(record, {
      source_id: this.source_id,
      endpoint: this.endpoint,
      request_id,
      policy_mode: this.policy_mode,
    });
  }

  getHealth(): ConnectorHealth { return this.telemetry.getHealth(); }
  getQuota(): QuotaStatus { return this.telemetry.getQuota(); }
  getCircuitState(): CircuitState { return this.circuitBreaker.getState(); }

  abstract fetch(params: { asset_ids?: string[]; since?: string; limit?: number }): Promise<ConnectorResult>;
  abstract normalize(raw: unknown[]): Promise<unknown[]>;
  abstract validate(records: unknown[]): Promise<{ valid: unknown[]; invalid: unknown[] }>;
  abstract persist(records: unknown[]): Promise<ConnectorResult>;
  abstract ack(request_id: string): Promise<void>;
  abstract delete_sync(params: { record_ids?: string[]; before?: string }): Promise<ConnectorResult>;
}
