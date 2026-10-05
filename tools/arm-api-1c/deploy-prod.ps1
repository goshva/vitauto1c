#Requires -Version 5.1
<#
.SYNOPSIS
  АРМ v2.9 с HTTP API в рабочую файловую базу и её публикация для PWA.

  1. База должна быть закрыта (все окна 1С на ней) — иначе выход без изменений.
  2. Резервная копия: файлы базы (без DoNotCopy.txt) и текущее расширение (.cfe) в -BackupDir.
  3. Загрузка расширения из -Cfe, обновление БД, проверка модулей.
  4. Безопасный режим расширения — выключен (API нужен привилегированный режим), пользователи ИБ для PWA.
  5. Публикация /<Name> на локальном Apache (tools/arm-api-1c) и проверка входа через API.

.EXAMPLE
  .\tools\arm-api-1c\deploy-prod.ps1
  .\tools\arm-api-1c\deploy-prod.ps1 -IbDir C:\1c_bases\autoservice -Password 'стойкий-пароль'
#>
param(
    [string]$IbDir     = 'C:\1c_bases\autoservice',
    [string]$Name      = 'autoservice',                  # имя публикации: http://127.0.0.1:8090/<Name>/hs/api/arm/v1
    [string]$Cfe       = (Join-Path $PSScriptRoot '..\..\АРМЗакупокИПродаж_v2.9.cfe'),
    [string]$BackupDir = 'D:\1c\backup',
    [string]$Password  = '1',                            # пароль пользователей arm.manager / arm.storekeeper / arm.supply
    [string]$Platform  = 'D:\Program Files\1cv8\8.3.27.2342\bin',
    [string]$PubRoot   = 'D:\1c\pub',
    [string]$ApacheConf = 'D:\1c\apache\httpd-1c.conf',
    [int]   $Port      = 8090
)
$ErrorActionPreference = 'Stop'
$Ext = 'АРМЗакупокИПродаж'
$designer = Join-Path $Platform '1cv8.exe'
$cscript = "$env:WINDIR\SysWOW64\cscript.exe"
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$work = Join-Path $BackupDir "$Name`_$stamp"
function Step($t) { Write-Host "`n=== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }

function Designer([string[]]$cmd, [string]$what) {
    $log = Join-Path $work "designer-$what.log"
    $a = @('DESIGNER', '/F', "`"$IbDir`"", '/N', '"Админ"', '/P', '""', '/DisableStartupDialogs') + $cmd + @('/Out', "`"$log`"")
    $p = Start-Process $designer -ArgumentList $a -Wait -PassThru
    $text = if (Test-Path $log) { (Get-Content $log -Encoding Default) -join "`n" } else { '' }
    if ($p.ExitCode -ne 0) { throw "Конфигуратор ($what) завершился с кодом $($p.ExitCode): $text" }
    if ($text) { Write-Host "  $text" }
}

Step 'Проверки'
foreach ($f in @($designer, $cscript, $Cfe, (Join-Path $IbDir '1Cv8.1CD'))) { if (-not (Test-Path $f)) { throw "Нет $f" } }
$Cfe = (Resolve-Path $Cfe).Path
# своя публикация этой базы в Apache держит базу открытой — остановить Apache на время
$httpd = Get-Process httpd -ErrorAction SilentlyContinue
if ($httpd) { $httpd | Stop-Process -Force; Start-Sleep 2; Ok 'Apache остановлен на время обновления' }
try {
    $fs = [IO.File]::Open((Join-Path $IbDir '1Cv8.1CD'), 'Open', 'ReadWrite', 'None'); $fs.Close()
} catch {
    throw "База $IbDir открыта (окно 1С, конфигуратор или COM). Закройте все сеансы и запустите снова."
}
Ok "база закрыта: $IbDir"

Step 'Резервная копия'
New-Item -ItemType Directory -Force (Join-Path $work 'ib') | Out-Null
Get-ChildItem $IbDir -File | Where-Object { $_.Name -ne 'DoNotCopy.txt' } | Copy-Item -Destination (Join-Path $work 'ib')
Ok "файлы базы -> $work\ib (без DoNotCopy.txt)"
Designer @('/DumpCfg', "`"$work\$Ext-before.cfe`"", '-Extension', "`"$Ext`"") 'dump-before'
Ok "текущее расширение -> $work\$Ext-before.cfe"

Step "Загрузка $([IO.Path]::GetFileName($Cfe))"
Designer @('/LoadCfg', "`"$Cfe`"", '-Extension', "`"$Ext`"") 'load'
Designer @('/UpdateDBCfg', '-Extension', "`"$Ext`"") 'update'
Designer @('/CheckModules', '-Server', '-ExternalConnection', '-Extension', "`"$Ext`"") 'check'
Ok 'расширение загружено, БД обновлена'

Step 'Безопасный режим и пользователи PWA'
$js = Join-Path $work 'prod-setup.u.js'
[IO.File]::WriteAllText($js, [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'prod-setup.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
$report = Join-Path $work 'prod-setup.txt'
& $cscript //nologo //E:JScript $js $report $IbDir $Password
$text = Get-Content $report -Encoding Unicode
$text | ForEach-Object { Write-Host "  $_" }
if (-not ($text -match '^OK$')) { throw "Настройка не выполнена — см. $report" }
if (-not ($text -match 'EXT version=2\.9 safe=false')) { throw 'Расширение не v2.9 или безопасный режим не выключен' }

Step "Публикация /$Name"
$pub = Join-Path $PubRoot $Name
New-Item -ItemType Directory -Force $pub | Out-Null
$vrd = @"
<?xml version="1.0" encoding="UTF-8"?>
<point xmlns="http://v8.1c.ru/8.2/virtual-resource-system" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" base="/$Name" ib="File=&quot;$IbDir&quot;;Usr=&quot;Админ&quot;;Pwd=&quot;&quot;;">
	<httpServices publishByDefault="false" publishExtensionsByDefault="true"/>
</point>
"@
[IO.File]::WriteAllText((Join-Path $pub 'default.vrd'), $vrd, (New-Object Text.UTF8Encoding $false))
$conf = [IO.File]::ReadAllText($ApacheConf)
$pubFwd = $pub.Replace('\', '/')
if ($conf -notmatch [regex]::Escape("Alias `"/$Name`"")) {
    $conf += @"

# публикация $IbDir (deploy-prod.ps1)
Alias "/$Name" "$pubFwd/"
<Directory "$pubFwd/">
    AllowOverride All
    Options None
    Require all granted
    SetHandler 1c-application
    ManagedApplicationDescriptor "$pubFwd/default.vrd"
</Directory>
"@
    [IO.File]::WriteAllText($ApacheConf, $conf, (New-Object Text.UTF8Encoding $false))
    Ok "Alias /$Name добавлен в $ApacheConf"
}
& (Join-Path $PSScriptRoot 'start.ps1') -Conf $ApacheConf -Port $Port

Step 'Проверка API'
$base = "http://127.0.0.1:$Port/$Name/hs/api/arm/v1"
$body = [Text.Encoding]::UTF8.GetBytes((@{ login = 'arm.manager'; password = $Password } | ConvertTo-Json -Compress))
$s = Invoke-RestMethod -Method Post -Uri "$base/session" -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 120
$h = @{ 'Authorization' = 'Bearer ' + $s.token }
$lines = Invoke-RestMethod -Uri "$base/lines?view=sales&limit=500" -Headers $h -TimeoutSec 120
Ok "вход arm.manager: роль $($s.role), строк продаж: $($lines.items.Count)"
Write-Host "`nГОТОВО. API: $base`nPWA: `$env:ARM_API_TARGET='http://127.0.0.1:$Port/$Name/hs/api'; npm run dev`nРезервная копия: $work" -ForegroundColor Green
