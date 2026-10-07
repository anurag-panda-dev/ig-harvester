/**
 * Profile scraping — merges header DOM + embedded JSON with header-first priority.
 */
import { scrapeHeader } from '../extractors/dom.mjs';
import { harvestJson, mine } from '../extractors/json-miner.mjs';
import { parseCount } from '../extractors/parser.mjs';
import { logger } from '../utils/logger.mjs';

export async function scrapeProfile(page, username) {
  const dom = await scrapeHeader(page);
  const mined = mine(await harvestJson(page), username);

  const profile = {
    username  : username,
    url       : `https://instagram.com/${username}`,
    name      : dom.name || mined.fullName || undefined,
    bio       : dom.bio || mined.biography || undefined,
    posts     : parseCount(dom.postsRaw)  ?? mined.posts   ?? null,
    followers : parseCount(dom.follRaw)   ?? mined.followers ?? null,
    following : parseCount(dom.followRaw) ?? mined.follows   ?? null,
    isPrivate : mined.isPrivate ?? null,
    isVerified: mined.isVerified ?? null,
    externalUrl: mined.externalUrl ?? null,
    scrapedAt : new Date().toISOString(),
    _sources  : { headerRaw: dom, embeddedJson: mined },
  };

  logger.info(`profile: ${profile.name || username} · ${profile.posts ?? '?'} posts · ${profile.followers ?? '?'} followers · ${profile.following ?? '?'} following`);
  return profile;
}
