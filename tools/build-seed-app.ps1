<#
.SYNOPSIS
    Сборка единого приложения демо-стенда: PWA + Go API -> bin\VITAUTO.exe.
.DESCRIPTION
    1. Собирает PWA (pwa\dist) из текущего коммита.
    2. Копирует dist в backend\cmd\vitauto-desktop\webroot (встраивается в exe).
    3. Собирает bin\VITAUTO.exe (без консольного окна).
.PARAMETER SkipPwa
    Не пересобирать PWA (использовать текущий pwa\dist).
.PARAMETER Out
    Путь к exe (по умолчанию bin\VITAUTO.exe).
.EXAMPLE
    .\tools\build-seed-app.ps1
#>
param(
    [switch]$SkipPwa,
    [string]$Out = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$Pwa = Join-Path $Root 'pwa'
$Backend = Join-Path $Root 'backend'
$Webroot = Join-Path $Backend 'cmd\vitauto-desktop\webroot'
if (-not $Out) { $Out = Join-Path $Root 'bin\VITAUTO.exe' }

# Кэш Go — внутри репозитория: сборка работает и в песочнице без доступа к %LOCALAPPDATA%.
$env:GOCACHE = Join-Path $Root '.gocache'
$env:GOTMPDIR = Join-Path $Root '.gotmp'
New-Item -ItemType Directory -Force -Path $env:GOCACHE, $env:GOTMPDIR | Out-Null

function Write-Step($text) { Write-Host "  [..] $text" -ForegroundColor Yellow }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }

# ── Go и Node: PATH или переносимые каталоги ────────────────────────────────
$go = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $go) {
    $go = Get-ChildItem "$env:LOCALAPPDATA\Programs\go*\go\bin\go.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $go) { throw 'Go не найден (нужен для сборки backend)' }
$env:Path = (Split-Path $go) + ';' + $env:Path

$nodeDir = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodeDir) { $nodeDir = Split-Path $nodeDir }
if (-not $nodeDir) {
    $nodeDir = Get-ChildItem "$env:LOCALAPPDATA\Programs\node-*" -Directory -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if ($nodeDir) { $env:Path = $nodeDir + ';' + $env:Path }

$npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = Join-Path $nodeDir 'npm.cmd' }
if (-not $SkipPwa -and -not (Test-Path $npm)) { throw 'npm не найден (нужен для сборки PWA)' }

# ── PWA ─────────────────────────────────────────────────────────────────────
if (-not $SkipPwa) {
    Write-Step 'Сборка PWA (pwa\dist)...'
    Push-Location $Pwa
    try {
        if (-not (Test-Path (Join-Path $Pwa 'node_modules'))) {
            Write-Step 'npm ci...'
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci завершился с ошибкой' }
        }
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'vite build завершился с ошибкой' }
    } finally {
        Pop-Location
    }
    Write-Ok "PWA собрана: $Pwa\dist"
} else {
    Write-Step 'Сборка PWA пропущена (-SkipPwa)'
}
if (-not (Test-Path (Join-Path $Pwa 'dist\index.html'))) { throw "Нет $Pwa\dist\index.html" }

# ── Встраиваемая статика ────────────────────────────────────────────────────
Write-Step 'Копирование pwa\dist -> webroot...'
New-Item -ItemType Directory -Force -Path $Webroot | Out-Null
Get-ChildItem $Webroot -Force | Where-Object { $_.Name -ne 'README.txt' } | Remove-Item -Recurse -Force
Copy-Item (Join-Path $Pwa 'dist\*') $Webroot -Recurse -Force
Write-Ok "webroot: $Webroot"

# ── exe ─────────────────────────────────────────────────────────────────────
Write-Step 'Сборка bin\VITAUTO.exe...'
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
Push-Location $Backend
try {
    & $go build -trimpath -ldflags '-s -w -H=windowsgui' -o $Out ./cmd/vitauto-desktop
    if ($LASTEXITCODE -ne 0) { throw 'go build завершился с ошибкой' }
} finally {
    Pop-Location
}
Write-Ok "Готово: $Out"
Write-Host ''
Write-Host "  Запуск: $Out" -ForegroundColor Cyan
Write-Host "  Ярлык:  tools\seed-stand.ps1 -MakeShortcut" -ForegroundColor Gray
