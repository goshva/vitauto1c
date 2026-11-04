<#
.SYNOPSIS
    Создание и инициализация базы vitauto_app (без 1С).
.DESCRIPTION
    1. Авто-повышение прав (перезапуск себя с UAC).
    2. Проверка PostgreSQL (порт 5432, psql в стандартном каталоге или PATH).
    3. Запуск службы PostgreSQL (если остановлена).
    4. Создание базы vitauto_app (если нет).
    5. Применение миграций через go-мigrator.
    6. Загрузка демо-данных (справочники, пользователи, роли).
.PARAMETER PgPort
    Порт PostgreSQL (по умолчанию 5432).
.PARAMETER PgPassword
    Пароль postgres (спрашивается, если не задан).
.PARAMETER NoSeed
    Не загружать демо-данные.
.EXAMPLE
    .\init-db.ps1
    .\init-db.ps1 -PgPort 5432 -PgPassword 'mypassword' -NoSeed
#>
param(
    [int]$PgPort = 5432,
    [string]$PgPassword = '',
    [switch]$NoSeed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

# ── Авто-повышение прав ────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "`n[!] Требуется запуск от Администратора. Перезапуск..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    $argsList = @()
    if ($PgPassword) { $argsList += "-PgPassword '$PgPassword'" }
    if ($NoSeed) { $argsList += '-NoSeed' }
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $($argsList -join ' ')"
    exit 0
}

# ── Утилиты ─────────────────────────────────────────────────────────────────
function Write-Header($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Step($text) { Write-Host "  [..] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "  [FAIL] $text" -ForegroundColor Red }

# ── Находим psql ────────────────────────────────────────────────────────────
Write-Header "PostgreSQL клиент"
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    $stdPsql = 'C:\Program Files\PostgreSQL 1C\18\bin\psql.exe'
    if (Test-Path $stdPsql) { $psql = $stdPsql }
    else {
        Write-Err "psql не найден (ни в PATH, ни в стандартном каталоге)"
        exit 1
    }
} else {
    $psql = $psql.Source
}
Write-Ok "psql: $psql"

# ── Запускаем PostgreSQL ────────────────────────────────────────────────────
Write-Header "PostgreSQL сервер"
$pgBin = 'C:\Program Files\PostgreSQL 1C\18\bin'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgData = 'D:\PostgreSQL 1C\18\data'

# Проверяем, запущен ли
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('localhost', $PgPort)
    $tcp.Close()
    Write-Ok "PostgreSQL на порту $PgPort запущен"
} catch {
    Write-Step "Запуск PostgreSQL через pg_ctl..."
    $logFile = Join-Path $Root 'logs\pg-init.log'
    mkdir (Split-Path $logFile) -ErrorAction SilentlyContinue
    & $pgCtl start -D $pgData -l $logFile -w -t 60 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Не удалось запустить PostgreSQL"
        Write-Host "Последние строки лога:" -ForegroundColor DarkGray
        Get-Content $logFile -Tail 10 -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Ok "PostgreSQL запущен (PID через pg_ctl)"
}

# ── Пароль ──────────────────────────────────────────────────────────────────
if (-not $PgPassword) {
    $PgPassword = Read-Host "Пароль postgres" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PgPassword)
    $PgPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}

# ── Создаём базу ────────────────────────────────────────────────────────────
Write-Header "База vitauto_app"
$dbName = 'vitauto_app'
$env:PGPASSWORD = $PgPassword

$dbExists = & $psql -h localhost -p $PgPort -U postgres -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname='$dbName';" 2>&1
if ($dbExists.Trim() -ne '1') {
    Write-Step "Создание базы $dbName..."
    & $psql -h localhost -p $PgPort -U postgres -d postgres -c "CREATE DATABASE $dbName TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ru-RU' LOCALE 'C';" 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Err "Не удалось создать базу $dbName"; exit 1 }
    Write-Ok "База $dbName создана"
} else {
    Write-Ok "База $dbName уже существует"
}

# ── Миграции схемы (через Go-migrator) ──────────────────────────────────────
Write-Header "Миграции схемы"
$goDir = Join-Path $Root 'backend'
$env:VITAUTO_DB = "postgres://postgres:${PgPassword}@localhost:${PgPort}/$dbName"

Write-Step "go run ./cmd/migrator schema-up..."
Push-Location $goDir
& go run ./cmd/migrator schema-up 2>&1
if ($LASTEXITCODE -ne 0) { Write-Err "schema-up завершился с ошибкой"; exit 1 }
Write-Ok "Схема обновлена"
Pop-Location

# ── Демо-данные ─────────────────────────────────────────────────────────────
if (-not $NoSeed) {
    Write-Header "Демо-данные"
    $demoSql = Join-Path $Root 'seed\demo-app.sql'
    if (Test-Path $demoSql) {
        Write-Step "Загрузка demo-app.sql..."
        & $psql -h localhost -p $PgPort -U postgres -d $dbName -f $demoSql 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Демо-данные загружены"
            Write-Host "      Пользователи / пароли:" -ForegroundColor Gray
            Write-Host "        Администратор / admin123 (admin)" -ForegroundColor Gray
            Write-Host "        Менеджер / manager123 (manager)" -ForegroundColor Gray
            Write-Host "        Снабженец / supply123 (supply)" -ForegroundColor Gray
            Write-Host "        Кладовщик / storekeeper123 (storekeeper)" -ForegroundColor Gray
            Write-Host "        ГлавныйМеханик / chief123 (chief_mechanic)" -ForegroundColor Gray
        } else {
            Write-Err "Ошибка загрузки демо-данных"
        }
    } else {
        Write-Err "Файл демо-данных не найден: $demoSql"
    }
} else {
    Write-Step "Пропуск демо-данных (флаг -NoSeed)"
}

# ── Итог ────────────────────────────────────────────────────────────────────
Write-Header "ИТОГ"
Write-Ok "База $dbName на порту $PgPort инициализирована"
Write-Host "`n  Запуск: .\start-dev.ps1" -ForegroundColor Cyan
