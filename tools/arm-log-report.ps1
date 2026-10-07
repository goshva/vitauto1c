#Requires -Version 5.1
<#
.SYNOPSIS
  Выгрузка событий АРМ из журнала регистрации 1С для анализа ошибок (АРМ v2.13+, модуль Арм_Журнал).

  События: «АРМ.Ошибка» (исключения с местом, пользователем, ролью, контекстом и стеком вызовов),
  «АРМ.Отказ» (отказы по правам), «АРМ.Правка» (изменения полей: было → стало), «АРМ.Действие», а также
  прежние события АРМ («АРМ.ОшибкаОбработки» и др.).
  Результат: CSV со всеми записями (UTF-8, разделитель «;» — открывается в Excel) и сводка .md:
  группы «событие + место», сколько раз, первое и последнее появление, последний пример каждой ошибки.

.EXAMPLE
  .\tools\arm-log-report.ps1 -IbDir D:\1c\test_fresh
  .\tools\arm-log-report.ps1 -IbDir C:\1c_bases\autoservice -Days 1 -OutDir D:\1c\logs
#>
param(
    [string]$IbDir = 'C:\1c_bases\autoservice',
    [string]$User = 'Админ',
    [string]$Password = '',
    [double]$Days = 7,
    [string]$OutDir = (Join-Path $PSScriptRoot '..\logs')
)
$ErrorActionPreference = 'Stop'
$cscript = "$env:WINDIR\SysWOW64\cscript.exe"      # COM-соединитель 1С — 32-битный
if (-not (Test-Path $cscript)) { $cscript = "$env:WINDIR\System32\cscript.exe" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$stamp = Get-Date -Format 'yyyyMMdd_HHmm'
$csv = Join-Path $OutDir "arm-log_$stamp.csv"
$md = Join-Path $OutDir "arm-log_$stamp.md"
$start = (Get-Date).AddDays(-$Days).ToString('yyyyMMddHHmmss')
$conn = "File=`"$IbDir`";Usr=`"$User`";Pwd=`"$Password`""

# cscript читает JScript в UTF-16 — перекодируем во временный файл
$js = Join-Path $env:TEMP 'arm-log-report.u.js'
[IO.File]::WriteAllText($js, [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'arm-log-report.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
& $cscript //nologo //E:JScript $js $conn $start $csv $md
if ($LASTEXITCODE -ne 0) { throw "выгрузка не удалась (код $LASTEXITCODE)" }
Write-Host "CSV:    $csv"
Write-Host "Сводка: $md"
