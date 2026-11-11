<#
.SYNOPSIS
    Демо-стенд vitauto: подготовка БД (свежая схема + seed) и ярлык на рабочем столе.
.DESCRIPTION
    1. При необходимости поднимает PostgreSQL (pg_ctl).
    2. Пересоздаёт базу vitauto_app на порту 5434 и накатывает миграции из текущего коммита.
    3. Загружает демо-данные: seed\demo-app.sql, demo-stages.sql, demo-data.sql.
    4. С -MakeShortcut создаёт ярлык "VITAUTO — демо-стенд" на рабочем столе -> bin\VITAUTO.exe.
.PARAMETER PgPort
    Порт PostgreSQL демо-стенда (по умолчанию 5434).
.PARAMETER PgPassword
    Пароль postgres (по умолчанию postgres).
.PARAMETER PgData
    Каталог данных PostgreSQL (по умолчанию D:\vitauto_app\pgdata).
.PARAMETER SkipReseed
    Не пересоздавать базу, только ярлык/проверка.
.PARAMETER MakeShortcut
    Создать (обновить) ярлык на рабочем столе.
.EXAMPLE
    .\tools\seed-stand.ps1 -MakeShortcut
#>
param(
    [int]$PgPort = 5434,
    [string]$PgPassword = 'postgres',
    [string]$PgData = 'D:\vitauto_app\pgdata',
    [switch]$SkipReseed,
    [switch]$MakeShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$Db = 'vitauto_app'
$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin'
$psql = Join-Path $PgBin 'psql.exe'
$pgCtl = Join-Path $PgBin 'pg_ctl.exe'
$Exe = Join-Path $Root 'bin\VITAUTO.exe'

# Кэш Go — внутри репозитория: миграции применяются и там, где нет доступа к %LOCALAPPDATA%
# (как в tools\build-seed-app.ps1).
$env:GOCACHE = Join-Path $Root '.gocache'
$env:GOTMPDIR = Join-Path $Root '.gotmp'
New-Item -ItemType Directory -Force -Path $env:GOCACHE, $env:GOTMPDIR | Out-Null

function Write-Step($text) { Write-Host "  [..] $text" -ForegroundColor Yellow }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Err($text) { Write-Host "  [FAIL] $text" -ForegroundColor Red }

if (-not (Test-Path $psql)) { throw "psql не найден: $psql" }
$env:PGPASSWORD = $PgPassword

# ── PostgreSQL ──────────────────────────────────────────────────────────────
if (-not (Test-NetConnection 127.0.0.1 -Port $PgPort -WarningAction SilentlyContinue).TcpTestSucceeded) {
    Write-Step "Запуск PostgreSQL ($PgData, порт $PgPort)..."
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
    & $pgCtl start -D $PgData -l (Join-Path $Root 'logs\pg-stand.log') -w -t 60 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL не запустился' }
}
Write-Ok "PostgreSQL на $PgPort"

if (-not $SkipReseed) {
    # ── База с нуля ─────────────────────────────────────────────────────────
    Write-Step "Пересоздание базы $Db..."
    # psql пишет NOTICE в stderr; при $ErrorActionPreference = 'Stop' это исключение.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 `
            -c "drop database if exists $Db with (force);" `
            -c "create database $Db template template0 encoding 'UTF8' locale_provider icu icu_locale 'ru-RU' locale 'C';"
        $recreateExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prevEap }
    if ($recreateExit -ne 0) { throw "Не удалось пересоздать $Db" }
    Write-Ok "База $Db создана"

    # ── Схема (миграции текущего коммита) ───────────────────────────────────
    Write-Step 'Миграции: go run ./cmd/migrator schema-up...'
    $go = $null
    $goCmd = Get-Command go -ErrorAction SilentlyContinue
    if ($goCmd) { $go = $goCmd.Source }
    if (-not $go) {
        $go = Get-ChildItem "$env:LOCALAPPDATA\Programs\go*\go\bin\go.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $go) { throw 'Go не найден' }
    $env:Path = (Split-Path $go) + ';' + $env:Path
    $env:VITAUTO_DB = "postgres://postgres:${PgPassword}@127.0.0.1:${PgPort}/$Db"
    Push-Location (Join-Path $Root 'backend')
    # Go-логгер пишет информационные строки в stderr: при $ErrorActionPreference = 'Stop'
    # PowerShell считает их ошибкой — та же причина, что и в init-db.ps1.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $go run ./cmd/migrator schema-up 2>&1 | ForEach-Object { "$_" }
        $migrateExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
    if ($migrateExit -ne 0) { throw 'schema-up завершился с ошибкой' }
    Write-Ok 'Схема обновлена'

    # ── Демо-данные ─────────────────────────────────────────────────────────
    Write-Step 'Демо-данные (clean + demo-app + demo-stages + demo-data)...'
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & (Join-Path $Root 'seed\full-seed.ps1') -Port $PgPort -Password $PgPassword 2>&1 | ForEach-Object { "$_" }
        $seedExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prevEap }
    if ($seedExit -ne 0) { throw 'seed завершился с ошибкой' }
}

# ── Ярлык ───────────────────────────────────────────────────────────────────
if ($MakeShortcut) {
    if (-not (Test-Path $Exe)) { throw "Нет $Exe — сначала запустите tools\build-seed-app.ps1" }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'VITAUTO — демо-стенд.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $Exe
    $lnk.WorkingDirectory = $Root
    $lnk.Description = 'VITAUTO — демо-стенд (seed)'
    $lnk.IconLocation = "$Exe,0"
    $lnk.Save()
    Write-Ok "Ярлык: $lnkPath"
}

Write-Host ''
Write-Host '  Готово. Запуск: bin\VITAUTO.exe или ярлык на рабочем столе.' -ForegroundColor Green
Write-Host '  Вход: Администратор / admin123, Менеджер / manager123, Снабженец / supply123,' -ForegroundColor Gray
Write-Host '        Кладовщик / storekeeper123, ГлавныйМеханик / chief123' -ForegroundColor Gray
