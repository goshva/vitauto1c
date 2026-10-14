#Requires -Version 5.1
<#
.SYNOPSIS
  Восстановление дампа PostgreSQL в базу сервера 1С (localhost\autoservice) — ЗАМЕНЯЕТ все данные базы.

  1. проверки: файл дампа читается (pg_restore -l), база есть в кластере 1С, свободное место на диске данных
     PostgreSQL (размер дампа × 3) и на системном диске (кэш сервера 1С)
  2. подтверждение: ввести имя базы (или -Force)
  3. страховочный pg_dump текущей БД в -BackupDir (без -NoBackup)
  4. сервер 1С: запрет новых сеансов и регламентных заданий (если -IbUser подходит), завершение сеансов; Apache остановлен
  5. DROP DATABASE / CREATE DATABASE (UTF8, Russian_Russia.1251) / pg_restore -j 4
  6. перезапуск службы сервера 1С (сброс кэша метаданных), снятие запретов, Apache
  Пользователи 1С после восстановления — из дампа (для дампа autoservice_main: «Автосервис» без пароля).

.EXAMPLE
  .\restore-1c-pgsql.ps1 -Dump D:\1c_bases\backup\autoservice_20261014_1800.dump
  .\restore-1c-pgsql.ps1 -Dump D:\dump-autoservice_main-202610121429.sql -IbUser Автосервис -Force
