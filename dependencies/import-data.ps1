<#
  import-data.ps1 - archive scraped runs into IG-DATA
  ====================================================
  Copies an ig-harvester scrape folder into a structured, browsable archive
  and regenerates the analysis reports and master index.

  Layout created:

    00_TOOLS\IG-DATA\
      INDEX.md                     master index of every profile
      index.json                   machine-readable index
      <username>\
        README.md                  short profile card + links
        latest\                    always the newest import (read this)
          images\                  post images - the ONLY copy (see below)
        runs\2026-10-08_143012\    dated snapshot, never rewritten
        analysis\
          report.md                full OSINT report
          analytics.json           machine-readable metrics

    Tables and screenshots are copied into every snapshot. Post images are
    NOT: the media archive is written once to latest\images\, so importing
    a profile with a few GB of PNGs never duplicates them into each dated
    run. If the source carries no images\ folder, the media archive already
    in latest\images\ is preserved instead of being deleted.

    The report matches image filenames back to post timestamps and lists
    any posts missing media.

  Author      : Anurag Panda
  GitHub      : https://github.com/anurag-panda-dev/ig-harvester
  License     : MIT
  Version     : 2.0.0

  Usage:
    .\dependencies\import-data.ps1 --source out/someuser
    .\dependencies\import-data.ps1 --source out/someuser/
    .\dependencies\import-data.ps1 --source out/someuser --no-report
    .\dependencies\import-data.ps1 --root D:\00_TOOLS\IG-DATA --source out/someuser
    .\dependencies\import-data.ps1 --reindex

  Requirements:
    - Node.js >= 20   (only for report/index generation; use -NoReport to skip)
    - Scraped data in out/ (run .\dependencies\start.ps1 first)
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Alias('s')]
  [string]$Source,

  [Alias('r')]
  [string]$Root,

  [switch]$NoReport,

  [switch]$Reindex,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

# Accept GNU-style "--source out/foo" whether or not PowerShell binds it
# to the declared parameter above.
if ($RemainingArgs) {
  for ($i = 0; $i -lt $RemainingArgs.Count; $i++) {
    $arg = $RemainingArgs[$i]
    switch -Regex ($arg) {
      '^--?s(ource)?$'      { if ($i + 1 -lt $RemainingArgs.Count) { $Source = $RemainingArgs[++$i] } }
      '^--?r(oot)?$'        { if ($i + 1 -lt $RemainingArgs.Count) { $Root   = $RemainingArgs[++$i] } }
      '^--?no-?report$'     { $NoReport = $true }
      '^--?reindex$'        { $Reindex  = $true }
      '^--?s(ource)?=(.+)$' { $Source = $Matches[2] }
      '^--?r(oot)?=(.+)$'   { $Root   = $Matches[2] }
      default               { if (-not $Source -and -not $arg.StartsWith('-')) { $Source = $arg } }
    }
  }
}

$ErrorActionPreference = 'Stop'

# -- Paths --------------------------------------------------------
function Resolve-Absolute([string]$p) {
  if ([System.IO.Path]::IsPathRooted($p)) { return [System.IO.Path]::GetFullPath($p) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $p))
}

$ToolRoot = Split-Path -Parent $PSScriptRoot                     # repository root (script lives in dependencies\)
$DataRoot = if ($Root) { Resolve-Absolute $Root }
            else { Join-Path (Split-Path -Parent $ToolRoot) 'IG-DATA' }  # D:\00_TOOLS\IG-DATA

function Fail([string]$msg, [string]$hint) {
  Write-Host "  [FAIL] $msg" -ForegroundColor Red
  if ($hint) { Write-Host "  $hint" -ForegroundColor Yellow }
  exit 1
}

function Format-Size([long]$bytes) {
  if ($bytes -ge 1GB) { return '{0:N2} GB' -f ($bytes / 1GB) }
  if ($bytes -ge 1MB) { return '{0:N1} MB' -f ($bytes / 1MB) }
  if ($bytes -ge 1KB) { return '{0:N0} KB' -f ($bytes / 1KB) }
  return "$bytes B"
}

# -- Banner -------------------------------------------------------
Write-Host ''
Write-Host '  ig-harvester :: import-data  -  archive scraper output into IG-DATA' -ForegroundColor Cyan
Write-Host '  ==================================================================' -ForegroundColor DarkGray
Write-Host "  Source : $(if ($Source) { $Source } else { '(none)' })" -ForegroundColor White
Write-Host "  Target : $DataRoot" -ForegroundColor White
Write-Host ''

