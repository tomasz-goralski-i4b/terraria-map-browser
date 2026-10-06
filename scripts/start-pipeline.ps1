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
$git = Get-Command git -ErrorAction SilentlyContinue
$gitRoot = if ($git) { Split-Path (Split-Path $git.Source) } else { 'C:\Program Files\Git' }
$bash = Join-Path $gitRoot 'bin\bash.exe'
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
}

if (-not $watching) {
  Start-BashWindow 'Backlog watch' 'bash scripts/backlog/watch.sh'
  Write-Host 'Backlog watch : started'
}

Write-Host ''
Write-Host "Pipeline up. Automations keep their enabled/paused state: $cockpit/p/terraria-map-studio/automations"
