<#
.SYNOPSIS
    Запуск vitauto без 1С: Go API (:18100) + Vue PWA (:5173) + PostgreSQL (:5432).
.DESCRIPTION
    1. Авто-повышение прав (перезапуск себя с UAC).
    2. Проверка компонентов (Go, Node.js, PostgreSQL).
    3. Инициализация БД (init-db.ps1), если база ещё не создана.
    4. Сборка и запуск vitauto-api на :18100.
    5. Запуск PWA (vite) на :5173 (прокси /api -> :18100 настроен в vite.config.js).
.PARAMETER PgPort
    Порт PostgreSQL (по умолчанию 5432).
.PARAMETER PgPassword
    Пароль postgres (по умолчанию postgres).
.PARAMETER SkipInit
    Пропустить инициализацию БД.
.EXAMPLE
    .\start-dev.ps1
    .\start-dev.ps1 -PgPassword 'secret' -SkipInit
#>
param(
    [int]$PgPort = 5432,
    [string]$PgPassword = 'postgres',
    [switch]$SkipInit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

# ── Авто-повышение прав ────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "`n[!] Требуется запуск от Администратора. Перезапуск..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    $argsList = @("-PgPort", $PgPort)
    if ($PgPassword) { $argsList += "-PgPassword '$PgPassword'" }
    if ($SkipInit) { $argsList += '-SkipInit' }
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $($argsList -join ' ')"
    exit 0
}

# ── Утилиты ─────────────────────────────────────────────────────────────────
function Write-Header($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Step($text) { Write-Host "  [..] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "  [FAIL] $text" -ForegroundColor Red }

$GoExe = Join-Path $Root 'bin\vitauto-api.exe'

# ── Проверка компонентов ────────────────────────────────────────────────────
Write-Header "ПРОВЕРКА КОМПОНЕНТОВ"

$goCmd = Get-Command go -ErrorAction SilentlyContinue
if (-not $goCmd) { Write-Err "Go не найден в PATH (запустите .\check-setup.ps1)"; exit 1 }
Write-Ok "Go: $(& go version)"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Err "Node.js не найден в PATH (запустите .\check-setup.ps1)"; exit 1 }
Write-Ok "Node.js: $(& node --version), npm: $(& npm --version)"

# ── PostgreSQL ──────────────────────────────────────────────────────────────
Write-Header "PostgreSQL"
$pgRunning = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('localhost', $PgPort)
    $tcp.Close()
    $pgRunning = $true
    Write-Ok "PostgreSQL на порту $PgPort запущен"
} catch {
    Write-Step "PostgreSQL не отвечает на $PgPort - запуск через init-db.ps1..."
}

# ── Инициализация БД ────────────────────────────────────────────────────────
if (-not $SkipInit) {
    Write-Header "ИНИЦИАЛИЗАЦИЯ БАЗЫ"
    & (Join-Path $Root 'init-db.ps1') -PgPort $PgPort -PgPassword $PgPassword
    if ($LASTEXITCODE -ne 0 -and -not $pgRunning) { Write-Err "init-db.ps1 завершился с ошибкой"; exit 1 }
} else {
    if (-not $pgRunning) { Write-Err "PostgreSQL не запущен, а инициализация пропущена (-SkipInit)"; exit 1 }
    Write-Step "Пропуск инициализации (флаг -SkipInit)"
}

# ── Go-бэкенд ───────────────────────────────────────────────────────────────
Write-Header "GO API (:18100)"
Push-Location (Join-Path $Root 'backend')
Write-Step "Сборка vitauto-api..."
mkdir (Join-Path $Root 'bin') -ErrorAction SilentlyContinue | Out-Null
& go build -o $GoExe ./cmd/api
if ($LASTEXITCODE -ne 0) { Write-Err "Сборка не удалась"; Pop-Location; exit 1 }
Pop-Location
Write-Ok "Собрано: $GoExe"

$env:VITAUTO_ADDR = '127.0.0.1:18100'
$env:VITAUTO_DB = "postgres://postgres:${PgPassword}@localhost:${PgPort}/vitauto_app"
$goProc = Start-Process -FilePath $GoExe -PassThru -WindowStyle Minimized
Write-Ok "vitauto-api запущен (PID $($goProc.Id)), http://127.0.0.1:18100"

Start-Sleep 2
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:18100/api/v1/health' -TimeoutSec 10
    Write-Ok "health: $($health.status) (database: $($health.database))"
} catch {
    Write-Err "health не отвечает: $_"
}

# ── PWA ─────────────────────────────────────────────────────────────────────
Write-Header "PWA VUE (:5173)"
$pwaDir = Join-Path $Root 'pwa'
if (-not (Test-Path (Join-Path $pwaDir 'node_modules'))) {
    Write-Step "npm ci (первый запуск, ~1-2 мин)..."
    Push-Location $pwaDir
    & npm ci --no-audit --no-fund 2>&1 | Select-Object -Last 3
    Pop-Location
    if ($LASTEXITCODE -ne 0) { Write-Err "npm ci не удался"; exit 1 }
    Write-Ok "Зависимости установлены"
} else {
    Write-Ok "node_modules найдены"
}

Write-Step "Запуск vite (dev)..."
# Запускаем npx через cmd /c в отдельном окне (окно свёрнуто)
$pwaProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$pwaDir`" && npx vite --mode vitauto" -PassThru -WindowStyle Minimized
Write-Ok "vite запущен (PID $($pwaProc.Id)), http://127.0.0.1:5173"

# ── Итог ────────────────────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  ГОТОВО" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  PWA:     http://127.0.0.1:5173" -ForegroundColor White
Write-Host "  API:     http://127.0.0.1:18100/api/v1/health" -ForegroundColor White
Write-Host "  Swagger: http://127.0.0.1:18100/api/docs" -ForegroundColor White
Write-Host ""
Write-Host "  Вход (логин / пароль):" -ForegroundColor Gray
Write-Host "    Администратор / admin123" -ForegroundColor Gray
Write-Host "    Менеджер / manager123" -ForegroundColor Gray
Write-Host "    Снабженец / supply123" -ForegroundColor Gray
Write-Host "    Кладовщик / storekeeper123" -ForegroundColor Gray
Write-Host "    ГлавныйМеханик / chief123" -ForegroundColor Gray
Write-Host ""
Write-Host "  Остановить: .\stop-dev.ps1" -ForegroundColor DarkGray

Write-Host "`nНажмите Enter для выхода (процессы продолжат работу в свёрнутых окнах)..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
