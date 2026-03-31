import { describe, it, expect } from 'vitest';
import {
  DedupeIndex,
  computeCanonicalHash,
  tagProvenance,
} from '../../packages/connectors/src/base/dedupe.js';

describe('Ingestion Dedupe — Canonical hashing', () => {
  it('same record produces same hash', () => {
    const r = { tx: '0xabc', block: 100 };
    expect(computeCanonicalHash(r)).toBe(computeCanonicalHash(r));
  });

  it('different records produce different hashes', () => {
    expect(computeCanonicalHash({ a: 1 })).not.toBe(computeCanonicalHash({ a: 2 }));
  });

  it('key order does not affect hash (canonical sorting)', () => {
    expect(computeCanonicalHash({ b: 2, a: 1 })).toBe(computeCanonicalHash({ a: 1, b: 2 }));
  });

  it('hash is 64-char hex (sha256)', () => {
    expect(computeCanonicalHash({ x: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('DedupeIndex — Duplicate detection', () => {
  it('first record is not a duplicate', () => {
    const idx = new DedupeIndex();
    const hash = computeCanonicalHash({ id: 1 });
    expect(idx.isDuplicate(hash)).toBe(false);
  });

  it('marks and detects duplicate', () => {
    const idx = new DedupeIndex();
    const hash = computeCanonicalHash({ id: 1 });
    idx.mark(hash);
    expect(idx.isDuplicate(hash)).toBe(true);
  });

  it('dedupeRecords separates unique from duplicates', () => {
    const idx = new DedupeIndex();
    const records = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }, { id: 2 }];
    const { unique, duplicates } = idx.dedupeRecords(records);
    expect(unique.length).toBe(3);
    expect(duplicates.length).toBe(2);
  });

  it('size tracks unique entries', () => {
    const idx = new DedupeIndex();
    idx.dedupeRecords([{ a: 1 }, { a: 2 }, { a: 1 }]);
    expect(idx.size()).toBe(2);
  });

  it('clear resets the index', () => {
    const idx = new DedupeIndex();
    idx.mark('hash1');
    idx.clear();
    expect(idx.isDuplicate('hash1')).toBe(false);
    expect(idx.size()).toBe(0);
  });
});

describe('Provenance Tagging', () => {
  it('tags record with source metadata', () => {
    const tag = tagProvenance({ tx: '0x1' }, {
      source_id: 'onchain_evm',
      endpoint: 'https://eth.provider.io',
      request_id: 'req_001',
      policy_mode: 'allow',
    });
    expect(tag.source_id).toBe('onchain_evm');
    expect(tag.endpoint).toBe('https://eth.provider.io');
    expect(tag.request_id).toBe('req_001');
    expect(tag.policy_mode).toBe('allow');
    expect(tag.canonical_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(tag.ingested_at).toBeTruthy();
  });

  it('different records get different canonical hashes', () => {
    const t1 = tagProvenance({ a: 1 }, { source_id: 's', endpoint: 'e', request_id: 'r', policy_mode: 'allow' });
    const t2 = tagProvenance({ a: 2 }, { source_id: 's', endpoint: 'e', request_id: 'r', policy_mode: 'allow' });
    expect(t1.canonical_hash).not.toBe(t2.canonical_hash);
  });
});
