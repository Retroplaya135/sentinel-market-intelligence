import { describe, it, expect, beforeEach } from 'vitest';
import { PlaceholderStore } from '../../packages/placeholder-engine/src/crud/store.js';
import { AuditLog } from '../../packages/placeholder-engine/src/audit/audit-log.js';
import { PlaceholderValidator } from '../../packages/placeholder-engine/src/validation/validator.js';
import { isValidTransition, VALID_TRANSITIONS } from '../../packages/placeholder-engine/src/registry/schema.js';

describe('Placeholder Lifecycle State Machine — Valid transitions', () => {
  it('draft → review is valid', () => {
    expect(isValidTransition('draft', 'review')).toBe(true);
  });

  it('review → approved is valid', () => {
    expect(isValidTransition('review', 'approved')).toBe(true);
  });

  it('review → draft (rejection) is valid', () => {
    expect(isValidTransition('review', 'draft')).toBe(true);
  });

  it('approved → published is valid', () => {
    expect(isValidTransition('approved', 'published')).toBe(true);
  });

  it('approved → draft (rejection) is valid', () => {
    expect(isValidTransition('approved', 'draft')).toBe(true);
  });

  it('published → reverted is valid', () => {
    expect(isValidTransition('published', 'reverted')).toBe(true);
  });

  it('published → archived is valid', () => {
    expect(isValidTransition('published', 'archived')).toBe(true);
  });

  it('reverted → draft is valid', () => {
    expect(isValidTransition('reverted', 'draft')).toBe(true);
  });

  it('reverted → published (re-publish) is valid', () => {
    expect(isValidTransition('reverted', 'published')).toBe(true);
  });

  it('draft → archived is valid', () => {
    expect(isValidTransition('draft', 'archived')).toBe(true);
  });
});

describe('Placeholder Lifecycle State Machine — Invalid transitions', () => {
  it('draft → published is INVALID (must go through review + approve)', () => {
    expect(isValidTransition('draft', 'published')).toBe(false);
  });

  it('draft → approved is INVALID', () => {
    expect(isValidTransition('draft', 'approved')).toBe(false);
  });

  it('review → published is INVALID (must be approved first)', () => {
    expect(isValidTransition('review', 'published')).toBe(false);
  });

  it('archived → anything is INVALID (terminal state)', () => {
    for (const state of ['draft', 'review', 'approved', 'published', 'reverted']) {
      expect(isValidTransition('archived', state as any), `archived → ${state}`).toBe(false);
    }
  });

  it('published → draft is INVALID (must revert first)', () => {
    expect(isValidTransition('published', 'draft')).toBe(false);
  });
});

describe('Placeholder Store — Lifecycle transitions via store', () => {
  let store: PlaceholderStore;

  beforeEach(() => {
    store = new PlaceholderStore(new AuditLog(), new PlaceholderValidator());
    store.create({
      placeholder_key: 'test.lifecycle',
      category: 'feature_flag',
      value_type: 'boolean',
      scope: 'global',
      owner: 'product_team',
      value: true,
      description: 'Test lifecycle',
      actor_id: 'admin_001',
    });
  });

  it('full happy path: draft → review → approved → published', () => {
    store.transition('test.lifecycle', 'review', 'admin_001');
    store.transition('test.lifecycle', 'approved', 'admin_002');
    const p = store.transition('test.lifecycle', 'published', 'admin_002');
    expect(p.status).toBe('published');
  });

  it('revert and re-publish path', () => {
    store.transition('test.lifecycle', 'review', 'admin_001');
    store.transition('test.lifecycle', 'approved', 'admin_002');
    store.transition('test.lifecycle', 'published', 'admin_002');
    store.transition('test.lifecycle', 'reverted', 'admin_001', 'Bug found');
    const p = store.transition('test.lifecycle', 'published', 'admin_002');
    expect(p.status).toBe('published');
  });

  it('REJECTS invalid transition', () => {
    expect(() => store.transition('test.lifecycle', 'published', 'admin_001')).toThrow('Invalid transition');
  });

  it('rejection path: review → draft', () => {
    store.transition('test.lifecycle', 'review', 'admin_001');
    const p = store.transition('test.lifecycle', 'draft', 'admin_002', 'Needs rework');
    expect(p.status).toBe('draft');
  });

  it('creates audit entries for transitions', () => {
    const audit = new AuditLog();
    const localStore = new PlaceholderStore(audit, new PlaceholderValidator());
    localStore.create({
      placeholder_key: 'audit.test',
      category: 'feature_flag',
      value_type: 'boolean',
      scope: 'global',
      owner: 'team',
      value: false,
      description: 'Audit test',
      actor_id: 'admin_001',
    });
    localStore.transition('audit.test', 'review', 'admin_001');

    const entries = audit.getByKey('audit.test');
    expect(entries.length).toBe(2);
    expect(entries[1].action).toBe('transition');
  });
});
