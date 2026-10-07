<#
.SYNOPSIS
  Starts the local agent pipeline after a reboot: the Cezar cockpit and the backlog watcher.

.DESCRIPTION
  Cezar keeps its automations (enabled/paused, event cursor) and runs on disk, so after a reboot it only has to be
  started again - interrupted runs are recovered by Cezar itself. It must run from Git Bash, not WSL
  (docs/agent-workflow.md). The backlog watcher (scripts/backlog/watch.sh) finishes chains Cezar ended early,
  flags stalls and promotes the next issues.

  Each part starts in its own Git Bash window and is skipped when it is already running.

.PARAMETER Check
  Only report what is running; start nothing.

.PARAMETER InstallAutostart
  Add a shortcut to this script to the Windows Startup folder (runs at logon), then start the pipeline.

.PARAMETER RemoveAutostart
  Remove that shortcut and exit.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-pipeline.ps1
#>
param(
  [switch]$Check,
  [switch]$InstallAutostart,
  [switch]$RemoveAutostart
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Terraria Map Studio pipeline.lnk'

if ($RemoveAutostart) {
  if (Test-Path $shortcut) { Remove-Item $shortcut; Write-Host "Autostart removed: $shortcut" }
  else { Write-Host 'Autostart was not installed.' }
  return
}

# Git for Windows' bash, in its own console window per part (never WSL's C:\Windows\System32\bash.exe).
# git.exe lives in Git\cmd, or in Git\mingw64\bin when PowerShell is started from Git Bash: walk up to the root.
$git = Get-Command git -ErrorAction SilentlyContinue
$bash = $null
$dir = if ($git) { Split-Path $git.Source } else { $null }
while ($dir -and -not $bash) {
  if (Test-Path (Join-Path $dir 'bin\bash.exe')) { $bash = Join-Path $dir 'bin\bash.exe' }
  $dir = Split-Path $dir
}
if (-not $bash) { $bash = 'C:\Program Files\Git\bin\bash.exe' }
if (-not (Test-Path $bash)) { throw "Git for Windows not found (looked for $bash)." }

# D:\REPOS\x -> /d/REPOS/x for bash
$repoPosix = '/' + $repo.Substring(0, 1).ToLower() + ($repo.Substring(2) -replace '\\', '/')

function Find-Cockpit {
  foreach ($port in 4321..4330) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 3
      if ($health.repoRoot -and ((Resolve-Path $health.repoRoot).Path -eq $repo)) { return "http://localhost:$port" }
    } catch { }
  }
  return $null
}

function Test-Watcher {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'bash.exe'" -ErrorAction SilentlyContinue
  return [bool]($procs | Where-Object { $_.CommandLine -like '*scripts/backlog/watch.sh*' })
}

function Start-BashWindow([string]$title, [string]$command) {
  # $command must not contain double quotes (they would end the argument). The title is set with an ANSI sequence;
  # the window stays open after the command ends, so an error stays readable.
  $script = "echo -ne '\033]0;$title\007'; cd '$repoPosix' && $command; echo; echo '[$title stopped - press Enter to close]'; read"
  Start-Process -FilePath $bash -ArgumentList @('-lc', "`"$script`"") | Out-Null
}

$cockpit = Find-Cockpit
$watching = Test-Watcher
Write-Host ("Cezar cockpit : " + $(if ($cockpit) { "running at $cockpit" } else { 'not running' }))
Write-Host ("Backlog watch : " + $(if ($watching) { 'running' } else { 'not running' }))
if ($Check) { return }

if ($InstallAutostart) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  $link.TargetPath = (Get-Command powershell.exe).Source
  $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$PSCommandPath`""
  $link.WorkingDirectory = $repo
  $link.Save()
  Write-Host "Autostart installed: $shortcut"
}

if (-not $cockpit) {
  # CEZ_DISPATCH=0: agents in a chain do not spawn their own subtasks (those have no TDD gates).
  Start-BashWindow 'Cezar' 'export CEZ_DISPATCH=0 && npx cezar-run'
  Write-Host -NoNewline 'Waiting for the Cezar cockpit'
  $deadline = (Get-Date).AddMinutes(3)
  while (-not $cockpit -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    Write-Host -NoNewline '.'
    $cockpit = Find-Cockpit
  }
  Write-Host ''
  if (-not $cockpit) { throw 'The Cezar cockpit did not come up within 3 minutes - check the "Cezar" window.' }
  Write-Host "Cezar cockpit : started at $cockpit"

  # A freshly started cockpit re-baselines every automation on its first poll ("from now on"), a minute or two
  # after it answers health checks. The watcher promotes issues (adds agent:ready) on its first tick, so starting it
  # earlier means those labels predate the baseline and no automation ever picks them up. Wait for the first poll.
  $started = (Get-Date).ToUniversalTime()
  Write-Host -NoNewline 'Waiting for every enabled automation to poll GitHub once'
  $deadline = (Get-Date).AddMinutes(5)
  $polled = $false
  while (-not $polled -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    Write-Host -NoNewline '.'
    try {
      $automations = (Get-Content (Join-Path $repo '.ai\cezar\automations.json') -Raw -Encoding UTF8 | ConvertFrom-Json).automations
      $states = (Get-Content (Join-Path $repo '.ai\cezar\automation-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json).states
      $pending = @($automations | Where-Object { $_.enabled } | Where-Object {
          $state = $states.($_.id)
          -not $state -or -not $state.lastSuccessAt -or ([DateTime]::Parse($state.lastSuccessAt).ToUniversalTime() -lt $started)
        })
      $polled = ($pending.Count -eq 0)
    } catch { }
  }
  Write-Host ''
  if (-not $polled) { Write-Warning 'Automations have not polled within 5 minutes - starting the watcher anyway; re-add agent:ready to issues it promotes now if no run starts.' }
}

if (-not $watching) {
  Start-BashWindow 'Backlog watch' 'bash scripts/backlog/watch.sh'
  Write-Host 'Backlog watch : started'
}

Write-Host ''
Write-Host "Pipeline up. Automations keep their enabled/paused state: $cockpit/p/terraria-map-studio/automations"
