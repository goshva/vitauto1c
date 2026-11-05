# setup-and-restore.ps1 — проверка окружения и восстановление vitauto_app из дампа
param(
    [string]$ProjectRoot = "D:\soft\vitauto1c",
    [string]$DumpFile    = "D:\1c_bases\backup\vitauto_mirror-arm222-20261018-1305.dump",
    [string]$PgBin       = "C:\Program Files\PostgreSQL 1C\18\bin",
    [string]$PgDataDir   = "D:\vitauto_app\pgdata",
    [string]$PgLogFile   = "D:\vitauto_app\pg.log",
    [int]   $PgPort      = 5434,
    [string]$PgUser      = "postgres",
    [string]$PgPassword  = "postgres",
    [string]$DbName      = "vitauto_app"
)
$ErrorActionPreference = "Stop"

Write-Host "=== 1. Проверка путей ===" -ForegroundColor Cyan
if (-not (Test-Path $ProjectRoot)) { Write-Error "Нет проекта: $ProjectRoot"; exit 1 }
if (-not (Test-Path $DumpFile))    { Write-Error "Нет дампа: $DumpFile"; exit 1 }
if (-not (Test-Path (Join-Path $PgBin "pg_restore.exe"))) { Write-Error "Нет pg_restore в $PgBin"; exit 1 }
Write-Host "Проект: $ProjectRoot" -ForegroundColor Green
Write-Host "Дамп:   $DumpFile" -ForegroundColor Green

Write-Host "`n=== 2. Проверка инструментов ===" -ForegroundColor Cyan
foreach ($tool in @("node","npm","go")) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) { Write-Host "$tool : $($cmd.Source)" -ForegroundColor Green }
    else { Write-Error "$tool не найден в PATH. Установите и перезапустите PowerShell."; exit 1 }
}

Write-Host "`n=== 3. PostgreSQL: запуск ===" -ForegroundColor Cyan
$pgCtl = Join-Path $PgBin "pg_ctl.exe"
$portOpen = Test-NetConnection 127.0.0.1 -Port $PgPort -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $portOpen) {
    if (-not (Test-Path $PgDataDir)) {
        Write-Host "Каталог данных не найден. Создаю новый кластер..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path (Split-Path $PgDataDir -Parent) -Force | Out-Null
        $pwFile = New-TemporaryFile
        $PgPassword | Out-File $pwFile.FullName -Encoding ASCII -NoNewline
        & (Join-Path $PgBin "initdb.exe") -D $PgDataDir -U $PgUser -A scram-sha-256 --pwfile=$pwFile.FullName
        Remove-Item $pwFile.FullName -Force
        # порт 5434
        $conf = Join-Path $PgDataDir "postgresql.conf"
        (Get-Content $conf) -replace '^#?\s*port\s*=.*', "port = $PgPort" | Set-Content $conf -Encoding UTF8
    }
    Write-Host "Запуск PostgreSQL на $PgPort ..." -ForegroundColor Yellow
    & $pgCtl -D $PgDataDir -l $PgLogFile start
    Start-Sleep -Seconds 3
    if (-not (Test-NetConnection 127.0.0.1 -Port $PgPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
        Write-Error "PostgreSQL не запустился. Лог: $PgLogFile"; exit 1
    }
}
Write-Host "PostgreSQL слушает $PgPort" -ForegroundColor Green

Write-Host "`n=== 4. Восстановление базы из дампа ===" -ForegroundColor Cyan
$env:PGPASSWORD = $PgPassword
$psql    = Join-Path $PgBin "psql.exe"
$restore = Join-Path $PgBin "pg_restore.exe"

# Удаляем базу, если уже существует (чистое восстановление)
$exists = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d postgres -Atc "select 1 from pg_database where datname='$DbName'"
if ($exists -eq "1") {
    Write-Host "База $DbName уже есть. Удаляю (чистое восстановление)..." -ForegroundColor Yellow
    # Отключаем всех, кто держит базу
    & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DbName' and pid <> pg_backend_pid()" | Out-Null
    & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d postgres -c "drop database `"$DbName`"" | Out-Null
}
Write-Host "Создаю базу $DbName ..." -ForegroundColor Yellow
& $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d postgres -c "create database `"$DbName`"" | Out-Null

Write-Host "Восстанавливаю из дампа (это может занять минуты)..." -ForegroundColor Yellow
& $restore -h 127.0.0.1 -p $PgPort -U $PgUser -d $DbName --no-owner --no-privileges -v $DumpFile 2>&1 | Tee-Object -FilePath "D:\vitauto_app\restore.log" | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_restore завершился с ошибками. Смотрите D:\vitauto_app\restore.log"
    exit 1
}
Write-Host "Восстановление завершено." -ForegroundColor Green

Write-Host "`n=== 5. Проверка данных ===" -ForegroundColor Cyan
$cnt = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d $DbName -Atc "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"
Write-Host "Таблиц в базе: $cnt" -ForegroundColor Green
$lines = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d $DbName -Atc "select count(*) from arm.line" 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "Строк АРМ: $lines" -ForegroundColor Green }

Write-Host "`n=== 6. Запуск проекта ===" -ForegroundColor Cyan
$deploy = Join-Path $ProjectRoot "deplot.ps1"
if (Test-Path $deploy) {
    Write-Host "Запускаю deplot.ps1 ..." -ForegroundColor Yellow
    & $deploy
} else {
    Write-Host "deplot.ps1 не найден. Запустите вручную: vitauto-api + vite." -ForegroundColor Yellow
}