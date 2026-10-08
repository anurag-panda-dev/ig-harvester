<#
  Attaches Instagram to a DEDICATED Chrome profile with remote debugging enabled.

  Why a dedicated profile: since Chrome 136, --remote-debugging-port is ignored
  on the default profile. Using a separate profile also keeps your real Google
  session, cookies and passwords completely away from the scraper.

  Usage:
    .\dependencies\launch-chrome-debug.ps1
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'ig-profile',
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:LOCALAPPDATA $ProfileName
$chrome    = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" }
if (-not (Test-Path $chrome)) { $chrome = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" }
if (-not (Test-Path $chrome)) { $chrome = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }

if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Write-Host "Created dedicated profile at $profileDir" -ForegroundColor Cyan
}

if (-not $NoLaunch) {
  Write-Host "Launching: $chrome" -ForegroundColor DarkGray
  Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=9222",
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.instagram.com/accounts/login/'
  )
}

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 2 | Out-Null
    $ok = $true; break
  } catch { Start-Sleep -Milliseconds 700 }
}

if ($ok) {
  Write-Host ""
  Write-Host "CDP is live on http://127.0.0.1:9222" -ForegroundColor Green
  Write-Host "1. Log into a BURNER Instagram account in that window (2FA code from your phone)."
  Write-Host "2. Leave the window open."
  Write-Host "3. Then run:  node dependencies\scrape-ig.mjs --profile TARGETUSERNAME"
  Write-Host ""
  Write-Host "Verify with:  Invoke-RestMethod http://127.0.0.1:9222/json/version"
} else {
  Write-Host "Chrome did not expose port 9222. Close any running Chrome and retry." -ForegroundColor Red
}
