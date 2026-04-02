import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCache, DEFAULT_TTL_BY_SOURCE } from '../../packages/data-layer/src/cache/cache.js';

describe('InMemoryCache — Basic operations', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache(60000);
  });

  it('set and get a value', () => {
    cache.set('btc:score', { score: 0.5 }, 'onchain_evm');
    expect(cache.get('btc:score')).toEqual({ score: 0.5 });
  });

  it('has returns true for existing key', () => {
    cache.set('key1', 'val', 'onchain_evm');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('delete removes entry', () => {
    cache.set('key1', 'val', 'onchain_evm');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.has('key1')).toBe(false);
    expect(cache.delete('missing')).toBe(false);
  });

  it('size tracks entries', () => {
    expect(cache.size()).toBe(0);
    cache.set('a', 1, 'src');
    cache.set('b', 2, 'src');
    expect(cache.size()).toBe(2);
  });

  it('clear removes all entries', () => {
    cache.set('a', 1, 'src');
    cache.set('b', 2, 'src');
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('overwrite existing key', () => {
    cache.set('k', 'v1', 'src');
    cache.set('k', 'v2', 'src');
    expect(cache.get('k')).toBe('v2');
    expect(cache.size()).toBe(1);
  });
});

describe('InMemoryCache — TTL and expiry', () => {
  it('expired entries return undefined', () => {
    const cache = new InMemoryCache(1);
    cache.set('k', 'v', 'src', 1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(cache.get('k')).toBeUndefined();
  });

  it('has returns false for expired entries', () => {
    const cache = new InMemoryCache(1);
    cache.set('k', 'v', 'src', 1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(cache.has('k')).toBe(false);
  });

  it('pruneExpired removes all expired entries', () => {
    const cache = new InMemoryCache(1);
    cache.set('a', 1, 'src', 1);
    cache.set('b', 2, 'src', 1);
    cache.set('c', 3, 'src', 999999);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    const pruned = cache.pruneExpired();
    expect(pruned).toBe(2);
    expect(cache.size()).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('uses source-aware default TTL', () => {
    const cache = new InMemoryCache(60000);
    cache.set('k', 'v', 'exchange_market_data');
    expect(DEFAULT_TTL_BY_SOURCE['exchange_market_data']).toBe(15000);
  });
});

describe('InMemoryCache — Source invalidation', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache(60000);
    cache.set('evm:btc', 1, 'onchain_evm');
    cache.set('evm:eth', 2, 'onchain_evm');
    cache.set('news:btc', 3, 'licensed_news_rss');
    cache.set('exch:btc', 4, 'exchange_market_data');
  });

  it('invalidateBySource removes all entries for that source', () => {
    const count = cache.invalidateBySource('onchain_evm');
    expect(count).toBe(2);
    expect(cache.has('evm:btc')).toBe(false);
    expect(cache.has('evm:eth')).toBe(false);
    expect(cache.has('news:btc')).toBe(true);
    expect(cache.has('exch:btc')).toBe(true);
  });

  it('invalidateBySource returns 0 for unknown source', () => {
    expect(cache.invalidateBySource('unknown')).toBe(0);
  });

  it('invalidateByPrefix removes matching keys', () => {
    const count = cache.invalidateByPrefix('evm:');
    expect(count).toBe(2);
    expect(cache.has('news:btc')).toBe(true);
  });
});

describe('InMemoryCache — Hit rate tracking', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache(60000);
  });

  it('hitRate starts at 0', () => {
    expect(cache.hitRate()).toBe(0);
  });

  it('hitRate tracks correctly', () => {
    cache.set('k', 'v', 'src');
    cache.get('k');
    cache.get('k');
    cache.get('missing');
    expect(cache.hitRate()).toBeCloseTo(2 / 3, 2);
  });

  it('hitRate resets on clear', () => {
    cache.set('k', 'v', 'src');
    cache.get('k');
    cache.clear();
    expect(cache.hitRate()).toBe(0);
  });
});

describe('InMemoryCache — DEFAULT_TTL_BY_SOURCE', () => {
  it('has TTLs for all core sources', () => {
    expect(DEFAULT_TTL_BY_SOURCE['onchain_evm']).toBeDefined();
    expect(DEFAULT_TTL_BY_SOURCE['exchange_market_data']).toBeDefined();
    expect(DEFAULT_TTL_BY_SOURCE['licensed_news_rss']).toBeDefined();
    expect(DEFAULT_TTL_BY_SOURCE['first_party']).toBeDefined();
  });

  it('exchange data has shortest TTL', () => {
    expect(DEFAULT_TTL_BY_SOURCE['exchange_market_data']).toBeLessThan(DEFAULT_TTL_BY_SOURCE['licensed_news_rss']);
  });

  it('first_party has longest TTL', () => {
    expect(DEFAULT_TTL_BY_SOURCE['first_party']).toBeGreaterThan(DEFAULT_TTL_BY_SOURCE['onchain_evm']);
  });
});
