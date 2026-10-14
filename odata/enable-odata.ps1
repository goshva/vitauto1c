#Requires -Version 5.1
<#
.SYNOPSIS
  Полный состав стандартного интерфейса OData в базе через расширение АРМ_OData (odata\enable-odata.js, COM).

  Расширение должно быть подключено (АРМ_OData_v*.cfe: конфигуратор -> Расширения или odata\build-odata-ext.ps1).
  Безопасный режим расширения АРМ_OData снимается — иначе менять состав OData нельзя. Состав хранится в базе:
  повторять после обновления конфигурации или расширений. Публикация: в default.vrd
  <standardOdata enable="true" reuseSessions="autouse" sessionMaxAge="20" poolSize="10" poolTimeout="5"/>.

.EXAMPLE
  .\odata\enable-odata.ps1 -IbDir D:\1c\test_v215
  .\odata\enable-odata.ps1 -ConnectionString 'Srvr="localhost";Ref="autoservice";Usr="Администратор";Pwd=""' -List
#>
param(
    [string]$IbDir,
    [string]$IbUser = 'Админ',
    [string]$IbPassword = '',
    [string]$ConnectionString,
    [switch]$List                      # вывести все объекты состава
)
$ErrorActionPreference = 'Stop'
if (-not $ConnectionString) {
    if (-not $IbDir) { throw 'Укажите -IbDir или -ConnectionString' }
    $ConnectionString = "File=`"$IbDir`";Usr=`"$IbUser`";Pwd=`"$IbPassword`""
}
$tmp = Join-Path $env:TEMP ("enable-odata-{0:yyyyMMddHHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'enable-odata.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", $ConnectionString, [Text.Encoding]::Unicode)
    $cscript = "$env:WINDIR\SysWOW64\cscript.exe"; if (-not (Test-Path $cscript)) { $cscript = "$env:WINDIR\System32\cscript.exe" }
    $t0 = Get-Date
    & $cscript //nologo //E:JScript "$tmp\r.js" "$tmp\c.txt" "$tmp\out.txt" $(if ($List) { 'list' }) | Out-Null
    $out = if (Test-Path "$tmp\out.txt") { [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode) } else { @('ERROR=нет отчёта (COM-соединитель 1С не зарегистрирован?)') }
    foreach ($l in $out) {
        if ($l -match '^ERROR=(.*)') { Write-Host "  [X]  $($Matches[1])" -ForegroundColor Red }
        elseif ($l -match '^SKIPPED (.*)') { Write-Host "  [!]  не принят: $($Matches[1])" -ForegroundColor Yellow }
        elseif ($l -match '^ENABLED=(\d+)') { Write-Host "  [OK] в составе OData: $($Matches[1]) объектов" -ForegroundColor Green }
        elseif ($l -match '^CANDIDATES=(\d+)') { Write-Host "       кандидатов: $($Matches[1])" }
        elseif ($l -match '^KIND (.*)=(\d+)') { Write-Host ("       {0,-26} {1}" -f $Matches[1], $Matches[2]) }
        elseif ($l -match '^SAFEMODE_WAS=1') { Write-Host '  [OK] безопасный режим расширения АРМ_OData снят' -ForegroundColor Green }
        elseif ($l -match '^OBJ (.*)') { Write-Host "       $($Matches[1])" }
    }
    Write-Host ("  за {0:N0} с" -f ((Get-Date) - $t0).TotalSeconds)
    if ($out -match '^ERROR=') { exit 1 }
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
