param(
  [switch]$Rebuild,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ($buffer | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Get-LanIPv4 {
  try {
    $addresses = Get-NetIPConfiguration | Where-Object {
      $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -and $_.IPv4Address
    } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object {
      $_ -match '^10\.' -or $_ -match '^192\.168\.' -or $_ -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
    }
    return $addresses | Select-Object -First 1
  } catch {
    return $null
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found. Install/start Docker Desktop first.'
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is installed but the Docker daemon is not running.' }

docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

$LanIp = Get-LanIPv4
$EnvFile = Join-Path $RepoRoot '.env.desktop'
if (-not (Test-Path $EnvFile)) {
  $PostgresPassword = New-HexSecret 24
  $N8nKey = New-HexSecret 32
  $PublicBase = if ($LanIp) { "http://$LanIp`:8787" } else { '' }
  @"
PUBLIC_BASE_URL=$PublicBase
WEB_CONSOLE_ORIGINS=https://customer-service-bot-zeta.vercel.app,https://customer-service-bot-duc-s-projects.vercel.app
POSTGRES_PASSWORD=$PostgresPassword
N8N_ENCRYPTION_KEY=$N8nKey
BOT_HUB_ADMIN_USER=admin
BOT_HUB_ADMIN_TOKEN=
CONVERSATION_RETENTION_DAYS=30
"@ | Set-Content -Path $EnvFile -Encoding UTF8
  Write-Host "Created $EnvFile" -ForegroundColor Green
} else {
  Write-Host '.env.desktop already exists; preserving current values.' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'data\repos') | Out-Null

$ComposeArgs = @('compose', '-f', 'docker-compose.desktop.yml', '--env-file', '.env.desktop', 'up', '-d')
if ($Rebuild) { $ComposeArgs += '--build' } else { $ComposeArgs += '--build' }
& docker @ComposeArgs
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed to start Bot Hub.' }

$Healthy = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 3
    if ($health.ok -eq $true) { $Healthy = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $Healthy) {
  docker compose -f docker-compose.desktop.yml --env-file .env.desktop ps
  docker compose -f docker-compose.desktop.yml --env-file .env.desktop logs --tail 80 bot
  throw 'Bot Hub did not become healthy within 60 seconds.'
}

Write-Host ''
Write-Host 'Bot Hub Docker Desktop is healthy.' -ForegroundColor Green
Write-Host 'Local runtime: http://127.0.0.1:8787'
if ($LanIp) {
  Write-Host "Phone/LAN handoff: http://$LanIp`:8787" -ForegroundColor Cyan
} else {
  Write-Host 'No LAN IPv4 detected. Phone QR handoff needs Wi-Fi/Ethernet or a public HTTPS runtime.' -ForegroundColor Yellow
}
Write-Host 'Vercel console: https://customer-service-bot-zeta.vercel.app/?runtime=local' -ForegroundColor Cyan
Write-Host 'n8n: http://127.0.0.1:5678'
Write-Host ''
Write-Host 'Useful commands:'
Write-Host '  docker compose -f docker-compose.desktop.yml --env-file .env.desktop ps'
Write-Host '  docker compose -f docker-compose.desktop.yml --env-file .env.desktop logs -f bot'
Write-Host '  docker compose -f docker-compose.desktop.yml --env-file .env.desktop down'

if (-not $NoBrowser) {
  Start-Process 'https://customer-service-bot-zeta.vercel.app/?runtime=local'
}
