/**
 * Analytics — computes OSINT metrics from scraped data.
 */
import { logger } from '../utils/logger.mjs';

/**
 * Compute analytics from scraped data.
 * Returns an object with engagement metrics, posting patterns, and network stats.
 */
export function computeAnalytics({ profile, posts, followers, following }) {
  const analytics = {};

  // ── Engagement metrics ──────────────────────────────────────────
  if (posts.length && profile?.followers) {
    const totalLikes = posts.reduce((n, p) => n + (p.likes || 0), 0);
    const totalComments = posts.reduce((n, p) => n + (p.commentCount || 0), 0);
    const avgLikes = Math.round(totalLikes / posts.length);
    const avgComments = Math.round(totalComments / posts.length);
    const engagementRate = ((totalLikes + totalComments) / posts.length / profile.followers * 100).toFixed(2);

    analytics.engagement = {
      totalLikes,
      totalComments,
      avgLikes,
      avgComments,
      engagementRate: `${engagementRate}%`,
      postsAnalyzed: posts.length,
    };
  }

  // ── Posting patterns ────────────────────────────────────────────
  if (posts.length) {
    const timestamps = posts
      .map(p => {
        if (!p.timestamp) return null;
        const d = p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp);
        return isNaN(d.getTime()) ? null : d;
      })
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());

    if (timestamps.length > 1) {
      const earliest = timestamps[0];
      const latest = timestamps[timestamps.length - 1];
      const daysSpan = Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)));
      const postsPerDay = (posts.length / daysSpan).toFixed(2);
      const postsPerWeek = (posts.length / daysSpan * 7).toFixed(2);

      // Best posting hour
      const hourCounts = {};
      timestamps.forEach(t => {
        const h = t.getHours();
        hourCounts[h] = (hourCounts[h] || 0) + 1;
      });
      const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

      // Best posting day
      const dayCounts = {};
      timestamps.forEach(t => {
        const d = t.toLocaleDateString('en-US', { weekday: 'long' });
        dayCounts[d] = (dayCounts[d] || 0) + 1;
      });
      const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

      analytics.posting = {
        earliestPost: earliest.toISOString(),
        latestPost: latest.toISOString(),
        daysActive: daysSpan,
        postsPerDay,
        postsPerWeek,
        bestPostingHour: bestHour ? `${bestHour[0]}:00` : null,
        bestPostingDay: bestDay ? bestDay[0] : null,
      };
    }

    // Account creation estimate (earliest post date as proxy)
    if (timestamps.length) {
      analytics.account = {
        estimatedCreated: timestamps[0].toISOString(),
        estimatedAgeDays: Math.round((Date.now() - timestamps[0].getTime()) / (1000 * 60 * 60 * 24)),
      };
    }
  }

  // ── Content analysis ───────────────────────────────────────────
  if (posts.length) {
    const allHashtags = posts.flatMap(p => p.hashtags || []);
    const allMentions = posts.flatMap(p => p.mentions || []);
    const hashtagCounts = {};
    const mentionCounts = {};
    allHashtags.forEach(h => { hashtagCounts[h] = (hashtagCounts[h] || 0) + 1; });
    allMentions.forEach(m => { mentionCounts[m] = (mentionCounts[m] || 0) + 1; });

    const topHashtags = Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    const topMentions = Object.entries(mentionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([user, count]) => ({ user, count }));

    // Most liked and commented posts
    const mostLiked = [...posts].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5);
    const mostCommented = [...posts].sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0)).slice(0, 5);

    analytics.content = {
      topHashtags,
      topMentions,
      mostLiked: mostLiked.map(p => ({ shortcode: p.shortcode, likes: p.likes, url: p.url })),
      mostCommented: mostCommented.map(p => ({ shortcode: p.shortcode, comments: p.commentCount, url: p.url })),
      carouselPosts: posts.filter(p => p.isCarousel).length,
      reelPosts: posts.filter(p => p.type === 'reel').length,
      photoPosts: posts.filter(p => p.type === 'photo').length,
    };
  }

  // ── Network stats ──────────────────────────────────────────────
  if (followers.length || following.length) {
    const verifiedFollowers = followers.filter(f => f.verified).length;
    const verifiedFollowing = following.filter(f => f.verified).length;

    analytics.network = {
      followerCount: followers.length,
      followingCount: following.length,
      followerFollowingRatio: following.length > 0
        ? (followers.length / following.length).toFixed(2)
        : 'N/A',
      verifiedFollowers,
      verifiedFollowing,
    };
  }

  // ── Bio analysis ───────────────────────────────────────────────
  if (profile?.bio) {
    const bio = profile.bio;
    const emailMatch = bio.match(/[\w.-]+@[\w.-]+\.\w+/);
    const phoneMatch = bio.match(/(\+?\d[\d\s-]{7,}\d)/);
    const urlMatch = bio.match(/https?:\/\/[^\s]+/);

    analytics.bio = {
      hasEmail: !!emailMatch,
      email: emailMatch ? emailMatch[0] : null,
      hasPhone: !!phoneMatch,
      phone: phoneMatch ? phoneMatch[0] : null,
      hasUrl: !!urlMatch,
      url: urlMatch ? urlMatch[0] : null,
      length: bio.length,
    };
  }

  logger.info('analytics computed');
  return analytics;
}
