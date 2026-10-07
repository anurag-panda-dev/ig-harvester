#!/usr/bin/env node
/**
 * ig-analyzer — Instagram OSINT Dashboard
 * ========================================
 * Reads scraped data from out/<username>/ and starts a live web server
 * with a high-level analyzed dashboard for OSINT reporting.
 *
 * Usage:
 *   node ig-analyzer.mjs                          # auto-detect latest
 *   node ig-analyzer.mjs --user someuser          # specific user
 *   node ig-analyzer.mjs --port 8080              # custom port
 *   node ig-analyzer.mjs --dir out/someuser       # custom data dir
 *
 * Author  : Anurag Panda
 * GitHub  : https://github.com/anurag-panda-dev/ig-harvester
 * License : MIT
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { computeAnalytics } from './src/scraper/analytics.mjs';

// ── Args ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

const PORT = Number(val('port', 8080));
const USER = val('user');
const DATA_DIR = val('dir');

// ── Find data ─────────────────────────────────────────────
async function findDataDir() {
  if (DATA_DIR) return path.resolve(DATA_DIR);

  const outDir = path.resolve('out');
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  if (USER) {
    const target = path.join(outDir, USER);
    try { await fs.access(target); return target; } catch {
      console.error(`No data for user: ${USER}`);
      console.error(`Available: ${dirs.join(', ') || '(none)'}`);
      process.exit(1);
    }
  }

  // Auto-detect: most recently modified
  let latest = null, latestTime = 0;
  for (const d of dirs) {
    const stat = await fs.stat(path.join(outDir, d));
    if (stat.mtimeMs > latestTime) { latestTime = stat.mtimeMs; latest = d; }
  }

  if (!latest) {
    console.error('No scraped data found in out/');
    console.error('Run ig-harvester first.');
    process.exit(1);
  }

  return path.join(outDir, latest);
}

// ── Load data ──────────────────────────────────────────────
async function loadData(dataDir) {
  const jsonPath = path.join(dataDir, `${path.basename(dataDir)}.json`);
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}

// ── OSINT insight generation ──────────────────────────────
function buildInsights(analytics, posts, profile) {
  const out = [];
  const eng = analytics.engagement || {};
  const posting = analytics.posting || {};
  const network = analytics.network || {};
  const content = analytics.content || {};
  const account = analytics.account || {};

  const rate = parseFloat(eng.engagementRate) || 0;
  if (rate > 5) out.push({ level: 'high', text: `High engagement rate (${eng.engagementRate}) — audience is actively interacting with content.` });
  else if (rate > 1.5) out.push({ level: 'medium', text: `Moderate engagement rate (${eng.engagementRate}) — typical for an active personal account.` });
  else if (rate > 0) out.push({ level: 'low', text: `Low engagement rate (${eng.engagementRate}) — may indicate a large but passive audience.` });

  const ratio = parseFloat(network.followerFollowingRatio);
  if (!isNaN(ratio)) {
    if (ratio > 10) out.push({ level: 'high', text: `Follower ratio ${network.followerFollowingRatio}:1 — influencer or public-figure profile shape.` });
    else if (ratio >= 1) out.push({ level: 'medium', text: `Follower ratio ${network.followerFollowingRatio}:1 — balanced, organic growth pattern.` });
    else out.push({ level: 'low', text: `Follower ratio ${network.followerFollowingRatio}:1 — follows more than followers; new or growth-phase account.` });
  }

  if (posting.bestPostingHour) out.push({ level: 'info', text: `Peak activity at ${posting.bestPostingHour} on ${posting.bestPostingDay}s — best window for outreach.` });

  if (posting.latestPost) {
    const days = Math.round((Date.now() - new Date(posting.latestPost).getTime()) / 86400000);
    if (days <= 7) out.push({ level: 'high', text: `Active account — last post ${days === 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's')} ago.` });
    else if (days <= 30) out.push({ level: 'medium', text: `Last post ${days} days ago — active within the last month.` });
    else out.push({ level: 'low', text: `Last post ${days} days ago — account may be dormant.` });
  }

  const total = (content.photoPosts || 0) + (content.carouselPosts || 0) + (content.reelPosts || 0);
  if (total > 0) {
    const max = Math.max(content.photoPosts || 0, content.carouselPosts || 0, content.reelPosts || 0);
    const kind = max === (content.reelPosts || 0) ? 'reels' : max === (content.carouselPosts || 0) ? 'carousels' : 'single photos';
    out.push({ level: 'info', text: `Content dominated by ${kind} (${Math.round(max / total * 100)}% of analyzed posts).` });
  }

  if (network.followerCount > 0 && network.verifiedFollowers > 0) {
    out.push({ level: 'medium', text: `${network.verifiedFollowers} verified followers (${(network.verifiedFollowers / network.followerCount * 100).toFixed(1)}%) — notable public-account overlap.` });
  }

  if (account.estimatedAgeDays > 0) {
    out.push({ level: 'info', text: `Estimated account age: ${account.estimatedAgeDays} days (first post ${account.estimatedCreated?.split('T')[0]}).` });
  }

  const topTag = (analytics.content?.topHashtags || [])[0];
  if (topTag) out.push({ level: 'info', text: `Most frequent hashtag: #${topTag.tag} (${topTag.count} uses).` });

  return out;
}

// ── Caption word cloud ────────────────────────────────────
const STOPWORDS = new Set(('a,an,and,are,as,at,be,but,by,for,if,in,into,is,it,no,not,of,on,or,such,that,the,their,then,there,these,they,this,to,was,will,with,you,your,we,our,me,my,i,from,have,has,had,so,do,does,did,what,when,who,how,why,can,could,should,would,about,up,out,just,like,over,under,more,most,some,any,all,one,two,three,its,im,ive,ill,youre,youve,dont,cant,wont,its,lets,get,got,new,see,seen,via').split(','));
function buildWordCloud(posts) {
  const counts = {};
  posts.forEach(p => {
    const cap = p.caption || '';
    cap.toLowerCase().replace(/[^a-z0-9#@\s]/g, ' ').split(/\s+/).forEach(w => {
      if (w.length < 3 || STOPWORDS.has(w)) return;
      if (/^\d+$/.test(w)) return;
      counts[w] = (counts[w] || 0) + 1;
    });
  });
  const entries = Object.entries(counts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 40);
  if (!entries.length) return [];
  const max = entries[0][1];
  return entries.map(([word, count]) => ({ word, count, size: 11 + (count / max) * 20, opacity: 0.45 + (count / max) * 0.55 }));
}

// ── HTML Dashboard ─────────────────────────────────────────
function renderDashboard(data, analytics) {
  const { profile, posts, followers, following } = data;
  const username = profile?.username || 'unknown';

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (n) => n?.toLocaleString?.() ?? n ?? '—';
  // Safe JSON for embedding in <script>: escapes "<" so "</script>" can't appear
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

  // Chart data
  const postsByHour = {};
  const postsByDay = {};
  const chronological = [];
  posts.forEach(p => {
    if (p.timestamp) {
      const d = new Date(p.timestamp);
      if (!isNaN(d)) chronological.push({ ...p, _d: d });
    }
  });
  chronological.sort((a, b) => a._d - b._d);
  posts.forEach(p => {
    if (p.timestamp) {
      const d = new Date(p.timestamp);
      if (isNaN(d)) return;
      const h = d.getHours();
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      postsByHour[h] = (postsByHour[h] || 0) + 1;
      postsByDay[day] = (postsByDay[day] || 0) + 1;
    }
  });

  const topHashtags = analytics?.content?.topHashtags || [];
  const topMentions = analytics?.content?.topMentions || [];
  const mostLiked = analytics?.content?.mostLiked || [];
  const mostCommented = analytics?.content?.mostCommented || [];
  const engagement = analytics?.engagement || {};
  const posting = analytics?.posting || {};
  const network = analytics?.network || {};
  const bio = analytics?.bio || {};
  const account = analytics?.account || {};
  const content = analytics?.content || {};

  const likesData = chronological.slice(-30).map(p => p.likes || 0);
  const commentsData = chronological.slice(-30).map(p => p.commentCount || 0);
  const trendLabels = chronological.slice(-30).map(p => p.shortcode);

  // Engagement gauge percentage
  const engRate = parseFloat(engagement.engagementRate) || 0;
  const engPct = Math.min(100, engRate * 10);

  // Hashtag cloud sizing
  const maxTagCount = topHashtags.length ? topHashtags[0].count : 1;
  const tagCloud = topHashtags.slice(0, 30).map(h => ({
    ...h,
    size: 11 + (h.count / maxTagCount) * 18,
    opacity: 0.5 + (h.count / maxTagCount) * 0.5,
  }));

  // Caption word cloud
  const wordCloud = buildWordCloud(posts);

  // Timeline data (posts by month)
  const postsByMonth = {};
  chronological.forEach(p => {
    const m = p._d.toISOString().slice(0, 7);
    postsByMonth[m] = (postsByMonth[m] || 0) + 1;
  });
  const timeline = Object.entries(postsByMonth).sort((a, b) => a[0].localeCompare(b[0]));

  // Content mix
  const mixPhotos = content.photoPosts || 0;
  const mixCarousels = content.carouselPosts || 0;
  const mixReels = content.reelPosts || 0;

  // Insights
  const insights = buildInsights(analytics, posts, profile);
  const levelColor = { high: 'var(--success)', medium: 'var(--warn)', low: 'var(--danger)', info: 'var(--alpha)' };

  // Top followers / following (verified first, then alphabetical)
  const topFollowers = [...followers].sort((a, b) => (b.verified - a.verified) || a.username.localeCompare(b.username)).slice(0, 12);
  const topFollowing = [...following].sort((a, b) => (b.verified - a.verified) || a.username.localeCompare(b.username)).slice(0, 12);

  // Days since last post
  const lastPostDays = posting.latestPost
    ? Math.round((Date.now() - new Date(posting.latestPost).getTime()) / 86400000)
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ig-analyzer — @${esc(username)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --base-950: #0B0D10; --base-900: #10141A;
      --card-800: #13171D; --card-700: #1C222B;
      --line-600: #29323F; --line-500: #354052;
      --ink-100: #E8EDF3; --ink-300: #B7C0CC; --ink-500: #7D8794;
      --alpha: #0284C7; --beta: #D97706; --gamma: #8B5CF6; --delta: #059669;
      --success: #10B981; --warn: #F59E0B; --danger: #EF4444;
      --accent: var(--alpha); --accent-rgb: 2 132 199;
      --ease: cubic-bezier(.22,1,.36,1);
      --spring: cubic-bezier(.34,1.56,.64,1);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; scroll-padding-top: 84px; }
    body {
      background: var(--base-950);
      color: var(--ink-100);
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      min-height: 100vh;
      overflow-x: hidden;
    }
    ::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

    /* ── Atmosphere ─────────────────────────────────────── */
    .orb {
      position: fixed; border-radius: 50%;
      pointer-events: none; z-index: 0;
      background: radial-gradient(circle, var(--orb-color) 0%, transparent 70%);
      opacity: var(--orb-opacity, .25);
      animation: drift var(--drift-duration, 28s) ease-in-out var(--drift-delay, 0s) infinite alternate;
    }
    @keyframes drift {
      from { transform: translate3d(0, 0, 0); }
      to   { transform: translate3d(var(--drift-x, 6vw), var(--drift-y, -8vh), 0); }
    }
    .grid-veil {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(to right, color-mix(in srgb, var(--ink-100) 5%, transparent) 1px, transparent 1px),
        linear-gradient(to bottom, color-mix(in srgb, var(--ink-100) 5%, transparent) 1px, transparent 1px);
      background-size: 56px 56px;
      mask-image: radial-gradient(ellipse 90% 70% at 50% 35%, #000 25%, transparent 78%);
      -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 35%, #000 25%, transparent 78%);
    }

    /* ── Header ─────────────────────────────────────────── */
    .header {
      position: sticky; top: 0; z-index: 50;
      background: color-mix(in srgb, var(--base-950) 78%, transparent);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--line-600);
      padding: 0 32px;
    }
    .header-inner {
      max-width: 1400px; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      height: 64px;
    }
    .brand { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .brand-mark {
      width: 34px; height: 34px; border-radius: 9px;
      background: linear-gradient(135deg, var(--alpha), var(--gamma));
      display: flex; align-items: center; justify-content: center;
      font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 17px; color: #fff;
    }
    .brand-name { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
    .brand-name span { color: var(--ink-500); font-weight: 500; }
    .nav-pills { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; flex: 1; justify-content: center; }
    .nav-pills::-webkit-scrollbar { display: none; }
    .nav-pill {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase;
      color: var(--ink-500); text-decoration: none;
      padding: 6px 12px; border-radius: 9999px;
      border: 1px solid transparent;
      transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
      white-space: nowrap;
    }
    .nav-pill:hover { color: var(--ink-100); border-color: var(--line-600); }
    .nav-pill.active {
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    }
    .header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .live-badge {
      display: flex; align-items: center; gap: 7px;
      background: color-mix(in srgb, var(--success) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
      color: var(--success);
      padding: 5px 13px; border-radius: 9999px;
      font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    }
    .live-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
    .live-dot::before, .live-dot::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%;
      background: var(--success);
      animation: pulse-ring 1.8s cubic-bezier(.22,1,.36,1) infinite;
    }
    .live-dot::after { animation-delay: .9s; }
    @keyframes pulse-ring {
      0% { transform: scale(.85); opacity: .6; }
      70% { transform: scale(2.6); opacity: 0; }
      100% { transform: scale(2.6); opacity: 0; }
    }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase;
      color: var(--ink-100);
      background: var(--card-700);
      border: 1px solid var(--line-600);
      padding: 7px 14px; border-radius: 8px;
      cursor: pointer; text-decoration: none;
      transition: border-color 160ms ease, transform 160ms var(--spring), background 160ms ease;
    }
    .btn:hover { border-color: var(--accent); transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn svg { width: 13px; height: 13px; }

    /* ── Hero ───────────────────────────────────────────── */
    .hero {
      position: relative; z-index: 1;
      max-width: 1400px; margin: 0 auto;
      padding: 72px 32px 48px;
    }
    .hero-stack > * { animation: hero-rise 700ms var(--ease) both; }
    .hero-stack > *:nth-child(1) { animation-delay: 0ms; }
    .hero-stack > *:nth-child(2) { animation-delay: 90ms; }
    .hero-stack > *:nth-child(3) { animation-delay: 180ms; }
    .hero-stack > *:nth-child(4) { animation-delay: 300ms; }
    .hero-stack > *:nth-child(5) { animation-delay: 420ms; }
    @keyframes hero-rise {
      from { opacity: 0; transform: translate3d(0, 30px, 0) scale(.985); }
      to   { opacity: 1; transform: none; }
    }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
      color: var(--ink-500); font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.4s ease-in-out infinite; }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
    .hero h1 {
      font-family: 'Outfit', sans-serif; font-weight: 800;
      font-size: clamp(34px, 5vw, 56px); line-height: 1.05;
      letter-spacing: -0.03em; margin: 14px 0 10px;
    }
    .text-shine {
      background: linear-gradient(100deg, var(--alpha) 0%, var(--beta) 28%, var(--gamma) 55%, var(--delta) 82%, var(--alpha) 100%);
      background-size: 200% auto;
      background-clip: text; -webkit-background-clip: text;
      color: transparent;
      animation: shine 9s linear infinite;
    }
    @keyframes shine { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
    .hero-sub { color: var(--ink-300); font-size: 16px; max-width: 640px; }
    .hero-meta {
      display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px;
    }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 7px;
      background: var(--card-800); border: 1px solid var(--line-600);
      border-radius: 8px; padding: 7px 13px;
      font-size: 13px; color: var(--ink-300);
      font-family: 'JetBrains Mono', monospace;
      transition: border-color 160ms ease;
    }
    .meta-chip:hover { border-color: var(--line-500); }
    .meta-chip .k { color: var(--ink-500); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
    .meta-chip .v { color: var(--ink-100); font-weight: 600; }

    /* ── Section rule ───────────────────────────────────── */
    .section-rule {
      height: 1px; max-width: 1400px; margin: 0 auto;
      background: linear-gradient(90deg,
        color-mix(in srgb, var(--accent) 55%, transparent),
        var(--line-600) 45%, transparent 88%);
    }

    /* ── Content ────────────────────────────────────────── */
    .content { position: relative; z-index: 1; max-width: 1400px; margin: 0 auto; padding: 32px; }
    .section { margin-bottom: 44px; scroll-margin-top: 84px; }
    .section-title {
      display: flex; align-items: center; gap: 12px;
      font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 19px;
      letter-spacing: -0.01em; margin-bottom: 18px;
    }
    .section-title::before {
      content: ''; width: 3px; height: 20px; border-radius: 2px;
      background: var(--accent);
    }

    /* ── Cards ──────────────────────────────────────────── */
    .card {
      position: relative;
      background: var(--card-800);
      border: 1px solid var(--line-600);
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,.4);
      padding: 22px;
      overflow: hidden;
      transition: transform 240ms var(--ease), border-color 160ms ease, box-shadow 240ms ease;
    }
    .card::before {
      content: ''; position: absolute; inset: 0 0 auto; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.09), 50%, transparent);
    }
    .card-lift:hover, .card-lift:focus-visible {
      transform: translateY(-3px); border-color: var(--line-500);
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
    }
    .card[data-accent='alpha'] { --pillar: var(--alpha); --pillar-rgb: 2 132 199; }
    .card[data-accent='beta']  { --pillar: var(--beta);  --pillar-rgb: 217 119 6; }
    .card[data-accent='gamma'] { --pillar: var(--gamma); --pillar-rgb: 139 92 246; }
    .card[data-accent='delta'] { --pillar: var(--delta); --pillar-rgb: 5 150 105; }
    .card-bloom {
      position: absolute; inset: 0; pointer-events: none;
      opacity: 0; transition: opacity 500ms ease;
      background: radial-gradient(circle at 30% 0%, color-mix(in srgb, var(--pillar, var(--accent)) 10%, transparent) 0%, transparent 68%);
    }
    .card-lift:hover .card-bloom, .card-lift:focus-visible .card-bloom { opacity: 1; }

    .card-eyebrow {
      font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
      color: var(--ink-500); font-weight: 600; margin-bottom: 10px;
      font-family: 'JetBrains Mono', monospace;
    }
    .card-value {
      font-family: 'Outfit', sans-serif; font-weight: 700;
      font-size: 32px; letter-spacing: -0.02em; color: var(--ink-100);
      line-height: 1.1;
    }
    .card-sub { font-size: 12px; color: var(--ink-500); margin-top: 5px; }

    /* ── Grids ──────────────────────────────────────────── */
    .grid { display: grid; gap: 16px; }
    .grid-4 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .grid-3 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
    .grid-full { grid-column: 1 / -1; }

    /* ── Profile panel ──────────────────────────────────── */
    .profile-panel {
      display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap;
    }
    .avatar-ring {
      position: relative; width: 88px; height: 88px; flex-shrink: 0;
    }
    .avatar-ring::before {
      content: ''; position: absolute; inset: -3px; border-radius: 50%;
      background: conic-gradient(var(--alpha), var(--beta), var(--gamma), var(--delta), var(--alpha));
      animation: spin 6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .avatar {
      position: relative; width: 88px; height: 88px; border-radius: 50%;
      background: var(--card-700); border: 3px solid var(--base-950);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 30px;
      color: var(--accent);
    }
    .profile-info { flex: 1; min-width: 260px; }
    .profile-name { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 24px; letter-spacing: -0.02em; }
    .profile-username { color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 14px; margin-top: 2px; }
    .profile-bio { color: var(--ink-300); font-size: 14px; margin-top: 10px; max-width: 680px; line-height: 1.55; }
    .profile-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--card-700); border: 1px solid var(--line-600);
      border-radius: 7px; padding: 5px 11px; font-size: 12px;
      color: var(--ink-300);
      transition: border-color 160ms ease, transform 160ms var(--spring);
    }
    .badge:hover { border-color: var(--line-500); transform: translateY(-1px); }
    .badge .k { color: var(--ink-500); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
    .badge .v { color: var(--ink-100); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
    .badge.on { border-color: color-mix(in srgb, var(--success) 40%, transparent); }
    .badge.on .v { color: var(--success); }

    /* ── Gauge ──────────────────────────────────────────── */
    .gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .gauge { position: relative; width: 120px; height: 120px; }
    .gauge svg { transform: rotate(-90deg); }
    .gauge-bg { fill: none; stroke: var(--card-700); stroke-width: 10; }
    .gauge-fill {
      fill: none; stroke: url(#gaugeGrad); stroke-width: 10; stroke-linecap: round;
      stroke-dasharray: 339.29; stroke-dashoffset: 339.29;
      transition: stroke-dashoffset 1400ms var(--ease);
    }
    .gauge-center {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    .gauge-val { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 26px; color: var(--ink-100); }
    .gauge-lbl { font-size: 10px; color: var(--ink-500); text-transform: uppercase; letter-spacing: .08em; }

    /* ── Insights ───────────────────────────────────────── */
    .insight-list { display: flex; flex-direction: column; gap: 10px; }
    .insight {
      display: flex; gap: 12px; align-items: flex-start;
      background: var(--card-700);
      border: 1px solid var(--line-600);
      border-radius: 10px; padding: 12px 14px;
      animation: insight-in 500ms var(--ease) both;
    }
    .insight:nth-child(2) { animation-delay: 80ms; }
    .insight:nth-child(3) { animation-delay: 160ms; }
    .insight:nth-child(4) { animation-delay: 240ms; }
    .insight:nth-child(5) { animation-delay: 320ms; }
    .insight:nth-child(n+6) { animation-delay: 400ms; }
    @keyframes insight-in {
      from { opacity: 0; transform: translate3d(-10px, 0, 0); }
      to   { opacity: 1; transform: none; }
    }
    .insight-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 7px;
      background: var(--dot, var(--alpha));
      box-shadow: 0 0 10px var(--dot, var(--alpha));
    }
    .insight-text { font-size: 13px; color: var(--ink-300); line-height: 1.5; }

    /* ── Tag cloud ──────────────────────────────────────── */
    .tag-cloud { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; line-height: 1.4; }
    .tag {
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
      color: var(--accent); cursor: default;
      transition: transform 160ms var(--spring), color 160ms ease;
    }
    .tag:hover { transform: translateY(-2px) scale(1.06); color: var(--ink-100); }
    .tag.mention { color: var(--gamma); }
    .tag.mention:hover { color: var(--ink-100); }
    .tag.word { color: var(--delta); }
    .tag.word:hover { color: var(--ink-100); }

    /* ── Tables ─────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 9px 10px; color: var(--ink-500); border-bottom: 1px solid var(--line-600); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; font-family: 'JetBrains Mono', monospace; }
    td { padding: 9px 10px; border-bottom: 1px solid var(--card-700); color: var(--ink-300); }
    tr:hover td { background: var(--card-700); }
    td a { color: var(--accent); text-decoration: none; font-family: 'JetBrains Mono', monospace; font-weight: 500; }
    td a:hover { text-decoration: underline; }
    .num { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--ink-100); }
    .verified-mark { color: var(--alpha); font-weight: 700; }
    .mini-avatar {
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--card-700); border: 1px solid var(--line-600);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; color: var(--accent);
      font-family: 'Outfit', sans-serif;
      vertical-align: middle; margin-right: 7px;
    }

    /* ── Progress bar ───────────────────────────────────── */
    .bar { height: 7px; background: var(--card-700); border-radius: 999px; overflow: hidden; }
    .bar-fill {
      height: 100%; border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--gamma)));
      width: 0; transition: width 1200ms var(--ease);
    }

    /* ── Mix bars ───────────────────────────────────────── */
    .mix-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .mix-label { width: 82px; font-size: 12px; color: var(--ink-500); font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .05em; }
    .mix-bar { flex: 1; height: 10px; background: var(--card-700); border-radius: 999px; overflow: hidden; }
    .mix-fill { height: 100%; border-radius: 999px; width: 0; transition: width 1200ms var(--ease); }
    .mix-count { width: 44px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--ink-100); }

    /* ── Timeline ───────────────────────────────────────── */
    .timeline { position: relative; padding-left: 26px; }
    .timeline::before {
      content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px;
      width: 2px; border-radius: 2px;
      background: linear-gradient(to bottom, var(--alpha), var(--gamma), var(--delta));
    }
    .tl-item { position: relative; padding: 10px 0; }
    .tl-item::before {
      content: ''; position: absolute; left: -24px; top: 16px;
      width: 12px; height: 12px; border-radius: 50%;
      background: var(--base-950); border: 3px solid var(--accent);
    }
    .tl-date { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-500); text-transform: uppercase; letter-spacing: .06em; }
    .tl-count { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 17px; color: var(--ink-100); }
    .grow-x { transform-origin: left; animation: grow-x 700ms var(--ease) both; }
    @keyframes grow-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }

    /* ── Charts ─────────────────────────────────────────── */
    .chart-box { position: relative; height: 260px; }
    .chart-box.tall { height: 300px; }

    /* ── Reveal ─────────────────────────────────────────── */
    .reveal { opacity: 0; transform: translate3d(var(--reveal-x, 0px), var(--reveal-y, 22px), 0); }
    .reveal.is-revealed {
      opacity: 1; transform: none;
      transition: opacity var(--reveal-duration, 680ms) var(--ease) var(--reveal-delay, 0ms),
                  transform var(--reveal-duration, 680ms) var(--ease) var(--reveal-delay, 0ms);
    }

    /* ── Back to top ────────────────────────────────────── */
    .to-top {
      position: fixed; right: 24px; bottom: 24px; z-index: 40;
      width: 42px; height: 42px; border-radius: 12px;
      background: var(--card-800); border: 1px solid var(--line-600);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; opacity: 0; pointer-events: none;
      transform: translateY(10px);
      transition: opacity 300ms ease, transform 300ms var(--ease), border-color 160ms ease;
    }
    .to-top.show { opacity: 1; pointer-events: auto; transform: none; }
    .to-top:hover { border-color: var(--accent); }
    .to-top svg { width: 18px; height: 18px; stroke: var(--ink-300); }

    /* ── Reduced motion ─────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .reveal { opacity: 1; transform: none; }
      .hero-stack > * { animation: none; opacity: 1; transform: none; }
    }

    /* ── Footer ─────────────────────────────────────────── */
    .footer {
      position: relative; z-index: 1;
      border-top: 1px solid var(--line-600);
      padding: 28px 32px; text-align: center;
      color: var(--ink-500); font-size: 12px;
    }
    .footer a { color: var(--accent); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .footer-brand {
      font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 14px;
      margin-bottom: 6px;
    }

    /* ── Scroll cue ─────────────────────────────────────── */
    .scroll-cue {
      display: flex; justify-content: center; padding: 8px 0 0;
      animation: scroll-cue 2s ease-in-out infinite;
    }
    .scroll-cue svg { width: 22px; height: 22px; stroke: var(--ink-500); }
    @keyframes scroll-cue {
      0%, 100% { transform: translate3d(0, 0, 0); opacity: .45; }
      50% { transform: translate3d(0, 7px, 0); opacity: 1; }
    }

    @media (max-width: 900px) {
      .nav-pills { display: none; }
    }
    @media (max-width: 640px) {
      .header { padding: 0 16px; }
      .hero { padding: 48px 16px 32px; }
      .content { padding: 20px 16px; }
      .profile-panel { gap: 16px; }
    }
  </style>
</head>
<body>
  <!-- Atmosphere -->
  <span aria-hidden="true" class="orb" style="--orb-color:var(--alpha);--orb-opacity:.22;--drift-x:6vw;--drift-y:-8vh;--drift-duration:28s;width:480px;height:480px;top:-12%;left:-10%;"></span>
  <span aria-hidden="true" class="orb" style="--orb-color:var(--gamma);--orb-opacity:.18;--drift-x:-7vw;--drift-y:6vh;--drift-duration:32s;--drift-delay:4s;width:420px;height:420px;top:30%;right:-12%;"></span>
  <span aria-hidden="true" class="orb" style="--orb-color:var(--delta);--orb-opacity:.14;--drift-x:5vw;--drift-y:7vh;--drift-duration:36s;--drift-delay:8s;width:380px;height:380px;bottom:-15%;left:20%;"></span>
  <div aria-hidden="true" class="grid-veil"></div>

  <!-- Header -->
  <header class="header">
    <div class="header-inner">
      <div class="brand">
        <div class="brand-mark">ig</div>
        <div class="brand-name">ig-analyzer <span>/ OSINT</span></div>
      </div>
      <nav class="nav-pills" aria-label="Sections">
        <a class="nav-pill" href="#overview">Overview</a>
        <a class="nav-pill" href="#insights">Insights</a>
        <a class="nav-pill" href="#engagement">Engagement</a>
        <a class="nav-pill" href="#analytics">Analytics</a>
        <a class="nav-pill" href="#content">Content</a>
        <a class="nav-pill" href="#posts">Top Posts</a>
        <a class="nav-pill" href="#patterns">Patterns</a>
        <a class="nav-pill" href="#network">Network</a>
        <a class="nav-pill" href="#bio">Bio</a>
      </nav>
      <div class="header-actions">
        <button class="btn" id="exportBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
        <div class="live-badge"><span class="live-dot"></span>Live</div>
      </div>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-stack">
      <span class="eyebrow"><span class="eyebrow-dot"></span>OSINT REPORT</span>
      <h1>@${esc(username)} <span class="text-shine">Intelligence</span></h1>
      <p class="hero-sub">${esc(profile?.name || 'Instagram profile analysis')} — engagement, content, network, and behavioral patterns extracted from ${num(posts?.length)} posts.</p>
      <div class="hero-meta">
        <span class="meta-chip"><span class="k">Scraped</span><span class="v">${esc(profile?.scrapedAt?.split('T')[0] || '—')}</span></span>
        <span class="meta-chip"><span class="k">Posts</span><span class="v">${num(profile?.posts)}</span></span>
        <span class="meta-chip"><span class="k">Followers</span><span class="v">${num(profile?.followers)}</span></span>
        <span class="meta-chip"><span class="k">Following</span><span class="v">${num(profile?.following)}</span></span>
        <span class="meta-chip"><span class="k">Analyzed</span><span class="v">${num(posts?.length)}</span></span>
      </div>
    </div>
    <div class="scroll-cue" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  </section>

  <div class="section-rule"></div>

  <main class="content">
    <!-- Profile Overview -->
    <section class="section reveal" id="overview" data-delay="0">
      <div class="card card-lift">
        <span aria-hidden="true" class="card-bloom"></span>
        <div class="card-eyebrow">Profile Overview</div>
        <div class="profile-panel">
          <div class="avatar-ring"><div class="avatar">${esc(username.charAt(0).toUpperCase())}</div></div>
          <div class="profile-info">
            <div class="profile-name">${esc(profile?.name || username)}</div>
            <div class="profile-username">@${esc(username)}</div>
            <div class="profile-bio">${esc(profile?.bio || 'No bio available')}</div>
            <div class="profile-badges">
              <span class="badge"><span class="k">Posts</span><span class="v">${num(profile?.posts)}</span></span>
              <span class="badge"><span class="k">Followers</span><span class="v">${num(profile?.followers)}</span></span>
              <span class="badge"><span class="k">Following</span><span class="v">${num(profile?.following)}</span></span>
              <span class="badge ${profile?.isVerified ? 'on' : ''}"><span class="k">Verified</span><span class="v">${profile?.isVerified ? 'Yes' : 'No'}</span></span>
              <span class="badge"><span class="k">Private</span><span class="v">${profile?.isPrivate ? 'Yes' : 'No'}</span></span>
              ${profile?.externalUrl ? `<span class="badge"><span class="k">URL</span><span class="v">${esc(profile.externalUrl)}</span></span>` : ''}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- OSINT Insights -->
    <section class="section reveal" id="insights" data-delay="80">
      <h2 class="section-title">OSINT Insights</h2>
      <div class="card card-lift">
        <span aria-hidden="true" class="card-bloom"></span>
        <div class="card-eyebrow">Auto-generated Findings</div>
        <div class="insight-list">
          ${insights.map(i => `<div class="insight" style="--dot:${levelColor[i.level] || 'var(--alpha)'}"><span class="insight-dot"></span><span class="insight-text">${esc(i.text)}</span></div>`).join('') || '<div class="card-sub">Not enough data for insights.</div>'}
        </div>
      </div>
    </section>

    <!-- Engagement metrics -->
    <section class="section reveal" id="engagement" data-delay="90">
      <h2 class="section-title">Engagement</h2>
      <div class="grid grid-4">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Engagement Rate</div>
          <div class="gauge-wrap">
            <div class="gauge">
              <svg viewBox="0 0 120 120" width="120" height="120">
                <defs>
                  <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0284C7"/>
                    <stop offset="50%" stop-color="#8B5CF6"/>
                    <stop offset="100%" stop-color="#059669"/>
                  </linearGradient>
                </defs>
                <circle class="gauge-bg" cx="60" cy="60" r="54"></circle>
                <circle class="gauge-fill" id="engGauge" cx="60" cy="60" r="54" style="stroke-dashoffset: ${339.29 - (339.29 * engPct / 100)}"></circle>
              </svg>
              <div class="gauge-center">
                <div class="gauge-val">${esc(engagement.engagementRate || '—')}</div>
                <div class="gauge-lbl">rate</div>
              </div>
            </div>
          </div>
          <div class="card-sub">Avg across ${num(engagement.postsAnalyzed)} posts</div>
        </div>
        <div class="card card-lift" data-accent="beta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Total Likes</div>
          <div class="card-value" data-count="${num(engagement.totalLikes)}">${num(engagement.totalLikes)}</div>
          <div class="card-sub">Avg ${num(engagement.avgLikes)} per post</div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Total Comments</div>
          <div class="card-value" data-count="${num(engagement.totalComments)}">${num(engagement.totalComments)}</div>
          <div class="card-sub">Avg ${num(engagement.avgComments)} per post</div>
        </div>
        <div class="card card-lift" data-accent="delta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Follower / Following</div>
          <div class="card-value">${esc(network.followerFollowingRatio || '—')}</div>
          <div class="card-sub">${num(network.followerCount)} / ${num(network.followingCount)}</div>
        </div>
      </div>
    </section>

    <!-- Charts -->
    <section class="section reveal" id="analytics" data-delay="120">
      <h2 class="section-title">Analytics</h2>
      <div class="grid grid-3">
        <div class="card card-lift grid-full" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Engagement Trend (likes &amp; comments per post)</div>
          <div class="chart-box tall"><canvas id="trendChart"></canvas></div>
        </div>
        <div class="card card-lift" data-accent="beta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Posts by Hour</div>
          <div class="chart-box"><canvas id="hourChart"></canvas></div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Posts by Day</div>
          <div class="chart-box"><canvas id="dayChart"></canvas></div>
        </div>
      </div>
    </section>

    <!-- Content analysis -->
    <section class="section reveal" id="content" data-delay="150">
      <h2 class="section-title">Content Analysis</h2>
      <div class="grid grid-2">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Content Mix</div>
          <div class="mix-row">
            <span class="mix-label">Photos</span>
            <div class="mix-bar"><div class="mix-fill grow-x" data-fill="${mixPhotos + mixCarousels + mixReels ? Math.round(mixPhotos / (mixPhotos + mixCarousels + mixReels) * 100) : 0}" style="background:linear-gradient(90deg,#0284C7,#0EA5E9)"></div></div>
            <span class="mix-count">${num(mixPhotos)}</span>
          </div>
          <div class="mix-row">
            <span class="mix-label">Carousels</span>
            <div class="mix-bar"><div class="mix-fill grow-x" data-fill="${mixPhotos + mixCarousels + mixReels ? Math.round(mixCarousels / (mixPhotos + mixCarousels + mixReels) * 100) : 0}" style="background:linear-gradient(90deg,#D97706,#F59E0B)"></div></div>
            <span class="mix-count">${num(mixCarousels)}</span>
          </div>
          <div class="mix-row">
            <span class="mix-label">Reels</span>
            <div class="mix-bar"><div class="mix-fill grow-x" data-fill="${mixPhotos + mixCarousels + mixReels ? Math.round(mixReels / (mixPhotos + mixCarousels + mixReels) * 100) : 0}" style="background:linear-gradient(90deg,#8B5CF6,#A78BFA)"></div></div>
            <span class="mix-count">${num(mixReels)}</span>
          </div>
          <div class="card-sub" style="margin-top:8px">Distribution across ${num(mixPhotos + mixCarousels + mixReels)} typed posts</div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Hashtag Cloud</div>
          <div class="tag-cloud">
            ${tagCloud.map(h => `<span class="tag" style="font-size:${h.size}px;opacity:${h.opacity}">#${esc(h.tag)} <span style="font-size:.7em;color:var(--ink-500)">${h.count}</span></span>`).join('') || '<span class="card-sub">No hashtags found</span>'}
          </div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Mention Network</div>
          <div class="tag-cloud">
            ${topMentions.map(m => `<span class="tag mention" style="font-size:${11 + (m.count / (topMentions[0]?.count || 1)) * 16}px;opacity:${0.5 + (m.count / (topMentions[0]?.count || 1)) * 0.5}">@${esc(m.user)} <span style="font-size:.7em;color:var(--ink-500)">${m.count}</span></span>`).join('') || '<span class="card-sub">No mentions found</span>'}
          </div>
        </div>
        <div class="card card-lift" data-accent="delta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Caption Word Cloud</div>
          <div class="tag-cloud">
            ${wordCloud.map(w => `<span class="tag word" style="font-size:${w.size}px;opacity:${w.opacity}" title="${w.count} uses">${esc(w.word)} <span style="font-size:.7em;color:var(--ink-500)">${w.count}</span></span>`).join('') || '<span class="card-sub">No caption text found</span>'}
          </div>
        </div>
      </div>
    </section>

    <!-- Top posts -->
    <section class="section reveal" id="posts" data-delay="180">
      <h2 class="section-title">Top Posts</h2>
      <div class="grid grid-2">
        <div class="card card-lift" data-accent="beta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Most Liked Posts</div>
          <table>
            <thead><tr><th>Shortcode</th><th>Likes</th></tr></thead>
            <tbody>
              ${mostLiked.map(p => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.shortcode)}</a></td><td class="num">${num(p.likes)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="card card-lift" data-accent="delta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Most Commented Posts</div>
          <table>
            <thead><tr><th>Shortcode</th><th>Comments</th></tr></thead>
            <tbody>
              ${mostCommented.map(p => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.shortcode)}</a></td><td class="num">${num(p.comments)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Posting patterns -->
    <section class="section reveal" id="patterns" data-delay="210">
      <h2 class="section-title">Posting Patterns</h2>
      <div class="grid grid-4">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Best Posting Hour</div>
          <div class="card-value">${esc(posting.bestPostingHour || '—')}</div>
          <div class="card-sub">Best day: ${esc(posting.bestPostingDay || '—')}</div>
        </div>
        <div class="card card-lift" data-accent="beta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Post Frequency</div>
          <div class="card-value">${esc(posting.postsPerWeek || '—')}</div>
          <div class="card-sub">posts/week · ${esc(posting.postsPerDay)}/day</div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Account Age</div>
          <div class="card-value">${num(account.estimatedAgeDays)} <span style="font-size:15px;color:var(--ink-500)">days</span></div>
          <div class="card-sub">Est. created: ${esc(account.estimatedCreated?.split('T')[0] || '—')}</div>
        </div>
        <div class="card card-lift" data-accent="delta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Last Activity</div>
          <div class="card-value">${lastPostDays === null ? '—' : lastPostDays === 0 ? 'Today' : lastPostDays + '<span style="font-size:15px;color:var(--ink-500)">d ago</span>'}</div>
          <div class="card-sub">${esc(posting.latestPost?.split('T')[0] || '—')}</div>
        </div>
      </div>
    </section>

    <!-- Timeline -->
    <section class="section reveal" id="timeline" data-delay="240">
      <h2 class="section-title">Activity Timeline</h2>
      <div class="grid grid-2">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Posting Timeline</div>
          <div class="timeline">
            ${timeline.slice(-12).map(([month, count]) => `
              <div class="tl-item">
                <div class="tl-date">${esc(new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}</div>
                <div class="tl-count">${count} post${count === 1 ? '' : 's'}</div>
              </div>
            `).join('') || '<div class="card-sub">No timeline data</div>'}
          </div>
        </div>
        <div class="grid" style="gap:16px">
          <div class="card card-lift" data-accent="delta">
            <span aria-hidden="true" class="card-bloom"></span>
            <div class="card-eyebrow">Verified Followers</div>
            <div class="card-value">${num(network.verifiedFollowers)}</div>
            <div class="card-sub">Out of ${num(network.followerCount)} total</div>
            <div class="bar" style="margin-top:12px"><div class="bar-fill grow-x" style="width:${network.followerCount ? Math.min(100, network.verifiedFollowers / network.followerCount * 100) : 0}%"></div></div>
          </div>
          <div class="card card-lift" data-accent="gamma">
            <span aria-hidden="true" class="card-bloom"></span>
            <div class="card-eyebrow">Verified Following</div>
            <div class="card-value">${num(network.verifiedFollowing)}</div>
            <div class="card-sub">Out of ${num(network.followingCount)} total</div>
            <div class="bar" style="margin-top:12px"><div class="bar-fill grow-x" style="width:${network.followingCount ? Math.min(100, network.verifiedFollowing / network.followingCount * 100) : 0}%"></div></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Network -->
    <section class="section reveal" id="network" data-delay="270">
      <h2 class="section-title">Network</h2>
      <div class="grid grid-2">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Top Followers (${num(network.followerCount)} total)</div>
          <table>
            <thead><tr><th>User</th><th>Verified</th></tr></thead>
            <tbody>
              ${topFollowers.map(f => `<tr><td><span class="mini-avatar">${esc(f.username.charAt(0).toUpperCase())}</span><a href="https://www.instagram.com/${esc(f.username)}" target="_blank" rel="noopener">${esc(f.username)}</a></td><td>${f.verified ? '<span class="verified-mark">✓</span>' : '<span style="color:var(--ink-500)">—</span>'}</td></tr>`).join('') || '<tr><td colspan="2" class="card-sub">No follower data</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Top Following (${num(network.followingCount)} total)</div>
          <table>
            <thead><tr><th>User</th><th>Verified</th></tr></thead>
            <tbody>
              ${topFollowing.map(f => `<tr><td><span class="mini-avatar">${esc(f.username.charAt(0).toUpperCase())}</span><a href="https://www.instagram.com/${esc(f.username)}" target="_blank" rel="noopener">${esc(f.username)}</a></td><td>${f.verified ? '<span class="verified-mark">✓</span>' : '<span style="color:var(--ink-500)">—</span>'}</td></tr>`).join('') || '<tr><td colspan="2" class="card-sub">No following data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Bio analysis -->
    <section class="section reveal" id="bio" data-delay="300">
      <h2 class="section-title">Bio Intelligence</h2>
      <div class="grid grid-4">
        <div class="card card-lift" data-accent="alpha">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Email</div>
          <div class="card-value" style="font-size:18px">${bio.hasEmail ? esc(bio.email) : '<span style="color:var(--ink-500)">Not found</span>'}</div>
        </div>
        <div class="card card-lift" data-accent="beta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Phone</div>
          <div class="card-value" style="font-size:18px">${bio.hasPhone ? esc(bio.phone) : '<span style="color:var(--ink-500)">Not found</span>'}</div>
        </div>
        <div class="card card-lift" data-accent="gamma">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">External URL</div>
          <div class="card-value" style="font-size:18px">${bio.hasUrl ? esc(bio.url) : '<span style="color:var(--ink-500)">Not found</span>'}</div>
        </div>
        <div class="card card-lift" data-accent="delta">
          <span aria-hidden="true" class="card-bloom"></span>
          <div class="card-eyebrow">Bio Length</div>
          <div class="card-value">${num(bio.length)} <span style="font-size:15px;color:var(--ink-500)">chars</span></div>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer-brand text-shine" style="font-size:15px">ig-analyzer</div>
    Instagram OSINT Dashboard · Author: <a href="https://github.com/anurag-panda-dev" target="_blank" rel="noopener">Anurag Panda</a><br>
    Data scraped: ${esc(profile?.scrapedAt?.split('T')[0] || '—')} · ${num(posts?.length)} posts · ${num(followers?.length)} followers · ${num(following?.length)} following
  </footer>

  <button class="to-top" id="toTop" type="button" aria-label="Back to top">
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
  </button>

  <script>
    // Chart.js dark theme defaults
    Chart.defaults.color = '#7D8794';
    Chart.defaults.borderColor = '#1C222B';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.font.size = 11;

    const gridColor = 'rgba(28, 34, 43, .8)';
    const tickColor = '#7D8794';
    const tooltipStyle = { backgroundColor: '#13171D', borderColor: '#29323F', borderWidth: 1, titleColor: '#E8EDF3', bodyColor: '#B7C0CC', padding: 10 };

    // Engagement trend chart
    new Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: {
        labels: ${json(trendLabels)},
        datasets: [
          {
            label: 'Likes',
            data: ${json(likesData)},
            borderColor: '#0284C7',
            backgroundColor: 'rgba(2, 132, 199, .12)',
            fill: true,
            tension: .35,
            pointRadius: 3,
            pointBackgroundColor: '#0284C7',
            borderWidth: 2,
          },
          {
            label: 'Comments',
            data: ${json(commentsData)},
            borderColor: '#8B5CF6',
            backgroundColor: 'rgba(139, 92, 246, .12)',
            fill: true,
            tension: .35,
            pointRadius: 3,
            pointBackgroundColor: '#8B5CF6',
            borderWidth: 2,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } }, tooltip: tooltipStyle },
        scales: {
          x: { ticks: { color: tickColor, maxRotation: 90 }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true }
        }
      }
    });

    // Hour chart
    const hourData = ${json(postsByHour)};
    const hours = Array.from({length: 24}, (_, i) => i);
    new Chart(document.getElementById('hourChart'), {
      type: 'bar',
      data: {
        labels: hours.map(h => h + ':00'),
        datasets: [{
          label: 'Posts',
          data: hours.map(h => hourData[h] || 0),
          backgroundColor: 'rgba(217, 119, 6, .55)',
          borderColor: '#D97706',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltipStyle },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor, stepSize: 1 }, grid: { color: gridColor } }
        }
      }
    });

    // Day chart
    const dayData = ${json(postsByDay)};
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    new Chart(document.getElementById('dayChart'), {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{
          label: 'Posts',
          data: days.map(d => dayData[d] || 0),
          backgroundColor: 'rgba(139, 92, 246, .55)',
          borderColor: '#8B5CF6',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltipStyle },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor, stepSize: 1 }, grid: { color: gridColor } }
        }
      }
    });

    // ── Scroll reveal (IntersectionObserver) ──────────────
    (function() {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const els = document.querySelectorAll('.reveal');
      if (reduce || !('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('is-revealed'));
        return;
      }
      els.forEach(el => {
        const d = parseInt(el.dataset.delay || '0', 10);
        el.style.setProperty('--reveal-delay', d + 'ms');
      });
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-revealed');
            io.unobserve(e.target);
          }
        }
      }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
      els.forEach(el => io.observe(el));
    })();

    // ── Animated counters ─────────────────────────────────
    (function() {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelectorAll('[data-count]').forEach(el => {
        const raw = el.dataset.count.replace(/,/g, '');
        const target = parseFloat(raw);
        if (isNaN(target) || target === 0) return;
        if (reduce) { el.textContent = target.toLocaleString(); return; }
        const io = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(el);
            const start = performance.now();
            const dur = 1500;
            const step = (now) => {
              const t = Math.min(1, (now - start) / dur);
              const eased = 1 - Math.pow(1 - t, 3);
              el.textContent = Math.round(target * eased).toLocaleString();
              if (t < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        }, { threshold: 0.4 });
        io.observe(el);
      });
    })();

    // ── Scrollspy nav ─────────────────────────────────────
    (function() {
      const pills = document.querySelectorAll('.nav-pill');
      const map = {};
      pills.forEach(p => { map[p.getAttribute('href').slice(1)] = p; });
      const sections = Object.keys(map).map(id => document.getElementById(id)).filter(Boolean);
      if (!sections.length || !('IntersectionObserver' in window)) return;
      const spy = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          pills.forEach(p => p.classList.remove('active'));
          const pill = map[e.target.id];
          if (pill) pill.classList.add('active');
        }
      }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
      sections.forEach(s => spy.observe(s));
    })();

    // ── Export JSON ───────────────────────────────────────
    (function() {
      const btn = document.getElementById('exportBtn');
      if (!btn) return;
      const original = btn.innerHTML;
      const payload = ${json({ exportedAt: new Date().toISOString(), ...data, analytics })};
      btn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '${esc(username)}-osint-report.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        btn.textContent = 'Exported ✓';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
      });
    })();

    // ── Back to top ───────────────────────────────────────
    (function() {
      const btn = document.getElementById('toTop');
      if (!btn) return;
      window.addEventListener('scroll', () => {
        btn.classList.toggle('show', window.scrollY > 600);
      }, { passive: true });
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    })();
  </script>
</body>
</html>`;
}

// ── Server ─────────────────────────────────────────────────
async function main() {
  const dataDir = await findDataDir();
  const data = await loadData(dataDir);
  const analytics = computeAnalytics(data);

  const html = renderDashboard(data, analytics);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(PORT, () => {
    const username = data.profile?.username || 'unknown';
    console.log('');
    console.log('  ================================================================');
    console.log('  |                                                              |');
    console.log('  |    ig-analyzer — Instagram OSINT Dashboard                   |');
    console.log('  |                                                              |');
    console.log('  ================================================================');
    console.log('');
    console.log('  Author      : Anurag Panda');
    console.log('  GitHub      : https://github.com/anurag-panda-dev/ig-harvester');
    console.log('  Version     : 2.1.0');
    console.log('');
    console.log('  Data dir    : ' + dataDir);
    console.log('  Username    : @' + username);
    console.log('  Posts       : ' + data.posts?.length);
    console.log('  Followers   : ' + data.followers?.length);
    console.log('  Following   : ' + data.following?.length);
    console.log('');
    console.log('  Dashboard   : http://localhost:' + PORT);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
  });
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
