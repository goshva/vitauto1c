#Requires -Version 5.1
<#
.SYNOPSIS
  Пересоздание серверной базы 1С на PostgreSQL из дампа pg_dump + АРМ v2.15 + АРМ_OData + справочники из Excel + строки АРМ.

  1. pg_dump текущей БД (страховка) в -BackupDir
  2. сервер 1С: запрет сеансов и регламентных заданий, завершение сеансов; Apache остановлен
  3. БД пересоздаётся (DROP/CREATE) и восстанавливается из -Dump (pg_restore, -j 4); служба сервера 1С перезапускается
  4. расширения из .cfe (конфигуратор /LoadCfg -Extension + /UpdateDBCfg): АРМЗакупокИПродаж, АРМ_OData;
     оба включаются (активно, без безопасного режима), состав OData — полный, роль АРМ -AdminRole пользователю -IbUser
  5. Apache, затем seed: import-catalogs.py — товары, услуги (+ цены авторабот по шасси), машины; --fill-arm — строки АРМ
     по заказам покупателей за последний год (АРМ сам добавляет закупки для позиций без остатка)
  6. снятие запретов (регламентные задания — после seed)

  Пароль postgres: -PgPassword (SecureString) или запрос. Публикация OData — /odata-prod (D:\1c\pub\odata-prod).

.EXAMPLE
  .\odata\deploy-autoservice-pg.ps1 -Dump D:\dump-autoservice_main-202610121429.sql
