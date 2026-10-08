<#
.SYNOPSIS
  ig-harvester - the single entry point for the Instagram OSINT suite.

.DESCRIPTION
  Run it with no arguments for an interactive menu, or pass -Action (or a
  bare action word) to run one job directly. It drives every tool in this
  repository behind one command:

    Scrape    node dependencies\scrape-ig.mjs     posts/comments/followers -> JSON/CSV/SQLite
    Images    node dependencies\ig-images.mjs     full-resolution post images -> PNG
    Scrape+Images  scrape then download images    full Scrape + Images in one go
    Report    node dependencies\report.mjs        Markdown report + IG-DATA index rebuild
    Analyze   node dependencies\ig-analyzer.mjs   local dashboard server
    Archive   dependencies\import-data.ps1        out/<user> -> IG-DATA (+ report)
    Full      pipeline                  Scrape -> Images -> Archive
    Browser   dependencies\launch-chrome-debug.ps1  Chrome with CDP on port 9222
    Setup     npm install + Playwright Chromium + MCP config merge
    Doctor    environment diagnostics   (alias: Status)
    Tests     npm run lint + npm test
    Help      this help

  Every helper script and node entry point lives in dependencies\ - only this
  file stays at the repository root.

  In menu mode the target username is asked first (default: anur.panda), then
  the run settings (posts, comments, followers, following, screenshots, SQLite,
  headless, output dir) can be changed interactively before the run is confirmed.

  Unknown GNU-style flags are forwarded verbatim to the node tools, so every
  scraper flag works (--delay-min 900 --log-level debug --json-log
  --no-resume --shot-only ...), including the --key=value form.

  Exit codes: 0 = success, 1 = step failed / preflight failed,
              2 = usage error or cancelled input.

.PARAMETER Action
  What to run. One of: Menu, Scrape, Images, ScrapeImages, Report, Analyze,
  Archive, Full, Browser, Setup, Doctor, Tests, Help. Many aliases are accepted
  (data, img, scrape+images, both, dashboard, import, pipeline, install,
  status, ...).
  Default: Menu (interactive). The first bare argument is also treated as
  an action when it matches one of these names, otherwise as the target
  username.

.PARAMETER User
  Target username. Aliases: -u, -profile, -target. The second bare argument
  sets it (e.g. .\ig-harvester.ps1 scrape someuser). When nothing is given the
  interactive prompt is pre-filled with -DefaultUser (anur.panda).

.PARAMETER DefaultUser
  Username pre-filled in the interactive target prompt, default: anur.panda.

.PARAMETER Url
  Full Instagram URL as an alternative target (profile URLs also derive the
  username for Archive/Report).

.PARAMETER Posts
  Maximum number of posts to harvest (tools default to 30); accepts a number
  or "all" (-Posts all == --posts all == -AllPosts).

.PARAMETER AllPosts
  Harvest every post the profile grid will serve (forwards --posts all);
  same as -Posts all.

.PARAMETER Comments
  Also harvest comments (Scrape).

.PARAMETER Followers
  Also harvest the follower list (Scrape).

.PARAMETER Following
  Also harvest the following list (Scrape).

.PARAMETER Shots
  Also capture screenshot images while scraping (Scrape).

.PARAMETER Sqlite
  Also write a SQLite database (Scrape).

.PARAMETER Force
  Re-download images that are already on disk (Images).

.PARAMETER Headless
  Run the browser without a visible window.

.PARAMETER Out
  Output directory, default: out.

.PARAMETER Cdp
  CDP endpoint, default: http://127.0.0.1:9222.

.PARAMETER Proxy
  Proxy URL (http://host:port or socks5://host:port).

.PARAMETER Config
  Path to a JSON config file passed to the node tools.

.PARAMETER Port
  Dashboard port for Analyze, default: 8080.

.PARAMETER Dir
  Report/Analyze data directory (defaults to <Root>/<user>).

.PARAMETER Root
  IG-DATA root, default: ../IG-DATA (sibling of this repository).

.PARAMETER Source
  Archive source folder, default: out/<user>.

.PARAMETER NoReport
  Archive only - skip report regeneration.

.PARAMETER Reindex
  Report: rebuild the index for every archived profile.
  Archive (without -Source/-User): re-index only.

.PARAMETER SkipBrowser
  Setup: skip the Playwright Chromium download.

.PARAMETER Yes
  Non-interactive mode: assume yes, use defaults, never prompt.

.PARAMETER DryRun
  Print the exact commands without executing anything.

.PARAMETER Help
  Show this help. Alias: -h.

.EXAMPLE
  .\ig-harvester.ps1
  Interactive menu.

.EXAMPLE
  .\ig-harvester.ps1 scrape someuser --posts 50 --comments
  Positional action + GNU-style scraper flags (forwarded verbatim).

.EXAMPLE
  .\ig-harvester.ps1 ScrapeImages anur.panda --posts 50 --comments
  Full Scrape + Images in one go (menu option 3).

.EXAMPLE
  .\ig-harvester.ps1 -Action Scrape -User someuser -Posts 50 -Comments -Followers
  Fully explicit PowerShell-style invocation.

.EXAMPLE
  .\ig-harvester.ps1 -Action Full -User someuser -Yes
  Non-interactive scrape -> images -> archive pipeline.

.EXAMPLE
  .\ig-harvester.ps1 -Action Images -User someuser -Force -DryRun
  Show the exact ig-images command without running it.

.EXAMPLE
  .\ig-harvester.ps1 -Action Report -Reindex
  Rebuild the IG-DATA index for every archived profile.

.EXAMPLE
  .\ig-harvester.ps1 -Action Doctor
  Check Node.js, dependencies, CDP and data folders.

.NOTES
  Author      : Anurag Panda
  GitHub      : https://github.com/anurag-panda-dev/ig-harvester
  License     : MIT
  Version     : 2.0.0
  Requires    : Windows PowerShell 5.1+ or PowerShell 7+, Node.js >= 20
  Compatibility: Windows PowerShell 5.1 safe (no PS7-only syntax).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Action = 'Menu',

  [Parameter(Position = 1)]
  [Alias('u', 'profile', 'target')]
  [string]$User,

  [string]$DefaultUser = 'anur.panda',

  [string]$Url,
  [string]$Posts = '',      # a number, or "all" (-Posts all / --posts all)

  [Alias('all-posts')]
  [switch]$AllPosts,

  [switch]$Comments,
  [switch]$Followers,
  [switch]$Following,
  [switch]$Shots,
  [switch]$Sqlite,
  [switch]$Force,
  [switch]$Headless,

  [string]$Out = 'out',
  [string]$Cdp = 'http://127.0.0.1:9222',
  [string]$Proxy,
  [string]$Config,
  [int]$Port = 8080,

  [string]$Dir,
  [string]$Root,
  [string]$Source,

  [Alias('no-report')]
  [switch]$NoReport,
  [switch]$Reindex,
  [switch]$SkipBrowser,

  [Alias('non-interactive', 'assume-yes')]
  [switch]$Yes,
  [switch]$DryRun,
  [Alias('h')]
  [switch]$Help,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ── State ─────────────────────────────────────────────────────────────────────
$script:ToolRoot = $PSScriptRoot
$script:Deps     = 'dependencies'      # helper scripts + node entry points live here
$script:DefaultUser = $DefaultUser     # pre-filled target in the interactive prompt
$script:Ver      = '2.0.0'
$script:ExitCode = 0
$script:ActionGiven = $PSBoundParameters.ContainsKey('Action')
$script:UserGiven   = $PSBoundParameters.ContainsKey('User') -or $PSBoundParameters.ContainsKey('Url')
$script:Forward     = New-Object 'System.Collections.Generic.List[string]'

# ── Logging ───────────────────────────────────────────────────────────────────
function Write-Info([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '][info] ' + $m) -ForegroundColor Gray
}
function Write-Ok([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '][ ok ] ' + $m) -ForegroundColor Green
}
function Write-Warn([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '][warn] ' + $m) -ForegroundColor Yellow
}
function Write-Fail([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '][fail] ' + $m) -ForegroundColor Red
}
function Write-Step([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) -ForegroundColor Cyan
}
function Write-Cmd([string]$m) {
  Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + ']   $ ' + $m) -ForegroundColor DarkGray
}

# ── -Posts: a number, or "all" ───────────────────────────────────────────────
# The parameter is a string so both "-Posts all" and "--posts all" bind instead
# of failing the int conversion. Normalise it into an int count for the rest of
# the script: $script:PostsN (0 = leave it to the tools, whose default is 30)
# plus $script:AllPosts, which forwards --posts all (every post, no cap).
$script:PostsN = 0
if (-not [string]::IsNullOrWhiteSpace($Posts)) {
  $postsTxt = $Posts.Trim()
  if ($postsTxt -match '^(all|any|unlimited|none|0|\*)$') {
    $script:AllPosts = $true
  } else {
    $postsNum = 0
    if ([int]::TryParse($postsTxt, [ref]$postsNum) -and $postsNum -ge 0) {
      $script:PostsN = $postsNum
    } else {
      Write-Warn ('invalid -Posts "' + $postsTxt + '" - using the tool default (a number or "all")')
    }
  }
}

