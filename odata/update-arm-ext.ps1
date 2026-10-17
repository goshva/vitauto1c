#Requires -Version 5.1
<#
.SYNOPSIS
  Обновление (или откат) только расширения АРМЗакупокИПродаж в серверной базе — без пересоздания БД и seed.

  1. страховка: текущее расширение выгружается в .cfe (DumpCfg) в -BackupDir; при -PgPassword — ещё и pg_dump базы
  2. сеансы и регламентные задания запрещаются, сеансы завершаются (rac через ras на -RasPort; без ras — шаг пропускается)
  3. /LoadCfg + /UpdateDBCfg -Extension АРМЗакупокИПродаж, проверка модулей расширения (/CheckModules)
  4. запреты снимаются (в finally — и при ошибке)

  Откат: -Rollback — загружается последний (или указанный в -ArmCfe) .cfe из -BackupDir тем же путём.
  Пароль пользователя 1С — -IbPassword (по умолчанию пустой). Скрипт ничего не удаляет.

.EXAMPLE
  .\odata\update-arm-ext.ps1 -Infobase vitauto_mirror -IbUser Автосервис -ArmCfe .\АРМЗакупокИПродаж_v2.21.cfe
.EXAMPLE
  .\odata\update-arm-ext.ps1 -Infobase vitauto_mirror -IbUser Автосервис -Rollback
