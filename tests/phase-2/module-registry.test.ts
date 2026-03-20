import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../packages/module-system/src/registry/module-registry.js';
import type { ModuleManifest } from '../../packages/module-system/src/manifest/schema.js';

function makeManifest(overrides?: Partial<ModuleManifest>): ModuleManifest {
  return {
    module_id: 'connector.onchain.evm',
    version: '0.1.0',
    name: 'EVM On-Chain Connector',
    description: 'Fetches on-chain data from EVM chains',
    plugin_type: 'connector',
    capabilities: ['fetch_transactions'],
    inputs: ['chain_id'],
    outputs: ['normalized_tx'],
    policy_mode: 'allow',
    status: 'registered',
    dependencies: [],
    ...overrides,
  };
}

describe('Module Registry — CRUD + enable/disable', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry({ core_version: '0.1.0' });
  });

  it('registers a module and returns entry', () => {
    const entry = registry.register(makeManifest());
    expect(entry.manifest.module_id).toBe('connector.onchain.evm');
    expect(entry.manifest.status).toBe('registered');
    expect(entry.enabled).toBe(false);
  });

  it('REJECTS duplicate registration', () => {
    registry.register(makeManifest());
    expect(() => registry.register(makeManifest())).toThrow('already registered');
  });

  it('gets a registered module', () => {
    registry.register(makeManifest());
    const entry = registry.get('connector.onchain.evm');
    expect(entry.manifest.module_id).toBe('connector.onchain.evm');
  });

  it('THROWS on get for unknown module', () => {
    expect(() => registry.get('nonexistent')).toThrow('not registered');
  });

  it('enables a registered module', () => {
    registry.register(makeManifest());
    const entry = registry.enable('connector.onchain.evm');
    expect(entry.enabled).toBe(true);
    expect(entry.manifest.status).toBe('enabled');
  });

  it('BLOCKS enabling a module with blocked policy_mode', () => {
    registry.register(makeManifest({ module_id: 'connector.telegram', policy_mode: 'blocked' }));
    expect(() => registry.enable('connector.telegram')).toThrow('BLOCKED');
  });

  it('BLOCKS enabling a deprecated module', () => {
    registry.register(makeManifest({ module_id: 'old.module', status: 'deprecated' }));
    expect(() => registry.enable('old.module')).toThrow('deprecated');
  });

  it('disables an enabled module', () => {
    registry.register(makeManifest());
    registry.enable('connector.onchain.evm');
    const entry = registry.disable('connector.onchain.evm');
    expect(entry.enabled).toBe(false);
    expect(entry.manifest.status).toBe('disabled');
  });

  it('unregisters a disabled module', () => {
    registry.register(makeManifest());
    registry.unregister('connector.onchain.evm');
    expect(registry.size()).toBe(0);
  });

  it('BLOCKS unregistering an enabled module', () => {
    registry.register(makeManifest());
    registry.enable('connector.onchain.evm');
    expect(() => registry.unregister('connector.onchain.evm')).toThrow('Disable it first');
  });

  it('lists all modules', () => {
    registry.register(makeManifest());
    registry.register(makeManifest({ module_id: 'scorer.sentiment.v1', plugin_type: 'scorer' }));
    expect(registry.list().length).toBe(2);
  });

  it('filters list by plugin_type', () => {
    registry.register(makeManifest());
    registry.register(makeManifest({ module_id: 'scorer.sentiment.v1', plugin_type: 'scorer' }));
    expect(registry.list({ plugin_type: 'connector' }).length).toBe(1);
    expect(registry.list({ plugin_type: 'scorer' }).length).toBe(1);
  });

  it('filters list by enabled status', () => {
    registry.register(makeManifest());
    registry.register(makeManifest({ module_id: 'scorer.sentiment.v1', plugin_type: 'scorer' }));
    registry.enable('connector.onchain.evm');
    expect(registry.list({ enabled: true }).length).toBe(1);
    expect(registry.list({ enabled: false }).length).toBe(1);
  });

  it('checks compatibility', () => {
    registry.register(makeManifest());
    const result = registry.checkCompatibility('connector.onchain.evm');
    expect(result.compatible).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('reports missing dependencies in compatibility check', () => {
    registry.register(makeManifest({ module_id: 'dependent.module', dependencies: ['missing.dep'] }));
    const result = registry.checkCompatibility('dependent.module');
    expect(result.compatible).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('Module Registry — Dependency enforcement', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  it('BLOCKS enabling module with unregistered dependency', () => {
    registry.register(makeManifest({ module_id: 'child.module', dependencies: ['parent.module'] }));
    expect(() => registry.enable('child.module')).toThrow('not registered');
  });

  it('BLOCKS enabling module with disabled dependency', () => {
    registry.register(makeManifest({ module_id: 'parent.module' }));
    registry.register(makeManifest({ module_id: 'child.module', dependencies: ['parent.module'] }));
    expect(() => registry.enable('child.module')).toThrow('not enabled');
  });

  it('allows enabling module with enabled dependency', () => {
    registry.register(makeManifest({ module_id: 'parent.module' }));
    registry.enable('parent.module');
    registry.register(makeManifest({ module_id: 'child.module', dependencies: ['parent.module'] }));
    const entry = registry.enable('child.module');
    expect(entry.enabled).toBe(true);
  });

  it('BLOCKS disabling module with enabled dependents', () => {
    registry.register(makeManifest({ module_id: 'parent.module' }));
    registry.enable('parent.module');
    registry.register(makeManifest({ module_id: 'child.module', dependencies: ['parent.module'] }));
    registry.enable('child.module');
    expect(() => registry.disable('parent.module')).toThrow('enabled dependents');
  });
});
