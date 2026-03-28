import { describe, it, expect, beforeEach } from 'vitest';
import { PlaceholderStore } from '../../packages/placeholder-engine/src/crud/store.js';
import { AuditLog } from '../../packages/placeholder-engine/src/audit/audit-log.js';
import { PlaceholderValidator } from '../../packages/placeholder-engine/src/validation/validator.js';

describe('Placeholder Export/Import — Round-trip bundles', () => {
  let store: PlaceholderStore;
  let audit: AuditLog;

  beforeEach(() => {
    audit = new AuditLog();
    store = new PlaceholderStore(audit, new PlaceholderValidator());
  });

  function createTestPlaceholders() {
    store.create({
      placeholder_key: 'weight.social', category: 'scoring_weight', value_type: 'number',
      scope: 'global', owner: 'ml', value: 0.3, description: 'Social weight', actor_id: 'admin',
    });
    store.create({
      placeholder_key: 'flag.dark_mode', category: 'feature_flag', value_type: 'boolean',
      scope: 'global', owner: 'product', value: false, description: 'Dark mode', actor_id: 'admin',
    });
  }

  it('exports all placeholders as bundle', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle('staging');
    expect(bundle.environment).toBe('staging');
    expect(bundle.placeholders.length).toBe(2);
    expect(bundle.exported_at).toBeTruthy();
  });

  it('imports bundle into empty store', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle();

    const targetStore = new PlaceholderStore(new AuditLog(), new PlaceholderValidator());
    const result = targetStore.importBundle(bundle, 'admin');
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.conflicts.length).toBe(0);
    expect(targetStore.size()).toBe(2);
  });

  it('detects conflicts on import without overwrite', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle();

    const result = store.importBundle(bundle, 'admin');
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.conflicts.length).toBe(2);
  });

  it('overwrites on import with overwrite flag', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle();

    const result = store.importBundle(bundle, 'admin', { overwrite: true });
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('round-trip preserves placeholder data', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle();

    const targetStore = new PlaceholderStore(new AuditLog(), new PlaceholderValidator());
    targetStore.importBundle(bundle, 'admin');

    const original = store.read('weight.social');
    const imported = targetStore.read('weight.social');
    expect(imported.value).toBe(original.value);
    expect(imported.category).toBe(original.category);
    expect(imported.scope).toBe(original.scope);
  });

  it('import creates audit entries', () => {
    createTestPlaceholders();
    const bundle = store.exportBundle();

    const targetAudit = new AuditLog();
    const targetStore = new PlaceholderStore(targetAudit, new PlaceholderValidator());
    targetStore.importBundle(bundle, 'admin');

    expect(targetAudit.size()).toBe(2);
    const entries = targetAudit.getAll();
    expect(entries[0].action).toBe('import');
  });
});
