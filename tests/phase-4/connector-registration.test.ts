import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../packages/module-system/src/registry/module-registry.js';
import { PolicyService } from '../../packages/policy-engine/src/service/policy-service.js';
import { EvmOnchainConnector } from '../../packages/connectors/src/adapters/evm-onchain.js';
import { ExchangeMarketConnector } from '../../packages/connectors/src/adapters/exchange-market.js';
import { LicensedNewsConnector } from '../../packages/connectors/src/adapters/licensed-news.js';
import { FirstPartyConnector } from '../../packages/connectors/src/adapters/first-party.js';
import type { ModuleManifest } from '../../packages/module-system/src/manifest/schema.js';

function connectorManifest(source_id: string, policy_mode: 'allow' | 'conditional' | 'blocked'): ModuleManifest {
  return {
    module_id: `connector.${source_id}`,
    version: '0.1.0',
    name: `${source_id} connector`,
    description: `Connector for ${source_id}`,
    plugin_type: 'connector',
    capabilities: ['fetch', 'normalize', 'validate', 'persist'],
    inputs: ['asset_id'],
    outputs: ['raw_record'],
    policy_mode,
    status: 'registered',
    dependencies: [],
  };
}

describe('Connector Registration + Policy Check Integration', () => {
  let registry: ModuleRegistry;
  let policy: PolicyService;

  beforeEach(() => {
    registry = new ModuleRegistry();
    policy = new PolicyService();
  });

  it('registers and enables all 4 allowed connectors', () => {
    const connectors = [
      { id: 'onchain_evm', mode: 'allow' as const },
      { id: 'exchange_market_data', mode: 'allow' as const },
      { id: 'licensed_news_rss', mode: 'allow' as const },
      { id: 'first_party', mode: 'allow' as const },
    ];

    for (const c of connectors) {
      registry.register(connectorManifest(c.id, c.mode));
      const entry = registry.enable(`connector.${c.id}`);
      expect(entry.enabled).toBe(true);
    }

    expect(registry.list({ enabled: true }).length).toBe(4);
  });

  it('policy allows ingestion for all 4 allowed connectors', async () => {
    for (const id of ['onchain_evm', 'exchange_market_data', 'licensed_news_rss', 'first_party']) {
      const result = await policy.checkPolicy({ source_id: id, action: 'ingest', actor_id: 'test' });
      expect(result.allowed, `${id} should be allowed`).toBe(true);
    }
  });

  it('BLOCKS registration+enable of blocked source connector', () => {
    registry.register(connectorManifest('telegram_public', 'blocked'));
    expect(() => registry.enable('connector.telegram_public')).toThrow('BLOCKED');
  });

  it('policy REJECTS ingestion for blocked sources', async () => {
    for (const id of ['telegram_public', 'discord_mining', 'tiktok_research']) {
      const result = await policy.checkPolicy({ source_id: id, action: 'ingest', actor_id: 'test' });
      expect(result.allowed, `${id} should be blocked`).toBe(false);
    }
  });

  it('EVM connector fetch returns valid result', async () => {
    const connector = new EvmOnchainConnector();
    const result = await connector.fetch({ asset_ids: ['ETH'], limit: 10 });
    expect(result.success).toBe(true);
    expect(result.source_id).toBe('onchain_evm');
    expect(result.records_count).toBe(10);
  });

  it('Exchange connector fetch returns valid result', async () => {
    const connector = new ExchangeMarketConnector();
    const result = await connector.fetch({ limit: 50 });
    expect(result.success).toBe(true);
    expect(result.source_id).toBe('exchange_market_data');
  });

  it('News connector fetch returns valid result', async () => {
    const connector = new LicensedNewsConnector();
    const result = await connector.fetch({ limit: 20 });
    expect(result.success).toBe(true);
    expect(result.source_id).toBe('licensed_news_rss');
  });

  it('First-party connector fetch returns valid result', async () => {
    const connector = new FirstPartyConnector();
    const result = await connector.fetch({ limit: 30 });
    expect(result.success).toBe(true);
    expect(result.source_id).toBe('first_party');
  });

  it('all connectors implement normalize + validate + persist', async () => {
    const connectors = [new EvmOnchainConnector(), new ExchangeMarketConnector(), new LicensedNewsConnector(), new FirstPartyConnector()];
    for (const c of connectors) {
      const raw = [{ tx: '0x1' }, { tx: '0x2' }];
      const normalized = await c.normalize(raw);
      expect(normalized.length).toBe(2);
      const { valid } = await c.validate(normalized);
      expect(valid.length).toBe(2);
      const result = await c.persist(valid);
      expect(result.success).toBe(true);
    }
  });
});