# -- Reindex-only mode --------------------------------------------
if ($Reindex -and -not $Source) {
  Write-Host '[1/1] Rebuilding index...' -ForegroundColor Yellow
  if (-not (Test-Path $DataRoot)) { Fail "No archive at $DataRoot" }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js not found' 'Install from https://nodejs.org/' }
  & node (Join-Path $ToolRoot 'dependencies\report.mjs') --root $DataRoot
  if ($LASTEXITCODE -ne 0) { Fail 'report.mjs failed' }
  Write-Host "  [OK] $DataRoot\INDEX.md" -ForegroundColor Green
  exit 0
}

if (-not $Source) {
  Fail 'Need --source out/<username>/' 'Example: .\dependencies\import-data.ps1 --source out/someuser'
}

# -- 1. Resolve source --------------------------------------------
Write-Host '[1/5] Resolving source...' -ForegroundColor Yellow
$resolved = $null
try { $resolved = (Resolve-Path -LiteralPath $Source -ErrorAction Stop).Path } catch { }
if (-not $resolved) { Fail "Source not found: $Source" 'Run .\dependencies\start.ps1 --profile <user> first.' }

$srcItem = Get-Item -LiteralPath $resolved
if (-not $srcItem.PSIsContainer) { Fail "Source is not a folder: $resolved" }

$srcDir = $srcItem.FullName
$user = Split-Path $srcDir -Leaf
$user = $user -replace '[^\w.-]', '_'
if (-not $user) { Fail "Could not derive a username from $srcDir" }
Write-Host "  [OK] $srcDir  ->  @$(Split-Path $srcDir -Leaf)" -ForegroundColor Green

# -- 2. Validate scrape output ------------------------------------
Write-Host '[2/5] Validating scrape output...' -ForegroundColor Yellow

$items = @(Get-ChildItem -LiteralPath $srcDir -Force)
if ($items.Count -eq 0) { Fail "Source folder is empty: $srcDir" }

$jsonPath = Join-Path $srcDir "$user.json"
if (-not (Test-Path -LiteralPath $jsonPath)) {
  $alt = Get-ChildItem -LiteralPath $srcDir -Filter '*.json' -File -Force | Select-Object -First 1
  if ($alt) { $jsonPath = $alt.FullName }
  else {
    Fail "No <username>.json in $srcDir" 'The scrape did not complete. Run: .\dependencies\start.ps1 --profile <user>'
  }
}

$captured = @()
foreach ($f in @('-posts.csv', '-comments.csv', '-followers.csv', '-following.csv', '.db')) {
  $n = "$user$f"
  if (Test-Path -LiteralPath (Join-Path $srcDir $n)) { $captured += $n }
}
$shotCount = 0
$shotDir = Join-Path $srcDir 'screenshots'
if (Test-Path -LiteralPath $shotDir) { $shotCount = @(Get-ChildItem -LiteralPath $shotDir -File -Force).Count }

$imgCount = 0
$imgBytes = 0
$imgDir = Join-Path $srcDir 'images'
if (Test-Path -LiteralPath $imgDir) {
  $imgFiles = @(Get-ChildItem -LiteralPath $imgDir -File -Force)
  $imgCount = $imgFiles.Count
  $imgBytes = ($imgFiles | Measure-Object -Property Length -Sum).Sum
  if (-not $imgBytes) { $imgBytes = 0 }
}

