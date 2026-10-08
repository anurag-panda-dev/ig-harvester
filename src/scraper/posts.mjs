/**
 * Post scraping — visits each permalink, extracts data from JSON + DOM,
 * with caching for resume support. Handles carousels, comment threads,
 * media URLs, hashtags, and mentions.
 */
import {
  harvestJson, mine, extractSidecarChildren, extractCommentThreads,
  extractMediaUrls, extractHashtags, extractMentions,
} from '../extractors/json-miner.mjs';
import {
  scrapePostDom, collectPostLinks, loadAllComments, scrapeComments,
  scrapeCarouselDom, expandCommentThreads,
} from '../extractors/dom.mjs';
import { parseCount, parseTimestamp, extractShortcode, mediaType, sanitizeText } from '../extractors/parser.mjs';
import { logger } from '../utils/logger.mjs';
import { humanDelay } from '../utils/rate-limit.mjs';

export async function scrapePosts(page, links, { wantComments, cache, onProgress } = {}) {
  const posts = [];
  const cached = cache ? cache.getCachedPosts() : new Map();

  for (const [i, href] of links.entries()) {
    const shortcode = extractShortcode(href);

    // Resume: skip already-cached posts
    if (cached.has(shortcode)) {
      logger.debug(`cache hit: ${shortcode}`);
      posts.push(cached.get(shortcode));
      onProgress?.(i + 1, links.length, 'cached');
      continue;
    }

    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 2200));

      const blob = await harvestJson(page);
      const m = mine(blob, null);
      const d = await scrapePostDom(page);

      // Carousel / sidecar media
      const sidecarChildren = extractSidecarChildren(blob, { shortcode });
      const carouselDom = await scrapeCarouselDom(page);

      // Determine media items — sidecar JSON is the most reliable source
      let mediaItems = [];
      if (sidecarChildren.length > 0) {
        mediaItems = sidecarChildren.map(c => ({
          type: c.isVideo ? 'video' : 'image',
          url: c.isVideo ? (c.videoUrl || c.displayUrl) : c.displayUrl,
          thumbnail: c.displayUrl,
        }));
      } else if (carouselDom.mediaItems.length > 0) {
        mediaItems = carouselDom.mediaItems;
      }
      // Note: extractMediaUrls is NOT used as fallback because it grabs
      // ALL display_url values from the page (suggested accounts, ads, etc.)

      // Comments with threads
      let comments = [];
      if (wantComments) {
        await loadAllComments(page);
        await expandCommentThreads(page);
        // Try JSON threads first (more complete)
        const jsonThreads = extractCommentThreads(blob);
        if (jsonThreads.length > 0) {
          comments = jsonThreads.map(c => ({
            username: c.username,
            text: c.text,
            likes: c.likeCount,
            verified: c.verified,
            timestamp: parseTimestamp(c.createdAt),
            replies: c.replies.map(r => ({
              username: r.username,
              text: r.text,
              likes: r.likeCount,
              verified: r.verified,
              timestamp: parseTimestamp(r.createdAt),
            })),
          }));
        } else {
          // Fallback to DOM scraping
          comments = await scrapeComments(page);
        }
      }

      const caption = sanitizeText(m.caption ?? d.caption ?? '');

      const post = {
        shortcode,
        url: `https://www.instagram.com${href}`,
        type: mediaType(href),
        caption,
        likes: parseCount(d.likesUi) ?? m.likeCount ?? 0,
        views: m.playCount ?? null,
        commentCount: comments.length || m.commentCount || 0,
        timestamp: parseTimestamp(d.time) ?? parseTimestamp(m.takenAt),
        location: m.location || null,
        comments,
        // New fields
        isCarousel: sidecarChildren.length > 1 || carouselDom.isCarousel,
        mediaItems,
        mediaCount: mediaItems.length,
        hashtags: extractHashtags(caption),
        mentions: extractMentions(caption),
        engagementRate: null, // calculated later if follower count known
      };
      posts.push(post);

      if (cache) cache.savePost(post);

      const c = comments.length ? `, ${comments.length} comments` : '';
      const media = post.isCarousel ? ` [${post.mediaCount} media]` : '';
      logger.info(`[${i + 1}/${links.length}] ${shortcode} · ${post.likes} likes${c}${media}`);
      onProgress?.(i + 1, links.length, 'scraped');
    } catch (e) {
      logger.warn(`failed on ${href}: ${e.message?.split('\n')[0]}`);
      onProgress?.(i + 1, links.length, 'error');
    }

    await humanDelay();
  }

  return posts;
}

/** Collect post permalinks from the profile grid. */
export async function getPostLinks(page, max, { onProgress } = {}) {
  return collectPostLinks(page, max, { onProgress });
}
