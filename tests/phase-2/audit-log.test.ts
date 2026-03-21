import { describe, it, expect } from 'vitest';
import { AuditLog, computeDiffHash } from '../../packages/placeholder-engine/src/audit/audit-log.js';

describe('Audit Log — Immutable append-only log', () => {
  it('appends entries with auto-generated change_id and timestamp', () => {
    const audit = new AuditLog();
    const entry = audit.append({
      actor_id: 'admin_001',
      action: 'create',
      placeholder_key: 'test.key',
      new_value: 42,
    });
    expect(entry.change_id).toBeTruthy();
    expect(entry.actor_id).toBe('admin_001');
    expect(entry.action).toBe('create');
    expect(entry.diff_hash).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
  });

  it('entries are immutable (frozen)', () => {
    const audit = new AuditLog();
    const entry = audit.append({
      actor_id: 'admin_001',
      action: 'create',
      placeholder_key: 'test.key',
      new_value: 'hello',
    });
    expect(() => { (entry as any).actor_id = 'hacker'; }).toThrow();
  });

  it('getAll returns a frozen copy', () => {
    const audit = new AuditLog();
    audit.append({ actor_id: 'a', action: 'create', placeholder_key: 'k1', new_value: 1 });
    audit.append({ actor_id: 'b', action: 'update', placeholder_key: 'k1', old_value: 1, new_value: 2 });

    const all = audit.getAll();
    expect(all.length).toBe(2);
    expect(() => { (all as any).push('fake'); }).toThrow();
  });

  it('cannot modify entries array externally', () => {
    const audit = new AuditLog();
    audit.append({ actor_id: 'a', action: 'create', placeholder_key: 'k1', new_value: 1 });
    const all = audit.getAll();
    expect(all.length).toBe(1);
    // getAll returns a copy — original unaffected
    const all2 = audit.getAll();
    expect(all2.length).toBe(1);
  });

  it('getByKey filters correctly', () => {
    const audit = new AuditLog();
    audit.append({ actor_id: 'a', action: 'create', placeholder_key: 'key1', new_value: 1 });
    audit.append({ actor_id: 'a', action: 'create', placeholder_key: 'key2', new_value: 2 });
    audit.append({ actor_id: 'a', action: 'update', placeholder_key: 'key1', old_value: 1, new_value: 3 });

    expect(audit.getByKey('key1').length).toBe(2);
    expect(audit.getByKey('key2').length).toBe(1);
    expect(audit.getByKey('nonexistent').length).toBe(0);
  });

  it('getByActor filters correctly', () => {
    const audit = new AuditLog();
    audit.append({ actor_id: 'admin_001', action: 'create', placeholder_key: 'k1', new_value: 1 });
    audit.append({ actor_id: 'admin_002', action: 'update', placeholder_key: 'k1', old_value: 1, new_value: 2 });

    expect(audit.getByActor('admin_001').length).toBe(1);
    expect(audit.getByActor('admin_002').length).toBe(1);
  });

  it('size returns correct count', () => {
    const audit = new AuditLog();
    expect(audit.size()).toBe(0);
    audit.append({ actor_id: 'a', action: 'create', placeholder_key: 'k', new_value: 1 });
    expect(audit.size()).toBe(1);
  });
});

describe('Diff Hash — Deterministic hashing', () => {
  it('same inputs produce same hash', () => {
    const h1 = computeDiffHash('old', 'new');
    const h2 = computeDiffHash('old', 'new');
    expect(h1).toBe(h2);
  });

  it('different inputs produce different hashes', () => {
    const h1 = computeDiffHash('old', 'new1');
    const h2 = computeDiffHash('old', 'new2');
    expect(h1).not.toBe(h2);
  });

  it('hash is a hex string of 64 chars (sha256)', () => {
    const h = computeDiffHash(null, { key: 'value' });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