$bytes = (Get-ChildItem -LiteralPath $srcDir -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum
if (-not $bytes) { $bytes = 0 }

Write-Host "  [OK] $($items.Count) item(s), $(Format-Size $bytes)" -ForegroundColor Green
if ($captured.Count) { Write-Host "       tables: $($captured -join ', ')" -ForegroundColor DarkGray }
if ($shotCount)     { Write-Host "       screenshots: $shotCount" -ForegroundColor DarkGray }
if ($imgCount)      { Write-Host "       post images: $imgCount files ($(Format-Size $imgBytes))" -ForegroundColor DarkGray }
if (-not $captured.Contains("$($user).db")) {
  Write-Host '       (no .db - re-run with --sqlite for a SQLite copy)' -ForegroundColor DarkGray
}
if (-not $imgCount) {
  Write-Host "       (no images/ - run: node dependencies\ig-images.mjs --profile $user)" -ForegroundColor DarkGray
}

# -- 3. Dated run snapshot ----------------------------------------
Write-Host '[3/5] Creating dated run snapshot...' -ForegroundColor Yellow

$profileDir = Join-Path $DataRoot $user
$ts = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$runDir = Join-Path $profileDir "runs\$ts"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null

# A snapshot holds scrape output only. Post images are archived once, in
# latest/images/ - duplicating them per run would multiply the archive by
# the number of snapshots.
Get-ChildItem -LiteralPath $srcDir -Force |
  Where-Object { -not ($_.PSIsContainer -and $_.Name -ieq 'images') } |
  Copy-Item -Destination $runDir -Recurse -Force

$runCount = @(Get-ChildItem -LiteralPath $runDir -Recurse -File -Force).Count
Write-Host "  [OK] $runDir  ($runCount files)" -ForegroundColor Green
if ($imgCount) {
  Write-Host "       media archive skipped here (kept once in latest\images)" -ForegroundColor DarkGray
}

# -- 4. Refresh latest/ -------------------------------------------
Write-Host '[4/5] Refreshing latest/...' -ForegroundColor Yellow

$latestDir   = Join-Path $profileDir 'latest'
$latestImg   = Join-Path $latestDir 'images'
$holdImg     = Join-Path $profileDir '.images-hold'

# Media is expensive to rebuild and runs/ no longer holds a copy, so if this
# source has no images/ folder the archive already in latest/images/ is set
# aside and restored rather than dropped. Clear any orphan from an import
# that died mid-way.
Remove-Item -LiteralPath $holdImg -Recurse -Force -ErrorAction SilentlyContinue
$keepMedia = (-not $imgCount) -and (Test-Path -LiteralPath $latestImg)
if ($keepMedia) { Move-Item -LiteralPath $latestImg -Destination $holdImg -Force }

# Refresh from the SOURCE, not from the snapshot - runs/ deliberately
# excludes images/, and latest/ must still carry them.
if (Test-Path -LiteralPath $latestDir) { Remove-Item -LiteralPath $latestDir -Recurse -Force }
New-Item -ItemType Directory -Path $latestDir -Force | Out-Null
Get-ChildItem -LiteralPath $srcDir -Force | Copy-Item -Destination $latestDir -Recurse -Force

if ($keepMedia) { Move-Item -LiteralPath $holdImg -Destination $latestImg -Force }

Write-Host "  [OK] $latestDir" -ForegroundColor Green
if ($keepMedia) {
  Write-Host '       kept existing latest\images (source carries none)' -ForegroundColor DarkGray
}

# -- 5. Report + index --------------------------------------------
$reportOk = $false
if ($NoReport) {
  Write-Host '[5/5] Skipping report (-no-report).' -ForegroundColor DarkGray
} else {
  Write-Host '[5/5] Generating report and index...' -ForegroundColor Yellow
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '  [WARN] Node.js not found - skipping report generation.' -ForegroundColor Yellow
    Write-Host "         Later: node `"$ToolRoot\dependencies\report.mjs`" --dir `"$profileDir`"" -ForegroundColor Yellow
  } else {
    & node (Join-Path $ToolRoot 'dependencies\report.mjs') --dir $profileDir --root $DataRoot --source $srcDir
    if ($LASTEXITCODE -eq 0) { $reportOk = $true }
    else { Write-Host '  [WARN] report.mjs failed - data is archived, report is stale.' -ForegroundColor Yellow }
  }
}

# -- Summary ------------------------------------------------------
Write-Host ''
Write-Host '==========================================================================' -ForegroundColor DarkGray
# What actually landed in latest/ - the source may not have carried images
# while the media archive was preserved from the previous import.
$finalImg = @(Get-ChildItem -LiteralPath $latestImg -File -Force -ErrorAction SilentlyContinue)
$finalImgCount = $finalImg.Count
$finalImgBytes = ($finalImg | Measure-Object -Property Length -Sum).Sum
if (-not $finalImgBytes) { $finalImgBytes = 0 }

$sumNote = if ($finalImgCount) {
  "$runCount snapshot files + $(Format-Size $finalImgBytes) media in latest"
} else {
  "$runCount files"
}
Write-Host "  Archived  @$user  ($sumNote)" -ForegroundColor Cyan
Write-Host "  $profileDir" -ForegroundColor White
Write-Host ''
if ($reportOk) {
  Write-Host "    profile card : $profileDir\README.md" -ForegroundColor Green
  Write-Host "    full report  : $profileDir\analysis\report.md" -ForegroundColor Green
  Write-Host "    metrics      : $profileDir\analysis\analytics.json" -ForegroundColor Green
  Write-Host "    master index : $DataRoot\INDEX.md" -ForegroundColor Green
}
Write-Host "    data         : $latestDir" -ForegroundColor White
if ($finalImgCount) {
  Write-Host "    images       : $latestImg  ($finalImgCount files, $(Format-Size $finalImgBytes))" -ForegroundColor White
  if ($keepMedia) { Write-Host "                   (preserved - source carried none)" -ForegroundColor DarkGray }
} else {
  Write-Host "    images       : not present - fetch with: node dependencies\ig-images.mjs --profile $user" -ForegroundColor DarkGray
}
Write-Host "    history      : $profileDir\runs\" -ForegroundColor White
Write-Host ''
Write-Host '  Live dashboard:' -ForegroundColor DarkGray
Write-Host "    .\dependencies\ig-analyzer.ps1 --dir `"$latestDir`"" -ForegroundColor DarkGray
Write-Host ''
