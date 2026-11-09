#Requires -Version 5.1
<#
.SYNOPSIS
    Seed-стенд для приёмки фичи «Заказ поставщику по кнопке» (ФТ v2, п. 3 и п. 5).
.DESCRIPTION
    Поднимает выделенную базу (по умолчанию vitauto_so_stand) на том же PostgreSQL, что и приложение:
      1. проверяет psql, go и доступность PostgreSQL;
      2. пересоздаёт базу (DROP/CREATE) — данные стенда одноразовые;
      3. применяет схему (vitauto-migrator schema-up);
      4. заливает seed/supplier-order-stand.sql (пользователи, НСИ, заказ покупателя, строки АРМ);
      5. печатает DSN, команду запуска backend/API-тестов и подсказку для ручной проверки.
.PARAMETER PgPort
    Порт PostgreSQL (по умолчанию 5432; на сервере с 1С часто 5433).
.PARAMETER PgPassword
    Пароль пользователя PostgreSQL (по умолчанию postgres).
.PARAMETER DbName
    Имя базы стенда (по умолчанию vitauto_so_stand).
.PARAMETER KeepData
    Не удалять базу перед инициализацией (только миграции и перезаливка сида).
.PARAMETER PgBin
    Каталог bin PostgreSQL с psql.exe (по умолчанию ищется в PATH и в «C:\Program Files\PostgreSQL*\*\bin»).
.EXAMPLE
    .\seed\supplier-order-stand.ps1
    .\seed\supplier-order-stand.ps1 -PgPort 5433 -PgPassword 'secret'
    .\seed\supplier-order-stand.ps1 -KeepData
#>
param(
    [int]$PgPort = 5432,
    [string]$PgUser = 'postgres',
    [string]$PgPassword = 'postgres',
    [string]$DbName = 'vitauto_so_stand',
    [switch]$KeepData,
    [string]$PgBin = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:LASTEXITCODE = 0   # Powershell 5.1 + StrictMode: без этого чтение $LASTEXITCODE в функции падает
$Root = Split-Path -Parent $PSScriptRoot   # корень репозитория (seed/..)
$SeedSql = Join-Path $PSScriptRoot 'supplier-order-stand.sql'

function Write-Header($text) { Write-Host ('=== ' + $text + ' ===') -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host ('  [OK] ' + $text) -ForegroundColor Green }
function Write-Step($text) { Write-Host ('  [..] ' + $text) -ForegroundColor Yellow }
function Write-Err($text) { Write-Host ('  [FAIL] ' + $text) -ForegroundColor Red }

Write-Header 'Компоненты'
$psql = $null
if ($PgBin) { $psql = Join-Path $PgBin 'psql.exe' }
if (-not $psql -or -not (Test-Path $psql)) {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { $psql = $cmd.Source }
}
if (-not $psql -or -not (Test-Path $psql)) {
    $found = Get-ChildItem 'C:\Program Files\PostgreSQL*\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $psql = $found.FullName }
}
if (-not $psql -or -not (Test-Path $psql)) {
    Write-Err 'psql.exe не найден: добавьте PostgreSQL в PATH или передайте -PgBin'
    exit 1
}
Write-Ok ('psql: ' + $psql)
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Err 'go не найден в PATH (нужен для vitauto-migrator schema-up)'
    exit 1
}
Write-Ok ('go: ' + ((& go version) -join ' '))

Write-Header ('PostgreSQL 127.0.0.1:' + $PgPort)
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('127.0.0.1', $PgPort)
    $tcp.Close()
    Write-Ok ('сервер отвечает на порту ' + $PgPort)
} catch {
    Write-Err ('PostgreSQL не отвечает на 127.0.0.1:' + $PgPort + ' — запустите службу PostgreSQL')
    exit 1
}

$env:PGPASSWORD = $PgPassword
$env:PGCLIENTENCODING = 'UTF8'

# psql без -w спросит пароль; $? проверяем сразу после вызова (надёжнее $LASTEXITCODE в функции)
function Invoke-Psql([string[]]$ExtraArgs) {
    & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -w @ExtraArgs
    if (-not $?) { throw ('psql: ' + ($ExtraArgs -join ' ')) }
}
function Query-Text([string]$Sql) {
    $out = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -w -d postgres -Atc $Sql
    if (-not $?) { throw ('psql -Atc: ' + $Sql) }
    if ($null -eq $out) { return '' }
    return ([string]$out).Trim()
}

Write-Header ('База ' + $DbName)
if (-not $KeepData) {
    Write-Step ('DROP DATABASE IF EXISTS ' + $DbName + ' (WITH FORCE)')
    Invoke-Psql @('-d', 'postgres', '-q', '-c', ('DROP DATABASE IF EXISTS ' + $DbName + ' WITH (FORCE);'))
}
if ((Query-Text ("SELECT 1 FROM pg_database WHERE datname='" + $DbName + "'")) -ne '1') {
    Write-Step ('CREATE DATABASE ' + $DbName)
    Invoke-Psql @('-d', 'postgres', '-q', '-c', ("CREATE DATABASE " + $DbName + " TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ru-RU' LOCALE 'C';"))
    Write-Ok ('база ' + $DbName + ' создана')
} else {
    Write-Ok ('база ' + $DbName + ' уже существует')
}

Write-Header 'Схема (vitauto-migrator schema-up)'
$env:VITAUTO_DB = 'postgres://' + $PgUser + ':' + $PgPassword + '@127.0.0.1:' + $PgPort + '/' + $DbName
Push-Location (Join-Path $Root 'backend')
try {
    Write-Step 'go run ./cmd/migrator schema-up'
    & go run ./cmd/migrator schema-up
    if (-not $?) { throw 'schema-up завершился с ошибкой' }
} finally {
    Pop-Location
}
Write-Ok 'схема обновлена'

Write-Header 'Seed-данные стенда'
if (-not (Test-Path $SeedSql)) { Write-Err ('не найден ' + $SeedSql); exit 1 }
Write-Step ('psql -f ' + $SeedSql)
Invoke-Psql @('-d', $DbName, '-v', 'ON_ERROR_STOP=1', '-f', $SeedSql)
Write-Ok 'стенд залит'

$dsn = 'postgres://' + $PgUser + ':' + $PgPassword + '@127.0.0.1:' + $PgPort + '/' + $DbName
Write-Header 'ГОТОВО'
Write-Host ''
Write-Host '  DSN стенда:' -ForegroundColor Gray
Write-Host ('    ' + $dsn) -ForegroundColor White
Write-Host ''
Write-Host '  Backend- и API-тесты фичи (без e2e):' -ForegroundColor Gray
Write-Host ("    `$env:VITAUTO_SO_DSN='" + $dsn + "'") -ForegroundColor White
Write-Host '    cd backend; go test ./internal/arm/ ./internal/api/ -run SupplierOrder -v' -ForegroundColor White
Write-Host ''
Write-Host '  Логины стенда:' -ForegroundColor Gray
Write-Host '    Снабженец / supply123        — оформляет заказ поставщику' -ForegroundColor Gray
Write-Host '    Менеджер / manager123        — тоже может (п. 5 ФТ)' -ForegroundColor Gray
Write-Host '    Кладовщик / storekeeper123   — получает 403' -ForegroundColor Gray
Write-Host ''
Write-Host '  Ручная проверка — раздел «Приёмка» в deploy/REINSTALL.md' -ForegroundColor Gray
Write-Host ''
