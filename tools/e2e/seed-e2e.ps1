#Requires -Version 5.1
<#
.SYNOPSIS
  Расширение seed для сквозных тестов АРМ (tools/e2e/seed-e2e.js): 2 поставщика и покупатель с договорами,
  номенклатура с видами НДС Общая / БезНДС / Пониженная, остатки через проведённую приходную накладную.
  Только тестовая база: перед запуском сделайте резервную копию (.dt).
.EXAMPLE
  .\tools\e2e\seed-e2e.ps1 -IbDir D:\1c_bases\autoservice -IAmSureThisIsTestBase
#>
param(
    [Parameter(Mandatory)] [string]$IbDir,
    [string]$IbUser = 'Админ',
    [string]$IbPassword = '',
    [switch]$IAmSureThisIsTestBase,
    [string]$ReportPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not $IAmSureThisIsTestBase) { throw 'Скрипт пишет данные в базу. Подтвердите, что база тестовая: -IAmSureThisIsTestBase' }
$tmp = Join-Path $env:TEMP ("seed-e2e-{0:yyyyMMddHHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\s.js", [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'seed-e2e.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", "File=`"$IbDir`";Usr=`"$IbUser`";Pwd=`"$IbPassword`"", [Text.Encoding]::Unicode)
    & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript "$tmp\s.js" "$tmp\c.txt" "$tmp\out.txt" | Out-Null
    $out = [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode)
    if ($ReportPath) { [IO.File]::WriteAllLines($ReportPath, $out, (New-Object Text.UTF8Encoding $true)) }
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor $(if ($_ -like 'ERROR*') { 'Red' } else { 'Green' }) }
    if ($out -match '^ERROR') { exit 1 }
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
