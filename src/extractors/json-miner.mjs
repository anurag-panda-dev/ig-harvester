/**
 * Mines embedded Relay JSON islands from the DOM.
 * Instagram ships <script type="application/json"> blobs with profile/post data.
 * We regex individual fields rather than JSON.parse the whole blob (it's a
 * requirejs bundle with interleaved text that won't parse).
 */

/** Concatenate every embedded JSON island Instagram ships in the DOM. */
export async function harvestJson(page) {
  return page.evaluate(() => {
    const chunks = [];
    for (const s of document.querySelectorAll(
      'script[type="application/json"], script#polars-ig-cache, script[data-content-len]'
    )) {
      const t = s.textContent;
      if (t && t.length < 4_000_000) chunks.push(t);
    }
    return chunks.join('\n');
  });
}

/** Extract a balanced JSON block starting at a given position. */
function extractBlock(blob, startPos) {
  let depth = 0, inStr = false, esc = false;
  for (let i = startPos; i < blob.length; i++) {
    const c = blob[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') { depth--; if (depth === 0) return blob.slice(startPos, i + 1); }
  }
  return null;
}

/** Locate the sidecar (carousel children) block; optionally near a shortcode. */
function sidecarBlock(blob, shortcode = null) {
  // Newer payloads renamed the field — accept both spellings
  const keyRe = /"(?:edge_sidecar_to_children|xdt_api__v1__media__sidecar_children)":\s*\{/;

  if (shortcode) {
    // Prefer the block belonging to THIS post (pages can embed other posts)
    const scRe = new RegExp(`"shortcode"\\s*:\\s*"${String(shortcode).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}"`);
    const at = blob.search(scRe);
    if (at > -1) {
      const scoped = blob.slice(at, at + 100_000).match(keyRe);
      if (scoped) {
        const block = extractBlock(blob, at + scoped.index + scoped[0].length - 1);
        if (block) return block;
      }
    }
  }

  const match = blob.match(keyRe);
  if (!match) return null;
  return extractBlock(blob, match.index + match[0].length - 1);
}

/** Unescape a JSON string value (\" \\ \/ \uXXXX). */
const unesc = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                      .replace(/\\\//g, '/')
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, '\\');

/**
 * Extract all sidecar children (carousel media) from the blob.
 *
 * Each `"node"` block is parsed field-by-field, so field order cannot break
 * extraction (Instagram reorders freely between payloads). Pass the post's
 * `shortcode` to pin the block to that post.
 */
export function extractSidecarChildren(blob, { shortcode = null } = {}) {
  if (!blob) return [];
  const block = sidecarBlock(blob, shortcode);
  if (!block) return [];

  const children = [];
  const nodeRe = /"node":\s*\{/g;
  let m;
  while ((m = nodeRe.exec(block)) !== null) {
    const start = m.index + m[0].length - 1;
    const nodeBlock = extractBlock(block, start);
    if (!nodeBlock) continue;
    nodeRe.lastIndex = start + nodeBlock.length; // never re-parse nested text

    const grab = (re) => {
      const g = nodeBlock.match(re);
      return g ? g[1] : undefined;
    };
    const displayUrl = grab(/"display_url":\s*"((?:[^"\\]|\\.)+)"/);
    const videoUrl   = grab(/"video_url":\s*"((?:[^"\\]|\\.)+)"/);
    const typename   = grab(/"__typename":\s*"(\w+)"/);
    const isVideoRaw = grab(/"is_video":\s*(true|false)/);
    const mediaType  = grab(/"media_type":\s*(\d+)/); // IG API: 1 photo, 2 video, 8 carousel

    if (!displayUrl && !videoUrl) continue; // not a media node
    const isVideo = isVideoRaw === 'true' ||
                    (!isVideoRaw && (typename === 'GraphVideo' || !!videoUrl || mediaType === '2'));

    children.push({
      type      : typename || (isVideo ? 'GraphVideo' : 'GraphImage'),
      displayUrl: displayUrl ? unesc(displayUrl) : null,
      isVideo,
      videoUrl  : videoUrl ? unesc(videoUrl) : null,
    });
  }
  return children;
}

/** Extract comment threads with replies from the blob. */
export function extractCommentThreads(blob) {
  if (!blob) return [];
  const match = blob.match(/"edge_media_to_parent_comment":\s*\{/) || blob.match(/"edge_media_to_comment":\s*\{/);
  if (!match) return [];
  const startPos = match.index + match[0].length - 1;
  const block = extractBlock(blob, startPos);
  if (!block) return [];

  const comments = [];
  // Match individual comment nodes
  const commentRe = /"node":\s*\{[^}]*?"id":\s*"(\d+)"[^}]*?"text":\s*"((?:[^"\\]|\\.){0,5000})"[^}]*?"created_at":\s*(\d+)[^}]*?"owner":\s*\{[^}]*?"username":\s*"([^"]+)"[^}]*?"is_verified":\s*(true|false)[^}]*?"edge_liked_by":\s*\{[^}]*?"count":\s*(\d+)/g;
  let m;
  while ((m = commentRe.exec(block)) !== null) {
    const comment = {
      id        : m[1],
      text      : decodeJsonString(m[2]),
      createdAt : Number(m[3]),
      username  : m[4],
      verified  : m[5] === 'true',
      likeCount : Number(m[6]),
      replies   : [],
    };
    // Check for threaded replies after this comment
    const afterComment = block.slice(m.index + m[0].length);
    const replyMatch = afterComment.match(/"edge_threaded_comments":\s*\{/);
    if (replyMatch) {
      const replyStart = m.index + m[0].length + replyMatch.index + replyMatch[0].length - 1;
      const replyBlock = extractBlock(block, replyStart);
      if (replyBlock) {
        const replyRe = /"node":\s*\{[^}]*?"id":\s*"(\d+)"[^}]*?"text":\s*"((?:[^"\\]|\\.){0,5000})"[^}]*?"created_at":\s*(\d+)[^}]*?"owner":\s*\{[^}]*?"username":\s*"([^"]+)"[^}]*?"is_verified":\s*(true|false)[^}]*?"edge_liked_by":\s*\{[^}]*?"count":\s*(\d+)/g;
        let rm;
        while ((rm = replyRe.exec(replyBlock)) !== null) {
          comment.replies.push({
            id        : rm[1],
            text      : decodeJsonString(rm[2]),
            createdAt : Number(rm[3]),
            username  : rm[4],
            verified  : rm[5] === 'true',
            likeCount : Number(rm[6]),
          });
        }
      }
    }
    comments.push(comment);
  }
  return comments;
}

