#Requires -Version 5.1
<#
.SYNOPSIS
  Дополнить уже установленную платформу 1С 8.3.27.2342 компонентом «Модули расширения веб-сервера»
  (WEBSERVEREXT=1: wsap24.dll, webinst.exe) — нужен для публикации OData в Apache (checkApacheOdata.ps1).
  Сам Apache ставит checkApacheOdata.ps1. Новая установка install-1c-pgsql.ps1 ставит модуль сразу — этот скрипт
  нужен только для платформы, установленной раньше с WEBSERVEREXT=0. Запуск — от администратора.
#>
param(
    [string]$MsiDir = 'D:\1c\platform_8_3_27_2342\windows_8_3_27_2342',
    [string]$Log = 'D:\1c\logs\1c_webext.log'
)
$ErrorActionPreference = 'Stop'
$msi = Join-Path $MsiDir '1CEnterprise 8.msi'
if (-not (Test-Path $msi)) { throw "Нет $msi — распакуйте дистрибутив платформы (install-1c-pgsql.ps1, шаг 1)" }
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null

# Подключение трансформаций, если они есть
$mst = @('adminstallrelogon.mst', '1049.mst') |
    Where-Object { Test-Path (Join-Path $MsiDir $_) } |
    ForEach-Object { Join-Path $MsiDir $_ }
$transforms = if ($mst) { "TRANSFORMS=`"$($mst -join ';')`"" } else { '' }

$msiArgs = "/i `"$msi`" /qn ALLUSERS=1 $transforms " +
        "DESIGNERALLCLIENTS=1 THICKCLIENT=1 THINCLIENT=1 THINCLIENTFILE=1 " +
        "WEBSERVEREXT=1 SERVER=1 SERVERCLIENT=1 CONFREPOSSERVER=0 CONVERTER77=0 LANGUAGES=RU " +
        "/norestart /l*v `"$Log`""
$p = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru
if ($p.ExitCode -notin 0, 3010) { throw "msiexec: код $($p.ExitCode), лог $Log" }
Write-Host "  [OK] модули веб-сервера 1С установлены (код $($p.ExitCode))" -ForegroundColor Green
