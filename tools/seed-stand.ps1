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
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 `
        -c "drop database if exists $Db with (force);" `
        -c "create database $Db template template0 encoding 'UTF8' locale_provider icu icu_locale 'ru-RU' locale 'C';"
    if ($LASTEXITCODE -ne 0) { throw "Не удалось пересоздать $Db" }
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
    try {
        & $go run ./cmd/migrator schema-up
        if ($LASTEXITCODE -ne 0) { throw 'schema-up завершился с ошибкой' }
    } finally {
        Pop-Location
    }
    Write-Ok 'Схема обновлена'

    # ── Демо-данные ─────────────────────────────────────────────────────────
    Write-Step 'Демо-данные (clean + demo-app + demo-stages + demo-data)...'
    & (Join-Path $Root 'seed\full-seed.ps1') -Port $PgPort -Password $PgPassword
    if ($LASTEXITCODE -ne 0) { throw 'seed завершился с ошибкой' }
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
