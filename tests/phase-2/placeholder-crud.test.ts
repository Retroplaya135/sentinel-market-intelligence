import { describe, it, expect, beforeEach } from 'vitest';
import { PlaceholderStore } from '../../packages/placeholder-engine/src/crud/store.js';
import { AuditLog } from '../../packages/placeholder-engine/src/audit/audit-log.js';
import { PlaceholderValidator } from '../../packages/placeholder-engine/src/validation/validator.js';

describe('Placeholder Store — CRUD + version history + rollback', () => {
  let store: PlaceholderStore;
  let audit: AuditLog;
  let validator: PlaceholderValidator;

  beforeEach(() => {
    audit = new AuditLog();
    validator = new PlaceholderValidator();
    store = new PlaceholderStore(audit, validator);
  });

  const baseParams = {
    placeholder_key: 'fusion.weight.social',
    category: 'scoring_weight' as const,
    value_type: 'number' as const,
    scope: 'global' as const,
    owner: 'ml_team',
    value: 0.35,
    description: 'Social signal weight in fusion',
    actor_id: 'admin_001',
  };

  it('creates a placeholder successfully', () => {
    const p = store.create(baseParams);
    expect(p.placeholder_key).toBe('fusion.weight.social');
    expect(p.version).toBe(1);
    expect(p.status).toBe('draft');
    expect(p.value).toBe(0.35);
  });

  it('REJECTS duplicate creation', () => {
    store.create(baseParams);
    expect(() => store.create(baseParams)).toThrow('already exists');
  });

  it('reads an existing placeholder', () => {
    store.create(baseParams);
    const p = store.read('fusion.weight.social');
    expect(p.placeholder_key).toBe('fusion.weight.social');
  });

  it('THROWS on read for nonexistent key', () => {
    expect(() => store.read('nonexistent')).toThrow('not found');
  });

  it('updates a placeholder and increments version', () => {
    store.create(baseParams);
    const updated = store.update({
      placeholder_key: 'fusion.weight.social',
      value: 0.45,
      actor_id: 'admin_001',
      reason: 'Increased social weight after calibration',
    });
    expect(updated.version).toBe(2);
    expect(updated.value).toBe(0.45);
  });

  it('maintains version history', () => {
    store.create(baseParams);
    store.update({ placeholder_key: 'fusion.weight.social', value: 0.45, actor_id: 'admin_001' });
    store.update({ placeholder_key: 'fusion.weight.social', value: 0.50, actor_id: 'admin_002' });

    const history = store.getHistory('fusion.weight.social');
    expect(history.length).toBe(3);
    expect(history[0].version).toBe(1);
    expect(history[1].version).toBe(2);
    expect(history[2].version).toBe(3);
  });

  it('rollback restores previous version value and resets to draft', () => {
    store.create(baseParams);
    store.update({ placeholder_key: 'fusion.weight.social', value: 0.99, actor_id: 'admin_001' });

    const rolled = store.rollback('fusion.weight.social', 1, 'admin_001');
    expect(rolled.value).toBe(0.35);
    expect(rolled.status).toBe('draft');
    expect(rolled.version).toBe(3);
  });

  it('THROWS rollback to nonexistent version', () => {
    store.create(baseParams);
    expect(() => store.rollback('fusion.weight.social', 999, 'admin_001')).toThrow('not found');
  });

  it('deletes a placeholder', () => {
    store.create(baseParams);
    store.delete('fusion.weight.social', 'admin_001');
    expect(store.size()).toBe(0);
    expect(() => store.read('fusion.weight.social')).toThrow('not found');
  });

  it('lists placeholders with filter', () => {
    store.create(baseParams);
    store.create({ ...baseParams, placeholder_key: 'alert.threshold.high', category: 'threshold', value: 0.9, description: 'High alert threshold' });
    expect(store.list().length).toBe(2);
    expect(store.list({ category: 'scoring_weight' }).length).toBe(1);
    expect(store.list({ category: 'threshold' }).length).toBe(1);
  });

  it('creates audit entries for all CRUD operations', () => {
    store.create(baseParams);
    store.update({ placeholder_key: 'fusion.weight.social', value: 0.5, actor_id: 'admin_001' });
    store.delete('fusion.weight.social', 'admin_001');

    const entries = audit.getAll();
    expect(entries.length).toBe(3);
    expect(entries[0].action).toBe('create');
    expect(entries[1].action).toBe('update');
    expect(entries[2].action).toBe('delete');
  });
});