# ── Paths ─────────────────────────────────────────────────────────────────────
function Resolve-FsPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $script:ToolRoot }
  if ([System.IO.Path]::IsPathRooted($p)) { return [System.IO.Path]::GetFullPath($p) }
  return [System.IO.Path]::GetFullPath((Join-Path $script:ToolRoot $p))
}

function Get-DataRoot {
  if ($script:Root) { return (Resolve-FsPath $script:Root) }
  return (Join-Path (Split-Path -Parent $script:ToolRoot) 'IG-DATA')
}

function Test-ToolFile([string]$f) {
  return (Test-Path -LiteralPath (Join-Path $script:ToolRoot $f))
}

# Every helper script and node entry point lives in dependencies\ - route all
# tool references through this so the repository root only holds ig-harvester.ps1.
function Get-Tool([string]$f) {
  return (Join-Path $script:Deps $f)
}

function Get-LatestDirName([string]$base) {
  if ([string]::IsNullOrWhiteSpace($base)) { return $null }
  if (-not (Test-Path -LiteralPath $base)) { return $null }
  $d = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($d) { return $d.Name }
  return $null
}

function Get-LatestOutUser  { return (Get-LatestDirName (Resolve-FsPath $script:Out)) }
function Get-LatestDataUser { return (Get-LatestDirName (Get-DataRoot)) }

# ── Argument quoting (for -DryRun display) ────────────────────────────────────
function Quote-Arg([string]$s) {
  if ($null -eq $s) { return "''" }
  if ($s -match '[\s"]') { return '"' + ($s -replace '"', '\"') + '"' }
  return $s
}

function Format-ArgList([string[]]$ArgList) {
  if ($null -eq $ArgList -or $ArgList.Count -eq 0) { return '' }
  $parts = foreach ($a in $ArgList) { Quote-Arg $a }
  return (' ' + ($parts -join ' '))
}

