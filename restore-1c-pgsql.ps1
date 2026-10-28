#Requires -Version 5.1
<#
.SYNOPSIS
  Восстановление дампа PostgreSQL в базу сервера 1С (localhost\autoservice) — ЗАМЕНЯЕТ все данные базы.
  Без страховочного дампа: перед восстановлением текущая БД НЕ сохраняется.

  1. проверки: файл дампа читается (pg_restore -l), база есть в кластере 1С, свободное место
     на диске данных PostgreSQL (размер дампа × 3) и на системном диске (кэш сервера 1С)
  2. подтверждение: ввести имя базы (или -Force)
  3. сервер 1С: запрет новых сеансов и регламентных заданий (если пользователь IbUser подходит),
     завершение сеансов; Apache остановлен. Если IbUser не подошёл — шаг пропускается с предупреждением.
  4. DROP DATABASE / CREATE DATABASE (UTF8, Russian_Russia.1251) / pg_restore -j N
  5. перезапуск службы сервера 1С (сброс кэша метаданных), снятие запретов, Apache
  Пользователи 1С после восстановления — из дампа.

.EXAMPLE
  .\restore-1c-pgsql.ps1 -Dump D:\1c_bases\backup\autoservice_20261014_1800.dump
  .\restore-1c-pgsql.ps1 -Dump D:\dump.dump -IbUser Админ -Force
#>
param(
    [Parameter(Mandatory)] [string]$Dump,
    [string]$Database = 'autoservice',
    [string]$IbUser = 'Автосервис',
    [string]$IbPassword = '',
    [SecureString]$PgPassword,
    [string]$PgUser = 'postgres',
    [string]$PgHost = '127.0.0.1',
    [int]$PgPort = 5432,
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin',
    [string]$V8Bin = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin',
    [string]$ApacheStart = (Join-Path $PSScriptRoot 'odata\start-apache.ps1'),
    [int]$Jobs = 4,
    [double]$MinFreeSystemGB = 2,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$t0 = Get-Date
function Step([string]$m) { Write-Host ("`n[{0:mm\:ss}] {1}" -f ((Get-Date) - $t0), $m) -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

foreach ($f in $Dump, "$PgBin\pg_restore.exe", "$PgBin\pg_dump.exe", "$PgBin\psql.exe", "$V8Bin\rac.exe", "$V8Bin\ras.exe") {
    if (-not (Test-Path $f)) { throw "Нет файла: $f" }
}
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
# Rac: аргументы передаются массивом строк; stderr не поднимает исключение при $ErrorActionPreference='Stop'
function Rac {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgList)
    $out = & $rac 'localhost:1545' @ArgList 2>$null
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($out) }
}
function Deny([string]$v) {
    if (-not $ib -or -not $cl) { return $false }
    $r = Rac 'infobase' 'update' "--cluster=$cl" "--infobase=$ib" `
        "--infobase-user=$IbUser" "--infobase-pwd=$IbPassword" `
        "--sessions-deny=$v" "--scheduled-jobs-deny=$v"
    if ($r.Code) { Warn "запрет сеансов $v не установлен ($IbUser): $($r.Out -join ' ')"; return $false }
    return $true
}
function KillSessions {
    if (-not $ib -or -not $cl) { return }
    $list = Rac 'session' 'list' "--cluster=$cl" "--infobase=$ib"
    foreach ($s in ($list.Out | Select-String '^session\s+:\s+(\S+)')) {
        Rac 'session' 'terminate' "--cluster=$cl" "--session=$($s.Matches[0].Groups[1].Value)" | Out-Null
    }
}
function StartRas {
    $script:ras = Start-Process "$V8Bin\ras.exe" -ArgumentList 'cluster --port=1545 localhost:1540' -PassThru -WindowStyle Hidden
    Start-Sleep 4
    $clRes = Rac 'cluster' 'list'
    $m = $clRes.Out | Select-String '^cluster\s+:\s+(\S+)'
    if (-not $m) { Warn 'кластер 1С не найден через ras (проверьте службу агента)'; $script:cl = $null; return }
    $script:cl = $m.Matches[0].Groups[1].Value
    $list = Rac 'infobase' 'summary' 'list' "--cluster=$cl"
    $script:ib = $null
    $prev = $null
    foreach ($line in $list.Out) {
        if ($line -match '^infobase\s+:\s+(\S+)') { $prev = $Matches[1] }
        elseif ($line -match '^name\s+:\s+(\S+)$' -and $Matches[1] -eq $Database) { $script:ib = $prev; break }
    }
}

