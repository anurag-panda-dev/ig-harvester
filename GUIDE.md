# ig-harvester — OSINT Guide

<p align="center">
  <b>Complete OSINT workflow guide for Instagram intelligence gathering.</b>
</p>

---

## Table of Contents

- [Workflow Overview](#workflow-overview)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
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
.\start.ps1 --profile someuser --comments --followers --following

# Or manual:
npm install
.\launch-chrome-debug.ps1
node scrape-ig.mjs --profile someuser --posts 50 --comments --followers --following --sqlite
```

---

## CLI Reference

| Flag | Default | Description |
|---|---|---|
| `--profile <name>` | – | Target username |
| `--url <url>` | – | Full Instagram URL instead of username |
| `--posts N` | `30` | Max posts to scrape |
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
| `--delay-min N` | `900` | Min delay between requests (ms) |
| `--delay-max N` | `2600` | Max delay between requests (ms) |
| `--log-level` | `info` | `debug` / `info` / `warn` / `error` |
| `--json-log` | off | Structured JSON logging |

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

## ig-analyzer — Live OSINT Dashboard

After scraping, analyze the data with a live web dashboard:

```bash
# Auto-detect latest scraped user
node ig-analyzer.mjs

# Specific user
node ig-analyzer.mjs --user someuser

# Custom port
node ig-analyzer.mjs --port 8080

# Custom data directory
node ig-analyzer.mjs --dir out/someuser

# One-click (Windows)
.\ig-analyzer.ps1
.\ig-analyzer.ps1 --user someuser --port 8080
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
| "No CDP endpoint" | Run `.\launch-chrome-debug.ps1` first |
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
scrape-ig.mjs              — entry point (scraper)
ig-analyzer.mjs            — entry point (live OSINT dashboard)
start.ps1                  — one-click setup & run (Windows)
ig-analyzer.ps1            — one-click dashboard (Windows)
src/
  cli.mjs                  — orchestration
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

Runs unit tests for parsers (count parsing, timestamps, URL extraction).

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
