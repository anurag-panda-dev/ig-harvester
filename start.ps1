<#
  ig-harvester — Instagram OSINT Collector
  ========================================
  A production-ready Playwright-based Instagram scraper that drives your own
  logged-in Chrome via CDP. Reads the rendered page (not raw HTTP), so it
  survives Instagram's JS app, infinite scroll, and login wall.

  Author      : Anurag Panda
  GitHub      : https://github.com/anurag-panda-dev/ig-harvester
  License     : MIT
  Version     : 2.0.0

  Usage:
    .\start.ps1
    .\start.ps1 --profile someuser --comments --followers --following
    .\start.ps1 --profile someuser --posts 50 --sqlite --proxy http://127.0.0.1:8080

  Requirements:
    - Node.js >= 20
    - Chrome (system)
    - A burner Instagram account (logged in manually)
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ScrapeArgs
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ── Banner ────────────────────────────────────────────────────────
$banner = @"
  ==============================================================================
  |                                                                            |
  |   ___ ____       _   _    _    ______     _______ ____ _____ _____ ____    |
  |  |_ _/ ___|     | | | |  / \  |  _ \ \   / / ____/ ___|_   _| ____|  _ \   |
  |   | | |  _ _____| |_| | / _ \ | |_) \ \ / /|  _| \___ \ | | |  _| | |_) |  |
  |   | | |_| |_____|  _  |/ ___ \|  _ < \ V / | |___ ___) || | | |___|  _ <   |
  |  |___\____|     |_| |_/_/   \_\_| \_\ \_/  |_____|____/ |_| |_____|_| \_\  |
  |                                                                            |
  |                    Instagram OSINT Collector v2.0.0                        |
  |                                                                            |
  ==============================================================================
"@

Write-Host $banner -ForegroundColor Cyan
Write-Host ""
Write-Host "  Author      : Anurag Panda" -ForegroundColor White
Write-Host "  GitHub      : https://github.com/anurag-panda-dev/ig-harvester" -ForegroundColor White
Write-Host "  License     : MIT" -ForegroundColor White
Write-Host "  Version     : 2.0.0" -ForegroundColor White
Write-Host ""
Write-Host "  Description : Playwright-based Instagram scraper with CDP attach," -ForegroundColor Gray
Write-Host "                triple-source extraction, resume caching, proxy" -ForegroundColor Gray
Write-Host "                support, and modular architecture." -ForegroundColor Gray
Write-Host ""
Write-Host "  Requirements: Node.js >= 20, Chrome, burner Instagram account" -ForegroundColor Gray
Write-Host ""
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Check Node.js ──────────────────────────────────────────────
Write-Host "[1/5] Checking Node.js..." -ForegroundColor Yellow
try {
  $nodeVer = node --version
  Write-Host "  [OK] Node.js $nodeVer" -ForegroundColor Green
} catch {
  Write-Host "  [FAIL] Node.js not found!" -ForegroundColor Red
  Write-Host "  Install from: https://nodejs.org/" -ForegroundColor Yellow
  Write-Host "  Then re-run this script." -ForegroundColor Yellow
  exit 1
}

# ── 2. Check Chrome ───────────────────────────────────────────────
Write-Host "[2/5] Checking Chrome..." -ForegroundColor Yellow
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Host "  [FAIL] Chrome not found!" -ForegroundColor Red
  Write-Host "  Install from: https://www.google.com/chrome/" -ForegroundColor Yellow
  Write-Host "  Then re-run this script." -ForegroundColor Yellow
  exit 1
}
Write-Host "  [OK] Chrome: $chrome" -ForegroundColor Green

# ── 3. Install dependencies ───────────────────────────────────────
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
  npm install --silent
  Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
} else {
  Write-Host "  [OK] Dependencies already present" -ForegroundColor Green
}

# ── 4. Launch Chrome with debugging ───────────────────────────────
Write-Host "[4/5] Launching Chrome with debugging..." -ForegroundColor Yellow
$profileDir = Join-Path $env:LOCALAPPDATA 'ig-profile'
if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

# Check if Chrome is already running with debugging
$cdpUp = $false
try {
  Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 2 | Out-Null
  $cdpUp = $true
  Write-Host "  [OK] Chrome debugging already running" -ForegroundColor Green
} catch {
  # Launch Chrome
  Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=9222",
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.instagram.com/accounts/login/'
  )
  Write-Host "  [WAIT] Chrome launched - waiting for debugger..." -ForegroundColor Yellow

  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 2 | Out-Null
      $cdpUp = $true
      break
    } catch { Start-Sleep -Milliseconds 700 }
  }

  if (-not $cdpUp) {
    Write-Host "  [FAIL] Chrome debugger did not start!" -ForegroundColor Red
    Write-Host "  Close all Chrome windows and retry." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "  [OK] Chrome debugger ready" -ForegroundColor Green
}

# ── 5. Run scraper ────────────────────────────────────────────────
Write-Host "[5/5] Running scraper..." -ForegroundColor Green
Write-Host ""
Write-Host "  [!] Log into Instagram in the Chrome window if prompted." -ForegroundColor Yellow
Write-Host "  [!] The scraper will wait up to 5 minutes." -ForegroundColor Yellow
Write-Host ""

$allArgs = @('scrape-ig.mjs') + $ScrapeArgs
& node @allArgs

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host "  Done! Check the out/ folder." -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host ""
