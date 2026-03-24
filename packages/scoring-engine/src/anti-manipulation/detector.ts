import { z } from 'zod';

export const ManipulationMarkersSchema = z.object({
  source_id: z.string().min(1),
  asset_id: z.string().min(1),
  bot_score: z.number().min(0).max(1),
  brigade_score: z.number().min(0).max(1),
  coordination_score: z.number().min(0).max(1),
  composite_manipulation_score: z.number().min(0).max(1),
  flags: z.array(z.string()),
  discount_factor: z.number().min(0).max(1),
  checked_at: z.string().datetime(),
});

export type ManipulationMarkers = z.infer<typeof ManipulationMarkersSchema>;

export interface ManipulationSignals {
  unique_authors: number;
  total_posts: number;
  time_window_hours: number;
  avg_account_age_days: number;
  posting_burst_ratio: number;
  sentiment_uniformity: number;
  hashtag_coordination_ratio: number;
  known_bot_ratio: number;
}

export const DEFAULT_THRESHOLDS = {
  bot_author_ratio: 0.3,
  brigade_burst_ratio: 5.0,
  coordination_uniformity: 0.9,
  min_unique_authors: 3,
  min_account_age_days: 7,
} as const;

export class ManipulationDetector {
  private thresholds: typeof DEFAULT_THRESHOLDS;

  constructor(thresholds?: Partial<typeof DEFAULT_THRESHOLDS>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  analyze(source_id: string, asset_id: string, signals: ManipulationSignals): ManipulationMarkers {
    const botScore = this.computeBotScore(signals);
    const brigadeScore = this.computeBrigadeScore(signals);
    const coordinationScore = this.computeCoordinationScore(signals);

    const composite = this.computeComposite(botScore, brigadeScore, coordinationScore);
    const flags = this.generateFlags(botScore, brigadeScore, coordinationScore, signals);
    const discountFactor = Math.max(0, 1 - composite);

    const markers: ManipulationMarkers = {
      source_id,
      asset_id,
      bot_score: botScore,
      brigade_score: brigadeScore,
      coordination_score: coordinationScore,
      composite_manipulation_score: composite,
      flags,
      discount_factor: discountFactor,
      checked_at: new Date().toISOString(),
    };

    ManipulationMarkersSchema.parse(markers);
    return markers;
  }

  applyDiscount(rawScore: number, markers: ManipulationMarkers): number {
    return rawScore * markers.discount_factor;
  }

  private computeBotScore(signals: ManipulationSignals): number {
    let score = 0;

    if (signals.known_bot_ratio > this.thresholds.bot_author_ratio) {
      score += 0.5;
    }
    score += signals.known_bot_ratio * 0.3;

    if (signals.avg_account_age_days < this.thresholds.min_account_age_days) {
      score += 0.2;
    }

    return Math.min(1, Math.max(0, score));
  }

  private computeBrigadeScore(signals: ManipulationSignals): number {
    let score = 0;

    if (signals.unique_authors < this.thresholds.min_unique_authors && signals.total_posts > 10) {
      score += 0.4;
    }

    if (signals.posting_burst_ratio > this.thresholds.brigade_burst_ratio) {
      score += 0.3;
    }

    const postsPerAuthor = signals.unique_authors > 0
      ? signals.total_posts / signals.unique_authors
      : signals.total_posts;
    if (postsPerAuthor > 10) {
      score += 0.3;
    }

    return Math.min(1, Math.max(0, score));
  }

  private computeCoordinationScore(signals: ManipulationSignals): number {
    let score = 0;

    if (signals.sentiment_uniformity > this.thresholds.coordination_uniformity) {
      score += 0.5;
    }

    if (signals.hashtag_coordination_ratio > 0.7) {
      score += 0.3;
    }

    if (signals.posting_burst_ratio > 3.0 && signals.sentiment_uniformity > 0.8) {
      score += 0.2;
    }

    return Math.min(1, Math.max(0, score));
  }

  private computeComposite(bot: number, brigade: number, coordination: number): number {
    const weighted = bot * 0.35 + brigade * 0.35 + coordination * 0.30;
    return Math.min(1, Math.max(0, weighted));
  }

  private generateFlags(
    bot: number, brigade: number, coordination: number,
    signals: ManipulationSignals,
  ): string[] {
    const flags: string[] = [];

    if (bot > 0.5) flags.push('HIGH_BOT_ACTIVITY');
    if (bot > 0.3) flags.push('ELEVATED_BOT_RATIO');
    if (brigade > 0.5) flags.push('POSSIBLE_BRIGADE');
    if (brigade > 0.3) flags.push('CONCENTRATED_POSTING');
    if (coordination > 0.5) flags.push('COORDINATED_ACTIVITY');
    if (coordination > 0.3) flags.push('SENTIMENT_UNIFORMITY');
    if (signals.avg_account_age_days < 1) flags.push('NEW_ACCOUNTS_CLUSTER');
    if (signals.posting_burst_ratio > 10) flags.push('EXTREME_BURST');

    return flags;
  }
}
