# Deploy the Featurebase Intercom Canvas app to a VPS that was set up with
# scripts/provision.sh. Run from the project root or from anywhere — the script
# resolves paths relative to itself.
#
# Usage:
#   scripts\deploy.ps1 -VpsHost 1.2.3.4 -User ubuntu
#   scripts\deploy.ps1 -VpsHost intercom-canvas.example.com -User ubuntu
#
# What it does:
#   1. Bundles src/, test/, package*.json, README.md, .env.example, .gitignore
#      into a tarball using Windows' built-in tar.
#   2. scp's the tarball to /tmp on the VPS.
#   3. Runs `sudo fb-deploy-finish` over SSH — that script (installed by
#      provision.sh) syncs into /opt/featurebase-intercom, runs `npm ci`,
#      and restarts the systemd service.
#   4. Curls the public /health endpoint to confirm the new version is up.
#
# Requires: PowerShell 5.1+ and OpenSSH (ssh.exe, scp.exe, tar.exe — all
# bundled with Windows 10/11 by default).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VpsHost,

    [Parameter(Mandatory = $true)]
    [string]$User,

    [string]$Domain = $VpsHost
)

$ErrorActionPreference = 'Stop'

# Resolve project root (scripts/ is one level down)
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

Write-Host "==> Project:   $projectRoot" -ForegroundColor Cyan
Write-Host "==> VPS:       $User@$VpsHost" -ForegroundColor Cyan
Write-Host "==> Domain:    https://$Domain" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
$includes = @(
    'src',
    'test',
    'package.json',
    'package-lock.json',
    'README.md',
    '.env.example',
    '.gitignore'
)

foreach ($p in $includes) {
    if (-not (Test-Path $p)) {
        Write-Error "Missing required path: $p"
    }
}

if (-not (Test-Path 'package-lock.json')) {
    Write-Error "package-lock.json missing. Run 'npm install' locally first."
}

# ---------------------------------------------------------------------------
$tempTar = Join-Path $env:TEMP "fb-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').tar"

Write-Host "==> Bundling tarball..."
# Windows tar is BSD libarchive; same flags as POSIX tar.
& tar -cf $tempTar $includes
if ($LASTEXITCODE -ne 0) { Write-Error "tar failed (exit $LASTEXITCODE)" }

$sizeKB = [math]::Round((Get-Item $tempTar).Length / 1KB, 1)
Write-Host "    $sizeKB KB"

# ---------------------------------------------------------------------------
$remoteTar = "/tmp/fb-deploy-$([guid]::NewGuid().ToString('N')).tar"

Write-Host "==> Uploading to ${User}@${VpsHost}:$remoteTar ..."
& scp -q $tempTar "${User}@${VpsHost}:$remoteTar"
if ($LASTEXITCODE -ne 0) {
    Remove-Item $tempTar -Force -ErrorAction SilentlyContinue
    Write-Error "scp failed (exit $LASTEXITCODE)"
}
Remove-Item $tempTar -Force

# ---------------------------------------------------------------------------
Write-Host "==> Running fb-deploy-finish on the server..."
Write-Host ""
# As root, skip sudo. As any other user, sudo -n hits the sudoers entry
# provision.sh installed (no password required).
$remoteCmd = if ($User -eq 'root') {
    "/usr/local/bin/fb-deploy-finish $remoteTar"
} else {
    "sudo -n /usr/local/bin/fb-deploy-finish $remoteTar"
}
& ssh "${User}@${VpsHost}" $remoteCmd
$deployExit = $LASTEXITCODE
Write-Host ""

if ($deployExit -ne 0) {
    Write-Error "Remote deploy script failed (exit $deployExit). Run 'ssh ${User}@${VpsHost} sudo journalctl -u featurebase-intercom -n 50' to investigate."
}

# ---------------------------------------------------------------------------
Write-Host "==> Public smoke test: https://$Domain/health"
try {
    $health = Invoke-RestMethod -Uri "https://$Domain/health" -TimeoutSec 10
    $mode = if ($health.mock) { 'MOCK' } else { 'LIVE' }
    Write-Host "    ok=$($health.ok)  mode=$mode  uptime=$([math]::Round($health.uptime,1))s" -ForegroundColor Green
    if ($health.mock) {
        Write-Host ""
        Write-Host "    Heads-up: server is in MOCK mode. To go live:" -ForegroundColor Yellow
        Write-Host "      ssh ${User}@${VpsHost}" -ForegroundColor Yellow
        Write-Host "      sudo nano /opt/featurebase-intercom/.env   # set FEATUREBASE_API_KEY=..." -ForegroundColor Yellow
        Write-Host "      sudo systemctl restart featurebase-intercom" -ForegroundColor Yellow
    }
}
catch {
    Write-Warning "Could not reach https://$Domain/health from your machine: $_"
    Write-Warning "The deploy itself succeeded on the server. Check DNS and Caddy if this is unexpected."
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
