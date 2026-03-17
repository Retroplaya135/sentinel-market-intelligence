import { z } from 'zod';

export const CacheEntrySchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  source_id: z.string().min(1),
  ttl_ms: z.number().int().positive(),
  created_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  hit_count: z.number().int().nonnegative(),
  last_accessed_at: z.number().int().positive(),
});

export type CacheEntry = z.infer<typeof CacheEntrySchema>;

export interface CacheInterface {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown, source_id: string, ttl_ms?: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  invalidateBySource(source_id: string): number;
  invalidateByPrefix(prefix: string): number;
  pruneExpired(): number;
  size(): number;
  hitRate(): number;
  clear(): void;
}

export const DEFAULT_TTL_BY_SOURCE: Record<string, number> = {
  onchain_evm: 60_000,
  onchain_solana: 60_000,
  exchange_market_data: 15_000,
  licensed_news_rss: 300_000,
  first_party: 600_000,
  x_twitter: 30_000,
  reddit: 120_000,
  youtube: 300_000,
};

export class InMemoryCache implements CacheInterface {
  private entries: Map<string, CacheEntry> = new Map();
  private sourceIndex: Map<string, Set<string>> = new Map();
  private totalGets = 0;
  private totalHits = 0;
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T = unknown>(key: string): T | undefined {
    this.totalGets++;
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (Date.now() >= entry.expires_at) {
      this.delete(key);
      return undefined;
    }

    this.totalHits++;
    entry.hit_count++;
    entry.last_accessed_at = Date.now();
    return entry.value as T;
  }

  set(key: string, value: unknown, source_id: string, ttl_ms?: number): void {
    const effectiveTtl = ttl_ms ?? DEFAULT_TTL_BY_SOURCE[source_id] ?? this.defaultTtlMs;
    const now = Date.now();

    const entry: CacheEntry = {
      key,
      value,
      source_id,
      ttl_ms: effectiveTtl,
      created_at: now,
      expires_at: now + effectiveTtl,
      hit_count: 0,
      last_accessed_at: now,
    };

    this.entries.set(key, entry);

    if (!this.sourceIndex.has(source_id)) {
      this.sourceIndex.set(source_id, new Set());
    }
    this.sourceIndex.get(source_id)!.add(key);
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expires_at) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;

    this.entries.delete(key);
    const sourceKeys = this.sourceIndex.get(entry.source_id);
    if (sourceKeys) {
      sourceKeys.delete(key);
      if (sourceKeys.size === 0) this.sourceIndex.delete(entry.source_id);
    }
    return true;
  }

  invalidateBySource(source_id: string): number {
    const keys = this.sourceIndex.get(source_id);
    if (!keys) return 0;

    const count = keys.size;
    for (const key of [...keys]) {
      this.entries.delete(key);
    }
    this.sourceIndex.delete(source_id);
    return count;
  }

  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.expires_at) {
        this.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  size(): number {
    return this.entries.size;
  }

  hitRate(): number {
    if (this.totalGets === 0) return 0;
    return this.totalHits / this.totalGets;
  }

  clear(): void {
    this.entries.clear();
    this.sourceIndex.clear();
    this.totalGets = 0;
    this.totalHits = 0;
  }
}
