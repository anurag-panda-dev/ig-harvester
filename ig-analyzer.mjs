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

// ── Args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

const PORT = Number(val('port', 8080));
const USER = val('user');
const DATA_DIR = val('dir');

// ── Find data ─────────────────────────────────────────────────────
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

// ── Load data ──────────────────────────────────────────────────────
async function loadData(dataDir) {
  const jsonPath = path.join(dataDir, `${path.basename(dataDir)}.json`);
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}

// ── HTML Dashboard ─────────────────────────────────────────────────
function renderDashboard(data, analytics) {
  const { profile, posts, followers, following } = data;
  const username = profile?.username || 'unknown';

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (n) => n?.toLocaleString?.() ?? n ?? '—';

  // Animated counter markup — falls back to the literal value without JS
  const cnt = (v, dec = 0, suffix = '') => {
    if (v == null) return '<span class="num">\u2014</span>';
    const raw = String(v).trim();
    const stripped = raw.replace(/[^0-9.\-]/g, '');
    if (stripped === '' || stripped === '-' || stripped === '.') return '<span class="num">' + esc(raw || '\u2014') + '</span>';
    const n = Number(stripped);
    if (!isFinite(n)) return '<span class="num">' + esc(raw) + '</span>';
    const shown = n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
    return '<span class="num" data-count="' + n + '" data-dec="' + dec + '" data-suffix="' + esc(suffix) + '">' + shown + '</span>';
  };

  // Inline stroke icons (feather-style)
  const svg = (inner, sw) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.7) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const ICONS = {
    pulse: svg('<path d="M3 12h4l3 8 4-16 3 8h4"/>', 2),
    target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>'),
    heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>'),
    comment: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'),
    users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 1.9"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M16 3v4M8 3v4M3 10.5h18"/>'),
    id: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.2a4 4 0 0 1 7 0M14.5 9.5h4M14.5 13.5h4"/>'),
    grid: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>'),
    hash: svg('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
    at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5.2a3 3 0 0 0 6 0V12A10 10 0 1 0 18 20"/>'),
    chart: svg('<path d="M3 3v17.5A1.5 1.5 0 0 0 4.5 22H21"/><path d="M7 15.5 11 10l3 3 5-7"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5.2L12 2 4 5.2V12c0 6 8 10 8 10z"/>'),
    mail: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m2.8 7.5 9.2 6 9.2-6"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
    link: svg('<path d="M10.5 13.5a5 5 0 0 0 7.1 0l2.6-2.6a5 5 0 0 0-7.1-7.1l-1.3 1.3"/><path d="M13.5 10.5a5 5 0 0 0-7.1 0l-2.6 2.6a5 5 0 0 0 7.1 7.1l1.3-1.3"/>'),
    ruler: svg('<path d="M3.5 14.5 14.5 3.5l6 6-11 11z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>'),
    zap: svg('<path d="M13 2 3.5 13.5H11l-1 8.5 9.5-11.5H12l1-8.5z"/>'),
  };

  // Chart data
  const postsByHour = {};
  const postsByDay = {};
  posts.forEach(p => {
    if (p.timestamp) {
      const d = new Date(p.timestamp);
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

  const likesData = posts.slice(0, 30).map(p => p.likes || 0).reverse();
  const labels = posts.slice(0, 30).map(p => p.shortcode).reverse();

  // Ranked list rows with proportional meters
  const rankRows = (items, key) => {
    const max = Math.max(1, ...items.map(i => i[key] || 0));
    return items.map((p, i) => {
      const w = Math.round(((p[key] || 0) / max) * 100);
      return '<div class="rank"><span class="no">' + (i + 1) + '</span>' +
        '<a class="code" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.shortcode) + '</a>' +
        '<span class="meter"><i style="width:' + w + '%"></i></span>' +
        '<span class="n">' + num(p[key]) + '</span></div>';
    }).join('') || '<div class="empty">No data</div>';
  };

  // Tag cloud — size & glow scale with frequency
  const cloud = (items, kind) => {
    const max = Math.max(1, ...items.map(i => i.count || 0));
    return items.map(i => {
      const t = (i.count || 0) / max;
      const size = (12 + t * 13).toFixed(1);
      const label = kind === 'hash' ? '#' + i.tag : '@' + i.user;
      return '<span class="tag' + (kind === 'at' ? ' mention' : '') + '" style="font-size:' + size + 'px;opacity:' + (0.55 + t * 0.45).toFixed(2) + '">' +
        esc(label) + '<em>' + num(i.count) + '</em></span>';
    }).join('') || '<div class="empty">None found</div>';
  };

  // Verified rings (SVG donuts)
  const R = 46, CIRC = (2 * Math.PI * R).toFixed(2);
  const ring = (verified, total, gradId, label) => {
    const p = total ? Math.min(1, verified / total) : 0;
    const offset = (CIRC * (1 - p)).toFixed(2);
    const share = total ? (p * 100).toFixed(1) : '0.0';
    return '<div class="ring-wrap">' +
      '<svg class="donut" viewBox="0 0 110 110">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#8b5cf6"/><stop offset="60%" stop-color="#ec4899"/><stop offset="100%" stop-color="#f97316"/></linearGradient></defs>' +
      '<circle class="track" cx="55" cy="55" r="' + R + '"/>' +
      '<circle class="prog" cx="55" cy="55" r="' + R + '" stroke="url(#' + gradId + ')" stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + CIRC + '" data-ring="' + offset + '"/>' +
      '</svg>' +
      '<div class="ring-meta"><div class="ring-pct">' + share + '%</div><div class="ring-label">' + esc(label) + '</div>' +
      '<div class="ring-sub">' + num(verified) + ' of ' + num(total) + '</div></div></div>';
  };

  // Content mix bars
  const mix = [
    { label: 'Carousels', n: analytics?.content?.carouselPosts || 0, c: '#8b5cf6' },
    { label: 'Reels', n: analytics?.content?.reelPosts || 0, c: '#ec4899' },
    { label: 'Photos', n: analytics?.content?.photoPosts || 0, c: '#22d3ee' },
  ];
  const mixMax = Math.max(1, ...mix.map(m => m.n));
  const mixRows = mix.map(m =>
    '<div class="mix-row"><span class="mix-dot" style="background:' + m.c + '"></span>' +
    '<span class="mix-label">' + m.label + '</span>' +
    '<span class="meter"><i style="width:' + Math.round((m.n / mixMax) * 100) + '%;background:' + m.c + '"></i></span>' +
    '<b class="num">' + num(m.n) + '</b></div>').join('');

  const sectionHead = (id, title, hint, icon) =>
    '<div class="section-head"><span class="bar"></span>' + icon +
    '<h2>' + title + '</h2><span class="hint">' + hint + '</span></div>';

  const verifiedChip = profile?.isVerified
    ? '<span class="chip ok">' + ICONS.shield + 'Verified</span>' : '';
  const privateChip = profile?.isPrivate
    ? '<span class="chip warn">Private account</span>' : '';
  const initial = esc((username[0] || '?').toUpperCase());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ig-analyzer — @${esc(username)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    :root{
      --bg:#05060b;
      --panel:rgba(255,255,255,.035);
      --panel-2:rgba(255,255,255,.06);
      --stroke:rgba(255,255,255,.08);
      --stroke-hi:rgba(255,255,255,.18);
      --txt:#e8edf6;
      --muted:#8b93a7;
      --violet:#8b5cf6;
      --pink:#ec4899;
      --orange:#f97316;
      --cyan:#22d3ee;
      --green:#34d399;
      --grad:linear-gradient(135deg,#8b5cf6,#ec4899 55%,#f97316);
      --radius:18px;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{
      background:var(--bg);color:var(--txt);
      font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
      min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;
    }

    /* ── Ambient background ─────────────────────────────── */
    .bg{position:fixed;inset:0;z-index:-3;background:
      radial-gradient(700px 620px at 6% -12%, rgba(139,92,246,.30), transparent 62%),
      radial-gradient(760px 520px at 98% -6%, rgba(236,72,153,.20), transparent 62%),
      radial-gradient(900px 700px at 50% 115%, rgba(249,115,22,.15), transparent 65%);}
    .bg-grid{position:fixed;inset:0;z-index:-2;pointer-events:none;
      background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),
                       linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
      background-size:54px 54px;
      -webkit-mask-image:radial-gradient(ellipse at 50% 20%, #000 10%, transparent 78%);
      mask-image:radial-gradient(ellipse at 50% 20%, #000 10%, transparent 78%);}
    .orb{position:fixed;border-radius:50%;filter:blur(90px);opacity:.5;z-index:-1;pointer-events:none}
    .orb-a{width:340px;height:340px;left:-90px;top:24%;background:rgba(139,92,246,.55);animation:drift 22s ease-in-out infinite}
    .orb-b{width:280px;height:280px;right:-70px;top:48%;background:rgba(236,72,153,.45);animation:drift 27s ease-in-out infinite reverse}
    .orb-c{width:240px;height:240px;left:42%;bottom:-100px;background:rgba(34,211,238,.32);animation:drift 31s ease-in-out infinite}
    @keyframes drift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(40px,-46px,0)}}

    /* ── Top bar ────────────────────────────────────────── */
    .topbar{position:sticky;top:0;z-index:60;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
      background:rgba(5,6,11,.74);border-bottom:1px solid var(--stroke)}
    .topbar-inner{max-width:1440px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .logo{width:40px;height:40px;border-radius:13px;background:var(--grad);display:grid;place-items:center;color:#fff;flex:none;
      box-shadow:0 10px 26px -8px rgba(139,92,246,.75)}
    .logo svg{width:21px;height:21px}
    .title h1{font-size:16.5px;letter-spacing:-.02em;font-weight:700}
    .title .sub{font-size:12px;color:var(--muted);margin-top:2px}
    .nav{display:flex;gap:5px;margin-left:auto;flex-wrap:wrap}
    .nav a{font-size:12.5px;font-weight:500;color:var(--muted);text-decoration:none;padding:7px 13px;border-radius:999px;
      border:1px solid transparent;transition:.22s}
    .nav a:hover{color:#fff;background:var(--panel-2)}
    .nav a.active{color:#fff;background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.45)}
    .live{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:.16em;color:var(--green);
      background:rgba(52,211,153,.09);border:1px solid rgba(52,211,153,.32);padding:7px 13px;border-radius:999px;flex:none}
    .pulse{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.6)}70%{box-shadow:0 0 0 9px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}

    /* ── Layout ─────────────────────────────────────────── */
    .container{max-width:1440px;margin:0 auto;padding:26px 24px 40px}
    .section{margin-top:38px;scroll-margin-top:88px}
    .section:first-child{margin-top:0}
    .section-head{display:flex;align-items:center;gap:11px;margin-bottom:15px}
    .section-head .bar{width:4px;height:20px;border-radius:4px;background:var(--grad);flex:none}
    .section-head svg{width:16px;height:16px;color:var(--muted);flex:none}
    .section-head h2{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#cfd6e4;font-weight:700}
    .section-head .hint{margin-left:auto;font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:16px}
    .grid.two{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
    .full{grid-column:1/-1}

    /* ── Reveal on scroll ───────────────────────────────── */
    .reveal{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1)}
    .reveal.in{opacity:1;transform:none}

    /* ── Hero ───────────────────────────────────────────── */
    .hero{position:relative;overflow:hidden;border-radius:24px;padding:28px;
      background:linear-gradient(135deg,rgba(139,92,246,.20),rgba(236,72,153,.11) 48%,rgba(249,115,22,.07));
      border:1px solid rgba(255,255,255,.11);box-shadow:0 30px 70px -40px rgba(0,0,0,.95)}
    .hero::before{content:'';position:absolute;width:460px;height:460px;right:-120px;top:-220px;border-radius:50%;
      background:radial-gradient(circle,rgba(236,72,153,.42),transparent 65%);filter:blur(12px);pointer-events:none}
    .hero::after{content:'';position:absolute;inset:0;pointer-events:none;
      background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
      background-size:38px 38px;opacity:.5;
      -webkit-mask-image:linear-gradient(120deg,#000,transparent 65%);mask-image:linear-gradient(120deg,#000,transparent 65%)}
    .hero-inner{position:relative;z-index:1;display:flex;align-items:center;gap:26px;flex-wrap:wrap}
    .avatar{position:relative;width:98px;height:98px;border-radius:50%;padding:3px;background:var(--grad);flex:none;
      box-shadow:0 16px 40px -14px rgba(236,72,153,.7)}
    .avatar .inner{width:100%;height:100%;border-radius:50%;background:#0b0d14;display:grid;place-items:center;
      font-size:36px;font-weight:800;color:#fff}
    .avatar .status-dot{position:absolute;right:5px;bottom:7px;width:16px;height:16px;border-radius:50%;
      background:var(--green);border:3px solid #0b0d14}
    .hero-info{flex:1;min-width:260px}
    .hero-tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:9px}
    .chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;
      background:var(--panel-2);border:1px solid var(--stroke);color:var(--muted)}
    .chip svg{width:12px;height:12px}
    .chip.ok{color:var(--green);background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.32)}
    .chip.warn{color:var(--orange);background:rgba(249,115,22,.1);border-color:rgba(249,115,22,.32)}
    .chip.subject{color:#fff;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);letter-spacing:.1em;text-transform:uppercase;font-size:10px}
    .hero-info h2{font-size:27px;font-weight:800;letter-spacing:-.03em;color:#fff}
    .hero-info .handle{font-family:'JetBrains Mono',monospace;font-size:13.5px;color:#f9a8d4;margin-top:4px}
    .hero-info .bio{font-size:13.5px;color:#aab3c5;margin-top:11px;max-width:620px;line-height:1.65;white-space:pre-line}
    .hero-stats{display:flex;gap:11px;flex-wrap:wrap}
    .pill{background:rgba(4,5,10,.55);border:1px solid var(--stroke);border-radius:16px;padding:13px 17px;min-width:112px;text-align:center;
      backdrop-filter:blur(6px);transition:.25s}
    .pill:hover{border-color:var(--stroke-hi);transform:translateY(-3px)}
    .pill b{display:block;font-size:22px;font-weight:800;letter-spacing:-.02em;color:#fff;font-variant-numeric:tabular-nums}
    .pill span{display:block;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-top:5px}

    /* ── Cards ──────────────────────────────────────────── */
    .card{position:relative;overflow:hidden;background:var(--panel);border:1px solid var(--stroke);border-radius:var(--radius);
      padding:20px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      transition:transform .32s cubic-bezier(.22,1,.36,1),border-color .32s,box-shadow .32s}
    .card::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
      background:radial-gradient(420px 200px at var(--mx,50%) var(--my,0%),rgba(255,255,255,.07),transparent 68%)}
    .card:hover{transform:translateY(-5px);border-color:var(--stroke-hi);box-shadow:0 26px 50px -28px rgba(0,0,0,1)}
    .card:hover::after{opacity:1}
    .kpi-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .card h3{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:700;
      display:flex;align-items:center;gap:8px}
    .ico{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;flex:none;
      background:rgba(255,255,255,.05);border:1px solid var(--stroke);color:var(--muted)}
    .ico svg{width:17px;height:17px}
    .ico.v{color:#a78bfa;background:rgba(139,92,246,.13);border-color:rgba(139,92,246,.35)}
    .ico.p{color:#f9a8d4;background:rgba(236,72,153,.13);border-color:rgba(236,72,153,.35)}
    .ico.o{color:#fdba74;background:rgba(249,115,22,.13);border-color:rgba(249,115,22,.35)}
    .ico.c{color:#67e8f9;background:rgba(34,211,238,.13);border-color:rgba(34,211,238,.35)}
    .ico.g{color:#6ee7b7;background:rgba(52,211,153,.13);border-color:rgba(52,211,153,.35)}
    .value{font-size:36px;font-weight:800;letter-spacing:-.035em;line-height:1;margin-top:16px;
      background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
    .value.ink{background:none;color:#fff}
    .value .num{font-variant-numeric:tabular-nums}
    .sub{font-size:12.5px;color:var(--muted);margin-top:9px;line-height:1.5}
    .chip-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}

    /* ── Charts ─────────────────────────────────────────── */
    .chart-container{position:relative;height:265px}
    .chart-container.short{height:238px}

    /* ── Ranks / meters ─────────────────────────────────── */
    .rank{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.055)}
    .rank:last-child{border-bottom:none;padding-bottom:2px}
    .rank .no{width:25px;height:25px;border-radius:8px;display:grid;place-items:center;font-size:11.5px;font-weight:800;
      background:var(--panel-2);color:var(--muted);flex:none}
    .rank:first-child .no{background:var(--grad);color:#fff;box-shadow:0 6px 16px -6px rgba(236,72,153,.7)}
    .rank .code{font-family:'JetBrains Mono',monospace;font-size:13px;color:#c9d3e6;text-decoration:none;transition:.2s}
    .rank .code:hover{color:#fff}
    .meter{flex:1;height:6px;min-width:54px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}
    .meter i{display:block;height:100%;border-radius:99px;background:var(--grad);transform-origin:left;
      animation:grow 1.1s cubic-bezier(.22,1,.36,1) both .25s}
    @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    .rank .n{font-variant-numeric:tabular-nums;font-weight:700;font-size:13px;min-width:58px;text-align:right;color:#fff}
    .empty{font-size:13px;color:var(--muted);padding:14px 0}

    /* ── Tag cloud ──────────────────────────────────────── */
    .cloud{display:flex;flex-wrap:wrap;gap:8px}
    .tag{display:inline-flex;align-items:baseline;gap:6px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.3);
      color:#c4b5fd;border-radius:10px;padding:5px 11px;font-weight:600;transition:.22s;cursor:default}
    .tag em{font-style:normal;font-size:10.5px;color:var(--muted);font-family:'JetBrains Mono',monospace}
    .tag:hover{transform:translateY(-2px);border-color:rgba(139,92,246,.65);box-shadow:0 8px 20px -10px rgba(139,92,246,.9)}
    .tag.mention{background:rgba(236,72,153,.1);border-color:rgba(236,72,153,.3);color:#f9a8d4}
    .tag.mention:hover{border-color:rgba(236,72,153,.65);box-shadow:0 8px 20px -10px rgba(236,72,153,.9)}

    /* ── Content mix ────────────────────────────────────── */
    .mix-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.055)}
    .mix-row:last-child{border-bottom:none}
    .mix-dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 12px currentColor}
    .mix-label{font-size:13.5px;color:#c9d3e6;min-width:82px}
    .mix-row b{font-size:14px;min-width:46px;text-align:right;color:#fff;font-variant-numeric:tabular-nums}

    /* ── Rings ──────────────────────────────────────────── */
    .ring-wrap{display:flex;align-items:center;gap:18px;margin-top:14px}
    .donut{width:118px;height:118px;transform:rotate(-90deg);flex:none}
    .donut circle{fill:none;stroke-width:10;stroke-linecap:round}
    .donut .track{stroke:rgba(255,255,255,.07)}
    .donut .prog{transition:stroke-dashoffset 1.5s cubic-bezier(.22,1,.36,1) .3s}
    .ring-pct{font-size:27px;font-weight:800;letter-spacing:-.03em;
      background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
    .ring-label{font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-top:6px}
    .ring-sub{font-size:12.5px;color:#aab3c5;margin-top:7px}

    /* ── Intel rows ─────────────────────────────────────── */
    .intel{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:15px}
    .intel-item{background:rgba(255,255,255,.04);border:1px solid var(--stroke);border-radius:14px;padding:14px 15px;transition:.25s}
    .intel-item:hover{border-color:var(--stroke-hi);background:rgba(255,255,255,.065)}
    .intel-item .k{display:flex;align-items:center;gap:7px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
    .intel-item .k svg{width:13px;height:13px}
    .intel-item .val{font-family:'JetBrains Mono',monospace;font-size:13.5px;color:#fff;margin-top:9px;word-break:break-all;line-height:1.5}
    .intel-item .val.none{color:#5b647a}

    /* ── Footer ─────────────────────────────────────────── */
    .footer{text-align:center;padding:26px 20px 6px;color:#4d5568;font-size:12px;line-height:1.9;
      border-top:1px solid var(--stroke);margin-top:44px}
    .footer a{color:#a78bfa;text-decoration:none}
    .footer a:hover{text-decoration:underline}
    .footer .brand{font-weight:700;color:#8b93a7;letter-spacing:.06em}
    .footer-meta{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:14px}
    .footer-meta span{font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--panel-2);
      border:1px solid var(--stroke);border-radius:8px;padding:5px 11px;color:var(--muted)}
    .footer-meta span b{color:#e8edf6;font-weight:600}

    /* ── Responsive ─────────────────────────────────────── */
    @media (max-width: 760px){
      .nav{order:3;width:100%;margin-left:0}
      .hero{padding:22px}
      .value{font-size:31px}
      .section-head .hint{display:none}
      .hero-info h2{font-size:23px}
    }
    @media (prefers-reduced-motion: reduce){
      *{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}
      html{scroll-behavior:auto}
    }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="bg-grid"></div>
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="orb orb-c"></div>

  <header class="topbar">
    <div class="topbar-inner">
      <div class="logo">${ICONS.pulse}</div>
      <div class="title">
        <h1>ig-analyzer</h1>
        <div class="sub">@${esc(username)} &middot; OSINT intelligence dashboard</div>
      </div>
      <nav class="nav">
        <a href="#overview" class="active">Overview</a>
        <a href="#engagement">Engagement</a>
        <a href="#activity">Activity</a>
        <a href="#content">Content</a>
        <a href="#network">Network</a>
        <a href="#intel">Intel</a>
      </nav>
      <div class="live"><span class="pulse"></span>LIVE</div>
    </div>
  </header>

  <main class="container">

    <!-- ── Subject profile ─────────────────────────────── -->
    <section class="section" id="overview">
      <div class="hero reveal">
        <div class="hero-inner">
          <div class="avatar">
            <div class="inner">${initial}</div>
            <span class="status-dot" title="Scraped"></span>
          </div>
          <div class="hero-info">
            <div class="hero-tags">
              <span class="chip subject">OSINT Subject</span>
              ${verifiedChip}
              ${privateChip}
            </div>
            <h2>${esc(profile?.name || username)}</h2>
            <div class="handle">@${esc(username)}</div>
            <p class="bio">${esc(profile?.bio || 'No bio recorded for this account.')}</p>
          </div>
          <div class="hero-stats">
            <div class="pill"><b>${cnt(profile?.posts)}</b><span>Posts</span></div>
            <div class="pill"><b>${cnt(profile?.followers)}</b><span>Followers</span></div>
            <div class="pill"><b>${cnt(profile?.following)}</b><span>Following</span></div>
            <div class="pill"><b>${cnt(posts.length)}</b><span>Analyzed</span></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Engagement ──────────────────────────────────── -->
    <section class="section" id="engagement">
      ${sectionHead('engagement', 'Engagement', num(engagement.postsAnalyzed || 0) + ' posts sampled', ICONS.target)}
      <div class="grid">
        <div class="card reveal">
          <div class="kpi-top"><h3>Engagement Rate</h3><span class="ico v">${ICONS.target}</span></div>
          <div class="value">${cnt(engagement.engagementRate, 2, '%')}</div>
          <div class="sub">Likes + comments per post vs. audience size</div>
          <div class="chip-row"><span class="chip">${num(engagement.postsAnalyzed)} posts analyzed</span></div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Total Likes</h3><span class="ico p">${ICONS.heart}</span></div>
          <div class="value">${cnt(engagement.totalLikes)}</div>
          <div class="sub">Cumulative across the analysed sample</div>
          <div class="chip-row"><span class="chip">avg ${num(engagement.avgLikes)} / post</span></div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Total Comments</h3><span class="ico o">${ICONS.comment}</span></div>
          <div class="value">${cnt(engagement.totalComments)}</div>
          <div class="sub">Discussion volume on recent posts</div>
          <div class="chip-row"><span class="chip">avg ${num(engagement.avgComments)} / post</span></div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Audience Ratio</h3><span class="ico c">${ICONS.users}</span></div>
          <div class="value">${cnt(network.followerFollowingRatio, 2)}</div>
          <div class="sub">Followers per account followed</div>
          <div class="chip-row"><span class="chip">${num(network.followerCount)} out &middot; ${num(network.followingCount)} in</span></div>
        </div>
      </div>
    </section>

    <!-- ── Activity ────────────────────────────────────── -->
    <section class="section" id="activity">
      ${sectionHead('activity', 'Activity Patterns', 'chronological signal', ICONS.chart)}
      <div class="grid">
        <div class="card full reveal">
          <div class="kpi-top"><h3>Likes per Post — last 30</h3><span class="ico v">${ICONS.chart}</span></div>
          <div class="chart-container" style="margin-top:14px"><canvas id="likesChart"></canvas></div>
        </div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card reveal">
          <div class="kpi-top"><h3>Posting Hour Distribution</h3><span class="ico c">${ICONS.clock}</span></div>
          <div class="chart-container short" style="margin-top:14px"><canvas id="hourChart"></canvas></div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Weekday Distribution</h3><span class="ico p">${ICONS.calendar}</span></div>
          <div class="chart-container short" style="margin-top:14px"><canvas id="dayChart"></canvas></div>
        </div>
      </div>
      <div class="grid" style="margin-top:16px">
        <div class="card reveal">
          <div class="kpi-top"><h3>Best Posting Time</h3><span class="ico o">${ICONS.clock}</span></div>
          <div class="value ink">${esc(posting.bestPostingHour || '\u2014')}</div>
          <div class="sub">Peak day: <strong style="color:#e8edf6">${esc(posting.bestPostingDay || '\u2014')}</strong></div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Post Frequency</h3><span class="ico v">${ICONS.calendar}</span></div>
          <div class="value">${cnt(posting.postsPerWeek, 2)}</div>
          <div class="sub">posts / week &middot; ${esc(posting.postsPerDay || '\u2014')} per day &middot; ${num(posting.daysActive)} days spanned</div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Account Age</h3><span class="ico c">${ICONS.id}</span></div>
          <div class="value">${cnt(account.estimatedAgeDays)}<span style="font-size:16px;font-weight:600"> days</span></div>
          <div class="sub">Earliest signal: ${esc((account.estimatedCreated || '').split('T')[0] || '\u2014')}</div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Content Mix</h3><span class="ico g">${ICONS.grid}</span></div>
          <div style="margin-top:8px">${mixRows}</div>
        </div>
      </div>
    </section>

    <!-- ── Content ─────────────────────────────────────── -->
    <section class="section" id="content">
      ${sectionHead('content', 'Content Intelligence', topHashtags.length + ' tags · ' + topMentions.length + ' mentions', ICONS.hash)}
      <div class="grid two">
        <div class="card reveal">
          <div class="kpi-top"><h3>Top Hashtags</h3><span class="ico v">${ICONS.hash}</span></div>
          <div class="cloud" style="margin-top:15px">${cloud(topHashtags, 'hash')}</div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Top Mentions</h3><span class="ico p">${ICONS.at}</span></div>
          <div class="cloud" style="margin-top:15px">${cloud(topMentions, 'at')}</div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Most Liked</h3><span class="ico p">${ICONS.heart}</span></div>
          <div style="margin-top:9px">${rankRows(mostLiked, 'likes')}</div>
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Most Commented</h3><span class="ico o">${ICONS.comment}</span></div>
          <div style="margin-top:9px">${rankRows(mostCommented, 'comments')}</div>
        </div>
      </div>
    </section>

    <!-- ── Network ─────────────────────────────────────── -->
    <section class="section" id="network">
      ${sectionHead('network', 'Network Verification', num(network.followerCount) + ' / ' + num(network.followingCount) + ' edges', ICONS.shield)}
      <div class="grid">
        <div class="card reveal">
          <div class="kpi-top"><h3>Verified Followers</h3><span class="ico v">${ICONS.shield}</span></div>
          ${ring(network.verifiedFollowers || 0, network.followerCount || 0, 'gradA', 'of follower base')}
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Verified Following</h3><span class="ico p">${ICONS.shield}</span></div>
          ${ring(network.verifiedFollowing || 0, network.followingCount || 0, 'gradB', 'of following list')}
        </div>
        <div class="card reveal">
          <div class="kpi-top"><h3>Ratio Breakdown</h3><span class="ico c">${ICONS.users}</span></div>
          <div class="value">${cnt(network.followerFollowingRatio, 2)}</div>
          <div class="sub">Followers ÷ following — anything above 1.0 indicates a reach-weighted account.</div>
          <div class="chip-row">
            <span class="chip">in: ${num(network.followingCount)}</span>
            <span class="chip">out: ${num(network.followerCount)}</span>
            <span class="chip">${num(network.verifiedFollowers)} verified out</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Intel ───────────────────────────────────────── -->
    <section class="section" id="intel">
      ${sectionHead('intel', 'Bio & Contact Intel', 'pattern-extracted', ICONS.mail)}
      <div class="grid">
        <div class="card full reveal">
          <div class="kpi-top"><h3>Extracted Indicators</h3><span class="ico g">${ICONS.zap}</span></div>
          <div class="intel">
            <div class="intel-item">
              <div class="k">${ICONS.mail} Email</div>
              <div class="val${bio.hasEmail ? '' : ' none'}">${bio.hasEmail ? esc(bio.email) : 'Not found'}</div>
            </div>
            <div class="intel-item">
              <div class="k">${ICONS.phone} Phone</div>
              <div class="val${bio.hasPhone ? '' : ' none'}">${bio.hasPhone ? esc(bio.phone) : 'Not found'}</div>
            </div>
            <div class="intel-item">
              <div class="k">${ICONS.link} External URL</div>
              <div class="val${bio.hasUrl ? '' : ' none'}">${bio.hasUrl ? esc(bio.url) : 'Not found'}</div>
            </div>
            <div class="intel-item">
              <div class="k">${ICONS.ruler} Bio Length</div>
              <div class="val">${num(bio.length)} characters</div>
            </div>
          </div>
          <div class="chip-row" style="margin-top:15px">
            <span class="chip">Profile scraped: ${esc((profile?.scrapedAt || '').split('T')[0] || '\u2014')}</span>
            <span class="chip">First post: ${esc((posting.earliestPost || '').split('T')[0] || '\u2014')}</span>
            <span class="chip">Last post: ${esc((posting.latestPost || '').split('T')[0] || '\u2014')}</span>
          </div>
        </div>
      </div>
    </section>

  </main>

  <div class="footer">
    <div class="footer-meta">
      <span>dataset <b>${esc(username)}</b></span>
      <span>posts <b>${num(posts.length)}</b></span>
      <span>followers <b>${num(followers?.length)}</b></span>
      <span>following <b>${num(following?.length)}</b></span>
      <span>build <b>v2.1.0</b></span>
    </div>
    <span class="brand">ig-analyzer v2.1.0</span> — Instagram OSINT Dashboard<br>
    Author: <a href="https://github.com/anurag-panda-dev">Anurag Panda</a> &middot;
    Data scraped: ${esc(profile?.scrapedAt?.split('T')[0] || '\u2014')}
  </div>

  <script>
  (function () {
    'use strict';

    /* ── Animated counters ─────────────────────────────── */
    function animateCount(el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
      var suf = el.getAttribute('data-suffix') || '';
      if (isNaN(target)) return;
      var dur = 1300, t0 = null;
      function fmt(v) {
        return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      }
      function step(now) {
        if (t0 === null) t0 = now;
        var p = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(target * e);
        if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
      }
      requestAnimationFrame(step);
    }

    /* ── Stagger + reveal on scroll ────────────────────── */
    document.querySelectorAll('.grid, .hero').forEach(function (group) {
      var i = 0;
      group.querySelectorAll(':scope > .reveal').forEach(function (el) {
        el.style.transitionDelay = Math.min(i * 75, 300) + 'ms';
        i++;
      });
    });

    if ('IntersectionObserver' in window) {
      var revealObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var el = en.target;
          el.classList.add('in');
          el.querySelectorAll('[data-count]').forEach(animateCount);
          el.querySelectorAll('[data-ring]').forEach(function (c) {
            c.style.strokeDashoffset = c.getAttribute('data-ring');
          });
          revealObs.unobserve(el);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      document.querySelectorAll('.reveal').forEach(function (el) { revealObs.observe(el); });

      /* ── Active nav pill ─────────────────────────────── */
      var links = document.querySelectorAll('.nav a');
      var navObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (l) {
            l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id);
          });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      document.querySelectorAll('.section').forEach(function (s) { navObs.observe(s); });
    } else {
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
      document.querySelectorAll('[data-ring]').forEach(function (c) {
        c.style.strokeDashoffset = c.getAttribute('data-ring');
      });
    }

    /* ── Pointer glow on cards ─────────────────────────── */
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    });

    /* ── Charts ────────────────────────────────────────── */
    if (typeof Chart === 'undefined') return;

    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#8b93a7';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

    var TIP = {
      backgroundColor: 'rgba(8,10,18,0.94)',
      borderColor: 'rgba(255,255,255,0.14)',
      borderWidth: 1,
      padding: 11,
      cornerRadius: 11,
      titleColor: '#ffffff',
      bodyColor: '#c9d3e6',
      displayColors: false,
      titleFont: { weight: '700', size: 12 },
      boxPadding: 5
    };

    function vGrad(chart, c1, c2) {
      var a = chart.chartArea;
      if (!a) return c1;
      var g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      return g;
    }
    function hGrad(chart, c1, c2) {
      var a = chart.chartArea;
      if (!a) return c1;
      var g = chart.ctx.createLinearGradient(a.left, 0, a.right, 0);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      return g;
    }

    var ax = {
      grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
      ticks: { color: '#7f879b', padding: 6, font: { size: 10.5 } },
      border: { display: false }
    };

    var likesEl = document.getElementById('likesChart');
    if (likesEl) {
      new Chart(likesEl, {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(labels)},
          datasets: [{
            label: 'Likes',
            data: ${JSON.stringify(likesData)},
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 26,
            hoverBackgroundColor: '#ec4899',
            backgroundColor: function (c) { return vGrad(c.chart, 'rgba(139,92,246,0.95)', 'rgba(139,92,246,0.12)'); }
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 1200, easing: 'easeOutQuart' },
          plugins: { legend: { display: false }, tooltip: TIP },
          scales: {
            x: Object.assign({}, ax, { ticks: { color: '#7f879b', maxRotation: 90, minRotation: 60, font: { size: 9.5, family: "'JetBrains Mono', monospace" }, autoSkip: true } }),
            y: Object.assign({}, ax, { ticks: { color: '#7f879b', padding: 8, callback: function (v) { return Number(v).toLocaleString(); } } })
          }
        }
      });
    }

    var hourEl = document.getElementById('hourChart');
    if (hourEl) {
      var hourData = ${JSON.stringify(postsByHour)};
      var hours = Array.from({ length: 24 }, function (_, i) { return i; });
      new Chart(hourEl, {
        type: 'line',
        data: {
          labels: hours.map(function (h) { return (h < 10 ? '0' + h : h) + ':00'; }),
          datasets: [{
            label: 'Posts',
            data: hours.map(function (h) { return hourData[h] || 0; }),
            borderColor: '#22d3ee',
            borderWidth: 2.4,
            tension: 0.42,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#22d3ee',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            fill: true,
            backgroundColor: function (c) { return vGrad(c.chart, 'rgba(34,211,238,0.34)', 'rgba(34,211,238,0)'); }
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 1400, easing: 'easeOutQuart' },
          plugins: { legend: { display: false }, tooltip: TIP },
          scales: {
            x: Object.assign({}, ax, { ticks: { color: '#7f879b', maxTicksLimit: 12, font: { size: 10, family: "'JetBrains Mono', monospace" } } }),
            y: Object.assign({}, ax, { ticks: { color: '#7f879b', stepSize: 1, padding: 8 }, beginAtZero: true })
          }
        }
      });
    }

    var dayEl = document.getElementById('dayChart');
    if (dayEl) {
      var dayData = ${JSON.stringify(postsByDay)};
      var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      var dayCenter = {
        id: 'dayCenter',
        afterDraw: function (chart) {
          var ds = chart.data.datasets[0].data;
          var total = ds.reduce(function (a, b) { return a + b; }, 0);
          var meta = chart.getDatasetMeta(0);
          if (!meta.data.length) return;
          var x = meta.data[0].x, y = meta.data[0].y, ctx = chart.ctx;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.font = '800 26px Inter, sans-serif';
          ctx.fillText(String(total), x, y - 7);
          ctx.fillStyle = '#8b93a7';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.fillText('POSTS', x, y + 15);
          ctx.restore();
        }
      };
      new Chart(dayEl, {
        type: 'doughnut',
        plugins: [dayCenter],
        data: {
          labels: days,
          datasets: [{
            data: days.map(function (d) { return dayData[d] || 0; }),
            backgroundColor: ['#8b5cf6', '#ec4899', '#f97316', '#22d3ee', '#34d399', '#facc15', '#60a5fa'],
            borderWidth: 0,
            hoverOffset: 10,
            spacing: 3
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '70%',
          animation: { animateRotate: true, duration: 1300, easing: 'easeOutQuart' },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7, padding: 14, color: '#9aa3b7', font: { size: 11.5 } }
            },
            tooltip: TIP
          }
        }
      });
    }
  })();
  </script>
</body>
</html>`;
}

// ── Server ─────────────────────────────────────────────────────────
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
