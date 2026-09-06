param(
  [string]$Branch = 'feat/omnichannel-router9-claude-skills'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Wait-BotHubHealthy {
  param([int]$Attempts = 30)
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 3
      if ($health.ok -eq $true) { return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

if (-not (Test-Path '.git')) { throw 'Run this script from a Git clone of Customer-service-bot.' }
if (-not (Test-Path '.env.desktop')) { throw '.env.desktop is missing. Run scripts/docker-desktop.ps1 first.' }

$Dirty = git status --porcelain
if ($Dirty) { throw 'Working tree is not clean. Commit/stash local changes before safe upgrade.' }

$Before = (git rev-parse HEAD).Trim()
Write-Host "Current revision: $Before"

try {
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/operations/backups' -ContentType 'application/json' -Body '{"label":"pre-upgrade"}' -TimeoutSec 30 | Out-Null
  Write-Host 'Pre-upgrade persistent backup created.' -ForegroundColor Green
} catch {
  throw "Backup failed; upgrade aborted. $($_.Exception.Message)"
}

try {
  git fetch origin $Branch
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
  git checkout $Branch
  if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  git pull --ff-only origin $Branch
  if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed' }

  docker compose -f docker-compose.desktop.yml --env-file .env.desktop up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Docker rebuild failed' }
  if (-not (Wait-BotHubHealthy)) { throw 'Health check failed after upgrade' }

  $Doctor = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/operations/doctor' -TimeoutSec 10
  if ($Doctor.doctor.ok -ne $true) { throw 'Operations doctor reported a blocking error after upgrade' }

  $After = (git rev-parse HEAD).Trim()
  Write-Host "Upgrade complete: $Before -> $After" -ForegroundColor Green
  exit 0
} catch {
  $Reason = $_.Exception.Message
  Write-Host "Upgrade failed: $Reason" -ForegroundColor Red
  Write-Host 'Rolling code back to previous revision...' -ForegroundColor Yellow
  git reset --hard $Before
  docker compose -f docker-compose.desktop.yml --env-file .env.desktop up -d --build
  if (Wait-BotHubHealthy) {
    Write-Host 'Rollback runtime is healthy. Persistent pre-upgrade backup was preserved.' -ForegroundColor Green
  } else {
    Write-Host 'Rollback did not become healthy. Inspect Docker logs and the pre-upgrade backup.' -ForegroundColor Red
  }
  throw "Safe upgrade rolled back: $Reason"
}