#>
param(
    [string]$Infobase = 'autoservice',
    [string]$Server = 'localhost',
    [string]$IbUser = 'Администратор',
    [string]$IbPassword = '',
    [string]$ArmCfe,
    [switch]$Rollback,
    [string]$BackupDir = 'D:\1c_bases\backup\arm-ext',
    [string]$V8Bin = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin',
    [int]$RasPort = 1545,
    [SecureString]$PgPassword,
    [string]$PgUser = 'postgres',
    [string]$PgHost = '127.0.0.1',
    [int]$PgPort = 5432,
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin'
)
$ErrorActionPreference = 'Stop'
$Ext = 'АРМЗакупокИПродаж'
$t0 = Get-Date
function Step([string]$m) { Write-Host ("`n[{0:mm\:ss}] {1}" -f ((Get-Date) - $t0), $m) -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
if (-not (Test-Path "$V8Bin\1cv8.exe")) { throw "Нет $V8Bin\1cv8.exe (параметр -V8Bin)" }
New-Item -ItemType Directory -Force $BackupDir | Out-Null
$stamp = '{0:yyyyMMdd_HHmmss}' -f (Get-Date)

if ($Rollback -and -not $ArmCfe) {
    $last = Get-ChildItem $BackupDir -Filter "${Infobase}_${Ext}_*.cfe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $last) { throw "Откат: в $BackupDir нет выгрузок ${Infobase}_${Ext}_*.cfe" }
    $ArmCfe = $last.FullName
}
if (-not $ArmCfe) { throw 'Укажите -ArmCfe (новая версия) или -Rollback' }
$ArmCfe = (Resolve-Path $ArmCfe).Path

function Run1C([string]$args1c, [string]$what) {
    $log = Join-Path $env:TEMP 'update-arm.log'; $res = Join-Path $env:TEMP 'update-arm.res'; Remove-Item $log, $res -ErrorAction SilentlyContinue
    $pwd1c = if ($IbPassword) { "/P `"$IbPassword`"" } else { '' }
    Start-Process "$V8Bin\1cv8.exe" -ArgumentList "DESIGNER /S `"$Server\$Infobase`" /N `"$IbUser`" $pwd1c $args1c /DisableStartupDialogs /DisableStartupMessages /Out `"$log`" /DumpResult `"$res`"" -Wait
    $code = if (Test-Path $res) { "$(Get-Content $res -Raw)".Trim() } else { '-1' }
    $text = if (Test-Path $log) { "$([IO.File]::ReadAllText($log, [Text.Encoding]::GetEncoding(866)))".Trim() } else { '' }
    if ($code -ne '0') { throw "$what — код $code`n$text" }
    Ok "$what$(if ($text) { ': ' + ($text -replace '\s+', ' ') })"
}

# ---------------------------------------------------------------- rac (если ras доступен)
$rac = "$V8Bin\rac.exe"; $cl = $null; $ib = $null
try {
    $cl = ((& $rac "localhost:$RasPort" cluster list 2>$null | Select-String '^cluster\s+:\s+(\S+)').Matches[0].Groups[1].Value)
    $list = & $rac "localhost:$RasPort" infobase summary list --cluster=$cl
    for ($i = 0; $i -lt $list.Count; $i++) { if ($list[$i] -match '^name\s+:\s+(\S+)' -and $Matches[1] -eq $Infobase) { $ib = ($list[$i - 1] -split ':\s+')[1].Trim() } }
} catch { }
$auth = @("--infobase-user=$IbUser", "--infobase-pwd=$IbPassword")
function Deny([string]$sessions, [string]$jobs) {
    if ($ib) { & $rac "localhost:$RasPort" infobase update --cluster=$cl --infobase=$ib @auth "--sessions-deny=$sessions" "--scheduled-jobs-deny=$jobs" "--denied-message=Обновление АРМ" | Out-Null }
}
function KillSessions {
    if (-not $ib) { return }
    foreach ($s in (& $rac "localhost:$RasPort" session list --cluster=$cl --infobase=$ib | Select-String '^session\s+:\s+(\S+)')) {
        & $rac "localhost:$RasPort" session terminate --cluster=$cl --session=$($s.Matches[0].Groups[1].Value) | Out-Null
    }
}
$jobsWereDenied = $false
if ($ib) {
    try {
        $info = & $rac "localhost:$RasPort" infobase info --cluster=$cl --infobase=$ib @auth
        $jobsWereDenied = [bool]($info | Select-String '^scheduled-jobs-deny\s+:\s+on')
    } catch { $jobsWereDenied = $true }   # не прочитали — после обновления оставляем запрет (безопаснее)
}

try {
    Step "Страховка: текущее расширение $Ext → $BackupDir"
    $bakCfe = Join-Path $BackupDir "${Infobase}_${Ext}_$stamp.cfe"
    Run1C "/DumpCfg `"$bakCfe`" -Extension $Ext" "выгрузка $(Split-Path -Leaf $bakCfe)"
    if ($PgPassword) {
        $env:PGPASSWORD = (New-Object Net.NetworkCredential('', $PgPassword)).Password
        $bakDb = Join-Path $BackupDir "${Infobase}_pg_$stamp.dump"
        & "$PgBin\pg_dump.exe" -h $PgHost -p $PgPort -U $PgUser -w -Fc -Z 6 -f $bakDb $Infobase
        if ($LASTEXITCODE) { throw 'pg_dump не выполнен' }
        Ok ("{0} ({1:N0} МБ)" -f $bakDb, ((Get-Item $bakDb).Length / 1MB))
    } else { Write-Host '  pg_dump пропущен (нет -PgPassword) — бэкап базы делается отдельно' -ForegroundColor Yellow }

    Step "Регламентные задания: запрет; сеансы: завершение$(if (-not $ib) { ' (ras недоступен — пропуск)' })"
    Deny 'off' 'on'; KillSessions; Start-Sleep 2

    Step "$(if ($Rollback) { 'Откат' } else { 'Обновление' }): $(Split-Path -Leaf $ArmCfe)"
    Run1C "/LoadCfg `"$ArmCfe`" -Extension $Ext" 'загрузка'
    Run1C "/UpdateDBCfg -Extension $Ext" 'применение'
    Run1C "/CheckModules -ThinClient -WebClient -Server -ExternalConnection -Extension $Ext" 'проверка модулей'
    Ok "откат при необходимости: .\odata\update-arm-ext.ps1 -Infobase $Infobase -IbUser $IbUser -ArmCfe `"$bakCfe`""
} finally {
    try { Deny 'off' $(if ($jobsWereDenied) { 'on' } else { 'off' }) } catch { }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Step 'Итог'
Ok 'готово'
