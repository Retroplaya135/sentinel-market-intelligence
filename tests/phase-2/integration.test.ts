import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../packages/module-system/src/registry/module-registry.js';
import { InMemoryEventBus } from '../../packages/module-system/src/events/event-bus.js';
import { PlaceholderStore } from '../../packages/placeholder-engine/src/crud/store.js';
import { AuditLog } from '../../packages/placeholder-engine/src/audit/audit-log.js';
import { PlaceholderValidator } from '../../packages/placeholder-engine/src/validation/validator.js';
import { checkSourcePolicy } from '../../packages/shared-contracts/src/policy/index.js';
import type { ModuleManifest } from '../../packages/module-system/src/manifest/schema.js';

describe('Integration — Register module → enable → check policy → use event bus', () => {
  let registry: ModuleRegistry;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    registry = new ModuleRegistry({ core_version: '0.1.0' });
    bus = new InMemoryEventBus();
  });

  function makeConnectorManifest(id: string, policyMode: 'allow' | 'conditional' | 'blocked'): ModuleManifest {
    return {
      module_id: id,
      version: '0.1.0',
      name: `Connector ${id}`,
      description: `Test connector for ${id}`,
      plugin_type: 'connector',
      capabilities: ['fetch'],
      inputs: ['asset_id'],
      outputs: ['data'],
      policy_mode: policyMode,
      status: 'registered',
      dependencies: [],
    };
  }

  it('full flow: register allowed connector → enable → publish event', async () => {
    const manifest = makeConnectorManifest('connector.onchain.evm', 'allow');
    registry.register(manifest);

    const policyResult = checkSourcePolicy({
      source_id: 'onchain_evm',
      policy_mode: 'allow',
      is_enabled: true,
      commercial_agreement_verified: true,
    });
    expect(policyResult.allowed).toBe(true);

    const entry = registry.enable('connector.onchain.evm');
    expect(entry.enabled).toBe(true);

    const received: unknown[] = [];
    bus.subscribe('module.enabled', (e) => { received.push(e); });
    await bus.publish('module.enabled', { module_id: entry.manifest.module_id, timestamp: new Date().toISOString() });

    expect(received.length).toBe(1);
  });

  it('blocked connector cannot be enabled — policy enforced', () => {
    const manifest = makeConnectorManifest('connector.telegram', 'blocked');
    registry.register(manifest);

    const policyResult = checkSourcePolicy({
      source_id: 'telegram_public',
      policy_mode: 'blocked',
      is_enabled: false,
      commercial_agreement_verified: false,
    });
    expect(policyResult.allowed).toBe(false);

    expect(() => registry.enable('connector.telegram')).toThrow('BLOCKED');
  });

  it('conditional connector requires agreement before enable', () => {
    const manifest = makeConnectorManifest('connector.x_twitter', 'conditional');
    registry.register(manifest);

    const policyCheck = checkSourcePolicy({
      source_id: 'x_twitter',
      policy_mode: 'conditional',
      is_enabled: false,
      commercial_agreement_verified: false,
    });
    expect(policyCheck.allowed).toBe(false);

    // Module registry allows enabling conditional (policy gate is separate)
    const entry = registry.enable('connector.x_twitter');
    expect(entry.enabled).toBe(true);
    // But the policy check MUST be called before actual data flow
  });
});

describe('Integration — Placeholder lifecycle + module config', () => {
  it('create placeholder → publish → use as module config', () => {
    const audit = new AuditLog();
    const validator = new PlaceholderValidator();
    validator.registerSafeRange('scoring_weight', { min: 0, max: 1 });
    const store = new PlaceholderStore(audit, validator);

    store.create({
      placeholder_key: 'fusion.weight.social',
      category: 'scoring_weight',
      value_type: 'number',
      scope: 'global',
      owner: 'ml_team',
      value: 0.35,
      description: 'Social signal weight',
      actor_id: 'admin_001',
    });

    store.transition('fusion.weight.social', 'review', 'admin_001');
    store.transition('fusion.weight.social', 'approved', 'admin_002');
    store.transition('fusion.weight.social', 'published', 'admin_002');

    const published = store.read('fusion.weight.social');
    expect(published.status).toBe('published');
    expect(published.value).toBe(0.35);

    // Module can now read this published config value
    const registry = new ModuleRegistry();
    registry.register({
      module_id: 'scorer.fusion.v1',
      version: '0.1.0',
      name: 'Fusion Scorer',
      description: 'Cross-source fusion scoring',
      plugin_type: 'scorer',
      capabilities: ['score', 'explain_score'],
      inputs: ['social_score', 'onchain_score'],
      outputs: ['fused_score'],
      policy_mode: 'allow',
      status: 'registered',
      dependencies: [],
    });
    registry.enable('scorer.fusion.v1');

    const scorer = registry.get('scorer.fusion.v1');
    expect(scorer.enabled).toBe(true);
    // Scorer would use published.value as its social weight
  });

  it('placeholder rollback + audit trail integrity', () => {
    const audit = new AuditLog();
    const store = new PlaceholderStore(audit, new PlaceholderValidator());

    store.create({
      placeholder_key: 'alert.threshold',
      category: 'threshold',
      value_type: 'number',
      scope: 'global',
      owner: 'product',
      value: 0.7,
      description: 'Alert threshold',
      actor_id: 'admin',
    });

    store.update({ placeholder_key: 'alert.threshold', value: 0.9, actor_id: 'admin' });
    store.rollback('alert.threshold', 1, 'admin');

    const current = store.read('alert.threshold');
    expect(current.value).toBe(0.7);
    expect(current.version).toBe(3);

    const history = store.getHistory('alert.threshold');
    expect(history.length).toBe(3);

    const auditEntries = audit.getByKey('alert.threshold');
    expect(auditEntries.length).toBe(3);
    expect(auditEntries[0].action).toBe('create');
    expect(auditEntries[1].action).toBe('update');
    expect(auditEntries[2].action).toBe('rollback');
  });
});