#>
param(
    [Parameter(Mandatory)] [string]$Dump,
    [string]$Database = 'autoservice',     # имя БД PostgreSQL = имя базы в кластере 1С
    [string]$IbUser = 'Автосервис',          # пользователь 1С для запрета сеансов (в текущей и в восстановленной базе)
    [string]$IbPassword = '',
    [SecureString]$PgPassword,
    [string]$PgUser = 'postgres',
    [string]$PgHost = '127.0.0.1',
    [int]$PgPort = 5432,
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin',
    [string]$V8Bin = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin',
    [string]$BackupDir = 'D:\1c_bases\backup',
    [string]$ApacheStart = (Join-Path $PSScriptRoot 'odata\start-apache.ps1'),
    [int]$Jobs = 4,
    [double]$MinFreeSystemGB = 2,
    [switch]$NoBackup,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$t0 = Get-Date
function Step([string]$m) { Write-Host ("`n[{0:mm\:ss}] {1}" -f ((Get-Date) - $t0), $m) -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
foreach ($f in $Dump, "$PgBin\pg_restore.exe", "$PgBin\pg_dump.exe", "$PgBin\psql.exe", "$V8Bin\rac.exe", "$V8Bin\ras.exe") { if (-not (Test-Path $f)) { throw "Нет файла: $f" } }
if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString "Пароль PostgreSQL ($PgUser)" }
$env:PGPASSWORD = (New-Object Net.NetworkCredential('', $PgPassword)).Password
$conn = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-w')
function Sql([string]$q, [string]$db = 'postgres') {
    $r = & "$PgBin\psql.exe" @conn -d $db -v ON_ERROR_STOP=1 -At -c $q
    if ($LASTEXITCODE) { throw "psql: $q" }
    $r
}
function FreeGB([string]$path) { [math]::Round((Get-PSDrive ((Resolve-Path $path).Drive.Name)).Free / 1GB, 1) }

$rac = "$V8Bin\rac.exe"; $ras = $null; $cl = $null; $ib = $null; $denied = $false
function Rac { & $rac localhost:1545 @args 2>&1 }
function Deny([string]$v) {
    if (-not $ib) { return $false }
    $out = Rac infobase update "--cluster=$cl" "--infobase=$ib" "--infobase-user=$IbUser" "--infobase-pwd=$IbPassword" "--sessions-deny=$v" "--scheduled-jobs-deny=$v"
    if ($LASTEXITCODE) { Warn "запрет сеансов $v не установлен ($IbUser): $out"; return $false }
    return $true
}
function KillSessions {
    foreach ($s in (Rac session list "--cluster=$cl" "--infobase=$ib" | Select-String '^session\s+:\s+(\S+)')) {
        Rac session terminate "--cluster=$cl" "--session=$($s.Matches[0].Groups[1].Value)" | Out-Null
    }
}
function StartRas {
    $script:ras = Start-Process "$V8Bin\ras.exe" -ArgumentList 'cluster --port=1545 localhost:1540' -PassThru -WindowStyle Hidden
    Start-Sleep 4
    $script:cl = ((Rac cluster list | Select-String '^cluster\s+:\s+(\S+)').Matches[0].Groups[1].Value)
    $list = @(Rac infobase summary list "--cluster=$cl")
    $script:ib = $null
    for ($i = 1; $i -lt $list.Count; $i++) { if ("$($list[$i])" -match '^name\s+:\s+(\S+)$' -and $Matches[1] -eq $Database) { $script:ib = ("$($list[$i - 1])" -split ':\s+')[1].Trim() } }
}

try {
    Step 'Проверки'
    $tables = (& "$PgBin\pg_restore.exe" -l $Dump | Select-String 'TABLE DATA').Count
    if ($tables -eq 0) { throw "Дамп $Dump не читается pg_restore (нужен формат pg_dump -Fc)" }
    $dumpGB = [math]::Round((Get-Item $Dump).Length / 1GB, 2)
    Ok "дамп $(Split-Path -Leaf $Dump): $dumpGB ГБ, таблиц с данными $tables"
    $pgData = Sql 'SHOW data_directory'
    $needData = [math]::Ceiling($dumpGB * 3) + 1
    if (-not $NoBackup) { $needData += [math]::Ceiling($dumpGB) }
    $freeData = FreeGB $pgData
    if ($freeData -lt $needData) { throw "Диск данных PostgreSQL ($pgData): свободно $freeData ГБ, нужно не меньше $needData ГБ" }
    Ok "данные PostgreSQL ($pgData): свободно $freeData ГБ (нужно $needData)"
    $freeSys = FreeGB ($env:SystemDrive + '\')
    if ($freeSys -lt $MinFreeSystemGB) { throw "Системный диск: свободно $freeSys ГБ, нужно не меньше $MinFreeSystemGB ГБ (кэш сервера 1С)" }
    Ok "системный диск: свободно $freeSys ГБ (нужно $MinFreeSystemGB)"
    StartRas
    if ($ib) { Ok "база $Database в кластере 1С: $ib" } else { Warn "базы $Database нет в кластере 1С — восстанавливается только БД PostgreSQL" }
    $exists = Sql "SELECT count(*) FROM pg_database WHERE datname = '$Database'"

    if (-not $Force) {
        Write-Host "`nВСЕ ДАННЫЕ базы $Database будут заменены данными из $(Split-Path -Leaf $Dump)." -ForegroundColor Yellow
        if ((Read-Host "Для продолжения введите имя базы ($Database)") -ne $Database) { throw 'Отменено' }
    }

    if (-not $NoBackup -and $exists -eq '1') {
        Step "Страховочный дамп текущей БД $Database"
        New-Item -ItemType Directory -Force $BackupDir | Out-Null
        $bak = Join-Path $BackupDir ("{0}_до-восстановления_{1:yyyyMMdd_HHmm}.dump" -f $Database, (Get-Date))
        & "$PgBin\pg_dump.exe" @conn -Fc -Z 6 -f $bak $Database
        if ($LASTEXITCODE) { throw 'pg_dump не выполнен — восстановление отменено' }
        Ok ("{0} ({1:N0} МБ)" -f $bak, ((Get-Item $bak).Length / 1MB))
    }

    Step 'Сеансы 1С: запрет и завершение; Apache остановлен'
    Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force
    if ($ib) {
        $denied = Deny 'on'
        KillSessions; Start-Sleep 3
        Ok "сеансов: $((Rac session list "--cluster=$cl" "--infobase=$ib" | Select-String '^session').Count)"
    }

    Step "БД ${Database}: пересоздание и pg_restore"
    Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Database' AND pid <> pg_backend_pid()" | Out-Null
    Sql "DROP DATABASE IF EXISTS `"$Database`"" | Out-Null
    Sql "CREATE DATABASE `"$Database`" WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'Russian_Russia.1251'" | Out-Null
    $r0 = Get-Date
    & "$PgBin\pg_restore.exe" @conn -d $Database --no-owner -j $Jobs $Dump
    if ($LASTEXITCODE) { throw "pg_restore: код $LASTEXITCODE (страховочный дамп — в $BackupDir)" }
    $restored = Sql "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" $Database
    Ok ("восстановлено за {0:N0} мин: таблиц {1}, размер {2}" -f ((Get-Date) - $r0).TotalMinutes, $restored, (Sql "SELECT pg_size_pretty(pg_database_size('$Database'))"))

    Step 'Сервер 1С: перезапуск службы (кэш метаданных), снятие запретов'
    $svc = Get-Service | Where-Object { $_.Name -like '1C:Enterprise 8.3 Server Agent*' } | Select-Object -First 1
    if ($ras) { Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue; $ras = $null }
    if ($svc) { Restart-Service $svc.Name -Force; Start-Sleep 10; Ok "служба $($svc.Name): $((Get-Service $svc.Name).Status)" }
    StartRas
    if ($ib -and (Deny 'off')) { Ok 'сеансы и регламентные задания разрешены'; $denied = $false }
    elseif ($ib) { Warn "снимите запрет сеансов вручную (консоль кластера) — пользователь $IbUser не подошёл к восстановленной базе" }
    if (Test-Path $ApacheStart) { & $ApacheStart | Select-Object -Last 1 }
} finally {
    if ($denied) { Deny 'off' | Out-Null }
    if ($ras) { Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Step ("Готово за {0:N0} мин" -f ((Get-Date) - $t0).TotalMinutes)
