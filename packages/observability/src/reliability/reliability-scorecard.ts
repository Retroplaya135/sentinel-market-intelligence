import { z } from 'zod';
import { randomUUID } from 'crypto';

export const ReliabilityDimension = z.enum(['availability', 'latency', 'error_rate', 'freshness', 'correctness']);
export type ReliabilityDimensionType = z.infer<typeof ReliabilityDimension>;

export const SubjectType = z.enum(['release', 'connector', 'service']);
export type SubjectTypeValue = z.infer<typeof SubjectType>;

export interface DimensionWeight {
  dimension: ReliabilityDimensionType;
  weight: number;
}

export interface ReliabilityScore {
  score_id: string;
  subject_type: z.infer<typeof SubjectType>;
  subject_id: string;
  overall_score: number;
  dimensions: Record<string, number>;
  pass: boolean;
  pass_threshold: number;
  computed_at: string;
  window_hours: number;
}

const DEFAULT_WEIGHTS: DimensionWeight[] = [
  { dimension: 'availability', weight: 0.30 },
  { dimension: 'latency', weight: 0.25 },
  { dimension: 'error_rate', weight: 0.20 },
  { dimension: 'freshness', weight: 0.15 },
  { dimension: 'correctness', weight: 0.10 },
];

export class ReliabilityScorecard {
  private scores: Map<string, ReliabilityScore> = new Map();
  private weights: DimensionWeight[];
  private passThreshold: number;

  constructor(passThreshold: number = 80, weights?: DimensionWeight[]) {
    this.passThreshold = passThreshold;
    this.weights = weights ?? DEFAULT_WEIGHTS;
  }

  compute(params: {
    subject_type: z.infer<typeof SubjectType>;
    subject_id: string;
    dimensions: Record<string, number>;
    window_hours: number;
  }): ReliabilityScore {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const w of this.weights) {
      const val = params.dimensions[w.dimension];
      if (val !== undefined) {
        weightedSum += val * w.weight;
        totalWeight += w.weight;
      }
    }

    const overall = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;

    const score: ReliabilityScore = {
      score_id: `rel_${randomUUID()}`,
      subject_type: params.subject_type,
      subject_id: params.subject_id,
      overall_score: overall,
      dimensions: { ...params.dimensions },
      pass: overall >= this.passThreshold,
      pass_threshold: this.passThreshold,
      computed_at: new Date().toISOString(),
      window_hours: params.window_hours,
    };

    this.scores.set(score.score_id, score);
    return score;
  }

  getScore(scoreId: string): ReliabilityScore | undefined {
    return this.scores.get(scoreId);
  }

  getBySubject(subjectType: z.infer<typeof SubjectType>, subjectId: string): ReliabilityScore[] {
    return Array.from(this.scores.values()).filter(
      (s) => s.subject_type === subjectType && s.subject_id === subjectId,
    );
  }

  getLatest(subjectType: z.infer<typeof SubjectType>, subjectId: string): ReliabilityScore | undefined {
    const scores = this.getBySubject(subjectType, subjectId);
    if (scores.length === 0) return undefined;
    return scores.sort((a, b) => b.computed_at.localeCompare(a.computed_at))[0];
  }

  getPassing(): ReliabilityScore[] {
    return Array.from(this.scores.values()).filter((s) => s.pass);
  }

  getFailing(): ReliabilityScore[] {
    return Array.from(this.scores.values()).filter((s) => !s.pass);
  }

  compare(scoreIdA: string, scoreIdB: string): { delta: number; improved: boolean } | null {
    const a = this.scores.get(scoreIdA);
    const b = this.scores.get(scoreIdB);
    if (!a || !b) return null;
    const delta = b.overall_score - a.overall_score;
    return { delta: Math.round(delta * 100) / 100, improved: delta > 0 };
  }

  size(): number { return this.scores.size; }
  clear(): void { this.scores.clear(); }
}
