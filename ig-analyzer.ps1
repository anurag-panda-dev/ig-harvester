<#
  ig-analyzer — Instagram OSINT Dashboard
  ========================================
  Reads scraped data from out/<username>/ and starts a live web server
  with a high-level analyzed dashboard for OSINT reporting.

  Author      : Anurag Panda
  GitHub      : https://github.com/anurag-panda-dev/ig-harvester
  License     : MIT
  Version     : 2.0.0

  Usage:
    .\ig-analyzer.ps1
    .\ig-analyzer.ps1 --user someuser
    .\ig-analyzer.ps1 --port 8080
    .\ig-analyzer.ps1 --dir out/someuser

  Requirements:
    - Node.js >= 20
    - Scraped data in out/ (run ig-harvester first)
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Alias('u')]
  [string]$User,

  [Alias('p')]
  [int]$Port = 8080,

  [Alias('d')]
  [string]$Dir,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

# Parse any double-dashed flags or positional arguments passed in $RemainingArgs
if ($RemainingArgs) {
  for ($i = 0; $i -lt $RemainingArgs.Count; $i++) {
    $arg = $RemainingArgs[$i]
    switch -Regex ($arg) {
      '^--?u(ser)?$' {
        if ($i + 1 -lt $RemainingArgs.Count) { $User = $RemainingArgs[++$i] }
      }
      '^--?p(ort)?$' {
        if ($i + 1 -lt $RemainingArgs.Count) { $Port = [int]$RemainingArgs[++$i] }
      }
      '^--?d(ir)?$' {
        if ($i + 1 -lt $RemainingArgs.Count) { $Dir = $RemainingArgs[++$i] }
      }
      '^--?u(ser)?=(.+)$' {
        $User = $Matches[2]
      }
      '^--?p(ort)?=(.+)$' {
        $Port = [int]$Matches[2]
      }
      '^--?d(ir)?=(.+)$' {
        $Dir = $Matches[2]
      }
      default {
        if (-not $User -and -not $arg.StartsWith('-')) {
          $User = $arg
        }
      }
    }
  }
}

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
  |                      Instagram OSINT Dashboard v2.0.0                      |
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
Write-Host "  Description : Live OSINT dashboard for scraped Instagram data" -ForegroundColor Gray
Write-Host "                with engagement metrics, charts, and analytics." -ForegroundColor Gray
Write-Host ""
Write-Host "  Requirements: Node.js >= 20, scraped data in out/" -ForegroundColor Gray
Write-Host ""
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Check Node.js ──────────────────────────────────────────────
Write-Host "[1/3] Checking Node.js..." -ForegroundColor Yellow
try {
  $nodeVer = node --version
  Write-Host "  [OK] Node.js $nodeVer" -ForegroundColor Green
} catch {
  Write-Host "  [FAIL] Node.js not found!" -ForegroundColor Red
  Write-Host "  Install from: https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

# ── 2. Check data ─────────────────────────────────────────────────
Write-Host "[2/3] Checking scraped data..." -ForegroundColor Yellow
$outDir = Join-Path $PSScriptRoot 'out'
if (-not (Test-Path $outDir)) {
  Write-Host "  [FAIL] No out/ directory found!" -ForegroundColor Red
  Write-Host "  Run ig-harvester first: .\start.ps1 --profile someuser" -ForegroundColor Yellow
  exit 1
}

$users = Get-ChildItem -Path $outDir -Directory -ErrorAction SilentlyContinue
if (-not $users) {
  Write-Host "  [FAIL] No scraped data found in out/" -ForegroundColor Red
  Write-Host "  Run ig-harvester first: .\start.ps1 --profile someuser" -ForegroundColor Yellow
  exit 1
}

Write-Host "  [OK] Found $($users.Count) scraped user(s): $($users.Name -join ', ')" -ForegroundColor Green

# ── 3. Start analyzer ─────────────────────────────────────────────
Write-Host "[3/3] Starting ig-analyzer..." -ForegroundColor Green
Write-Host ""

# Build arguments
$analyzerArgs = @('ig-analyzer.mjs')
if ($User) { $analyzerArgs += "--user", $User }
if ($Port -ne 8080) { $analyzerArgs += "--port", $Port }
if ($Dir) { $analyzerArgs += "--dir", $Dir }

Write-Host "  Dashboard will open at http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

& node @analyzerArgs
