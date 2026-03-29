import { describe, it, expect } from 'vitest';
import {
  ModuleManifestSchema,
  ModuleStatus,
  PluginType,
  isCompatibleVersion,
} from '../../packages/module-system/src/manifest/schema.js';

function makeValidManifest(overrides?: Record<string, unknown>) {
  return {
    module_id: 'connector.onchain.evm',
    version: '0.1.0',
    name: 'EVM On-Chain Connector',
    description: 'Fetches on-chain data from EVM chains',
    plugin_type: 'connector',
    capabilities: ['fetch_transactions', 'fetch_events'],
    inputs: ['chain_id', 'block_range'],
    outputs: ['normalized_tx', 'normalized_event'],
    policy_mode: 'allow',
    status: 'registered',
    dependencies: [],
    ...overrides,
  };
}

describe('Module Manifest Schema Validation', () => {
  it('valid manifest passes', () => {
    const result = ModuleManifestSchema.safeParse(makeValidManifest());
    expect(result.success).toBe(true);
  });

  it('REJECTS invalid module_id format', () => {
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ module_id: 'Invalid-ID' })).success).toBe(false);
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ module_id: '' })).success).toBe(false);
  });

  it('REJECTS invalid semver version', () => {
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ version: 'v1' })).success).toBe(false);
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ version: '1.0' })).success).toBe(false);
  });

  it('REJECTS empty capabilities', () => {
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ capabilities: [] })).success).toBe(false);
  });

  it('accepts all valid plugin types', () => {
    for (const pt of ['connector', 'scorer', 'explainer', 'alert_strategy']) {
      expect(ModuleManifestSchema.safeParse(makeValidManifest({ plugin_type: pt })).success).toBe(true);
    }
  });

  it('REJECTS invalid plugin type', () => {
    expect(ModuleManifestSchema.safeParse(makeValidManifest({ plugin_type: 'unknown' })).success).toBe(false);
  });

  it('accepts all valid policy modes', () => {
    for (const pm of ['allow', 'conditional', 'blocked']) {
      expect(ModuleManifestSchema.safeParse(makeValidManifest({ policy_mode: pm })).success).toBe(true);
    }
  });

  it('accepts all valid statuses', () => {
    for (const s of ['registered', 'enabled', 'disabled', 'error', 'deprecated']) {
      expect(ModuleManifestSchema.safeParse(makeValidManifest({ status: s })).success).toBe(true);
    }
  });
});

describe('Version Compatibility', () => {
  it('same major version is compatible', () => {
    expect(isCompatibleVersion('0.1.0', '0.2.0')).toBe(true);
    expect(isCompatibleVersion('1.0.0', '1.5.3')).toBe(true);
  });

  it('different major version is incompatible', () => {
    expect(isCompatibleVersion('0.1.0', '1.0.0')).toBe(false);
    expect(isCompatibleVersion('2.0.0', '1.0.0')).toBe(false);
  });
});
