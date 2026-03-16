import { createHash } from 'crypto';

export interface ProvenanceTag {
  source_id: string;
  endpoint: string;
  request_id: string;
  policy_mode: string;
  ingested_at: string;
  canonical_hash: string;
}

export function computeCanonicalHash(record: unknown): string {
  const normalized = JSON.stringify(record, Object.keys(record as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

export function tagProvenance(record: unknown, params: {
  source_id: string;
  endpoint: string;
  request_id: string;
  policy_mode: string;
}): ProvenanceTag {
  return {
    source_id: params.source_id,
    endpoint: params.endpoint,
    request_id: params.request_id,
    policy_mode: params.policy_mode,
    ingested_at: new Date().toISOString(),
    canonical_hash: computeCanonicalHash(record),
  };
}

export class DedupeIndex {
  private seen: Set<string> = new Set();

  isDuplicate(hash: string): boolean {
    return this.seen.has(hash);
  }

  mark(hash: string): void {
    this.seen.add(hash);
  }

  dedupeRecords<T>(records: T[]): { unique: T[]; duplicates: T[] } {
    const unique: T[] = [];
    const duplicates: T[] = [];
    for (const r of records) {
      const hash = computeCanonicalHash(r);
      if (this.seen.has(hash)) {
        duplicates.push(r);
      } else {
        this.seen.add(hash);
        unique.push(r);
      }
    }
    return { unique, duplicates };
  }

  size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}
