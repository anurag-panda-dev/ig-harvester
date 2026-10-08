<#
  Installs dependencies and wires up the MCP config so an AI agent
  (OpenCode / Claude Code / Cursor) can drive the same browser directly.
#>
[CmdletBinding()]
param([switch]$SkipBrowser)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)   # repository root (this script lives in dependencies\)

Write-Host "`n[1/3] npm install" -ForegroundColor Cyan
npm install --silent

if ($SkipBrowser) {
  Write-Host "[2/3] skipped (-SkipBrowser)" -ForegroundColor Cyan
} else {
  Write-Host "[2/3] Playwright Chromium" -ForegroundColor Cyan
  npx playwright install chromium
}

Write-Host "[3/3] Merging MCP config" -ForegroundColor Cyan

$cfgDir  = Join-Path $env:APPDATA 'opencode'
$portable = Join-Path $env:USERPROFILE '.config\opencode\opencode.json'
$target  = if (Test-Path (Join-Path $cfgDir 'opencode.json')) { Join-Path $cfgDir 'opencode.json' }
           elseif (Test-Path $portable) { $portable }
           else { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null; Join-Path $cfgDir 'opencode.json' }

$json = @{}
if (Test-Path $target) {
  try { $json = Get-Content $target -Raw | ConvertFrom-Json -AsHashtable } catch { $json = @{} }
}
if (-not $json.ContainsKey('mcp')) { $json['mcp'] = @{} }

if (-not $json['mcp'].ContainsKey('playwright')) {
  $json['mcp']['playwright'] = @{
    type        = 'local'
    command     = @('npx', '-y', '@playwright/mcp@latest')
    enabled     = $true
    environment = @{ PLAYWRIGHT_BROWSER = 'chrome' }
  }
  Write-Host "  added 'playwright' MCP server" -ForegroundColor Green
} else {
  Write-Host "  'playwright' already present, left untouched" -ForegroundColor DarkGray
}

$json | ConvertTo-Json -Depth 12 | Set-Content $target -Encoding utf8
Write-Host "  config: $target" -ForegroundColor DarkGray

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  .\dependencies\launch-chrome-debug.ps1         # log in once"
Write-Host "  node dependencies\scrape-ig.mjs --profile TARGET --comments --followers --following"
Write-Host ""
