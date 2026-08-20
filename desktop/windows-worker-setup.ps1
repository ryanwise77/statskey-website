#Requires -Version 5.1
<#
.SYNOPSIS
  StatsKey Fleet worker setup for a Windows machine (development mode).

.DESCRIPTION
  Installs a user-scope Node 22 (if missing), expands the synced
  statskey-website source tree, installs dependencies, builds the desktop web
  client, and writes Start-StatsKeyWorker.ps1.

  Development mode is required today: packaged Windows workers stay
  fail-closed until the separately privileged signed service owns the Job
  Object. In development mode the desktop uses the pinned PowerShell/C# Job
  Object process owner, which enforces lease and deadline fencing for the
  process tree but shares the signed-in user's token.

  Run this in an interactive session (console or RDP). Electron cannot run in
  Session 0 / as a service.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File windows-worker-setup.ps1 `
    -SourceArchive "$env:USERPROFILE\Downloads\statskey-website-sync.tar.gz"
#>
param(
  [string]$InstallRoot = "$env:USERPROFILE\statskey",
  [string]$SourceArchive = "$env:USERPROFILE\Downloads\statskey-website-sync.tar.gz"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($Message) { Write-Host "`n=== $Message ===" }

$sourceRoot = Join-Path $InstallRoot 'statskey-website'
$desktopRoot = Join-Path $sourceRoot 'desktop'
$nodeRoot = Join-Path $InstallRoot 'node'

Write-Step 'Node 22'
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeVersion = if ($node) { (& node --version) } else { $null }
if ($nodeVersion -and $nodeVersion -match '^v22\.') {
  Write-Host "Node $nodeVersion already available."
} else {
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/latest-v22.x/' -UseBasicParsing
  $fileName = ([regex]::Match($index, 'node-v22\.\d+\.\d+-win-x64\.zip')).Value
  if (-not $fileName) { throw 'Could not resolve the latest Node 22 Windows package.' }
  $zipPath = Join-Path $env:TEMP $fileName
  Write-Host "Downloading $fileName..."
  Invoke-WebRequest -Uri "https://nodejs.org/dist/latest-v22.x/$fileName" -OutFile $zipPath -UseBasicParsing
  if (Test-Path $nodeRoot) { Remove-Item $nodeRoot -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $InstallRoot -Force
  $extracted = Join-Path $InstallRoot ($fileName -replace '\.zip$', '')
  Rename-Item $extracted $nodeRoot
  Remove-Item $zipPath -Force
  $env:PATH = "$nodeRoot;$env:PATH"
  Write-Host "Node $(& node --version) installed to $nodeRoot (user scope)."
}
if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $nodeRoot })) {
  $env:PATH = "$nodeRoot;$env:PATH"
}

Write-Step 'Source tree'
if (-not (Test-Path $SourceArchive)) {
  throw "Source archive not found: $SourceArchive. Copy statskey-website-sync.tar.gz from the controller Mac first."
}
if (Test-Path $sourceRoot) { Remove-Item $sourceRoot -Recurse -Force }
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
# Windows ships bsdtar as tar.exe, which reads gzipped tarballs.
tar -xzf $SourceArchive -C $sourceRoot
Write-Host 'Source extracted.'

Write-Step 'Dependencies (this takes a few minutes)'
Push-Location $sourceRoot
npm ci --no-audit --no-fund
Pop-Location
Push-Location $desktopRoot
npm ci --no-audit --no-fund
if (-not (Test-Path (Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'))) {
  node node_modules\electron\install.js
}
Pop-Location

Write-Step 'Desktop web client build'
Push-Location $sourceRoot
npm run build:desktop
Pop-Location
if (-not (Test-Path (Join-Path $sourceRoot 'dist\desktop-app.html'))) {
  throw 'The desktop web client build did not produce dist\desktop-app.html.'
}

Write-Step 'Launcher'
$launcher = Join-Path $InstallRoot 'Start-StatsKeyWorker.ps1'
@"
`$ErrorActionPreference = 'Stop'
`$env:PATH = '$nodeRoot;' + `$env:PATH
Set-Location '$desktopRoot'
& '$desktopRoot\node_modules\electron\dist\electron.exe' . *`$args |
  Tee-Object -FilePath '$InstallRoot\statskey-worker.log' -Append
"@ | Set-Content -Path $launcher -Encoding UTF8
Write-Host "Wrote $launcher"

Write-Step 'Done — next steps'
Write-Host @'
1. Start the worker in this session:
     powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\statskey\Start-StatsKeyWorker.ps1"
2. In the StatsKey window, sign in with the owner's StatsKey account.
3. Fleet tab -> "Prepare worker" -> "Copy device card".
4. On the controller Mac: Fleet -> "Pair another computer" -> paste the card
   -> approve -> copy the approval package.
5. Back here: "Complete worker pairing" -> paste the package -> confirm.
The worker then polls and executes jobs targeted at it.
'@
