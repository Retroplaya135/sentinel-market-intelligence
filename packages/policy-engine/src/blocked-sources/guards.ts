export const BLOCKED_SOURCE_IDS = ['telegram_public', 'discord_mining', 'tiktok_research'] as const;
export type BlockedSourceId = (typeof BLOCKED_SOURCE_IDS)[number];

export interface BlockedSourceCheckResult {
  blocked: true;
  source_id: BlockedSourceId;
  reason: string;
  rule_id: string;
}

export interface AllowedSourceCheckResult {
  blocked: false;
  source_id: string;
}

export type SourceGuardResult = BlockedSourceCheckResult | AllowedSourceCheckResult;

export function guardTelegramPublicMining(source_id: string): SourceGuardResult {
  if (source_id === 'telegram_public') {
    return {
      blocked: true,
      source_id: 'telegram_public',
      reason: 'Broad Telegram public-channel mining is permanently blocked by policy.',
      rule_id: 'FSG-001',
    };
  }
  return { blocked: false, source_id };
}

export function guardDiscordMining(source_id: string): SourceGuardResult {
  if (source_id === 'discord_mining') {
    return {
      blocked: true,
      source_id: 'discord_mining',
      reason: 'Broad Discord scraping/mining is permanently blocked by policy.',
      rule_id: 'FSG-002',
    };
  }
  return { blocked: false, source_id };
}

export function guardTiktokResearch(source_id: string): SourceGuardResult {
  if (source_id === 'tiktok_research') {
    return {
      blocked: true,
      source_id: 'tiktok_research',
      reason: 'TikTok Research Tools ingestion for commercial SaaS is permanently blocked by policy.',
      rule_id: 'FSG-003',
    };
  }
  return { blocked: false, source_id };
}

const ALL_GUARDS = [guardTelegramPublicMining, guardDiscordMining, guardTiktokResearch] as const;

export function checkAllBlockedSourceGuards(source_id: string): SourceGuardResult {
  for (const guard of ALL_GUARDS) {
    const result = guard(source_id);
    if (result.blocked) return result;
  }
  return { blocked: false, source_id };
}

export function isBlockedSource(source_id: string): boolean {
  return (BLOCKED_SOURCE_IDS as readonly string[]).includes(source_id);
}
