```text
  ___ ____       _   _    _    ______     _______ ____ _____ _____ ____  
 |_ _/ ___|     | | | |  / \  |  _ \ \   / / ____/ ___|_   _| ____|  _ \ 
  | | |  _ _____| |_| | / _ \ | |_) \ \ / /|  _| \___ \ | | |  _| | |_) |
  | | |_| |_____|  _  |/ ___ \|  _ < \ V / | |___ ___) || | | |___|  _ < 
 |___\____|     |_| |_/_/   \_\_| \_\ \_/  |_____|____/ |_| |_____|_| \_\
```

# ig-harvester

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20-orange.svg" alt="Node">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
</p>

<p align="center">
  <b>Instagram OSINT Collector</b><br>
  A production-ready Playwright-based Instagram scraper that drives your own logged-in Chrome via CDP.
</p>

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [CLI Flags](#cli-flags)
- [Output](#output)
- [Analytics](#analytics)
- [ig-analyzer — Live Dashboard](#ig-analyzer--live-dashboard)
- [Architecture](#architecture)
- [Docker](#docker)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)
- [Disclaimer](#disclaimer)

---

## Features

| Feature | Description |
|---|---|
| **Triple-source extraction** | Embedded Relay JSON + semantic DOM + screenshots |
| **Carousel/sidecar posts** | Extracts all photos/videos in multi-media posts |
| **Comment threads** | Full reply threads with like counts |
| **Media URLs** | All image/video URLs (filters out profile pictures) |
| **Hashtags & mentions** | Extracted from captions |
| **Resume support** | SQLite cache by shortcode; interrupted runs pick up where they left off |
| **Proxy support** | HTTP/SOCKS5 proxies for operational security |
| **Multiple output formats** | JSON, CSV, and SQLite |
| **Analytics** | Engagement metrics, posting patterns, network stats, content analysis |
| **Structured logging** | Levels, JSON mode, child loggers |
| **Retry with backoff** | Exponential backoff on transient failures |
| **Docker support** | Containerized deployment |
| **Modular architecture** | Clean separation of concerns |
| **Unit tested** | Parser tests included |

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Chrome](https://www.google.com/chrome/) (system)
- A burner Instagram account

### One-click (Windows)

```powershell
.\start.ps1 --profile someuser --comments --followers --following
```

### Manual

```bash
git clone https://github.com/anurag-panda-dev/ig-harvester.git
cd ig-harvester
npm install
```

---

## Quick Start

```bash
# 1. Launch Chrome with debugging (dedicated profile)
.\launch-chrome-debug.ps1

# 2. Log into a BURNER Instagram account in that window

# 3. Scrape
node scrape-ig.mjs --profile someuser --posts 50 --comments --followers --following --sqlite
```

---

## Usage

```powershell
# Basic
node scrape-ig.mjs --profile someuser

# Full OSINT harvest
node scrape-ig.mjs --profile someuser --posts 50 --comments --followers --following --sqlite

# With proxy
node scrape-ig.mjs --profile someuser --proxy http://127.0.0.1:8080

# Config file
node scrape-ig.mjs --config config.json

# Screenshots only
node scrape-ig.mjs --profile someuser --shots-only

# Analyze scraped data (live dashboard)
node ig-analyzer.mjs
node ig-analyzer.mjs --user someuser --port 8080

# Docker
docker build -t ig-harvester .
docker run -v $(pwd)/out:/app/out ig-harvester --profile someuser --comments
```

---

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--profile <name>` | – | Target username |
| `--url <url>` | – | Full Instagram URL |
| `--posts N` | `30` | Max posts to scrape |
| `--comments` | off | Harvest post comments with threads |
| `--followers` | off | Harvest follower list (all) |
| `--following` | off | Harvest following list (all) |
| `--shots` | off | Capture screenshots |
| `--out DIR` | `out` | Output directory |
| `--cdp URL` | `http://127.0.0.1:9222` | Chrome CDP endpoint |
| `--headless` | off | Run headless |
| `--proxy URL` | – | HTTP/SOCKS proxy |
| `--config FILE` | – | JSON config file |
| `--sqlite` | off | Also write SQLite database |
| `--no-resume` | – | Disable resume cache |
| `--delay-min N` | `900` | Min delay (ms) |
| `--delay-max N` | `2600` | Max delay (ms) |
| `--log-level` | `info` | `debug` / `info` / `warn` / `error` |
| `--json-log` | off | Structured JSON logging |

---

## Output

All files saved inside a folder named after the username:

```
out/
  someuser/
    someuser.json             # Full payload + analytics
    someuser-posts.csv        # One row per post
    someuser-comments.csv     # One row per comment
    someuser-followers.csv    # One row per follower
    someuser-following.csv    # One row per following
    someuser.db               # SQLite database (--sqlite)
    screenshots/*.png         # Screenshots (--shots)
    .cache.db                 # Resume cache (internal)
```

---

## Analytics

The scraper computes OSINT metrics automatically:

```json
{
  "analytics": {
    "engagement": {
      "totalLikes": 1234,
      "totalComments": 56,
      "avgLikes": 45,
      "avgComments": 2,
      "engagementRate": "1.23%",
      "postsAnalyzed": 30
    },
    "posting": {
      "earliestPost": "2024-01-01T00:00:00.000Z",
      "latestPost": "2026-10-07T00:00:00.000Z",
      "daysActive": 1000,
      "postsPerDay": "0.03",
      "postsPerWeek": "0.21",
      "bestPostingHour": "18:00",
      "bestPostingDay": "Saturday"
    },
    "account": {
      "estimatedCreated": "2024-01-01T00:00:00.000Z",
      "estimatedAgeDays": 1000
    },
    "content": {
      "topHashtags": [{ "tag": "DevProfile", "count": 5 }],
      "topMentions": [{ "user": "friend1", "count": 3 }],
      "mostLiked": [{ "shortcode": "ABC123", "likes": 500, "url": "..." }],
      "mostCommented": [{ "shortcode": "DEF456", "comments": 50, "url": "..." }],
      "carouselPosts": 10,
      "reelPosts": 5,
      "photoPosts": 15
    },
    "network": {
      "followerCount": 299,
      "followingCount": 925,
      "followerFollowingRatio": "0.32",
      "verifiedFollowers": 2,
      "verifiedFollowing": 5
    },
    "bio": {
      "hasEmail": true,
      "email": "user@example.com",
      "hasPhone": false,
      "phone": null,
      "hasUrl": true,
      "url": "https://example.com",
      "length": 150
    }
  }
}
```

---

## ig-analyzer — Live Dashboard

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

| Section | What it shows |
|---|---|
| **Profile overview** | Bio, stats, verified/private badges |
| **Engagement metrics** | Rate, total/avg likes, comments |
| **Charts** | Likes per post, posts by hour, posts by day |
| **Content analysis** | Top hashtags, top mentions, most liked/commented |
| **Posting patterns** | Best time, frequency, account age |
| **Network stats** | Follower/following ratio, verified counts |
| **Bio analysis** | Email, phone, URL detection |

---

## Architecture

```
scrape-ig.mjs              — entry point (scraper)
ig-analyzer.mjs            — entry point (live OSINT dashboard)
start.ps1                  — one-click setup & run (Windows)
ig-analyzer.ps1            — one-click dashboard (Windows)
src/
  cli.mjs                  — orchestration
  config.mjs               — config loading
  browser.mjs              — CDP attach, proxy, auth
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

## Docker

```bash
# Build
docker build -t ig-harvester .

# Run
docker run -v $(pwd)/out:/app/out ig-harvester --profile someuser --comments

# Compose
docker compose run ig-harvester --profile someuser --comments --followers
```

---

## Testing

```powershell
npm test
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

- **Author:** [Anurag Panda](https://github.com/anurag-panda-dev)
- **Inspired by:** Sherlock, Recon-ng, the OSINT community

---

## Disclaimer

This tool is intended for legitimate OSINT research, journalism, security audits, and educational purposes only. Users are responsible for complying with all applicable laws and regulations, respecting Instagram's Terms of Service, and protecting privacy rights (GDPR, CCPA, etc.). The author assumes no liability for misuse of this software.