/** Extract all media URLs (images and videos) from the blob.
 *  Filters out profile pictures (small dimensions like 150x150, 206x206)
 *  and only keeps actual post media (large images/videos). */
export function extractMediaUrls(blob) {
  if (!blob) return [];
  const urls = new Set();
  const re = /"(?:display_url|video_url|thumbnail_src)":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const url = m[1].replace(/\\\//g, '/');
    if (!url.startsWith('http')) continue;
    // Skip profile pictures (small dimensions in URL params)
    if (/s150x150|s206x206|s320x320/.test(url)) continue;
    // Skip avatar/profile pic patterns
    if (/profile_pic|avatar/i.test(url)) continue;
    urls.add(url);
  }
  return [...urls];
}

/** Extract hashtags from caption text. */
export function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w]+/g);
  return matches ? matches.map(t => t.slice(1)) : [];
}

/** Extract mentions (@username) from caption text. */
export function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@([\w.]+)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
}

/**
 * Pull scalars out of the Relay payload with regex.
 * Returns undefined for missing fields so callers can fall back.
 * When username is provided, profile-level fields are filtered to avoid
 * grabbing data from suggested-account blobs embedded in the same page.
 */
export function mine(blob, username = null) {
  if (!blob) return {};
  const g = (re, i = 1) => { const m = blob.match(re); return m ? m[i] : undefined; };
  const gInt = (re) => { const v = g(re); return v ? Number(v) : undefined; };

  let caption;
  try {
    const raw = g(/"caption":\{"text":"((?:[^"\\]|\\.){0,5000})"/);
    caption = raw ? JSON.parse(`"${raw}"`) : undefined;
  } catch { caption = undefined; }

  // Decode escaped forward slashes in URLs
  const decodeUrl = (raw) => raw ? raw.replace(/\\\//g, '/') : undefined;

  // Profile-level fields: if username is provided, only accept values from
  // a JSON blob that also contains the target username.
  const profileFields = {};
  if (username) {
    const chunks = blob.split(`"${username}"`);
    const relevantBlob = chunks.length > 1 ? `"${username}"${chunks.slice(1).join(`"${username}"`)}` : blob;
    const rg = (re, i = 1) => { const m = relevantBlob.match(re); return m ? m[i] : undefined };

    profileFields.fullName     = rg(/"full_name":"((?:[^"\\]|\\.){0,200})"/);
    profileFields.biography    = rg(/"biography":"((?:[^"\\]|\\.){0,2000})"/);
    profileFields.externalUrl  = decodeUrl(rg(/"external_url":"((?:[^"\\]|\\.){0,500})"/));
    profileFields.isPrivate    = rg(/"is_private":(true|false)/);
    profileFields.isVerified   = rg(/"is_verified":(true|false)/);
    profileFields.profilePicUrl= decodeUrl(rg(/"profile_pic_url_hd":"((?:[^"\\]|\\.){0,1000})"/));
  } else {
    profileFields.fullName     = g(/"full_name":"((?:[^"\\]|\\.){0,200})"/);
    profileFields.biography    = g(/"biography":"((?:[^"\\]|\\.){0,2000})"/);
    profileFields.externalUrl  = decodeUrl(g(/"external_url":"((?:[^"\\]|\\.){0,500})"/));
    profileFields.isPrivate    = gInt(/"is_private":(true|false)/);
    profileFields.isVerified   = gInt(/"is_verified":(true|false)/);
    profileFields.profilePicUrl= decodeUrl(g(/"profile_pic_url_hd":"((?:[^"\\]|\\.){0,1000})"/));
  }

  return {
    likeCount    : gInt(/"like_count":(\d+)/),
    commentCount : gInt(/"comment_count":(\d+)/) ?? gInt(/"comments":\{"count":(\d+)/),
    playCount    : gInt(/"play_count":(\d+)/),
    takenAt      : gInt(/"taken_at(?:_timestamp)?":(\d+)/),
    shortcode    : g(/"shortcode":"([A-Za-z0-9_-]{11,30})"/),
    location     : g(/"location":\{"pk":\d+,"name":"([^"]{1,80})"/),
    caption      ,
    follows      : gInt(/"follows_count":(\d+)/),
    followers    : gInt(/"follower_count":(\d+)/) ?? gInt(/"edge_followed_by":\{"count":(\d+)/),
    posts        : gInt(/"media_count":(\d+)/) ?? gInt(/"edge_owner_to_timeline_media":\{"count":(\d+)/),
    isVideo      : gInt(/"is_video":(true|false)/),
    videoDuration: gInt(/"video_duration":([\d.]+)/),
    // Profile-level fields (filtered by username if provided)
    ...profileFields,
  };
}

/** Decode a JSON string value (handles \u2063 etc). */
export function decodeJsonString(raw) {
  if (!raw) return undefined;
  try { return JSON.parse(`"${raw}"`); } catch { return raw; }
}
