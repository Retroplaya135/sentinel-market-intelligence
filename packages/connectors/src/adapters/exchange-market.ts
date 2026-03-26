import type { ConnectorResult } from '@sentinel/module-system';
import { BaseConnector } from '../base/base-connector.js';
import type { BaseConnectorConfig } from '../base/base-connector.js';

export class ExchangeMarketConnector extends BaseConnector {
  constructor(config?: Partial<BaseConnectorConfig>) {
    super({
      source_id: 'exchange_market_data',
      endpoint: 'wss://stream.exchange.io/v1',
      policy_mode: 'allow',
      quota_limit: 500000,
      ...config,
    });
  }

  async fetch(params: { asset_ids?: string[]; since?: string; limit?: number }): Promise<ConnectorResult> {
    if (!this.circuitBreaker.canExecute()) {
      return this.makeResult({ success: false, records_count: 0, request_id: this.nextRequestId(), errors: ['Circuit breaker OPEN'] });
    }
    const request_id = this.nextRequestId();
    const count = params.limit ?? 500;
    this.circuitBreaker.recordSuccess();
    this.telemetry.recordSuccess(12, count);
    return this.makeResult({ success: true, records_count: count, request_id });
  }

  async normalize(raw: unknown[]): Promise<unknown[]> {
    return raw.map((r, i) => ({ ...(r as object), _normalized: true, _source: this.source_id, _index: i }));
  }

  async validate(records: unknown[]): Promise<{ valid: unknown[]; invalid: unknown[] }> {
    const valid: unknown[] = [];
    const invalid: unknown[] = [];
    for (const r of records) {
      if (r && typeof r === 'object') valid.push(r); else invalid.push(r);
    }
    return { valid, invalid };
  }

  async persist(records: unknown[]): Promise<ConnectorResult> {
    const request_id = this.nextRequestId();
    const { unique } = this.dedupe.dedupeRecords(records);
    for (const r of unique) this.tagRecord(r, request_id);
    return this.makeResult({ success: true, records_count: unique.length, request_id });
  }

  async ack(_request_id: string): Promise<void> { /* no-op */ }

  async delete_sync(_params: { record_ids?: string[]; before?: string }): Promise<ConnectorResult> {
    return this.makeResult({ success: true, records_count: 0, request_id: this.nextRequestId() });
  }
}
