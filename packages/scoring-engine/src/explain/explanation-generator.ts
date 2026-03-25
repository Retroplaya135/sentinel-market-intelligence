import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ScoreExplanation } from '@sentinel/module-system';
import { ScoreExplanationSchema } from '@sentinel/module-system';
import type { PerSourceScore } from '../base/base-scorer.js';
import type { FusionResult } from '../fusion/fusion-engine.js';
import type { ManipulationMarkers } from '../anti-manipulation/detector.js';

export const DetailedExplanationSchema = z.object({
  explanation_id: z.string().min(1),
  asset_id: z.string().min(1),
  fused_score: z.number(),
  fused_confidence: z.number(),
  source_breakdowns: z.array(z.object({
    source_id: z.string().min(1),
    raw_score: z.number(),
    adjusted_score: z.number(),
    confidence: z.number(),
    effective_weight: z.number(),
    contribution_pct: z.number(),
    evidence_refs: z.array(z.string().min(1)),
    manipulation_flags: z.array(z.string()),
    discount_factor: z.number().min(0).max(1),
    narrative: z.string().min(1),
  })),
  agreement_ratio: z.number().min(0).max(1),
  dominant_source: z.string().optional(),
  summary_narrative: z.string().min(1),
  invalidation_conditions: z.array(z.string().min(1)),
  generated_at: z.string().datetime(),
});

export type DetailedExplanation = z.infer<typeof DetailedExplanationSchema>;

export class ExplanationGenerator {
  generateFromFusion(
    fusionResult: FusionResult,
    perSourceScores: PerSourceScore[],
    manipulationMap?: Map<string, ManipulationMarkers>,
  ): DetailedExplanation {
    const scoreMap = new Map(perSourceScores.map((s) => [s.source_id, s]));
    const totalContribution = fusionResult.source_contributions.reduce(
      (sum, c) => sum + Math.abs(c.contribution), 0,
    );

    const sourceBreakdowns = fusionResult.source_contributions.map((contrib) => {
      const pss = scoreMap.get(contrib.source_id);
      const markers = manipulationMap?.get(contrib.source_id);
      const contributionPct = totalContribution > 0
        ? (Math.abs(contrib.contribution) / totalContribution) * 100
        : 0;

      const direction = contrib.adjusted_score >= 0 ? 'bullish' : 'bearish';
      const strength = Math.abs(contrib.adjusted_score) > 0.5 ? 'strongly' : 'moderately';

      return {
        source_id: contrib.source_id,
        raw_score: contrib.raw_score,
        adjusted_score: contrib.adjusted_score,
        confidence: pss?.confidence ?? 0,
        effective_weight: contrib.effective_weight,
        contribution_pct: Math.round(contributionPct * 100) / 100,
        evidence_refs: pss?.evidence_refs ?? [],
        manipulation_flags: markers?.flags ?? [],
        discount_factor: markers?.discount_factor ?? 1.0,
        narrative: `${contrib.source_id} is ${strength} ${direction} (raw: ${contrib.raw_score.toFixed(3)}, adj: ${contrib.adjusted_score.toFixed(3)}, weight: ${contrib.effective_weight.toFixed(3)}, contributing ${contributionPct.toFixed(1)}% of total signal)${markers && markers.flags.length > 0 ? ` [⚠ ${markers.flags.join(', ')}]` : ''}`,
      };
    });

    const overallDirection = fusionResult.fused_score >= 0 ? 'bullish' : 'bearish';
    const overallStrength = Math.abs(fusionResult.fused_score) > 0.5 ? 'strong' : Math.abs(fusionResult.fused_score) > 0.2 ? 'moderate' : 'weak';
    const agreementDesc = fusionResult.agreement_ratio > 0.8 ? 'high cross-source agreement' : fusionResult.agreement_ratio > 0.5 ? 'mixed signals across sources' : 'significant disagreement across sources';

    const summaryNarrative = `${fusionResult.asset_id}: ${overallStrength} ${overallDirection} signal (score: ${fusionResult.fused_score.toFixed(3)}, confidence: ${fusionResult.fused_confidence.toFixed(3)}) from ${fusionResult.total_sources} source(s) with ${agreementDesc} (${(fusionResult.agreement_ratio * 100).toFixed(0)}%).${fusionResult.dominant_source ? ` Dominant source: ${fusionResult.dominant_source}.` : ''}`;

    const invalidationConditions = [
      `Score invalidated if any source evidence_ref becomes unavailable`,
      `Score invalidated if manipulation composite exceeds 0.7 for any contributing source`,
      `Score invalidated if source data older than 24h for time-sensitive sources`,
      `Score invalidated if dominant source weight drops below 0.1`,
    ];

    const explanation: DetailedExplanation = {
      explanation_id: `expl_${randomUUID()}`,
      asset_id: fusionResult.asset_id,
      fused_score: fusionResult.fused_score,
      fused_confidence: fusionResult.fused_confidence,
      source_breakdowns: sourceBreakdowns,
      agreement_ratio: fusionResult.agreement_ratio,
      dominant_source: fusionResult.dominant_source,
      summary_narrative: summaryNarrative,
      invalidation_conditions: invalidationConditions,
      generated_at: new Date().toISOString(),
    };

    DetailedExplanationSchema.parse(explanation);
    return explanation;
  }

  toModuleExplanation(detailed: DetailedExplanation): ScoreExplanation {
    const factors = detailed.source_breakdowns.map((b) => ({
      source_id: b.source_id,
      weight: b.effective_weight,
      contribution: b.adjusted_score * b.effective_weight,
      description: b.narrative,
    }));

    const explanation: ScoreExplanation = {
      asset_id: detailed.asset_id,
      score: detailed.fused_score,
      factors,
      timestamp: detailed.generated_at,
    };

    ScoreExplanationSchema.parse(explanation);
    return explanation;
  }
}