try {
    Step 'Проверки'
    $tables = (& "$PgBin\pg_restore.exe" -l $Dump | Select-String 'TABLE DATA').Count
    if ($tables -eq 0) { throw "Дамп $Dump не читается pg_restore (нужен формат pg_dump -Fc)" }
    $dumpGB = [math]::Round((Get-Item $Dump).Length / 1GB, 2)
    Ok "дамп $(Split-Path -Leaf $Dump): $dumpGB ГБ, таблиц с данными $tables"

    $pgData = Sql 'SHOW data_directory'
    $needData = [math]::Ceiling($dumpGB * 3) + 1
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
        Write-Host '  (страховочный дамп текущей БД НЕ делается — при необходимости сделайте его вручную заранее)' -ForegroundColor Yellow
        if ((Read-Host "Для продолжения введите имя базы ($Database)") -ne $Database) { throw 'Отменено' }
    }

    Step 'Сеансы 1С: запрет и завершение; Apache остановлен'
    Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force
    if ($ib) {
        $denied = Deny 'on'
        if ($denied) {
            KillSessions; Start-Sleep 3
            $ses = (Rac 'session' 'list' "--cluster=$cl" "--infobase=$ib").Out | Select-String '^session'
            Ok "сеансов осталось: $(@($ses).Count)"
        }
        else {
            Warn 'запрет сеансов не установлен — восстановление продолжится; перед pg_restore все соединения к БД будут принудительно завершены'
        }
    }
    else {
        Warn 'база не найдена в кластере — запрет сеансов и завершение сеансов 1С пропущены'
    }

    Step "БД ${Database}: пересоздание и pg_restore"
    Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Database' AND pid <> pg_backend_pid()" | Out-Null
    Sql "DROP DATABASE IF EXISTS `"$Database`"" | Out-Null
    Sql "CREATE DATABASE `"$Database`" WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'Russian_Russia.1251'" | Out-Null
    $r0 = Get-Date
    & "$PgBin\pg_restore.exe" @conn -d $Database --no-owner -j $Jobs $Dump
    if ($LASTEXITCODE) { throw "pg_restore: код $LASTEXITCODE" }
    $restored = Sql "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" $Database
    Ok ("восстановлено за {0:N0} мин: таблиц {1}, размер {2}" -f ((Get-Date) - $r0).TotalMinutes, $restored, (Sql "SELECT pg_size_pretty(pg_database_size('$Database'))"))

    Step 'Сервер 1С: перезапуск службы (кэш метаданных), снятие запретов'
    $svc = Get-Service | Where-Object { $_.Name -like '1C:Enterprise 8.3 Server Agent*' } | Select-Object -First 1
    if ($ras) { Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue; $ras = $null }
    if ($svc) { Restart-Service $svc.Name -Force; Start-Sleep 10; Ok "служба $($svc.Name): $((Get-Service $svc.Name).Status)" }
    StartRas
    if ($denied -and $ib -and (Deny 'off')) { Ok 'сеансы и регламентные задания разрешены'; $denied = $false }
    elseif ($denied) { Warn 'снимите запрет сеансов вручную (консоль кластера): IbUser не подошёл к восстановленной базе' }
    if (Test-Path $ApacheStart) { & $ApacheStart | Select-Object -Last 1 }
}
finally {
    if ($denied) { Deny 'off' | Out-Null }
    if ($ras) { Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Step ("Готово за {0:N0} мин" -f ((Get-Date) - $t0).TotalMinutes)