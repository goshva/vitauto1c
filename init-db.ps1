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
.PARAMETER Reset
    Удалить базу vitauto_app целиком перед инициализацией (DROP DATABASE)
    и залить схему и демо-данные заново.
.EXAMPLE
    .\init-db.ps1
    .\init-db.ps1 -PgPort 5432 -PgPassword 'mypassword' -NoSeed
    .\init-db.ps1 -Reset
#>
param(
    [int]$PgPort = 5432,
    [string]$PgPassword = '',
    [switch]$NoSeed,
    [switch]$Reset
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
    if ($Reset) { $argsList += '-Reset' }
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
    $tcp.Connect('127.0.0.1', $PgPort)
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

if ($Reset) {
    Write-Step "Сброс: остановка API и удаление базы $dbName..."
    # API держит соединения с базой, без их закрытия DROP DATABASE не выполнится
    Get-Process -Name vitauto-api -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid();" 2>&1 | Out-Null
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -c "DROP DATABASE IF EXISTS $dbName;" 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Err "Не удалось удалить базу $dbName"; exit 1 }
    Write-Ok "База $dbName удалена, будет создана заново"
}

$dbExists = & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname='$dbName';" 2>&1
if ($dbExists.Trim() -ne '1') {
    Write-Step "Создание базы $dbName..."
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -c "CREATE DATABASE $dbName TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ru-RU' LOCALE 'C';" 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Err "Не удалось создать базу $dbName"; exit 1 }
    Write-Ok "База $dbName создана"
} else {
    Write-Ok "База $dbName уже существует"
}

# ── Миграции схемы (через Go-migrator) ──────────────────────────────────────
Write-Header "Миграции схемы"
$goDir = Join-Path $Root 'backend'
$env:VITAUTO_DB = "postgres://postgres:${PgPassword}@127.0.0.1:${PgPort}/$dbName"

Write-Step "go run ./cmd/migrator schema-up..."
Push-Location $goDir
# Go-логгер пишет информационные строки в stderr; при 'Stop' они стали бы исключением
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& go run ./cmd/migrator schema-up 2>&1 | ForEach-Object { "$_" }
$migrateExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($migrateExit -ne 0) { Pop-Location; Write-Err "schema-up завершился с ошибкой"; exit 1 }
Write-Ok "Схема обновлена"
Pop-Location

# ── Демо-данные ─────────────────────────────────────────────────────────────
$userCount = & $psql -h 127.0.0.1 -p $PgPort -U postgres -d $dbName -w -At -c 'SELECT count(*) FROM auth."user";' 2>$null
if (-not $NoSeed -and "$userCount".Trim() -ne '0') {
    Write-Step "В базе уже есть пользователи ($("$userCount".Trim())), демо-данные не загружаются"
} elseif (-not $NoSeed) {
    Write-Header "Демо-данные"
    $demoSql = Join-Path $Root 'seed\demo-app.sql'
    if (Test-Path $demoSql) {
        Write-Step "Загрузка demo-app.sql..."
        $env:PGCLIENTENCODING = 'UTF8'
        & $psql -h 127.0.0.1 -p $PgPort -U postgres -d $dbName -f $demoSql 2>&1
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