#>
param(
    [Parameter(Mandatory)] [string]$Dump,
    [string]$Infobase = 'autoservice',            # имя базы в кластере 1С (= имя БД PostgreSQL)
    [string]$IbUser = 'Администратор',
    [string]$IbPassword = '',
    [string]$AdminRole = 'Администратор',
    [SecureString]$PgPassword,
    [string]$PgUser = 'postgres',
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin',
    [string]$V8Bin = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin',
    [string]$BackupDir = 'D:\1c_bases\backup',
    [string]$ODataUrl = 'http://127.0.0.1:8090/odata-prod/odata/standard.odata',
    [string]$ArmCfe = (Join-Path (Split-Path -Parent $PSScriptRoot) 'АРМЗакупокИПродаж_v2.15.cfe'),
    [string]$ODataCfe = (Join-Path (Split-Path -Parent $PSScriptRoot) 'АРМ_OData_v1.1.cfe'),
    [switch]$SkipBackup,
    [switch]$SkipRestore,               # БД уже восстановлена из дампа: только расширения, OData и seed
    [double]$MinFreeSystemGB = 2,       # диск системы: кэш сервера 1С (srvinfo), временные файлы конфигуратора и rphost
    [double]$MinFreeDataGB = 8          # диск данных PostgreSQL и бэкапа: pg_dump текущей БД + восстановленная БД с запасом
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot; $Root = Split-Path -Parent $Here
$t0 = Get-Date
function Step([string]$m) { Write-Host ("`n[{0:mm\:ss}] {1}" -f ((Get-Date) - $t0), $m) -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
foreach ($f in $Dump, $ArmCfe, $ODataCfe, "$PgBin\pg_restore.exe", "$V8Bin\1cv8.exe", "$V8Bin\rac.exe") { if (-not (Test-Path $f)) { throw "Нет файла: $f" } }
if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString "Пароль PostgreSQL ($PgUser)" }
$env:PGPASSWORD = (New-Object Net.NetworkCredential('', $PgPassword)).Password
$psql = "$PgBin\psql.exe"
function Sql([string]$q, [string]$db = 'postgres') { & $psql -h 127.0.0.1 -U $PgUser -w -d $db -v ON_ERROR_STOP=1 -At -c $q; if ($LASTEXITCODE) { throw "psql: $q" } }

# ---------------------------------------------------------------- место на дисках (до любых изменений)
function FreeGB([string]$path) { [math]::Round((Get-PSDrive ((Resolve-Path $path).Drive.Name)).Free / 1GB, 1) }
function CheckSpace([string]$when) {
    $sys = $env:SystemDrive + '\'
    $pgData = (Sql 'SHOW data_directory')
    $checks = @(
        @{ Path = $sys; Need = $MinFreeSystemGB; What = 'кэш сервера 1С и временные файлы' },
        @{ Path = $pgData; Need = $MinFreeDataGB; What = "данные PostgreSQL ($pgData)" }
    )
    if (-not $SkipBackup) { $checks += @{ Path = $BackupDir; Need = [math]::Ceiling((Get-Item $Dump).Length / 1GB) + 1; What = "бэкап ($BackupDir)" } }
    $bad = @()
    foreach ($c in $checks) {
        if (-not (Test-Path $c.Path)) { New-Item -ItemType Directory -Force $c.Path | Out-Null }
        $free = FreeGB $c.Path
        $line = "{0}: свободно {1} ГБ, нужно не меньше {2} ГБ — {3}" -f (Resolve-Path $c.Path).Drive.Name, $free, $c.Need, $c.What
        if ($free -lt $c.Need) { $bad += $line; Write-Host "  [X]  $line" -ForegroundColor Red } else { Ok $line }
    }
    if ($bad) { throw "Недостаточно места ($when):`n" + ($bad -join "`n") + "`nОсвободите место и запустите снова — база не изменялась после последнего успешного шага." }
}
Step 'Проверка свободного места'
CheckSpace 'перед началом'

# ---------------------------------------------------------------- сервер 1С: ras (временно), кластер, база
$rac = "$V8Bin\rac.exe"
$ras = Start-Process "$V8Bin\ras.exe" -ArgumentList 'cluster --port=1545 localhost:1540' -PassThru -WindowStyle Hidden
Start-Sleep 3
$cl = ((& $rac localhost:1545 cluster list | Select-String '^cluster\s+:\s+(\S+)').Matches[0].Groups[1].Value)
$ibList = & $rac localhost:1545 infobase summary list --cluster=$cl
$ib = $null
for ($i = 0; $i -lt $ibList.Count; $i++) { if ($ibList[$i] -match '^name\s+:\s+(\S+)' -and $Matches[1] -eq $Infobase) { $ib = ($ibList[$i - 1] -split ':\s+')[1].Trim() } }
if (-not $ib) { throw "База $Infobase не найдена в кластере 1С" }
$auth = @("--infobase-user=$IbUser", "--infobase-pwd=$IbPassword")
# сеансы запрещаются только на время пересоздания БД (конфигуратору и COM нужен вход); регламентные задания — до конца
function Deny([string]$sessions, [string]$jobs) {
    & $rac localhost:1545 infobase update --cluster=$cl --infobase=$ib @auth "--sessions-deny=$sessions" "--scheduled-jobs-deny=$jobs" "--denied-message=Обновление базы" | Out-Null
}
function KillSessions { foreach ($s in (& $rac localhost:1545 session list --cluster=$cl --infobase=$ib | Select-String '^session\s+:\s+(\S+)')) { & $rac localhost:1545 session terminate --cluster=$cl --session=$($s.Matches[0].Groups[1].Value) | Out-Null } }
function Run1C([string]$args1c, [string]$what) {
    $log = Join-Path $env:TEMP 'deploy-1c.log'; $res = Join-Path $env:TEMP 'deploy-1c.res'; Remove-Item $log, $res -ErrorAction SilentlyContinue
    Start-Process "$V8Bin\1cv8.exe" -ArgumentList "DESIGNER /S `"localhost\$Infobase`" /N `"$IbUser`" /P `"$IbPassword`" $args1c /DisableStartupDialogs /DisableStartupMessages /Out `"$log`" /DumpResult `"$res`"" -Wait
    $code = if (Test-Path $res) { "$(Get-Content $res -Raw)".Trim() } else { '-1' }
    $text = if (Test-Path $log) { "$(Get-Content $log -Raw -Encoding UTF8)".Trim() } else { '' }
    if ($code -ne '0') { throw "$what — код $code`n$text" }
    Ok "$what$(if ($text) { ': ' + ($text -replace '\s+', ' ') })"
}
function ComJs([string]$js, [string[]]$rest) {
    $tmp = Join-Path $env:TEMP ("deploy-js-{0:HHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText((Join-Path $Here $js), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", "Srvr=`"localhost`";Ref=`"$Infobase`";Usr=`"$IbUser`";Pwd=`"$IbPassword`"", [Text.Encoding]::Unicode)
    & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript "$tmp\r.js" "$tmp\c.txt" "$tmp\out.txt" @rest | Out-Null
    $out = if (Test-Path "$tmp\out.txt") { [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode) } else { @('ERROR=нет отчёта') }
    Remove-Item $tmp -Recurse -Force
    foreach ($l in $out) { if ($l -match '^ERROR=(.*)') { throw $Matches[1] } else { Ok ($l -replace '^OK ', '') } }
}

try {
    if (-not $SkipBackup) {
        Step "pg_dump текущей БД $Infobase"
        New-Item -ItemType Directory -Force $BackupDir | Out-Null
        $bak = Join-Path $BackupDir ("{0}-pg_до-переразвёртывания_{1:yyyyMMdd_HHmm}.dump" -f $Infobase, (Get-Date))
        & "$PgBin\pg_dump.exe" -h 127.0.0.1 -U $PgUser -w -Fc -Z 6 -f $bak $Infobase
        if ($LASTEXITCODE) { throw 'pg_dump не выполнен' }
        Ok ("{0} ({1:N0} МБ)" -f $bak, ((Get-Item $bak).Length / 1MB))
    }

  if (-not $SkipRestore) {
    Step 'Сеансы: запрет, завершение; Apache остановлен'
    Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force
    Deny 'on' 'on'; KillSessions; Start-Sleep 3
    Ok "сеансов: $((& $rac localhost:1545 session list --cluster=$cl --infobase=$ib | Select-String '^session').Count)"

    Step "БД ${Infobase}: пересоздание и восстановление из $(Split-Path -Leaf $Dump)"
    Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Infobase' AND pid <> pg_backend_pid()" | Out-Null
    Sql "DROP DATABASE IF EXISTS `"$Infobase`""
    Sql "CREATE DATABASE `"$Infobase`" WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'Russian_Russia.1251'"
    $r0 = Get-Date
    & "$PgBin\pg_restore.exe" -h 127.0.0.1 -U $PgUser -w -d $Infobase --no-owner -j 4 $Dump
    if ($LASTEXITCODE) { throw "pg_restore: код $LASTEXITCODE" }
    Ok ("восстановлено за {0:N0} мин, таблиц {1}" -f ((Get-Date) - $r0).TotalMinutes, (Sql "SELECT count(*) FROM pg_tables WHERE schemaname='public'" $Infobase))
    $svc = Get-Service | Where-Object { $_.Name -like '1C:Enterprise 8.3 Server Agent*' } | Select-Object -First 1
    if ($svc) { Restart-Service $svc.Name -Force; Start-Sleep 10; Ok "служба $($svc.Name) перезапущена (кэш метаданных)" }
    Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue
    $ras = Start-Process "$V8Bin\ras.exe" -ArgumentList 'cluster --port=1545 localhost:1540' -PassThru -WindowStyle Hidden
    Start-Sleep 3
  } else {
    Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force
  }
    # пользователи — уже из дампа: -IbUser должен входить в восстановленную базу
    Deny 'off' 'on'

    CheckSpace 'перед загрузкой расширений'
    Step 'Расширения из .cfe'
    Run1C "/LoadCfg `"$ArmCfe`" -Extension АРМЗакупокИПродаж" "загрузка $(Split-Path -Leaf $ArmCfe)"
    Run1C '/UpdateDBCfg -Extension АРМЗакупокИПродаж' 'применение АРМЗакупокИПродаж'
    Run1C "/LoadCfg `"$ODataCfe`" -Extension АРМ_OData" "загрузка $(Split-Path -Leaf $ODataCfe)"
    Run1C '/UpdateDBCfg -Extension АРМ_OData' 'применение АРМ_OData'
    ComJs 'ext-activate.js' @('АРМЗакупокИПродаж', $IbUser, $AdminRole)
    ComJs 'ext-activate.js' @('АРМ_OData')
    & (Join-Path $Here 'enable-odata.ps1') -ConnectionString "Srvr=`"localhost`";Ref=`"$Infobase`";Usr=`"$IbUser`";Pwd=`"$IbPassword`"" | Select-Object -First 2

    Step 'Apache и seed: товары, услуги, машины из Excel; строки АРМ за год'
    & (Join-Path $Here 'start-apache.ps1') | Select-Object -Last 1
    & python -X utf8 (Join-Path $Here 'import-catalogs.py') --base $ODataUrl --user $IbUser "--password=$IbPassword" --fill-arm
    if ($LASTEXITCODE) { throw 'seed (import-catalogs.py) не выполнен' }
} finally {
    try { Deny 'off' 'off' } catch { }
    Stop-Process -Id $ras.Id -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Step 'Итог'
Ok 'готово'
