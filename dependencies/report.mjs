#!/usr/bin/env node
/**
 * report.mjs — static analysis + master index for IG-DATA
 * =======================================================
 * Turns an imported profile folder into readable documents. Pure derivation:
 * it never writes into the archived run data, only into analysis/ and README.md.
 *
 * Writes:
 *   <dir>/analysis/analytics.json   machine-readable metrics
 *   <dir>/analysis/report.md        full OSINT report
 *   <dir>/README.md                 short profile card + links
 *   <root>/INDEX.md                 master index across every profile
 *   <root>/index.json               machine-readable index
 *
 * Usage:
 *   node dependencies/report.mjs --dir ../IG-DATA/someuser
 *   node dependencies/report.mjs --dir ../IG-DATA/someuser --root ../IG-DATA
 *   node dependencies/report.mjs --root ../IG-DATA        # re-index every profile only
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// analytics.mjs reads LOG_LEVEL at import time, so set it before loading.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
const { computeAnalytics } = await import('../src/scraper/analytics.mjs');

// ── Args ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const val = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const dirArg = val('dir');
const rootArg = val('root');
const sourceArg = val('source');

if (!dirArg && !rootArg) {
  console.error('usage: node dependencies/report.mjs --dir <IG-DATA/user> [--root <IG-DATA>] [--source out/user]');
  console.error('       node dependencies/report.mjs --root <IG-DATA>     # re-index only');
  process.exit(1);
}

// ── Formatting helpers ───────────────────────────────────────────
const num = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : '—');
const md = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
};
const clip = (s, n = 100) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** Markdown link, with backtick-wrapped label. */
const link = (label, target) => `[\`${label}\`](${target})`;
/** Path relative to root, with forward slashes for Markdown. */
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
/**
 * Write Markdown with a UTF-8 BOM. Windows PowerShell 5.1 reads files as
 * ANSI when there is no BOM, which mangles every em-dash in the document.
 * JSON deliberately gets no BOM — it breaks strict parsers.
 */
const writeMd = (file, text) => fs.writeFile(file, `\uFEFF${text}`, 'utf8');

function fmtDate(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function daysAgo(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.now() - d.getTime()) / 86400000);
}

