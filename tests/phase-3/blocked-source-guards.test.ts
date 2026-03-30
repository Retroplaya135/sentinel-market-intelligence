import { describe, it, expect } from 'vitest';
import {
  guardTelegramPublicMining,
  guardDiscordMining,
  guardTiktokResearch,
  checkAllBlockedSourceGuards,
  isBlockedSource,
  BLOCKED_SOURCE_IDS,
} from '../../packages/policy-engine/src/blocked-sources/guards.js';

describe('Blocked Source Guards — Hard guards that CANNOT be bypassed', () => {
  describe('Telegram public-channel mining', () => {
    it('BLOCKS telegram_public', () => {
      const result = guardTelegramPublicMining('telegram_public');
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.rule_id).toBe('FSG-001');
      }
    });

    it('allows non-telegram sources', () => {
      expect(guardTelegramPublicMining('onchain_evm').blocked).toBe(false);
      expect(guardTelegramPublicMining('reddit').blocked).toBe(false);
    });
  });

  describe('Discord scraping/mining', () => {
    it('BLOCKS discord_mining', () => {
      const result = guardDiscordMining('discord_mining');
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.rule_id).toBe('FSG-002');
      }
    });

    it('allows non-discord sources', () => {
      expect(guardDiscordMining('onchain_evm').blocked).toBe(false);
    });
  });

  describe('TikTok Research Tools', () => {
    it('BLOCKS tiktok_research', () => {
      const result = guardTiktokResearch('tiktok_research');
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.rule_id).toBe('FSG-003');
      }
    });

    it('allows non-tiktok sources', () => {
      expect(guardTiktokResearch('onchain_evm').blocked).toBe(false);
    });
  });

  describe('Combined guard check', () => {
    it('blocks ALL 3 blocked sources', () => {
      for (const id of BLOCKED_SOURCE_IDS) {
        const result = checkAllBlockedSourceGuards(id);
        expect(result.blocked, `${id} must be blocked`).toBe(true);
      }
    });

    it('allows all non-blocked sources', () => {
      const allowed = ['onchain_evm', 'onchain_solana', 'exchange_market_data', 'licensed_news_rss', 'first_party'];
      for (const id of allowed) {
        expect(checkAllBlockedSourceGuards(id).blocked, `${id} should not be blocked`).toBe(false);
      }
    });

    it('conditional sources are NOT hard-blocked (they have separate gates)', () => {
      for (const id of ['x_twitter', 'reddit', 'youtube']) {
        expect(checkAllBlockedSourceGuards(id).blocked).toBe(false);
      }
    });
  });

  describe('isBlockedSource utility', () => {
    it('returns true for all 3 blocked source IDs', () => {
      expect(isBlockedSource('telegram_public')).toBe(true);
      expect(isBlockedSource('discord_mining')).toBe(true);
      expect(isBlockedSource('tiktok_research')).toBe(true);
    });

    it('returns false for non-blocked sources', () => {
      expect(isBlockedSource('onchain_evm')).toBe(false);
      expect(isBlockedSource('x_twitter')).toBe(false);
    });
  });

  describe('Guards are pure functions — cannot be reconfigured', () => {
    it('guard functions always return the same result for the same input', () => {
      for (let i = 0; i < 10; i++) {
        expect(guardTelegramPublicMining('telegram_public').blocked).toBe(true);
        expect(guardDiscordMining('discord_mining').blocked).toBe(true);
        expect(guardTiktokResearch('tiktok_research').blocked).toBe(true);
      }
    });

    it('BLOCKED_SOURCE_IDS is exactly 3 entries', () => {
      expect(BLOCKED_SOURCE_IDS.length).toBe(3);
    });
  });
});