# ── Node / child-script runners ───────────────────────────────────────────────
# Output is piped to Out-Host so tool output streams live to the console
# while the function still returns a clean exit code.
function Invoke-NodeTool {
  param(
    [string]$ScriptFile,
    [string[]]$ToolArgs = @(),
    [string]$Label
  )
  if ($null -eq $ToolArgs) { $ToolArgs = @() }
  Write-Step $Label
  $line = 'node ' + $ScriptFile + (Format-ArgList $ToolArgs)
  Write-Cmd $line
  if (-not (Test-ToolFile $ScriptFile)) {
    Write-Fail ('missing tool: ' + $ScriptFile)
    return 1
  }
  if ($script:DryRun) {
    Write-Warn 'dry-run - command not executed'
    return 0
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & node $ScriptFile @ToolArgs | Out-Host
  $code = $LASTEXITCODE
  $sw.Stop()
  if ($null -eq $code) { $code = 0 }
  if ($code -eq 0) {
    Write-Ok ($Label + ' - ok (' + $sw.Elapsed.ToString('hh\:mm\:ss') + ')')
  } else {
    Write-Fail ($Label + ' - exit ' + $code + ' (' + $sw.Elapsed.ToString('hh\:mm\:ss') + ')')
  }
  return $code
}

function Invoke-PsTool {
  param(
    [string]$PsFile,
    [string[]]$ToolArgs = @(),
    [string]$Label
  )
  if ($null -eq $ToolArgs) { $ToolArgs = @() }
  Write-Step $Label
  $line = '.\' + $PsFile + (Format-ArgList $ToolArgs)
  Write-Cmd $line
  if (-not (Test-ToolFile $PsFile)) {
    Write-Fail ('missing tool: ' + $PsFile)
    return 1
  }
  if ($script:DryRun) {
    Write-Warn 'dry-run - command not executed'
    return 0
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $LASTEXITCODE = 0
  & (Join-Path $script:ToolRoot $PsFile) @ToolArgs | Out-Host
  $code = $LASTEXITCODE
  $sw.Stop()
  if ($null -eq $code) { $code = 0 }
  if ($code -eq 0) {
    Write-Ok ($Label + ' - ok (' + $sw.Elapsed.ToString('hh\:mm\:ss') + ')')
  } else {
    Write-Fail ($Label + ' - exit ' + $code + ' (' + $sw.Elapsed.ToString('hh\:mm\:ss') + ')')
  }
  return $code
}

# ── Preflight ─────────────────────────────────────────────────────────────────
function Test-NodePreflight {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Fail 'Node.js not found on PATH - install from https://nodejs.org/'
    return $false
  }
  $v = $null
  try { $v = & node --version } catch { }
  $vs = ("$v").Trim()
  if ($vs -match '^v(\d+)') {
    if ([int]$Matches[1] -ge 20) {
      Write-Ok ('Node.js ' + $vs)
      return $true
    }
    Write-Fail ('Node.js ' + $vs + ' is too old - need >= 20')
    return $false
  }
  Write-Warn ('could not read node version: ' + $vs)
  return $true
}

function Test-DepsPreflight {
  $missing = @()
  foreach ($m in @('playwright', 'jimp', 'better-sqlite3')) {
    if (-not (Test-Path -LiteralPath (Join-Path $script:ToolRoot ('node_modules\' + $m)))) { $missing += $m }
  }
  if ($missing.Count -gt 0) {
    Write-Fail ('missing npm dependencies: ' + ($missing -join ', '))
    Write-Info 'fix: .\ig-harvester.ps1 -Action Setup'
    return $false
  }
  Write-Ok 'npm dependencies present (playwright, jimp, better-sqlite3)'
  return $true
}

function Test-Preflight {
  param([switch]$Deps)
  $okNode = Test-NodePreflight
  $okDeps = $true
  if ($Deps) { $okDeps = Test-DepsPreflight }
  return ($okNode -and $okDeps)
}

# ── CDP ───────────────────────────────────────────────────────────────────────
function Get-CdpInfo {
  try {
    return (Invoke-RestMethod ($script:Cdp.TrimEnd('/') + '/json/version') -TimeoutSec 2)
  } catch {
    return $null
  }
}

function Ensure-Cdp {
  $info = Get-CdpInfo
  if ($info) {
    Write-Ok ('CDP live: ' + $info.Browser + ' @ ' + $script:Cdp)
    return $true
  }
  Write-Warn ('no CDP endpoint at ' + $script:Cdp)
  if ($script:Headless) {
    Write-Info 'headless mode - the tool launches its own Chromium (log in there if asked)'
    return $true
  }
  if ($script:DryRun) {
    Write-Cmd '.\dependencies\launch-chrome-debug.ps1'
    Write-Warn 'dry-run - browser not launched'
    return $true
  }
  $launch = $false
  if ($script:Yes) {
    $launch = $true
  } else {
    $r = Read-Input '  Launch debug Chrome now? [Y/n]'
    if ($null -eq $r) { $launch = $false }
    elseif ($r.Trim() -eq '') { $launch = $true }
    else { $launch = ($r.Trim() -match '^[Yy]') }
  }
  if ($launch) {
    Invoke-BrowserAction | Out-Null
    $info = Get-CdpInfo
    if ($info) {
      Write-Ok ('CDP live: ' + $info.Browser + ' @ ' + $script:Cdp)
      return $true
    }
    Write-Warn 'CDP still not reachable after launch'
  }
  $pw = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  $hasChromium = (Test-Path -LiteralPath $pw) -and
    (@(Get-ChildItem -LiteralPath $pw -Directory -Filter 'chromium*' -ErrorAction SilentlyContinue).Count -gt 0)
  if (-not $hasChromium) {
    Write-Warn 'no bundled Chromium either - run -Action Setup first'
  } else {
    Write-Info 'continuing: bundled Chromium fallback waits up to 5 min for a manual login'
  }
  return $true
}

# ── Prompts ───────────────────────────────────────────────────────────────────
# Read-Host throws in NonInteractive hosts (-NonInteractive / piped sessions);
# normalize that to $null so every prompt behaves like end-of-input.
function Read-Input([string]$Prompt) {
  try { return Read-Host $Prompt } catch { return $null }
}

function Read-Yes([string]$Message) {
  $r = Read-Input ('  ' + $Message)
  if ($null -eq $r) { return $false }   # stdin closed
  $r = $r.Trim()
  if ($r -eq '') { return $true }
  return ($r -match '^[Yy]')
}

function Confirm-Menu([string]$Message) {
  if ($script:Action -ne 'Menu') { return $true }   # explicit -Action = intent
  if ($script:Yes) { return $true }
  return (Read-Yes ($Message + ' [Y/n]'))
}

# ── Interactive settings ──────────────────────────────────────────────────────
# Menu mode asks for the target first, then lets the user change the run
# settings (Enter keeps the value shown in [ ]) before anything is confirmed.
function Read-SettingYesNo([string]$Label, [bool]$Current) {
  $yn = 'n'; if ($Current) { $yn = 'y' }
  $r = Read-Input ('    ' + $Label + ' [' + $yn + ']')
  if ($null -eq $r) { return $Current }              # stdin closed: keep
  $r = $r.Trim().ToLower()
  if ($r -eq '') { return $Current }                 # Enter: keep
  if ($r -match '^(y|yes|on|true|1)$') { return $true }
  if ($r -match '^(n|no|off|false|0)$') { return $false }
  Write-Warn ('    invalid yes/no - keeping ' + $yn)
  return $Current
}

function Edit-RunSettings([string]$Kind) {
  if ($script:Action -ne 'Menu') { return }   # explicit -Action = flags already given
  if ($script:Yes) { return }                  # non-interactive mode
  Write-Host ''
  Write-Host ('  Settings for ' + $Kind + ' - Enter keeps the value in [ ]') -ForegroundColor Cyan

  $curPosts = if ($script:AllPosts) { 'all' }
              elseif ($script:PostsN -gt 0) { [string]$script:PostsN }
              else { '30 (default)' }
  $r = Read-Input ('    posts to harvest              [' + $curPosts + ']  (number, all, or Enter)')
  if ($null -ne $r) {
    $r = $r.Trim()
    if ($r -ne '') {
      if ($r -match '^(all|any|unlimited|none|\*)$') { $script:AllPosts = $true; $script:PostsN = 0 }
      else {
        $n = 0
        if ([int]::TryParse($r, [ref]$n) -and $n -ge 0) { $script:PostsN = $n; if ($n -eq 0) { $script:AllPosts = $false } }
        else { Write-Warn ('    invalid number - keeping ' + $curPosts) }
      }
    }
  }

  if ($Kind -ne 'Images') {   # scraper-only settings
    $script:Comments  = Read-SettingYesNo 'harvest comments               ' $script:Comments
    $script:Followers = Read-SettingYesNo 'harvest followers              ' $script:Followers
    $script:Following = Read-SettingYesNo 'harvest following              ' $script:Following
    $script:Shots     = Read-SettingYesNo 'capture screenshots            ' $script:Shots
    $script:Sqlite    = Read-SettingYesNo 'write SQLite .db               ' $script:Sqlite
  }
  if ($Kind -ne 'Scrape') {   # image-only settings
    $script:Force = Read-SettingYesNo 're-download images on disk    ' $script:Force
  }
  $script:Headless = Read-SettingYesNo 'headless (no browser window)  ' $script:Headless

  $r = Read-Input ('    output directory              [' + $script:Out + ']')
  if ($null -ne $r) { $r = $r.Trim(); if ($r -ne '') { $script:Out = $r } }

  Write-Host ''
  Show-SessionLine
}

function Resolve-Target {
  if ($script:User) { return $script:User }
  if ($script:Url) {
    $m = [regex]::Match($script:Url, 'instagram\.com/([^/?#]+)')
    if ($m.Success) {
      $seg = $m.Groups[1].Value.ToLower()
      if (@('p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'direct') -notcontains $seg) {
        $script:User = $seg
        return $seg
      }
    }
    return $script:Url   # post URL: target known, handle unknown
  }
  # Default target: -DefaultUser (anur.panda) pre-fills the prompt; the most
  # recent scrape in out/ is only used when no default is configured.
  $hint = $script:DefaultUser
  if (-not $hint) { $hint = Get-LatestOutUser }
  if ($script:Yes) {
    if ($hint) {
      $script:User = $hint
      Write-Info ('no -User given, using default target: ' + $hint)
      return $hint
    }
    Write-Fail 'no target username - pass -User <username> or -DefaultUser <username>'
    return $null
  }
  $msg = '  Target username'
  if ($hint) { $msg += (' [' + $hint + ']') }
  $r = Read-Input $msg
  if ($null -eq $r) { Write-Warn 'input closed - cancelled'; return $null }
  $r = $r.Trim()
  if ($r -eq '') { $r = $hint }
  if (-not $r) { Write-Fail 'no target username - cancelled'; return $null }
  $script:User = $r
  return $r
}

# ── Node argument builders ────────────────────────────────────────────────────
function Get-TargetArgs {
  if ($script:Url) { return @('--url', $script:Url) }
  if ($script:User) { return @('--profile', $script:User) }
  return @()
}

function Get-PostsArgs {
  if ($script:AllPosts) { return @('--posts', 'all') }
  if ($script:PostsN -gt 0) { return @('--posts', [string]$script:PostsN) }
  return @()
}

function Get-ScrapeArgs {
  $a = New-Object 'System.Collections.Generic.List[string]'
  foreach ($t in (Get-TargetArgs)) { [void]$a.Add($t) }
  foreach ($t in (Get-PostsArgs)) { [void]$a.Add($t) }
  if ($script:Out) { [void]$a.Add('--out'); [void]$a.Add($script:Out) }
  if ($script:Cdp) { [void]$a.Add('--cdp'); [void]$a.Add($script:Cdp) }
  if ($script:Proxy) { [void]$a.Add('--proxy'); [void]$a.Add($script:Proxy) }
  if ($script:Config) { [void]$a.Add('--config'); [void]$a.Add($script:Config) }
  $flags = @(
    @('comments', $script:Comments),
    @('followers', $script:Followers),
    @('following', $script:Following),
    @('shots', $script:Shots),
    @('sqlite', $script:Sqlite),
    @('headless', $script:Headless)
  )
  foreach ($f in $flags) { if ($f[1]) { [void]$a.Add('--' + $f[0]) } }
  foreach ($t in $script:Forward) { [void]$a.Add($t) }
  return @($a.ToArray())
}

function Get-ImagesArgs {
  $a = New-Object 'System.Collections.Generic.List[string]'
  foreach ($t in (Get-TargetArgs)) { [void]$a.Add($t) }
  foreach ($t in (Get-PostsArgs)) { [void]$a.Add($t) }
  if ($script:Out) { [void]$a.Add('--out'); [void]$a.Add($script:Out) }
  if ($script:Cdp) { [void]$a.Add('--cdp'); [void]$a.Add($script:Cdp) }
  if ($script:Proxy) { [void]$a.Add('--proxy'); [void]$a.Add($script:Proxy) }
  if ($script:Config) { [void]$a.Add('--config'); [void]$a.Add($script:Config) }
  if ($script:Force) { [void]$a.Add('--force') }
  if ($script:Headless) { [void]$a.Add('--headless') }
  foreach ($t in $script:Forward) { [void]$a.Add($t) }
  return @($a.ToArray())
}

# ── Actions ───────────────────────────────────────────────────────────────────
function Invoke-ScrapeAction {
  Write-Step 'Action: Scrape'
  if (-not (Test-Preflight -Deps)) { return 1 }
  $t = Resolve-Target
  if (-not $t) { return 2 }
  Edit-RunSettings 'Scrape'
  if (-not (Confirm-Menu ('Run scrape for @' + $t + ' with current settings?'))) {
    Write-Info 'cancelled'
    return 0
  }
  [void](Ensure-Cdp)
  return (Invoke-NodeTool (Get-Tool 'scrape-ig.mjs') (Get-ScrapeArgs) ('Scrape @' + $t))
}

function Invoke-ImagesAction {
  Write-Step 'Action: Images'
  if (-not (Test-Preflight -Deps)) { return 1 }
  $t = Resolve-Target
  if (-not $t) { return 2 }
  Edit-RunSettings 'Images'
  if (-not (Confirm-Menu ('Download post images for @' + $t + '?'))) {
    Write-Info 'cancelled'
    return 0
  }
  [void](Ensure-Cdp)
  return (Invoke-NodeTool (Get-Tool 'ig-images.mjs') (Get-ImagesArgs) ('Images @' + $t))
}

function Invoke-ScrapeImagesAction {
  Write-Step 'Action: Scrape + Images (full harvest)'
  if (-not (Test-Preflight -Deps)) { return 1 }
  $t = Resolve-Target
  if (-not $t) { return 2 }
  Edit-RunSettings 'Scrape + Images'
  if (-not (Confirm-Menu ('Run full Scrape + Images for @' + $t + '?'))) {
    Write-Info 'cancelled'
    return 0
  }
  [void](Ensure-Cdp)

  $rows = @()
  $firstFail = 0

  # 1/2 Scrape - failure aborts
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = Invoke-NodeTool (Get-Tool 'scrape-ig.mjs') (Get-ScrapeArgs) ('Scrape + Images 1/2: Scrape @' + $t)
  $sw.Stop()
  $rows += (New-PipelineRow 'scrape' $code $sw.Elapsed)
  if ($code -ne 0) {
    $rows += (New-PipelineRow 'images' -1 $null)
    Write-Fail 'aborted: scrape failed'
    Show-PipelineSummary $rows
    return $code
  }

  # 2/2 Images
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = Invoke-NodeTool (Get-Tool 'ig-images.mjs') (Get-ImagesArgs) ('Scrape + Images 2/2: Images @' + $t)
  $sw.Stop()
  $rows += (New-PipelineRow 'images' $code $sw.Elapsed)
  if ($code -ne 0) { $firstFail = $code }

  Show-PipelineSummary $rows
  if ($firstFail -ne 0) { return $firstFail }
  Write-Ok 'Scrape + Images complete'
  return 0
}

function Start-Archive {
  # Archive with no prompts - target/src must already be resolved.
  $src = $script:Source
  if (-not $src -and $script:User) { $src = Join-Path $script:Out $script:User }
  if (-not $src) { return 2 }
  $srcAbs = Resolve-FsPath $src
  if (-not (Test-Path -LiteralPath $srcAbs)) {
    Write-Fail ('no scraped data at ' + $srcAbs + ' - run -Action Scrape first')
    return 1
  }
  $psArgs = New-Object 'System.Collections.Generic.List[string]'
  [void]$psArgs.Add('-Source'); [void]$psArgs.Add($srcAbs)
  if ($script:Root) { [void]$psArgs.Add('-Root'); [void]$psArgs.Add((Resolve-FsPath $script:Root)) }
  if ($script:NoReport) { [void]$psArgs.Add('-NoReport') }
  $leaf = Split-Path $srcAbs -Leaf
  return (Invoke-PsTool (Get-Tool 'import-data.ps1') @($psArgs.ToArray()) ('Archive ' + $leaf + ' -> ' + (Get-DataRoot)))
}

function Invoke-ArchiveAction {
  Write-Step 'Action: Archive'
  if (-not (Test-Preflight)) { return 1 }
  if ($script:Reindex -and -not $script:Source -and -not $script:User -and -not $script:Dir) {
    $psArgs = @('-Reindex')
    if ($script:Root) { $psArgs += @('-Root', (Resolve-FsPath $script:Root)) }
    return (Invoke-PsTool (Get-Tool 'import-data.ps1') $psArgs 'Archive: re-index IG-DATA')
  }
  if (-not $script:Source) {
    $t = Resolve-Target
    if (-not $t) { return 2 }
    if (-not $script:User) {
      Write-Fail 'archive needs -User <username> (folder out/<username>)'
      return 2
    }
  }
  if (-not (Confirm-Menu 'Archive into IG-DATA?')) {
    Write-Info 'cancelled'
    return 0
  }
  return (Start-Archive)
}

function Invoke-ReportAction {
  Write-Step 'Action: Report'
  if (-not (Test-Preflight)) { return 1 }
  $dataRoot = Get-DataRoot
  $a = New-Object 'System.Collections.Generic.List[string]'
  $label = 'Report'

  if ($script:Reindex -and -not $script:User -and -not $script:Dir) {
    if (-not (Test-Path -LiteralPath $dataRoot)) {
      Write-Fail ('no archive at ' + $dataRoot + ' - run -Action Archive first')
      return 1
    }
    [void]$a.Add('--root'); [void]$a.Add($dataRoot)
    $label = 'Report: re-index all profiles'
  } else {
    $dir = $script:Dir
    if (-not $dir -and $script:User) { $dir = Join-Path $dataRoot $script:User }
    if (-not $dir) {
      if (-not $script:Yes) {
        $hint = Get-LatestDataUser
        $msg = '  IG-DATA profile'
        if ($hint) { $msg += (' [' + $hint + ']') }
        $msg += ' (Enter = re-index all)'
        $r = Read-Input $msg
        if ($null -eq $r) { Write-Warn 'input closed - cancelled'; return 0 }
        $r = $r.Trim()
        if ($r -eq '') {
          if ($hint) { $dir = Join-Path $dataRoot $hint } else { $script:Reindex = $true }
        } else {
          $script:User = $r
          $dir = Join-Path $dataRoot $r
        }
      }
      if (-not $dir -and -not $script:Reindex) {
        Write-Fail 'need -User <name>, -Dir <path> or -Reindex'
        return 2
      }
      if ($script:Reindex -and -not $dir) {
        if (-not (Test-Path -LiteralPath $dataRoot)) {
          Write-Fail ('no archive at ' + $dataRoot)
          return 1
        }
        [void]$a.Add('--root'); [void]$a.Add($dataRoot)
        $label = 'Report: re-index all profiles'
        return (Invoke-NodeTool (Get-Tool 'report.mjs') @($a.ToArray()) $label)
      }
    }
    if ($dir) {
      $dirAbs = Resolve-FsPath $dir
      if (-not (Test-Path -LiteralPath $dirAbs)) {
        Write-Fail ('no archived profile at ' + $dirAbs + ' - run -Action Archive first')
        return 1
      }
      [void]$a.Add('--dir'); [void]$a.Add($dirAbs)
      [void]$a.Add('--root'); [void]$a.Add($dataRoot)
      $leaf = Split-Path $dirAbs -Leaf
      if ($script:User) {
        $srcAbs = Resolve-FsPath (Join-Path $script:Out $script:User)
        if (Test-Path -LiteralPath $srcAbs) { [void]$a.Add('--source'); [void]$a.Add($srcAbs) }
      }
      $label = ('Report @' + $leaf)
      if (-not (Confirm-Menu ('Regenerate report for @' + $leaf + '?'))) {
        Write-Info 'cancelled'
        return 0
      }
    }
  }
  return (Invoke-NodeTool (Get-Tool 'report.mjs') @($a.ToArray()) $label)
}

function Invoke-AnalyzeAction {
  Write-Step 'Action: Analyze'
  if (-not (Test-Preflight)) { return 1 }
  $a = New-Object 'System.Collections.Generic.List[string]'
  if ($script:Dir) {
    [void]$a.Add('--dir'); [void]$a.Add((Resolve-FsPath $script:Dir))
  } elseif ($script:User) {
    [void]$a.Add('--user'); [void]$a.Add($script:User)
  }
  [void]$a.Add('--port'); [void]$a.Add([string]$script:Port)
  Write-Info 'dashboard runs until you press Ctrl+C'
  return (Invoke-NodeTool (Get-Tool 'ig-analyzer.mjs') @($a.ToArray()) ('Analyze (port ' + $script:Port + ')'))
}

function Invoke-BrowserAction {
  Write-Step 'Action: Browser (launch Chrome with CDP)'
  if (-not (Test-ToolFile (Get-Tool 'launch-chrome-debug.ps1'))) {
    Write-Fail ('missing tool: ' + (Get-Tool 'launch-chrome-debug.ps1'))
    return 1
  }
  if ($script:DryRun) {
    Write-Cmd '.\dependencies\launch-chrome-debug.ps1'
    Write-Warn 'dry-run - command not executed'
    return 0
  }
  $LASTEXITCODE = 0
  & (Join-Path $script:ToolRoot (Get-Tool 'launch-chrome-debug.ps1')) | Out-Host
  $info = Get-CdpInfo
  if ($info) {
    Write-Ok ('Chrome CDP ready: ' + $info.Browser + ' @ ' + $script:Cdp)
    return 0
  }
  Write-Fail ('CDP not reachable at ' + $script:Cdp + ' after launch')
  return 1
}

function Invoke-SetupAction {
  Write-Step 'Action: Setup'
  if (-not (Test-NodePreflight)) { return 1 }
  $fail = 0

  # 1. npm install
  # NOTE: call npm/npx bare, never "& npm" - the npm.ps1 shim on PATH derives
  # its arguments from $MyInvocation.InvocationName, which is "&" under the
  # call operator and would strip the leading "n" ("npm run" -> "pm run").
  Write-Step 'Setup 1/3: npm install'
  if ($script:DryRun) {
    Write-Cmd 'npm install --no-fund --no-audit'
  } else {
    npm install --no-fund --no-audit | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Fail 'npm install failed'
      return 1
    }
    Write-Ok 'npm install complete'
  }

  # 2. Playwright Chromium
  Write-Step 'Setup 2/3: Playwright Chromium'
  if ($script:SkipBrowser) {
    Write-Info 'skipped (-SkipBrowser)'
  } elseif ($script:DryRun) {
    Write-Cmd 'npx playwright install chromium'
  } else {
    npx playwright install chromium | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'playwright install failed (network?) - CDP attach to your own Chrome still works'
      $fail = 1
    } else {
      Write-Ok 'Playwright Chromium ready'
    }
  }

  # 3. MCP config merge (done with node so it works on Windows PowerShell 5.1,
  #    where ConvertFrom-Json -AsHashtable does not exist - and never rewrites
  #    a config it cannot parse).
  Write-Step 'Setup 3/3: MCP config (playwright server)'
  if ($script:DryRun) {
    Write-Cmd 'node <merge opencode.json mcp.playwright>'
    return $fail
  }
  $mcpScript = @'
import fs from 'node:fs';
import path from 'node:path';
const appData = process.env.APPDATA || '';
const portable = path.join(process.env.USERPROFILE || '', '.config', 'opencode', 'opencode.json');
let target = path.join(appData, 'opencode', 'opencode.json');
if (!fs.existsSync(target) && fs.existsSync(portable)) target = portable;
let json = null;
if (fs.existsSync(target)) {
  try {
    const raw = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
    json = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('  existing config is not valid JSON - left untouched: ' + target);
    process.exit(0);
  }
} else {
  json = {};
  fs.mkdirSync(path.dirname(target), { recursive: true });
}
if (!json || typeof json !== 'object' || Array.isArray(json)) json = {};
if (!json.mcp || typeof json.mcp !== 'object') json.mcp = {};
if (json.mcp.playwright) {
  console.log("  'playwright' MCP already present, left untouched");
} else {
  json.mcp.playwright = {
    type: 'local',
    command: ['npx', '-y', '@playwright/mcp@latest'],
    enabled: true,
    environment: { PLAYWRIGHT_BROWSER: 'chrome' }
  };
  fs.writeFileSync(target, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log("  added 'playwright' MCP server");
}
console.log('  config: ' + target);
'@
  $tempJs = Join-Path $env:TEMP 'ig-harvester-mcp-setup.mjs'
  try {
    [System.IO.File]::WriteAllText($tempJs, $mcpScript)
    & node $tempJs | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'MCP config step failed (non-fatal)'
      $fail = 1
    } else {
      Write-Ok 'MCP config merged'
    }
  } finally {
    Remove-Item -LiteralPath $tempJs -Force -ErrorAction SilentlyContinue
  }

  if ($fail -ne 0) { return $fail }
  Write-Ok 'setup complete'
  Write-Info 'next: .\dependencies\launch-chrome-debug.ps1   (log in once), then -Action Scrape'
  return 0
}

function Invoke-DoctorAction {
  Write-Step 'Action: Doctor (environment diagnostics)'
  $fail = 0
  $warn = 0

  # 1. Node.js
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Fail 'Node.js not found on PATH'
    $fail++
  } else {
    $v = $null
    try { $v = & node --version } catch { }
    $vs = ("$v").Trim()
    if ($vs -match '^v(\d+)') {
      if ([int]$Matches[1] -ge 20) { Write-Ok ('Node.js ' + $vs) }
      else { Write-Fail ('Node.js ' + $vs + ' < 20 (need >= 20)'); $fail++ }
    } else { Write-Warn ('could not read node version: ' + $vs); $warn++ }
  }

  # 2. npm dependencies
  $missing = @()
  foreach ($m in @('playwright', 'jimp', 'better-sqlite3')) {
    if (-not (Test-Path -LiteralPath (Join-Path $script:ToolRoot ('node_modules\' + $m)))) { $missing += $m }
  }
  if ($missing.Count -gt 0) { Write-Fail ('missing npm deps: ' + ($missing -join ', ')); $fail++ }
  else { Write-Ok 'npm dependencies present' }

  # 3. Playwright browser
  $pwDir = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  $chromium = $null
  if (Test-Path -LiteralPath $pwDir) {
    $chromium = Get-ChildItem -LiteralPath $pwDir -Directory -Filter 'chromium*' -ErrorAction SilentlyContinue |
                Select-Object -First 1
  }
  if ($chromium) { Write-Ok ('Playwright browser: ' + $chromium.Name) }
  else { Write-Warn 'Playwright Chromium not downloaded (-Action Setup)'; $warn++ }

  # 4. System Chrome
  $chromePaths = @(
    ($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'),
    (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'),
    ($env:LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe')
  )
  $chrome = $chromePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($chrome) { Write-Ok ('Chrome: ' + $chrome) }
  else { Write-Warn 'system Chrome not found (bundled Chromium is used instead)'; $warn++ }

  # 5. CDP
  $info = Get-CdpInfo
  if ($info) { Write-Ok ('CDP: ' + $info.Browser + ' @ ' + $script:Cdp) }
  else { Write-Warn ('CDP down at ' + $script:Cdp + ' (-Action Browser to launch)'); $warn++ }

  # 6. Entry points
  $tools = @((Get-Tool 'scrape-ig.mjs'), (Get-Tool 'ig-images.mjs'), (Get-Tool 'ig-analyzer.mjs'),
             (Get-Tool 'report.mjs'), (Get-Tool 'import-data.ps1'),
             (Get-Tool 'launch-chrome-debug.ps1'), (Get-Tool 'install.ps1'))
  $missingTools = @($tools | Where-Object { -not (Test-ToolFile $_) })
  if ($missingTools.Count -gt 0) { Write-Fail ('missing tools: ' + ($missingTools -join ', ')); $fail++ }
  else { Write-Ok ('entry points present (' + $tools.Count + ')') }

  # 7. Scraped data (out/)
  $outAbs = Resolve-FsPath $script:Out
  if (-not (Test-Path -LiteralPath $outAbs)) {
    Write-Info ('' + $outAbs + ': no scrapes yet (-Action Scrape)')
  } else {
    $dirs = @(Get-ChildItem -LiteralPath $outAbs -Directory -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending)
    if ($dirs.Count -eq 0) { Write-Info ($outAbs + ': empty') }
    else { Write-Ok ('' + $outAbs + ': ' + $dirs.Count + ' profile(s), latest: ' + $dirs[0].Name) }
  }

  # 8. Archive (IG-DATA)
  $dataRoot = Get-DataRoot
  if (-not (Test-Path -LiteralPath $dataRoot)) {
    Write-Warn ('IG-DATA not found at ' + $dataRoot + ' (Archive creates it)'); $warn++
  } else {
    $dDirs = @(Get-ChildItem -LiteralPath $dataRoot -Directory -ErrorAction SilentlyContinue)
    $idx = Test-Path -LiteralPath (Join-Path $dataRoot 'INDEX.md')
    $idxTxt = if ($idx) { 'INDEX.md present' } else { 'INDEX.md missing' }
    Write-Ok ('IG-DATA: ' + $dDirs.Count + ' profile(s), ' + $idxTxt + ' @ ' + $dataRoot)
    if (-not $idx) { Write-Warn 'index missing (-Action Report -Reindex)'; $warn++ }
  }

  Write-Host ''
  if ($fail -gt 0) {
    Write-Fail ('doctor: ' + $fail + ' failure(s), ' + $warn + ' warning(s)')
    return 1
  }
  if ($warn -gt 0) {
    Write-Warn ('doctor: healthy with ' + $warn + ' warning(s)')
    return 0
  }
  Write-Ok 'doctor: all checks passed'
  return 0
}

function Invoke-TestsAction {
  Write-Step 'Action: Tests (lint + unit tests)'
  if (-not (Test-NodePreflight)) { return 1 }
  if ($script:DryRun) {
    Write-Cmd 'npm run lint'
    Write-Cmd 'npm test'
    Write-Warn 'dry-run - commands not executed'
    return 0
  }
  Write-Step 'Tests 1/2: npm run lint'
  # bare "npm", never "& npm" - see the note in Invoke-SetupAction
  npm run lint | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Fail 'lint failed'; return 1 }
  Write-Ok 'lint passed'
  Write-Step 'Tests 2/2: npm test'
  npm test | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Fail 'tests failed'; return 1 }
  Write-Ok 'tests passed'
  return 0
}

# ── Pipeline ──────────────────────────────────────────────────────────────────
function New-PipelineRow([string]$Name, [int]$Code, $Elapsed) {
  return [pscustomobject]@{ Name = $Name; Code = $Code; Elapsed = $Elapsed }
}

function Show-PipelineSummary([object[]]$Rows) {
  Write-Host ''
  Write-Host '  Pipeline summary' -ForegroundColor Cyan
  Write-Host ('  {0,-10} {1,-9} {2,-11}' -f 'step', 'result', 'elapsed') -ForegroundColor DarkGray
  foreach ($r in $Rows) {
    if ($r.Code -eq -1)      { $res = 'skipped' }
    elseif ($r.Code -eq 0)   { $res = 'OK' }
    else                     { $res = ('exit ' + $r.Code) }
    if ($r.Code -eq 0)       { $col = 'Green' }
    elseif ($r.Code -eq -1)  { $col = 'DarkGray' }
    else                     { $col = 'Red' }
    $el = '-'
    if ($r.Elapsed) { $el = $r.Elapsed.ToString('hh\:mm\:ss') }
    Write-Host ('  {0,-10} {1,-9} {2,-11}' -f $r.Name, $res, $el) -ForegroundColor $col
  }
}

function Invoke-FullAction {
  Write-Step 'Action: Full pipeline (Scrape -> Images -> Archive)'
  if (-not (Test-Preflight -Deps)) { return 1 }
  $t = Resolve-Target
  if (-not $t) { return 2 }
  if (-not $script:User) {
    Write-Fail 'pipeline needs -User <username> (the archive step maps to out/<username>)'
    return 2
  }
  if (-not (Confirm-Menu ('Run full pipeline for @' + $script:User + '?'))) {
    Write-Info 'cancelled'
    return 0
  }
  [void](Ensure-Cdp)

  $rows = @()
  $firstFail = 0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  # 1/3 Scrape - failure aborts the pipeline
  $code = Invoke-NodeTool (Get-Tool 'scrape-ig.mjs') (Get-ScrapeArgs) ('Pipeline 1/3: Scrape @' + $script:User)
  $sw.Stop()
  $rows += (New-PipelineRow 'scrape' $code $sw.Elapsed)
  if ($code -ne 0) {
    $rows += (New-PipelineRow 'images' -1 $null)
    $rows += (New-PipelineRow 'archive' -1 $null)
    Write-Fail 'pipeline aborted: scrape failed'
    Show-PipelineSummary $rows
    return $code
  }

  # 2/3 Images - failure warns and continues
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = Invoke-NodeTool (Get-Tool 'ig-images.mjs') (Get-ImagesArgs) ('Pipeline 2/3: Images @' + $script:User)
  $sw.Stop()
  $rows += (New-PipelineRow 'images' $code $sw.Elapsed)
  if ($code -ne 0 -and $firstFail -eq 0) {
    $firstFail = $code
    Write-Warn 'images step failed - continuing to archive'
  }

  # 3/3 Archive
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = Start-Archive
  $sw.Stop()
  $rows += (New-PipelineRow 'archive' $code $sw.Elapsed)
  if ($code -ne 0 -and $firstFail -eq 0) { $firstFail = $code }

  Show-PipelineSummary $rows
  if ($firstFail -ne 0) { return $firstFail }
  Write-Ok 'pipeline complete'
  return 0
}

# ── Menu / help / banner ──────────────────────────────────────────────────────
function Show-Banner {
  $banner = @"
  ==============================================================================
  |                                                                            |
  |   ___ ____       _   _    _    ______     _______ ____ _____ _____ ____    |
  |  |_ _/ ___|     | | | |  / \  |  _ \ \   / / ____/ ___|_   _| ____|  _ \   |
  |   | | |  _ _____| |_| | / _ \ | |_) \ \ / /|  _| \___ \ | | |  _| | |_) |  |
  |   | | |_| |_____|  _  |/ ___ \|  _ < \ V / | |___ ___) || | | |___|  _ <   |
  |  |___\____|     |_| |_/_/   \_\_| \_\ \_/  |_____|____/ |_| |_____|_| \_\  |
  |                                                                            |
  |                    Instagram OSINT Suite  v2.0.0                           |
  |                                                                            |
  ==============================================================================
"@
  Write-Host $banner -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  Author      : Anurag Panda' -ForegroundColor White
  Write-Host '  GitHub      : https://github.com/anurag-panda-dev/ig-harvester' -ForegroundColor White
  Write-Host '  License     : MIT' -ForegroundColor White
  Write-Host ''
  Write-Host '  One command for every tool: scrape, images, report, analyze,' -ForegroundColor Gray
  Write-Host '  archive, browser, setup, doctor, tests.' -ForegroundColor Gray
  Write-Host ''
  Write-Host '  Run without arguments for the menu, or -Action Help for the' -ForegroundColor Gray
  Write-Host '  full CLI reference.' -ForegroundColor Gray
  Write-Host ''
  Write-Host '==============================================================================' -ForegroundColor DarkGray
  Write-Host ''
}

function Show-Header {
  Write-Host ('  ig-harvester v' + $script:Ver + ' :: Instagram OSINT Suite') -ForegroundColor Cyan
  Write-Host ('  action: ' + $script:Action) -ForegroundColor DarkGray
  Write-Host ''
}

function Show-SessionLine {
  $bits = @()
  if ($script:User) { $bits += ('user=' + $script:User) }
  if ($script:Url) { $bits += ('url=' + $script:Url) }
  if ($script:AllPosts) { $bits += 'posts=all' }
  elseif ($script:PostsN -gt 0) { $bits += ('posts=' + $script:PostsN) }
  $sw = @('comments', 'followers', 'following', 'shots', 'sqlite', 'force', 'headless')
  foreach ($n in $sw) {
    $v = $null
    try { $v = (Get-Variable -Name $n -ValueOnly -Scope Script -ErrorAction Stop) } catch { $v = $null }
    if ($v) { $bits += $n }
  }
  if ($script:Force) { if ($bits -notcontains 'force') { $bits += 'force' } }
  $bits += ('out=' + $script:Out)
  if ($bits.Count -gt 0) {
    Write-Host ('  session: ' + ($bits -join '  ')) -ForegroundColor DarkGray
  }
}

function Show-Menu {
  Write-Host ''
  Write-Host '  ===================== ig-harvester menu =====================' -ForegroundColor Cyan
  Write-Host '   1) Scrape        harvest posts / comments / followers -> JSON, CSV, SQLite' -ForegroundColor White
  Write-Host '   2) Images        download full-resolution post images -> PNG' -ForegroundColor White
  Write-Host '   3) Scrape+Images full Scrape + Images (option 1 then 2, one go)' -ForegroundColor Yellow
  Write-Host '   4) Report        write Markdown report + rebuild IG-DATA index' -ForegroundColor White
  Write-Host '   5) Analyze       launch the local dashboard server' -ForegroundColor White
  Write-Host '   6) Archive       import out/<user> into IG-DATA (+ report)' -ForegroundColor White
  Write-Host '   7) Pipeline      Scrape -> Images -> Archive in one go' -ForegroundColor White
  Write-Host '   8) Browser       launch Chrome with remote debugging (port 9222)' -ForegroundColor White
  Write-Host '   9) Setup         npm install + Playwright Chromium + MCP config' -ForegroundColor White
  Write-Host '  10) Doctor        environment diagnostics / health check' -ForegroundColor White
  Write-Host '  11) Tests         npm run lint + npm test' -ForegroundColor White
  Write-Host '  12) Help          show CLI help' -ForegroundColor White
  Write-Host '   0) Exit' -ForegroundColor White
  Write-Host '  =============================================================' -ForegroundColor DarkGray
  Show-SessionLine
}

function Show-Help {
  Write-Host ''
  Write-Host '  ig-harvester - Instagram OSINT Suite, one entry point' -ForegroundColor Cyan
  Write-Host '  ======================================================' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  USAGE' -ForegroundColor Yellow
  Write-Host '    .\ig-harvester.ps1                          interactive menu'
  Write-Host '    .\ig-harvester.ps1 <action> [user] [flags]  run an action directly'
  Write-Host '    .\ig-harvester.ps1 -Action <name> [flags]   same, explicit'
  Write-Host ''
  Write-Host '  ACTIONS (menu numbers)' -ForegroundColor Yellow
  Write-Host '    1 Scrape         harvest posts, comments, followers/following -> JSON/CSV/SQLite'
  Write-Host '    2 Images         download full-resolution post images (carousel aware) -> PNG'
  Write-Host '    3 ScrapeImages   full Scrape + Images in one go (alias: Both, Combo)'
  Write-Host '    4 Report         write Markdown report + rebuild the IG-DATA index'
  Write-Host '    5 Analyze        launch the local dashboard server'
  Write-Host '    6 Archive        import out/<user> into IG-DATA (+ regenerate report)'
  Write-Host '    7 Full           pipeline: Scrape -> Images -> Archive (alias: Pipeline, All)'
  Write-Host '    8 Browser        launch Chrome with remote debugging on port 9222'
  Write-Host '    9 Setup          npm install + Playwright Chromium + MCP config merge'
  Write-Host '   10 Doctor         environment diagnostics (alias: Status)'
  Write-Host '   11 Tests          npm run lint + npm test'
  Write-Host '   12 Help           this help'
  Write-Host ''
  Write-Host '  MENU MODE' -ForegroundColor Yellow
  Write-Host '    Asks for the target first (Enter = default username), then walks'
  Write-Host '    through the run settings (posts, comments, followers, following,'
  Write-Host '    screenshots, SQLite, re-download, headless, output dir) before it'
  Write-Host '    asks "Run ... with current settings? [Y/n]".'
  Write-Host ''
  Write-Host '  COMMON FLAGS (PowerShell style)' -ForegroundColor Yellow
  Write-Host '    -User <name>       target username (aliases: -u -profile -target)'
  Write-Host '    -DefaultUser <name> pre-filled username in the menu prompt (default: anur.panda)'
  Write-Host '    -Url <url>         full Instagram URL as target (Scrape/Images)'
  Write-Host '    -Posts <n|all>     max posts to harvest (default: 30; "all" = no cap)'
  Write-Host '    -AllPosts          every post the grid serves (forwards --posts all)'
  Write-Host '    -Comments -Followers -Following -Shots -Sqlite'
  Write-Host '    -Force             re-download images already on disk (Images)'
  Write-Host '    -Headless          run without a visible browser window'
  Write-Host '    -Out <dir>         output directory (default: out)'
  Write-Host '    -Cdp <url>         CDP endpoint (default: http://127.0.0.1:9222)'
  Write-Host '    -Proxy <url>       http://host:port or socks5://host:port'
  Write-Host '    -Port <n>          dashboard port (default: 8080)'
  Write-Host '    -Dir <path>        report/analyzer data dir (default: <Root>/<user>)'
  Write-Host '    -Root <path>       IG-DATA root (default: ../IG-DATA)'
  Write-Host '    -Source <path>     archive source (default: out/<user>)'
  Write-Host '    -NoReport          Archive: skip report regeneration'
  Write-Host '    -Reindex           Report: rebuild the index for every profile'
  Write-Host '    -SkipBrowser       Setup: skip the Playwright Chromium download'
  Write-Host '    -Yes               non-interactive: assume yes / use defaults'
  Write-Host '    -DryRun            print the exact commands, do not execute'
  Write-Host '    -Help              this help (alias: -h)'
  Write-Host ''
  Write-Host '  GNU-STYLE PASSTHROUGH' -ForegroundColor Yellow
  Write-Host '    Unknown flags are forwarded verbatim to the node tools, so every'
  Write-Host '    scraper flag works, in both forms:'
  Write-Host '      --delay-min 900 --delay-max 2600 --log-level debug --json-log'
  Write-Host '      --no-resume --shot-only --shots-only --proxy-bypass <list>'
  Write-Host '      --profile=someuser --posts=50   (equals form is understood too)'
  Write-Host '      --posts all                     (every post, not just the default 30)'
  Write-Host ''
  Write-Host '  PRIVATE ACCOUNTS' -ForegroundColor Yellow
  Write-Host '    Posts are collected from the profile grid, so Instagram only serves'
  Write-Host '    them to a session that can see them: the burner account must already'
  Write-Host '    follow the target (a pending "Requested" follow serves nothing) and'
  Write-Host '    the browser must be logged in as that burner. By default only the'
  Write-Host '    first 30 posts are harvested - use -Posts <n>, -AllPosts (or'
  Write-Host '    --posts all) for more. The tool warns when the grid returns fewer'
  Write-Host '    posts than the profile header claims.'
  Write-Host ''
  Write-Host '  EXAMPLES' -ForegroundColor Yellow
  Write-Host '    .\ig-harvester.ps1'
  Write-Host '        Interactive menu.'
  Write-Host '    .\ig-harvester.ps1 scrape someuser --posts 50 --comments'
  Write-Host '        Positional action + username + forwarded scraper flags.'
  Write-Host '    .\ig-harvester.ps1 ScrapeImages anur.panda --posts 50 --comments'
  Write-Host '        Menu option 3: full Scrape + Images in one go.'
  Write-Host '    .\ig-harvester.ps1 -Action Full -User someuser -Yes'
  Write-Host '        Non-interactive scrape -> images -> archive pipeline.'
  Write-Host '    .\ig-harvester.ps1 -Action Images -User someuser -Force -DryRun'
  Write-Host '        Show the exact ig-images command without running it.'
  Write-Host '    .\ig-harvester.ps1 -Action Report -Reindex'
  Write-Host '        Rebuild the IG-DATA index for every archived profile.'
  Write-Host '    .\ig-harvester.ps1 -Action Doctor'
  Write-Host '        Check Node.js, dependencies, CDP and data folders.'
  Write-Host ''
  Write-Host '  EXIT CODES' -ForegroundColor Yellow
  Write-Host '    0  success        1  step/preflight failed        2  usage/cancelled'
  Write-Host ''
  Write-Host '  Docs: README.md (full reference), GUIDE.md (playbook).' -ForegroundColor Gray
  Write-Host ''
}

function Invoke-MenuLoop {
  while ($true) {
    Show-Menu
    $choice = Read-Input '  Select 0-12'
    if ($null -eq $choice) {
      Write-Host ''
      Write-Info 'input closed - exiting menu'
      return
    }
    $choice = $choice.Trim()
    $code = 0
    switch ($choice) {
      '0'  { Write-Info 'bye'; return }
      '1'  { $code = Invoke-ScrapeAction }
      '2'  { $code = Invoke-ImagesAction }
      '3'  { $code = Invoke-ScrapeImagesAction }
      '4'  { $code = Invoke-ReportAction }
      '5'  { $code = Invoke-AnalyzeAction }
      '6'  { $code = Invoke-ArchiveAction }
      '7'  { $code = Invoke-FullAction }
      '8'  { $code = Invoke-BrowserAction }
      '9'  { $code = Invoke-SetupAction }
      '10' { $code = Invoke-DoctorAction }
      '11' { $code = Invoke-TestsAction }
      '12' { Show-Help }
      default { Write-Warn ('unknown choice: ' + $choice) }
    }
    if ($code -ne 0) { Write-Warn ('last action finished with exit code ' + $code) }
    Write-Host ''
  }
}

# ── Action name normalization (used by the rest-parser and the dispatch) ──────
function Get-ActionAlias([string]$Raw) {
  $k = $Raw.Trim().ToLower()
  if ($k -eq '') { return 'Menu' }
  $map = @{
    'menu' = 'Menu'; 'interactive' = 'Menu'; 'main' = 'Menu'
    'scrape' = 'Scrape'; 'data' = 'Scrape'; 'collect' = 'Scrape'; 'harvest' = 'Scrape'
    'images' = 'Images'; 'image' = 'Images'; 'img' = 'Images'; 'imgs' = 'Images'
    'pics' = 'Images'; 'photos' = 'Images'
    'scrape+images' = 'ScrapeImages'; 'scrape-images' = 'ScrapeImages'
    'scrapeimages' = 'ScrapeImages'; 'scrape_images' = 'ScrapeImages'
    'scrape+img' = 'ScrapeImages'; 'scrape+imgs' = 'ScrapeImages'
    'img+scrape' = 'ScrapeImages'; 'both' = 'ScrapeImages'
    'combo' = 'ScrapeImages'; 'full-scrape' = 'ScrapeImages'
    'report' = 'Report'; 'reports' = 'Report'
    'analyze' = 'Analyze'; 'analytics' = 'Analyze'; 'dashboard' = 'Analyze'
    'serve' = 'Analyze'; 'server' = 'Analyze'
    'archive' = 'Archive'; 'import' = 'Archive'
    'full' = 'Full'; 'pipeline' = 'Full'; 'all' = 'Full'; 'run' = 'Full'
    'browser' = 'Browser'; 'chrome' = 'Browser'; 'debug' = 'Browser'; 'cdp' = 'Browser'
    'setup' = 'Setup'; 'install' = 'Setup'; 'deps' = 'Setup'
    'doctor' = 'Doctor'; 'status' = 'Doctor'; 'health' = 'Doctor'
    'check' = 'Doctor'; 'env' = 'Doctor'
    'test' = 'Tests'; 'tests' = 'Tests'; 'lint' = 'Tests'; 'verify' = 'Tests'
    'help' = 'Help'
  }
  if ($map.ContainsKey($k)) { return $map[$k] }
  return $null
}

# ── GNU-style rest-parser ─────────────────────────────────────────────────────
# PowerShell binds what it can (--profile foo, --posts 50). Everything else
# lands in $Rest: equals-forms (--delay-min=900), hyphenated node flags that
# do not match a parameter name (--no-resume, --log-level debug) and unknown
# tokens. Parse them manually: harvester parameters are absorbed, everything
# else is forwarded verbatim to the node tools (which parse argv themselves).
# Re-queue any value PowerShell bound into a free positional slot that does
# not belong there: unknown "--flag=value" tokens are grabbed by Action/User
# before they ever reach $Rest, and a bare URL lands in the username slot.
# Real usernames and action names never start with a dash or "http://", so
# those values belong to the parser below, not to the parameter.
$queue = New-Object 'System.Collections.Generic.List[string]'
$requeue = '^(https?|ftp)://'
if ($script:Action -and ($script:Action.StartsWith('-') -or $script:Action -match $requeue)) {
  [void]$queue.Add($script:Action)
  $script:Action = 'Menu'
  $script:ActionGiven = $false
}
if ($script:User -and ($script:User.StartsWith('-') -or $script:User -match $requeue)) {
  [void]$queue.Add($script:User)
  $script:User = ''
  $script:UserGiven = $PSBoundParameters.ContainsKey('Url')
}
if ($Rest) { foreach ($t in @($Rest)) { [void]$queue.Add($t) } }

# Absorb the GNU space form of harvester keys PowerShell cannot bind because of
# the inner hyphen: "--default-user someuser" (the parameter form
# "-DefaultUser someuser" and the equals form "--default-user=x" already bind).
for ($qi = $queue.Count - 1; $qi -ge 0; $qi--) {
  $qTok = $queue[$qi]
  if ([string]::IsNullOrEmpty($qTok) -or -not $qTok.StartsWith('-')) { continue }
  $qKey = ($qTok.TrimStart('-')).ToLower()
  if ($qKey -eq 'default-user' -and ($qi + 1) -lt $queue.Count -and
      -not $queue[$qi + 1].StartsWith('-')) {
    $script:DefaultUser = $queue[$qi + 1]
    $queue.RemoveAt($qi + 1)
    $queue.RemoveAt($qi)
  }
}

if ($queue.Count -gt 0) {
  $nodeValueFlags = @('delay-min', 'delay-max', 'log-level', 'proxy-bypass')
  $psValueKeys = @('action', 'user', 'profile', 'target', 'default-user', 'url', 'posts', 'out', 'cdp',
                   'port', 'dir', 'root', 'source', 'proxy', 'config')
  $psBoolKeys = @('comments', 'followers', 'following', 'shots', 'sqlite', 'force', 'headless',
                  'all-posts', 'no-report', 'reindex', 'skip-browser', 'dry-run', 'yes', 'help',
                  'non-interactive', 'assume-yes')

  $pendingValue = $false
  foreach ($tok in $queue) {
    if ($null -eq $tok -or $tok -eq '') { continue }

    if ($pendingValue) {
      # value belonging to the previous unknown value-flag
      [void]$script:Forward.Add($tok)
      $pendingValue = $false
      continue
    }

    if ($tok.StartsWith('-')) {
      $eq = $tok.IndexOf('=')
      if ($eq -gt -1) {
        $k = ($tok.Substring(0, $eq)).TrimStart('-').ToLower()
        $v = $tok.Substring($eq + 1)
        if ($psValueKeys -contains $k) {
          switch ($k) {
            'action'  { $script:Action = $v; $script:ActionGiven = $true }
            'user'    { $script:User = $v; $script:UserGiven = $true }
            'profile' { $script:User = $v; $script:UserGiven = $true }
            'target'  { $script:User = $v; $script:UserGiven = $true }
            'default-user' { $script:DefaultUser = $v }
            'url'     { $script:Url = $v; $script:UserGiven = $true }
            'posts'   { if ($v -match '^(all|any|unlimited|none|0)$') { $script:AllPosts = $true; $script:PostsN = 0 }
                        else { $n = 0; if ([int]::TryParse($v, [ref]$n)) { $script:PostsN = $n; if ($n -gt 0) { $script:AllPosts = $false } } else { Write-Warn ('ignoring invalid --posts=' + $v + ' (use a number or all)') } } }
            'out'     { $script:Out = $v }
            'cdp'     { $script:Cdp = $v }
            'port'    { $n = 0; if ([int]::TryParse($v, [ref]$n)) { $script:Port = $n } else { Write-Warn ('ignoring non-numeric --port=' + $v) } }
            'dir'     { $script:Dir = $v }
            'root'    { $script:Root = $v }
            'source'  { $script:Source = $v }
            'proxy'   { $script:Proxy = $v }
            'config'  { $script:Config = $v }
          }
        } elseif ($psBoolKeys -contains $k) {
          $on = ($v -eq '' -or $v -match '^(1|true|yes|on)$')
          switch ($k) {
            'comments'         { $script:Comments = $on }
            'followers'        { $script:Followers = $on }
            'following'        { $script:Following = $on }
            'shots'            { $script:Shots = $on }
            'sqlite'           { $script:Sqlite = $on }
            'force'            { $script:Force = $on }
            'headless'         { $script:Headless = $on }
            'all-posts'        { $script:AllPosts = $on }
            'no-report'        { $script:NoReport = $on }
            'reindex'          { $script:Reindex = $on }
            'skip-browser'     { $script:SkipBrowser = $on }
            'dry-run'          { $script:DryRun = $on }
            'yes'              { $script:Yes = $on }
            'help'             { $script:Help = $on }
            'non-interactive'  { $script:Yes = $on }
            'assume-yes'       { $script:Yes = $on }
          }
        } else {
          # equals-form for a node tool flag: split it, node only
          # understands "--flag value", not "--flag=value"
          [void]$script:Forward.Add(($tok.Substring(0, $eq)))
          [void]$script:Forward.Add($v)
        }
        continue
      }

      $k = ($tok.TrimStart('-')).ToLower()
      if ($psBoolKeys -contains $k) {
        switch ($k) {
          'comments'         { $script:Comments = $true }
          'followers'        { $script:Followers = $true }
          'following'        { $script:Following = $true }
          'shots'            { $script:Shots = $true }
          'sqlite'           { $script:Sqlite = $true }
          'force'            { $script:Force = $true }
          'headless'         { $script:Headless = $true }
          'all-posts'        { $script:AllPosts = $true }
          'no-report'        { $script:NoReport = $true }
          'reindex'          { $script:Reindex = $true }
          'skip-browser'     { $script:SkipBrowser = $true }
          'dry-run'          { $script:DryRun = $true }
          'yes'              { $script:Yes = $true }
          'help'             { $script:Help = $true }
          'non-interactive'  { $script:Yes = $true }
          'assume-yes'       { $script:Yes = $true }
        }
        continue
      }
      if ($psValueKeys -contains $k) {
        # declared parameter that reached Rest (defensive): forward as-is
        [void]$script:Forward.Add($tok)
        continue
      }
      [void]$script:Forward.Add($tok)
      if ($nodeValueFlags -contains $k) { $pendingValue = $true }
      continue
    }

    # bare token: a URL is always the target, never an action
    if ($tok -match '^(https?|ftp)://') {
      if (-not $script:Url) {
        $script:Url = $tok
        $script:UserGiven = $true
      } else {
        [void]$script:Forward.Add($tok)
      }
      continue
    }

    # bare token
    if (-not $script:ActionGiven) {
      $canon = Get-ActionAlias $tok
      if ($canon) { $script:Action = $canon; $script:ActionGiven = $true; continue }
      if (-not $script:UserGiven) {
        $script:User = $tok
        $script:UserGiven = $true
      } else {
        [void]$script:Forward.Add($tok)
      }
      continue
    }
    if (-not $script:UserGiven) {
      $script:User = $tok
      $script:UserGiven = $true
      continue
    }
    [void]$script:Forward.Add($tok)
  }
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
$started = Get-Date

if ($script:Action -eq 'Menu' -and -not $script:Help) { Show-Banner }

$canon = $null
if (-not $script:Help) { $canon = Get-ActionAlias $script:Action }

if ($script:Help -or ($null -ne $canon -and $canon -eq 'Help')) {
  Show-Banner
  Show-Help
  $script:ExitCode = 0
} elseif (-not $canon) {
  Write-Host ('  ig-harvester v' + $script:Ver) -ForegroundColor Cyan
  Write-Fail ('unknown action: ' + $script:Action)
  Write-Info 'valid: Menu Scrape Images ScrapeImages Report Analyze Archive Full Browser Setup Doctor Tests Help'
  Write-Info 'try: .\ig-harvester.ps1 -Help'
  $script:ExitCode = 2
} else {
  $script:Action = $canon
  if ($script:Action -ne 'Menu') { Show-Header }
  try {
    switch ($script:Action) {
      'Menu'    { Invoke-MenuLoop }
      'Scrape'  { $script:ExitCode = Invoke-ScrapeAction }
      'Images'  { $script:ExitCode = Invoke-ImagesAction }
      'ScrapeImages' { $script:ExitCode = Invoke-ScrapeImagesAction }
      'Report'  { $script:ExitCode = Invoke-ReportAction }
      'Analyze' { $script:ExitCode = Invoke-AnalyzeAction }
      'Archive' { $script:ExitCode = Invoke-ArchiveAction }
      'Full'    { $script:ExitCode = Invoke-FullAction }
      'Browser' { $script:ExitCode = Invoke-BrowserAction }
      'Setup'   { $script:ExitCode = Invoke-SetupAction }
      'Doctor'  { $script:ExitCode = Invoke-DoctorAction }
      'Tests'   { $script:ExitCode = Invoke-TestsAction }
    }
  } catch {
    if ($_.FullyQualifiedErrorId -like '*PipelineStoppedException*') { throw }
    Write-Fail ('unexpected error: ' + $_.Exception.Message)
    Write-Info ('  at line ' + $_.InvocationInfo.ScriptLineNumber)
    $script:ExitCode = 1
  }
  if ($script:Action -ne 'Menu') {
    $elapsed = (Get-Date) - $started
    Write-Host ''
    if ($script:ExitCode -eq 0) {
      Write-Ok ('result: ' + $script:Action + ' OK (' + $elapsed.ToString('hh\:mm\:ss') + ')')
    } else {
      Write-Fail ('result: ' + $script:Action + ' failed with exit ' + $script:ExitCode)
    }
  }
}

exit $script:ExitCode