function formatBytes(n) {
  if (!n) return '0 B';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function readdirSafe(p) {
  try { return await fs.readdir(p, { withFileTypes: true }); } catch { return []; }
}

function table(cols, rows) {
  if (!rows.length) return '_none_\n';
  return [
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(md).join(' | ')} |`),
  ].join('\n') + '\n';
}

// ── Locate the canonical dump inside a profile folder ────────────
async function findJson(dir, user) {
  const candidates = [
    path.join(dir, `${user}.json`),
    path.join(dir, 'latest', `${user}.json`),   // archived layout: data lives in latest/
  ];
  for (const c of candidates) if (await exists(c)) return c;

  for (const sub of [dir, path.join(dir, 'latest')]) {
    const names = (await readdirSafe(sub))
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name)
      .filter((n) => n !== 'index.json' && n !== 'analytics.json');
    if (!names.length) continue;
    const match = names.find((n) => path.parse(n).name.toLowerCase() === String(user).toLowerCase());
    return path.join(sub, match || names[0]);
  }
  return null;
}

// ── Caption vocabulary ───────────────────────────────────────────
const STOPWORDS = new Set(
  ('a,an,and,are,as,at,be,but,by,for,if,in,into,is,it,no,not,of,on,or,such,that,the,their,' +
   'then,there,these,they,this,to,was,will,with,you,your,we,our,me,my,i,from,have,has,had,so,' +
   'do,does,did,what,when,who,how,why,can,could,should,would,about,up,out,just,like,over,' +
   'under,more,most,some,any,all,one,two,three,its,im,ive,ill,youre,youve,dont,cant,wont,lets,' +
   'get,got,new,see,seen,via,also,would,get').split(','),
);

function topWords(posts, n = 25) {
  const counts = {};
  for (const p of posts) {
    String(p.caption || '')
      .toLowerCase()
      .replace(/[^a-z0-9#@\s]/g, ' ')
      .split(/\s+/)
      .forEach((w) => {
        if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) return;
        counts[w] = (counts[w] || 0) + 1;
      });
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

// ── Plain-language insights ──────────────────────────────────────
function buildInsights(analytics, posts, profile, media = null) {
  const out = [];
  const eng = analytics.engagement || {};
  const posting = analytics.posting || {};
  const network = analytics.network || {};
  const content = analytics.content || {};
  const account = analytics.account || {};

  const rate = parseFloat(eng.engagementRate) || 0;
  if (rate > 5) out.push(`**High** engagement rate (${eng.engagementRate}) — audience actively interacts with content.`);
  else if (rate > 1.5) out.push(`**Moderate** engagement rate (${eng.engagementRate}) — typical of an active personal account.`);
  else if (rate > 0) out.push(`**Low** engagement rate (${eng.engagementRate}) — large but passive audience, or inflated follower count.`);

  const ratio = parseFloat(network.followerFollowingRatio);
  if (!isNaN(ratio)) {
    if (ratio > 10) out.push(`Follower ratio ${network.followerFollowingRatio}:1 — influencer / public-figure shape.`);
    else if (ratio >= 1) out.push(`Follower ratio ${network.followerFollowingRatio}:1 — balanced, organic growth.`);
    else out.push(`Follower ratio ${network.followerFollowingRatio}:1 — follows more than it has; new or growth-phase account.`);
  }

  if (posting.bestPostingHour) out.push(`Peak activity **${posting.bestPostingHour} on ${posting.bestPostingDay}s** — best outreach window.`);

  const lastDays = daysAgo(posting.latestPost);
  if (lastDays !== null) {
    if (lastDays <= 7) out.push(`**Active** — last post ${lastDays === 0 ? 'today' : `${lastDays} day${lastDays === 1 ? '' : 's'} ago`}.`);
    else if (lastDays <= 30) out.push(`Last post ${lastDays} days ago — active within the last month.`);
    else out.push(`Last post ${lastDays} days ago — account may be dormant.`);
  }

  const total = (content.photoPosts || 0) + (content.carouselPosts || 0) + (content.reelPosts || 0);
  if (total > 0) {
    const max = Math.max(content.photoPosts || 0, content.carouselPosts || 0, content.reelPosts || 0);
    const kind = max === (content.reelPosts || 0) ? 'reels'
      : max === (content.carouselPosts || 0) ? 'carousels' : 'single photos';
    out.push(`Content dominated by **${kind}** (${Math.round((max / total) * 100)}% of analyzed posts).`);
  }

  if (network.followerCount > 0 && network.verifiedFollowers > 0) {
    out.push(`${network.verifiedFollowers} verified followers (${((network.verifiedFollowers / network.followerCount) * 100).toFixed(1)}%) — notable public-account overlap.`);
  }

  if (account.estimatedAgeDays > 0) {
    out.push(`Estimated account age **${num(account.estimatedAgeDays)} days** (first post ${String(account.estimatedCreated || '').split('T')[0]}).`);
  }

  const bio = analytics.bio || {};
  if (bio.hasEmail || bio.hasPhone || bio.hasUrl) {
    const bits = [];
    if (bio.email) bits.push(`email \`${bio.email}\``);
    if (bio.phone) bits.push(`phone \`${bio.phone}\``);
    if (bio.url) bits.push(`link \`${bio.url}\``);
    out.push(`Bio exposes contact signal: ${bits.join(', ')}.`);
  }

  const topTag = (content.topHashtags || [])[0];
  if (topTag) out.push(`Most frequent hashtag: \`#${topTag.tag}\` (${topTag.count} uses).`);

  const topMention = (content.topMentions || [])[0];
  if (topMention) out.push(`Most frequent mention: \`@${topMention.user}\` (${topMention.count} uses) — likely a tight circle or cross-promotion.`);

  if (profile?.isPrivate) out.push('Account is **private** — data reflects only what the burner account is permitted to see.');

  if (media) {
    const { images, coverage } = media;
    if (!images?.count) {
      out.push('No post images archived yet — run `node dependencies/ig-images.mjs --profile <user>`, then re-import.');
    } else if (!posts.length) {
      out.push(`${num(images.count)} post image files archived.`);
    } else if (coverage === null) {
      out.push(`${num(images.count)} post image files archived, but none could be matched to a post timestamp.`);
    } else if (coverage >= posts.length) {
      out.push(`Media archive complete — all ${num(posts.length)} analyzed posts have images (${num(images.count)} files).`);
    } else {
      out.push(`Media archive ${Math.round((coverage / posts.length) * 100)}% complete — ${num(coverage)} of ${num(posts.length)} posts have images (${num(images.count)} files).`);
    }
  }

  if (!posts.length) out.push('No posts were captured, so engagement and content metrics are unavailable.');

  return out;
}

