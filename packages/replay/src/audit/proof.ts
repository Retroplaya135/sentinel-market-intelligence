import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import type { ReplayResult } from '../engine/replay-engine.js';

export const ReplayAuditProofSchema = z.object({
  proof_id: z.string().min(1),
  replay_id: z.string().min(1),
  stream_id: z.string().min(1),
  asset_id: z.string().min(1),
  total_events: z.number().int().nonnegative(),
  deterministic: z.boolean(),
  matching_ratio: z.number().min(0).max(1),
  content_hash: z.string().min(1),
  step_hashes: z.array(z.string().min(1)),
  chain_valid: z.boolean(),
  generated_at: z.string().datetime(),
  generated_by: z.string().min(1),
});

export type ReplayAuditProof = z.infer<typeof ReplayAuditProofSchema>;

export const ReplayComparisonSchema = z.object({
  comparison_id: z.string().min(1),
  replay_id: z.string().min(1),
  asset_id: z.string().min(1),
  original_score: z.number().optional(),
  replayed_score: z.number().optional(),
  score_deviation: z.number().nonnegative().optional(),
  score_direction_match: z.boolean(),
  alert_match: z.boolean(),
  explanation_match: z.boolean(),
  overall_match: z.boolean(),
  details: z.array(z.object({
    metric: z.string().min(1),
    original: z.unknown(),
    replayed: z.unknown(),
    matches: z.boolean(),
  })),
  generated_at: z.string().datetime(),
});

export type ReplayComparison = z.infer<typeof ReplayComparisonSchema>;

export class ReplayAuditProofGenerator {
  generateProof(replayResult: ReplayResult, actor_id: string): ReplayAuditProof {
    const stepHashes = replayResult.steps.map((step) => {
      const data = JSON.stringify({
        sequence: step.sequence_number,
        event_type: step.event_type,
        original: step.original_payload,
        replayed: step.replayed_result,
        matches: step.matches_original,
      });
      return createHash('sha256').update(data).digest('hex');
    });

    let chainHash = '0'.repeat(64);
    for (const sh of stepHashes) {
      chainHash = createHash('sha256').update(chainHash + sh).digest('hex');
    }

    const matchingRatio = replayResult.total_events > 0
      ? replayResult.matching_events / replayResult.total_events
      : 1;

    const proof: ReplayAuditProof = {
      proof_id: `rproof_${randomUUID()}`,
      replay_id: replayResult.replay_id,
      stream_id: replayResult.stream_id,
      asset_id: replayResult.asset_id,
      total_events: replayResult.total_events,
      deterministic: replayResult.deterministic,
      matching_ratio: Math.round(matchingRatio * 10000) / 10000,
      content_hash: chainHash,
      step_hashes: stepHashes,
      chain_valid: true,
      generated_at: new Date().toISOString(),
      generated_by: actor_id,
    };

    ReplayAuditProofSchema.parse(proof);
    return proof;
  }

  verifyProof(proof: ReplayAuditProof, replayResult: ReplayResult): boolean {
    const regenerated = this.generateProof(replayResult, proof.generated_by);
    return regenerated.content_hash === proof.content_hash
      && regenerated.step_hashes.length === proof.step_hashes.length
      && regenerated.step_hashes.every((h, i) => h === proof.step_hashes[i]);
  }
}

export class ReplayComparisonEngine {
  compare(replayResult: ReplayResult, original: {
    score?: number;
    alert_triggered?: boolean;
    explanation_summary?: string;
  }, replayed: {
    score?: number;
    alert_triggered?: boolean;
    explanation_summary?: string;
  }): ReplayComparison {
    const details: ReplayComparison['details'] = [];

    const scoreDeviation = (original.score !== undefined && replayed.score !== undefined)
      ? Math.abs(original.score - replayed.score) : undefined;

    const scoreDirectionMatch = original.score !== undefined && replayed.score !== undefined
      ? ((original.score >= 0) === (replayed.score >= 0))
      : true;

    const alertMatch = original.alert_triggered === replayed.alert_triggered;
    const explanationMatch = original.explanation_summary === replayed.explanation_summary;

    if (original.score !== undefined) {
      details.push({
        metric: 'score',
        original: original.score,
        replayed: replayed.score,
        matches: scoreDeviation !== undefined ? scoreDeviation < 0.001 : true,
      });
    }

    details.push({
      metric: 'alert_triggered',
      original: original.alert_triggered,
      replayed: replayed.alert_triggered,
      matches: alertMatch,
    });

    details.push({
      metric: 'explanation_summary',
      original: original.explanation_summary,
      replayed: replayed.explanation_summary,
      matches: explanationMatch,
    });

    const overallMatch = scoreDirectionMatch && alertMatch && (scoreDeviation === undefined || scoreDeviation < 0.01);

    const comparison: ReplayComparison = {
      comparison_id: `rcmp_${randomUUID()}`,
      replay_id: replayResult.replay_id,
      asset_id: replayResult.asset_id,
      original_score: original.score,
      replayed_score: replayed.score,
      score_deviation: scoreDeviation,
      score_direction_match: scoreDirectionMatch,
      alert_match: alertMatch,
      explanation_match: explanationMatch,
      overall_match: overallMatch,
      details,
      generated_at: new Date().toISOString(),
    };

    ReplayComparisonSchema.parse(comparison);
    return comparison;
  }
}
