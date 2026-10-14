#Requires -Version 5.1
<#
.SYNOPSIS
  Тестовые пользователи PWA (OData): arm.manager, arm.storekeeper, arm.supply, arm.admin, arm.mechanic.
  Пользователь ИБ (пароль -Password, роль ПолныеПрава) + элемент справочника «Пользователи» с тем же именем
  + роль интерфейса АРМ в регистре Арм_ПраваПользователей. Только для тестовой базы.

.EXAMPLE
  .\odata\pwa-test-users.ps1 -IbDir D:\1c\test_v215
#>
param(
    [Parameter(Mandatory)] [string]$IbDir,
    [string]$IbUser = 'Админ',
    [string]$IbPassword = '',
    [string]$Password = '1'
)
$ErrorActionPreference = 'Stop'
if ($IbDir -match '(?i)1c_bases') { throw 'Это похоже на рабочую базу — тестовые пользователи с полными правами только для тестовых баз' }
$tmp = Join-Path $env:TEMP ("pwa-users-{0:yyyyMMddHHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pwa-test-users.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", "File=`"$IbDir`";Usr=`"$IbUser`";Pwd=`"$IbPassword`"", [Text.Encoding]::Unicode)
    & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript "$tmp\r.js" "$tmp\c.txt" "$tmp\out.txt" $Password | Out-Null
    $out = [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode)
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor $(if ($_ -like 'ERROR*') { 'Red' } else { 'Green' }) }
    if ($out -match '^ERROR') { exit 1 }
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
