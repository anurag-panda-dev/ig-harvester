# ig-harvester — OSINT Guide

<p align="center">
  <b>Complete OSINT workflow guide for Instagram intelligence gathering.</b>
</p>

---

## Table of Contents

- [Workflow Overview](#workflow-overview)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Single Entry Point (ig-harvester.ps1)](#single-entry-point-ig-harvesterps1)
- [Output Structure](#output-structure)
- [Analytics](#analytics)
- [OSINT Techniques](#osint-techniques)
- [Data Enrichment](#data-enrichment)
- [Troubleshooting](#troubleshooting)
- [Legal & Ethical](#legal--ethical)

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OSINT Workflow                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Profile Analysis                                        │
│     ├── Bio, external URL, contact info                     │
│     ├── Follower/following counts                           │
│     └── Account age estimation                               │
│                                                             │
│  2. Content Harvesting                                      │
│     ├── Posts (caption, likes, comments, timestamp)         │
│     ├── Carousel media (all photos/videos)                  │
│     ├── Hashtags & mentions                                 │
│     └── Engagement metrics                                   │
│                                                             │
│  3. Network Mapping                                         │
│     ├── Follower list (all)                                 │
│     ├── Following list (all)                                │
│     ├── Verified accounts                                   │
│     └── Follower/following ratio                            │
│                                                             │
│  4. Comment Analysis                                        │
│     ├── Comment threads with replies                        │
│     ├── Comment like counts                                 │
│     ├── Top commenters                                      │
│     └── Sentiment indicators                                │
│                                                             │
│  5. Reporting                                               │
│     ├── JSON/CSV/SQLite export                              │
│     ├── Screenshots for evidence                            │
│     └── Analytics summary                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/anurag-panda-dev/ig-harvester.git
cd ig-harvester

# 2. One-click setup & run (Windows)
.\dependencies\start.ps1 --profile someuser --comments --followers --following

# Or manual:
npm install
.\dependencies\launch-chrome-debug.ps1
node dependencies/scrape-ig.mjs --profile someuser --posts 50 --comments --followers --following --sqlite
```

---

## CLI Reference

| Flag | Default | Description |
|---|---|---|
| `--profile <name>` | – | Target username |
| `--url <url>` | – | Full Instagram URL instead of username |
| `--posts N\|all` | `30` | Max posts to scrape - `all` (or `0`) = every post the grid serves |
| `--comments` | off | Harvest post comments with full threads |
| `--followers` | off | Harvest follower list (all) |
| `--following` | off | Harvest following list (all) |
| `--shots` | off | Capture screenshots |
| `--shot-only` | off | Screenshots only, no data |
| `--out DIR` | `out` | Output directory |
| `--cdp URL` | `http://127.0.0.1:9222` | Chrome CDP endpoint |
| `--headless` | off | Run headless (fallback Chromium) |
| `--proxy URL` | – | HTTP/SOCKS proxy |
| `--proxy-bypass` | – | Hosts to bypass proxy |
| `--config FILE` | – | JSON config file |
| `--sqlite` | off | Also write SQLite database |
| `--no-resume` | – | Disable resume cache |
| `--force` | off | `ig-images`: re-download files already on disk (redo a bad run) |
| `--delay-min N` | `900` | Min delay between requests (ms) |
| `--delay-max N` | `2600` | Max delay between requests (ms) |
| `--log-level` | `info` | `debug` / `info` / `warn` / `error` |
| `--json-log` | off | Structured JSON logging |

---

## Single Entry Point (ig-harvester.ps1)

Everything in this guide can be launched from one script. Run it bare for
the menu, or name the job directly:

```powershell
.\ig-harvester.ps1                               # interactive menu
.\ig-harvester.ps1 scrape someuser --posts 50     # one job + forwarded flags
.\ig-harvester.ps1 scrape someuser --posts all    # every post, no 30-post cap
.\ig-harvester.ps1 -Action Full -User someuser -Yes
.\ig-harvester.ps1 -Action Help                   # full reference
```

| Menu | `-Action` | Does |
|---|---|---|
| 1 Scrape | `Scrape` | JSON/CSV/SQLite harvest |
| 2 Images | `Images` | full-resolution PNGs |
| 3 Scrape+Images | `ScrapeImages` | both in one go (aliases `Both`, `Combo`) |
| 4 Report | `Report` | report + index (`-Reindex` = every profile) |
| 5 Analyze | `Analyze` | dashboard (`-Port`, default 8080) |
| 6 Archive | `Archive` | `out/<user>` → `IG-DATA` (+ report) |
| 7 Pipeline | `Full` | Scrape → Images → Archive with a step summary |
| 8 Browser | `Browser` | debug Chrome on port 9222 |
| 9 Setup | `Setup` | npm + Playwright Chromium + MCP config |
| 10 Doctor | `Doctor` | environment health check (alias `Status`) |
| 11 Tests | `Tests` | `npm run lint` + `npm test` |
| 12 Help | `Help` | CLI reference (also `-Help` / `-h`) |
| 0 Exit | - | leave the menu |

Working notes for the sections below:

- **Target once**: `-User someuser` (or positional), or a full `-Url` - in
  menu mode the target prompt comes first and is pre-filled with
  `-DefaultUser` (**anur.panda**).
- **Settings in menu mode**: right after the username you are walked through
  the run settings (posts - a number or `all` - comments, followers,
  following, screenshots, SQLite, re-download, headless, output dir), shown
  the session line and asked `Run ... with current settings? [Y/n]`.
- **Every flag passes through** in GNU form, including the equals shape:
  `--delay-min 1200 --json-log --no-resume --profile=someuser`.
- **`-DryRun`** previews the exact commands; **`-Yes`** answers every
  prompt with its default (CI / cron) and never opens a menu.
- **Exit codes**: `0` success · `1` step/preflight failed · `2` usage or
  cancelled input — safe to chain: `.\ig-harvester.ps1 -Action Scrape -User x -Yes; if ($LASTEXITCODE -ne 0) { exit 1 }`.

---

### Fewer posts than the profile claims?

Post links are read from the **profile grid**, so a run only returns what
Instagram serves to the session you are attached to:

| What you see | Why | What to do |
|---|---|---|
| exactly `30` posts, the header claims more | the default `--posts 30` cap | `--posts 500`, or `--posts all` for every post (`-Posts all` / `-AllPosts` in the harvester) |
| `12` / `24` / `36` posts | the grid stopped paginating (slow or gated layout) | re-run - the resume cache continues where it stopped - and read the `grid: N permalink(s) - <reason>` line, which names the exact stop reason |
| `0` posts plus `This account is private` | the logged-in session does not follow the target, or the follow is still pending (`Requested`) | attach Chrome logged in as the burner that already follows the account; a pending request serves nothing |
| `0` posts and no warning | the profile does not exist (or is blocked) | check the spelling and the account status |

Both entry points print `grid stopped early: N of M posts found` when the
profile header is higher than what the grid returned, and an explicit error
for the private wall, so a missing-post problem is always explained in the
log instead of showing up as a silent short list.

> **Private accounts**: a burner that already *follows* a private profile sees
> the same grid as any other follower. Only two things break that - the
> browser being logged into a different account, and the follow request not
> having been accepted yet. Always confirm consent before collecting data.

---

## Output Structure

All files saved inside a folder named after the username:

```
out/
  someuser/
    someuser.json             # Full payload + analytics
    someuser-posts.csv        # One row per post
    someuser-comments.csv     # One row per comment (--comments)
    someuser-followers.csv    # One row per follower (--followers)
    someuser-following.csv    # One row per following (--following)
    someuser.db               # SQLite database (--sqlite)
    screenshots/*.png         # Screenshots (--shots)
    images/*.png              # Post images (dependencies/ig-images.mjs)
    .cache.db                 # Resume cache (internal)
```

### JSON Structure

```json
{
  "profile": {
    "username": "someuser",
    "name": "Some User",
    "bio": "...",
    "posts": 123,
    "followers": 45678,
    "following": 89,
    "isPrivate": false,
    "isVerified": true,
    "externalUrl": "https://...",
    "scrapedAt": "2026-10-07T12:00:00.000Z",
    "_sources": { "headerRaw": {...}, "embeddedJson": {...} }
  },
  "posts": [
    {
      "shortcode": "ABC123",
      "url": "https://www.instagram.com/p/ABC123/",
      "type": "photo",
      "caption": "...",
      "likes": 1234,
      "views": null,
      "commentCount": 5,
      "timestamp": "2026-10-01T12:00:00.000Z",
      "location": "New York, NY",
      "isCarousel": true,
      "mediaCount": 5,
      "mediaItems": [
        { "type": "image", "url": "https://...", "thumbnail": "https://..." },
        { "type": "video", "url": "https://...", "thumbnail": "https://..." }
      ],
      "hashtags": ["DevProfile", "SystemsEngineer"],
      "mentions": ["friend1", "friend2"],
      "comments": [
        {
          "username": "user1",
          "text": "Nice post!",
          "likes": 5,
          "verified": false,
          "replies": [
            { "username": "user2", "text": "Thanks!", "likes": 2 }
          ]
        }
      ]
    }
  ],
  "followers": [{ "username": "user1", "name": "User One", "verified": false }],
  "following": [{ "username": "user2", "name": "User Two", "verified": true }],
  "analytics": { ... }
}
```

---

## Analytics

The scraper computes OSINT metrics automatically:

### Engagement Metrics
- Total likes and comments
- Average likes and comments per post
- Engagement rate (%)
- Posts analyzed

### Posting Patterns
- Earliest and latest post dates
- Days active
- Posts per day/week
- Best posting hour
- Best posting day

### Account Info
- Estimated creation date
- Estimated age in days

### Content Analysis
- Top 20 hashtags
- Top 20 mentioned users
- Most liked posts (top 5)
- Most commented posts (top 5)
- Carousel/reel/photo post counts

### Network Stats
- Follower/following counts
- Follower/following ratio
- Verified followers/following

### Bio Analysis
- Email detection
- Phone detection
- URL detection
- Bio length

---

## OSINT Techniques

### 1. Username Cross-Reference
```bash
# Check username against other platforms
# Use the followers/following lists to find connected accounts
```

### 2. Hashtag Analysis
- Identify trending hashtags in the target's posts
- Find related accounts using the same hashtags
- Track hashtag campaigns

### 3. Mention Network
- Map who the target tags most
- Identify close connections
- Find tagged posts from other users

### 4. Location Intelligence
- Extract location tags from posts
- Build a movement timeline
- Identify frequented locations

### 5. Engagement Analysis
- Identify peak engagement times
- Find the most engaging content type
- Detect potential bot activity (unusual engagement patterns)

### 6. Account Age & History
- Estimate account creation from earliest post
- Track posting frequency changes
- Identify dormant periods

---

## Data Enrichment

### Cross-Reference Ideas
- Check usernames against GitHub, Twitter, LinkedIn
- Search email addresses in data breaches
- Reverse image search profile pictures
- Geocode location tags

### Export for Analysis
```bash
# SQLite for SQL queries
sqlite3 out/someuser/someuser.db "SELECT * FROM posts ORDER BY likes DESC LIMIT 10;"

# CSV for spreadsheet analysis
# JSON for programmatic processing
```

---

## ig-images — Post Image Downloader

Standalone tool that saves every post image (each carousel slide too) as a
real PNG named after the post timestamp:

```text
someuser-2026-10-08-143022-01.png     single photo / first slide
someuser-2026-10-08-143022-02.png     second carousel slide
```

```bash
node dependencies/ig-images.mjs --profile someuser --posts 50
# -> out/someuser/images/*.png
```

- **Date/time** is the post timestamp in your local timezone
- **`01`..`NN`** is the carousel position, so ordering survives even when a
  slide is a video (video slides are saved as their poster frame — or a
  screenshot of the rendered slide when no poster exists)
- **Carousels are clicked through** — the tool presses the post's **Next**
  button slide by slide and reads each slide's full-resolution `<img>` from
  the DOM (the JSON sidecar source is no longer shipped in the page, and
  `og:image` would only ever be slide 1 at a cropped 640px)
- **Real PNGs** — converted with `jimp`; undecodable sources keep their
  original bytes and true extension
- **Resume** — files already on disk are skipped, so re-running continues
  where an interrupted run stopped; add **`--force`** to re-download
  everything (e.g. to replace files from an older broken run)
- Uses the shared flags (`--posts`, `--out`, `--cdp`, `--proxy`,
  `--delay-min/--delay-max`, `--log-level`) and collects nothing else

---

## ig-analyzer — Live OSINT Dashboard

After scraping, analyze the data with a live web dashboard:

```bash
# Auto-detect latest scraped user
node dependencies/ig-analyzer.mjs

# Specific user
node dependencies/ig-analyzer.mjs --user someuser

# Custom port
node dependencies/ig-analyzer.mjs --port 8080

# Custom data directory
node dependencies/ig-analyzer.mjs --dir out/someuser

# One-click (Windows)
.\dependencies\ig-analyzer.ps1
.\dependencies\ig-analyzer.ps1 --user someuser --port 8080
```

The dashboard opens at `http://localhost:8080` and includes:

- **Profile overview** — bio, stats, verified/private status
- **Engagement metrics** — rate, total/avg likes and comments
- **Charts** — likes per post, posts by hour, posts by day
- **Content analysis** — top hashtags, top mentions, most liked/commented posts
- **Posting patterns** — best time, frequency, account age
- **Network stats** — follower/following ratio, verified counts
- **Bio analysis** — email, phone, URL detection

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "No CDP endpoint" | Run `.\dependencies\launch-chrome-debug.ps1` first |
| "Not logged in" | Log into Instagram in the Chrome window |
| 429 / challenge | Increase `--delay-min` / `--delay-max` |
| Missing posts | Instagram lazy-loads; increase scroll wait |
| Selector failures | Instagram changed markup; check `_sources` in JSON |
| Proxy not working | Verify proxy URL format (`http://host:port`) |
| Followers not loading | Make sure the dialog opens; increase wait time |
| Comments missing | Instagram lazy-loads comments; try again with `--no-resume` |

---

## Legal & Ethical

- **Public data only** — don't scrape private accounts without consent
- **Rate limits** — the defaults are slow for a reason; don't lower them
- **GDPR/CCPA** — if you're processing data on EU/California residents, know your obligations
- **Terms of Service** — scraping Instagram violates their ToS; use at your own risk
- **Don't stalk** — this is for research, journalism, and security audits

---

## Architecture

```
ig-harvester.ps1            — single entry point: interactive menu + every action (root)
dependencies/
  scrape-ig.mjs             — entry point (scraper)
  ig-analyzer.mjs           — entry point (live OSINT dashboard)
  ig-images.mjs             — entry point (post image downloader)
  start.ps1                 — one-click setup & run (Windows)
  ig-analyzer.ps1           — one-click dashboard (Windows)
src/
  cli.mjs                  — orchestration
  images-cli.mjs           — orchestration (ig-images)
  config.mjs               — config loading (defaults < file < CLI)
  browser.mjs              — CDP attach, proxy, auth gate
  extractors/
    parser.mjs             — count/date/text parsing
    json-miner.mjs         — Relay JSON mining (carousels, threads, media)
    dom.mjs                — semantic DOM scraping
  scraper/
    profile.mjs            — profile header
    posts.mjs              — post scraping with resume
    users.mjs              — follower/following lists (unlimited)
    analytics.mjs          — OSINT metrics
    screenshot.mjs         — screenshots
    images.mjs             — post image download, PNG naming/conversion
  storage/
    cache.mjs              — SQLite cache (resume)
    output.mjs             — JSON/CSV/SQLite writers
  utils/
    logger.mjs             — structured logging
    retry.mjs              — exponential backoff
    rate-limit.mjs         — token bucket + human delay
    progress.mjs           — progress bar
```

---

## Testing

```powershell
npm test
```

Runs unit tests for parsers (count parsing, timestamps, URL extraction), the
JSON media miner (carousel sidecar children — order-independent field
parsing), and the `ig-images` filename/format helpers. An offline
end-to-end check of the image downloader lives in `tests/images.e2e.mjs` —
run it with `node tests/images.e2e.mjs` (launches a local page, no network);
it includes a carousel that is clicked through slide by slide.

`tests/live-probe.mjs` is a diagnostic that attaches to the debug Chrome and
walks real Instagram posts, printing each slide it collects — useful when
Instagram changes the page and the selectors need re-checking.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE). Use responsibly.

---

## Credits

- **Author:** [Anurag Panda](https://github.com/anurag-panda-dev)
- **Inspired by:** Sherlock, Recon-ng, the OSINT community