// ── Run history ──────────────────────────────────────────────────
async function readRunHistory(profileDir, user) {
  const runsDir = path.join(profileDir, 'runs');
  const entries = await readdirSafe(runsDir);
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const history = [];

  for (const name of names) {
    const jsonPath = await findJson(path.join(runsDir, name), user);
    let posts = 0;
    let scrapedAt = null;
    if (jsonPath) {
      try {
        const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        posts = (raw.posts || []).length;
        scrapedAt = raw.profile?.scrapedAt || null;
      } catch { /* unreadable run — still list it */ }
    }
    history.push({ name, posts, scrapedAt });
  }
  return history.reverse(); // newest first
}

// ── Post images (ig-images) ──────────────────────────────────────
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif']);

/**
 * Inventory of the post-image archive written by ig-images.mjs:
 *
 *   <user>-<YYYY-MM-DD>-<HHMMSS>-<NN>.<ext>
 *
 * The date/time is the post timestamp rendered in the local timezone —
 * the same value buildImageName() used — so a post and its image files
 * match on an exact key and we can report per-post media coverage.
 */
async function readImages(profileDir, handle) {
  const candidates = [
    path.join(profileDir, 'images'),             // data kept at the profile root
    path.join(profileDir, 'latest', 'images'),   // archived layout
  ];
  let dir = null;
  for (const d of candidates) {
    if (await exists(d)) { dir = d; break; }
  }

  const names = dir
    ? (await readdirSafe(dir)).filter((e) => e.isFile()).map((e) => e.name)
    : [];

  // Key set: "<YYYY-MM-DD>-<HHMMSS>" for every file we can attribute.
  const esc = String(handle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}-(\\d{4}-\\d{2}-\\d{2})-(\\d{6})-`);
  const keys = new Set();

  const byExt = {};
  let bytes = 0;
  let attributed = 0;
  for (const f of names) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.has(ext)) continue;
    byExt[ext] = (byExt[ext] || 0) + 1;
    bytes += (await fs.stat(path.join(dir, f)).catch(() => ({ size: 0 }))).size;
    const m = f.match(re);
    if (m) { keys.add(`${m[1]}-${m[2]}`); attributed++; }
  }

  const mediaCount = Object.values(byExt).reduce((a, b) => a + b, 0);
  return {
    dir: dir ? path.relative(profileDir, dir).split(path.sep).join('/') : null,
    count: mediaCount,
    byExt,
    bytes,
    keys,
    // Files whose name carries no post timestamp (e.g. `unknown-date`).
    // Note this is NOT count - keys.size: carousel slides share one key.
    unattributed: mediaCount - attributed,
    files: names.sort(),
  };
}

/** The key buildImageName() would produce for a post timestamp. */
function imageKeyFor(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ── Per-profile documents ────────────────────────────────────────
async function buildProfile(profileDir, user, root, source) {
  const stat = await fs.stat(profileDir).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error(`not a directory: ${profileDir}`);

  const jsonPath = await findJson(profileDir, user);
  if (!jsonPath) throw new Error(`no .json dump found in ${profileDir}`);

  const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const profile = raw.profile || {};
  const posts = raw.posts || [];
  const followers = raw.followers || [];
  const following = raw.following || [];
  const analytics = computeAnalytics({ profile, posts, followers, following });

  const history = await readRunHistory(profileDir, user);
  const currentRun = history[0]?.name || null;
  const eng = analytics.engagement || {};
  const posting = analytics.posting || {};
  const network = analytics.network || {};
  const content = analytics.content || {};
  const account = analytics.account || {};
  const bioSig = analytics.bio || {};

  const displayName = profile.name || profile.username || user;
  const handle = profile.username || user;
  const url = profile.url || `https://www.instagram.com/${handle}/`;

  // ── Post image archive (ig-images) ──
  const images = await readImages(profileDir, handle);
  const postsWithMedia = images.keys.size
    ? posts.filter((p) => images.keys.has(imageKeyFor(p.timestamp)))
    : [];
  const coverage = images.keys.size && posts.length ? postsWithMedia.length : null;
  const missingMedia = coverage === null || !posts.length
    ? []
    : posts.filter((p) => !images.keys.has(imageKeyFor(p.timestamp)));

  // ── analysis/analytics.json ──
  const analysisDir = path.join(profileDir, 'analysis');
  await fs.mkdir(analysisDir, { recursive: true });
  await fs.writeFile(
    path.join(analysisDir, 'analytics.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      run: currentRun,
      source: path.join(root, user, 'latest'),
      profile: {
        username: handle,
        name: profile.name ?? null,
        url,
        bio: profile.bio ?? null,
        isPrivate: profile.isPrivate ?? null,
        isVerified: profile.isVerified ?? null,
        externalUrl: profile.externalUrl ?? null,
        scrapedAt: profile.scrapedAt ?? null,
        followers: profile.followers ?? null,
        following: profile.following ?? null,
        posts: profile.posts ?? null,
      },
      counts: {
        postsAnalyzed: posts.length,
        comments: posts.reduce((n, p) => n + (p.comments?.length || 0), 0),
        followersListed: followers.length,
        followingListed: following.length,
        runs: history.length,
        images: images.count,
        postsWithMedia: coverage,
      },
      images: {
        dir: images.dir,
        count: images.count,
        byExt: images.byExt,
        bytes: images.bytes,
        postsCovered: coverage,
        postsTotal: posts.length || null,
        missing: missingMedia.length,
        unattributed: images.unattributed,
      },
      analytics,
      insights: buildInsights(analytics, posts, profile, { images, coverage }),
    }, null, 2),
    'utf8',
  );

  // ── analysis/report.md ──
  const likes = [...posts].sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const recent = [...posts]
    .filter((p) => p.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const report = [];
  report.push(`# ${displayName} (\`@${handle}\`) — OSINT Report\n`);
  report.push(`> **Generated:** ${fmtDate(new Date())}  `);
  report.push(`> **Archived run:** \`${currentRun || 'n/a'}\`  `);
  report.push(`> **Source:** \`${source}\` -> \`${rel(root, path.join(profileDir, 'latest'))}\`\n`);

  report.push('## 1 · Identity\n');
  report.push(table(
    ['Field', 'Value'],
    [
      ['Username', `[@${handle}](${url})`],
      ['Display name', displayName],
      ['Bio', clip(profile.bio || '', 400) || '—'],
      ['Verified', yesNo(profile.isVerified)],
      ['Private', yesNo(profile.isPrivate)],
      ['External URL', profile.externalUrl ? `[link](${profile.externalUrl})` : '—'],
      ['Captured', fmtDate(profile.scrapedAt)],
    ],
  ));

  report.push('## 2 · Snapshot\n');
  report.push(table(
    ['Metric', 'Value'],
    [
      ['Followers', num(profile.followers)],
      ['Following', num(profile.following)],
      ['Posts (profile counter)', num(profile.posts)],
      ['Posts analyzed', num(posts.length)],
      ['Comments captured', num(posts.reduce((n, p) => n + (p.comments?.length || 0), 0))],
      ['Engagement rate', eng.engagementRate ?? '—'],
      ['Avg likes / post', num(eng.avgLikes)],
      ['Avg comments / post', num(eng.avgComments)],
      ['Images archived', images.count ? `${num(images.count)} (${formatBytes(images.bytes)})` : 'none'],
      ['Posts with media', coverage === null ? (posts.length ? '—' : '—') : `${num(coverage)} / ${num(posts.length)}`],
      ['Archived runs', num(history.length)],
    ],
  ));

  report.push('## 3 · Key insights\n');
  const insights = buildInsights(analytics, posts, profile, { images, coverage });
  report.push(insights.length ? insights.map((i) => `- ${i}`).join('\n') + '\n' : '_none derived_\n');

  report.push('## 4 · Engagement\n');
  report.push(table(
    ['Metric', 'Value'],
    [
      ['Total likes (analyzed)', num(eng.totalLikes)],
      ['Total comments (analyzed)', num(eng.totalComments)],
      ['Engagement rate', eng.engagementRate ?? '—'],
      ['Posts analyzed', num(eng.postsAnalyzed)],
    ],
  ));

  report.push('## 5 · Posting pattern\n');
  report.push(table(
    ['Metric', 'Value'],
    [
      ['Earliest post', fmtDate(posting.earliestPost)],
      ['Latest post', fmtDate(posting.latestPost)],
      ['Days active', num(posting.daysActive)],
      ['Posts / day', posting.postsPerDay ?? '—'],
      ['Posts / week', posting.postsPerWeek ?? '—'],
      ['Peak hour', posting.bestPostingHour ?? '—'],
      ['Peak day', posting.bestPostingDay ?? '—'],
      ['Est. account age', account.estimatedAgeDays ? `${num(account.estimatedAgeDays)} days` : '—'],
    ],
  ));

  report.push('## 6 · Content mix\n');
  report.push(table(
    ['Type', 'Posts', 'Share'],
    [
      ['Reels', content.reelPosts ?? 0, posts.length ? `${Math.round(((content.reelPosts || 0) / posts.length) * 100)}%` : '—'],
      ['Carousels', content.carouselPosts ?? 0, posts.length ? `${Math.round(((content.carouselPosts || 0) / posts.length) * 100)}%` : '—'],
      ['Single photos', content.photoPosts ?? 0, posts.length ? `${Math.round(((content.photoPosts || 0) / posts.length) * 100)}%` : '—'],
    ],
  ));

  report.push('## 7 · Top posts by likes\n');
  report.push(table(
    ['Shortcode', 'Likes', 'Comments', 'Type', 'Posted', 'Caption'],
    likes.slice(0, 10).map((p) => [
      `[${p.shortcode}](${p.url})`,
      num(p.likes),
      num(p.commentCount),
      p.type,
      fmtDate(p.timestamp),
      clip(p.caption || '', 70),
    ]),
  ));

  if (recent.length) {
    report.push('## 8 · Most recent posts\n');
    report.push(table(
      ['Posted', 'Shortcode', 'Likes', 'Comments', 'Caption'],
      recent.slice(0, 10).map((p) => [
        fmtDate(p.timestamp),
        `[${p.shortcode}](${p.url})`,
        num(p.likes),
        num(p.commentCount),
        clip(p.caption || '', 70),
      ]),
    ));
  }

  report.push('## 9 · Hashtags & mentions\n');
  report.push('**Top hashtags**\n');
  report.push(table(
    ['Tag', 'Uses'],
    (content.topHashtags || []).slice(0, 15).map((h) => [`#${h.tag}`, h.count]),
  ));
  report.push('**Top mentions**\n');
  report.push(table(
    ['Account', 'Mentions'],
    (content.topMentions || []).slice(0, 15).map((m) => [`@${m.user}`, m.count]),
  ));

  report.push('## 10 · Network\n');
  report.push(table(
    ['Metric', 'Value'],
    [
      ['Followers listed', num(network.followerCount)],
      ['Following listed', num(network.followingCount)],
      ['Follower : following ratio', network.followerFollowingRatio ?? '—'],
      ['Verified followers', num(network.verifiedFollowers)],
      ['Verified following', num(network.verifiedFollowing)],
      ['Overlap (follows back)', overlapCount(followers, following)],
    ],
  ));

  report.push('## 11 · Bio signals\n');
  report.push(table(
    ['Signal', 'Value'],
    [
      ['Email', bioSig.email || '—'],
      ['Phone', bioSig.phone || '—'],
      ['URL', bioSig.url || '—'],
      ['Bio length', `${bioSig.length ?? 0} chars`],
    ],
  ));

  const words = topWords(posts);
  if (words.length) {
    report.push('## 12 · Caption vocabulary\n');
    report.push(table(['Word', 'Uses'], words.map((w) => [w.word, w.count])));
  }

  report.push('## 13 · Files in this profile\n');
  report.push(table(
    ['Path', 'Contents'],
    [
      ['`latest/`', 'the most recent import — always safe to read'],
      [link(`latest/${handle}.json`, `latest/${handle}.json`), 'full structured dump (profile, posts, comments, followers, following, analytics)'],
      [link(`latest/${handle}-posts.csv`, `latest/${handle}-posts.csv`), 'one row per post'],
      [link(`latest/${handle}-comments.csv`, `latest/${handle}-comments.csv`), 'one row per comment'],
      [link(`latest/${handle}-followers.csv`, `latest/${handle}-followers.csv`), 'follower list'],
      [link(`latest/${handle}-following.csv`, `latest/${handle}-following.csv`), 'following list'],
      [link(`latest/${handle}.db`, `latest/${handle}.db`), 'SQLite — join across everything (only if imported with `--sqlite`)'],
      ['`latest/screenshots/`', 'profile screenshots'],
      images.count
        ? [link('latest/images/', 'latest/images/'), `post images (ig-images) — ${num(images.count)} files, ${formatBytes(images.bytes)}`]
        : ['`latest/images/`', 'post images — _not archived yet_ (run `node dependencies/ig-images.mjs --profile <user>`)'],
      ['`runs/`', `dated snapshots — ${history.length} archived`],
      ['`analysis/`', 'this report + `analytics.json`'],
    ],
  ));

  report.push('## 14 · Run history\n');
  report.push(table(
    ['Run', 'Posts', 'Scraped at'],
    history.map((h, i) => [`${h.name}${i === 0 ? ' ← latest' : ''}`, h.posts ? num(h.posts) : '—', fmtDate(h.scrapedAt)]),
  ));

  report.push('## 15 · Media archive\n');
  if (!images.count) {
    report.push('No post images archived yet. Fetch them, then re-run this report:\n');
    report.push('```powershell');
    report.push(`node dependencies/ig-images.mjs --profile ${handle}`);
    report.push('```\n');
  } else {
    report.push('**Files by format**\n');
    report.push(table(
      ['Format', 'Files'],
      Object.entries(images.byExt).sort((a, b) => b[1] - a[1]).map(([ext, n]) => [ext, num(n)]),
    ));
    report.push(`**Coverage:** ${coverage === null
      ? 'could not be matched against post timestamps'
      : `${num(coverage)} of ${num(posts.length)} analyzed posts have at least one image`} — ${num(images.count)} files, ${formatBytes(images.bytes)}.\n`);

    if (coverage !== null && !missingMedia.length) {
      report.push('Every analyzed post has at least one archived image.\n');
    } else if (missingMedia.length) {
      const shown = missingMedia.slice(0, 20);
      report.push(`**${missingMedia.length} post(s) with no archived image:**\n`);
      report.push(table(
        ['Posted', 'Shortcode', 'Caption'],
        shown.map((p) => [fmtDate(p.timestamp), `[${p.shortcode}](${p.url})`, clip(p.caption || '', 60)]),
      ));
      if (missingMedia.length > shown.length) {
        report.push(`_…and ${missingMedia.length - shown.length} more._\n`);
      }
      report.push('Fill the gaps by re-running `node dependencies/ig-images.mjs --profile <user>` — files already on disk are skipped.\n');
    }

    if (images.unattributed > 0) {
      report.push(`_${images.unattributed} file(s) carry no post timestamp in their name (for example \`unknown-date\` naming)._ \n`);
    }
  }

  report.push('\n---\n');
  report.push(`Generated by \`report.mjs\` from \`${rel(root, jsonPath) || jsonPath}\`.`);

  await writeMd(path.join(analysisDir, 'report.md'), report.join('\n'));

  // ── README.md (short card) ──
  const readme = [];
  readme.push(`# ${displayName} — \`@${handle}\`\n`);
  readme.push(`![verified](${profile.isVerified ? 'https://img.shields.io/badge/verified-yes-blue' : 'https://img.shields.io/badge/verified-no-lightgrey'})` +
    ` ![private](${profile.isPrivate ? 'https://img.shields.io/badge/visibility-private-red' : 'https://img.shields.io/badge/visibility-public-brightgreen'})` +
    ` ![runs](${`https://img.shields.io/badge/runs-${history.length}-informational`})\n`);
  readme.push(`> [${url}](${url}) · last captured **${fmtDate(profile.scrapedAt)}** · archived run \`${currentRun || 'n/a'}\`\n`);

  readme.push('| Followers | Following | Posts | Analyzed | Engagement | Images | Last post |');
  readme.push('| ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  readme.push(`| ${num(profile.followers)} | ${num(profile.following)} | ${num(profile.posts)} | ${num(posts.length)} | ${eng.engagementRate ?? '—'} | ${images.count ? num(images.count) : '—'} | ${fmtDate(posting.latestPost)} |`);
  readme.push('');

  if (profile.bio) readme.push(`**Bio:** ${clip(profile.bio, 300)}\n`);

  const quick = buildInsights(analytics, posts, profile, { images, coverage }).slice(0, 5);
  if (quick.length) {
    readme.push('**Quick read**\n');
    readme.push(quick.map((i) => `- ${i}`).join('\n'));
    readme.push('');
  }

  readme.push('## Find it\n');
  readme.push('| What | Where |');
  readme.push('| --- | --- |');
  readme.push(`| Full report | [analysis/report.md](analysis/report.md) |`);
  readme.push(`| Metrics (JSON) | [analysis/analytics.json](analysis/analytics.json) |`);
  readme.push(`| Structured dump | ${link(`latest/${handle}.json`, `latest/${handle}.json`)} |`);
  readme.push(`| Posts table | ${link(`latest/${handle}-posts.csv`, `latest/${handle}-posts.csv`)} |`);
  readme.push(`| Comments | ${link(`latest/${handle}-comments.csv`, `latest/${handle}-comments.csv`)} |`);
  if (followers.length) readme.push(`| Followers | ${link(`latest/${handle}-followers.csv`, `latest/${handle}-followers.csv`)} |`);
  if (following.length) readme.push(`| Following | ${link(`latest/${handle}-following.csv`, `latest/${handle}-following.csv`)} |`);
  if (await exists(path.join(profileDir, 'latest', `${handle}.db`))) {
    readme.push(`| SQLite | ${link(`latest/${handle}.db`, `latest/${handle}.db`)} |`);
  }
  if (images.count) {
    readme.push(`| Post images | ${link('latest/images/', 'latest/images/')} (${num(images.count)} files) |`);
  }
  readme.push('| Screenshots | [latest/screenshots/](latest/screenshots/) |');
  readme.push('| History | [runs/](runs/) |');
  readme.push('');

  if (coverage !== null && coverage < posts.length) {
    readme.push(`> **Media gap:** ${num(coverage)} of ${num(posts.length)} analyzed posts have an archived image. ` +
      'Fill with `node dependencies/ig-images.mjs --profile ' + handle + '` then re-import.\n');
  }

  if (history.length) {
    readme.push('## Runs\n');
    readme.push(table(['Run', 'Posts', 'Scraped at'], history.slice(0, 12).map((h, i) =>
      [`${h.name}${i === 0 ? ' ← latest' : ''}`, h.posts ? num(h.posts) : '—', fmtDate(h.scrapedAt)])));
  }

  await writeMd(path.join(profileDir, 'README.md'), readme.join('\n'));

  return { handle, displayName, profile, posts, followers, following, analytics, history, run: currentRun };
}

function overlapCount(followers, following) {
  if (!followers.length || !following.length) return '—';
  const set = new Set(followers.map((f) => String(f.username || '').toLowerCase()));
  const both = following.filter((f) => set.has(String(f.username || '').toLowerCase())).length;
  return `${both} (${Math.round((both / following.length) * 100)}%)`;
}

// ── Master index ─────────────────────────────────────────────────
async function rebuildIndex(root) {
  const entries = await readdirSafe(root);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b));

  const records = [];
  for (const name of dirs) {
    const dir = path.join(root, name);
    const jsonPath = await findJson(dir, name);
    if (!jsonPath) continue; // not a profile folder
    let raw;
    try { raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')); } catch { continue; }

    const profile = raw.profile || {};
    const posts = raw.posts || [];
    const followers = raw.followers || [];
    const following = raw.following || [];
    // Recompute rather than trusting the embedded copy — it is absent from
    // some runs, and recompute costs nothing here.
    const analytics = computeAnalytics({ profile, posts, followers, following });
    const history = (await readdirSafe(path.join(dir, 'runs')))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    records.push({
      username: profile.username || name,
      name: profile.name || null,
      url: profile.url || null,
      isVerified: profile.isVerified ?? null,
      isPrivate: profile.isPrivate ?? null,
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      postsOnProfile: profile.posts ?? null,
      postsAnalyzed: posts.length,
      engagementRate: analytics.engagement?.engagementRate ?? null,
      lastPost: analytics.posting?.latestPost ?? null,
      scrapedAt: profile.scrapedAt ?? null,
      runs: history.length,
      latestRun: history[history.length - 1] || null,
      images: (await readImages(dir, profile.username || name)).count,
      folder: name,
      report: `${name}/analysis/report.md`,
    });
  }

  await fs.writeFile(
    path.join(root, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, profiles: records }, null, 2),
    'utf8',
  );

  const lines = [];
  lines.push('# IG-DATA — Index\n');
  lines.push(`> ${records.length} profile${records.length === 1 ? '' : 's'} · regenerated ${fmtDate(new Date())}`);
  lines.push('>');
  lines.push('> Rebuild with: `node ig-scrape/dependencies/report.mjs --root IG-DATA`\n');

  if (records.length) {
    lines.push(table(
      ['Profile', 'Name', 'Followers', 'Following', 'Posts', 'Engagement', 'Images', 'Last post', 'Runs', 'Report'],
      records.map((r) => [
        `[@${r.username}](${r.username}/)`,
        r.name || '—',
        num(r.followers),
        num(r.following),
        num(r.postsOnProfile),
        r.engagementRate ?? '—',
        r.images ? num(r.images) : '—',
        fmtDate(r.lastPost || r.scrapedAt),
        r.runs,
        `[report](${r.report})`,
      ]),
    ));
  } else {
    lines.push('_No profiles imported yet. Run `dependencies/import-data.ps1 --source out/<username>`._\n');
  }

  lines.push('## Folders\n');
  lines.push(records.length
    ? records.map((r) => `- \`${r.folder}/\` — [card](${r.folder}/README.md) · [report](${r.report})`).join('\n')
    : '- _none_');
  lines.push('');

  await writeMd(path.join(root, 'INDEX.md'), lines.join('\n'));
}

// ── Main ─────────────────────────────────────────────────────────
try {
  if (dirArg) {
    const profileDir = path.resolve(dirArg);
    const user = val('user') || path.basename(profileDir);
    const root = path.resolve(rootArg || path.dirname(profileDir));
    const source = sourceArg || `out/${user}/`;
    const result = await buildProfile(profileDir, user, root, source);
    console.log(`[report] ${result.handle}: analysis/report.md, analysis/analytics.json, README.md`);
    console.log(`[report] @${result.handle}: ${num(result.profile.followers)} followers, ${num(result.posts.length)} posts analyzed, ${result.history.length} run(s)`);
  }
  const rootForIndex = path.resolve(rootArg || (dirArg ? path.dirname(path.resolve(dirArg)) : '.'));
  await rebuildIndex(rootForIndex);
  console.log(`[report] INDEX.md + index.json -> ${rootForIndex}`);
} catch (e) {
  console.error(`[report] failed: ${e.message}`);
  process.exit(1);
}
