#Requires -Version 5.1
<#
.SYNOPSIS
  Стенд сборки расширения АРМЗакупокИПродаж: копия рабочей базы в кластере 1С, XML-исходники (src-xml) и сборка .cfe.

  Шаги (-Step):
    restore  — PostgreSQL: база -Infobase из дампа -Dump (pg_dump -Fc), локаль как у vitauto
    register — запись базы в кластере (CREATEINFOBASE CrSQLDB=N), регламентные задания запрещены (SchJobDn=Y)
    loadcfe  — загрузить -Cfe в расширение и применить (например, АРМЗакупокИПродаж_v2.22.cfe)
    dumpxml  — выгрузить расширение в src-xml\АРМЗакупокИПродаж_v<Version> (папка очищается)
    build    — загрузить src-xml\АРМЗакупокИПродаж_v<Version>, применить, проверить модули, выгрузить АРМЗакупокИПродаж_v<Version>.cfe

  Только для копии: рабочие базы (vitauto, autoservice, autoservice_main) скрипт не трогает.

.EXAMPLE
  .\tools\arm-dev-stand.ps1 -Step restore -Dump D:\1c_bases\backup\vitauto_20261028_1502.dump
  .\tools\arm-dev-stand.ps1 -Step register
  .\tools\arm-dev-stand.ps1 -Step loadcfe -Cfe .\АРМЗакупокИПродаж_v2.22.cfe
  .\tools\arm-dev-stand.ps1 -Step dumpxml -Version 2.22
  .\tools\arm-dev-stand.ps1 -Step build -Version 2.23
#>
param(
    [Parameter(Mandatory)][ValidateSet('restore', 'register', 'loadcfe', 'dumpxml', 'build')][string]$Step,
    [string]$Infobase = 'vitauto_dev',
    [string]$IbUser = 'Автосервис',
    [string]$IbPassword = '',
    [string]$Version = '2.23',
    [string]$Cfe,
    [string]$Dump,
    [string]$PgPassword = 'postgres',
    [int]$PgPort = 5433,
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin',
    [string]$V8Bin = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin'
)
$ErrorActionPreference = 'Stop'
$Ext = 'АРМЗакупокИПродаж'
$Repo = Split-Path -Parent $PSScriptRoot
if ($Infobase -match '^(vitauto|autoservice|autoservice_main)$') { throw "$Infobase — рабочая база; стенд только для копии" }

function Designer([string]$a, [string]$what) {
    $log = Join-Path $env:TEMP 'arm-dev-stand.log'; $res = Join-Path $env:TEMP 'arm-dev-stand.res'
    Remove-Item $log, $res -ErrorAction SilentlyContinue
    $pwd1c = if ($IbPassword) { "/P `"$IbPassword`"" } else { '' }
    Start-Process "$V8Bin\1cv8.exe" -Wait -ArgumentList "DESIGNER /S `"localhost\$Infobase`" /N `"$IbUser`" $pwd1c $a /DisableStartupDialogs /DisableStartupMessages /Out `"$log`" /DumpResult `"$res`""
    $code = if (Test-Path $res) { "$(Get-Content $res -Raw)".Trim() } else { '-1' }
    $text = if (Test-Path $log) { [IO.File]::ReadAllText($log, [Text.Encoding]::GetEncoding(1251)).Trim() -replace '\s+', ' ' } else { '' }
    Write-Host "  [$what] код $code $text"
    if ($code -ne '0') { throw "$what — ошибка (код $code)" }
}

switch ($Step) {
    'restore' {
        if (-not $Dump) { throw 'Укажите -Dump' }
        $env:PGPASSWORD = $PgPassword
        $psql = @('-w', '-h', '127.0.0.1', '-p', $PgPort, '-U', 'postgres')
        $loc = (& "$PgBin\psql.exe" @psql -At -c "select pg_encoding_to_char(encoding)||'|'||datcollate||'|'||datctype from pg_database where datname='vitauto'").Split('|')
        & "$PgBin\psql.exe" @psql -c "CREATE DATABASE $Infobase TEMPLATE template0 ENCODING '$($loc[0])' LC_COLLATE '$($loc[1])' LC_CTYPE '$($loc[2])'"
        if ($LASTEXITCODE) { throw "CREATE DATABASE $Infobase" }
        & "$PgBin\pg_restore.exe" @psql -d $Infobase --no-owner --no-privileges -j 4 $Dump
        if ($LASTEXITCODE) { throw 'pg_restore' }
    }
    'register' {
        $cs = "Srvr=`"localhost`";Ref=`"$Infobase`";DBMS=PostgreSQL;DBSrvr=`"localhost port=$PgPort`";DB=`"$Infobase`";" +
              "DBUID=`"postgres`";DBPwd=`"$PgPassword`";CrSQLDB=N;SchJobDn=Y;Locale=ru"
        $log = Join-Path $env:TEMP 'arm-dev-stand.log'
        Start-Process "$V8Bin\1cv8.exe" -Wait -ArgumentList "CREATEINFOBASE `"$($cs -replace '"', '""')`" /Out `"$log`" /DisableStartupDialogs"
        ([IO.File]::ReadAllText($log, [Text.Encoding]::GetEncoding(1251))) -replace 'DBPwd="[^"]*"', 'DBPwd="***"'
    }
    'loadcfe' {
        if (-not $Cfe) { throw 'Укажите -Cfe' }
        Designer "/LoadCfg `"$((Resolve-Path $Cfe).Path)`" -Extension $Ext" "загрузка $(Split-Path -Leaf $Cfe)"
        Designer "/UpdateDBCfg -Extension $Ext" 'применение'
    }
    'dumpxml' {
        $dir = Join-Path $Repo "src-xml\${Ext}_v$Version"
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
        New-Item -ItemType Directory -Force $dir | Out-Null
        Designer "/DumpConfigToFiles `"$dir`" -Extension $Ext" "выгрузка в $dir"
    }
    'build' {
        $dir = Join-Path $Repo "src-xml\${Ext}_v$Version"
        $out = Join-Path $Repo "${Ext}_v$Version.cfe"
        Designer "/LoadConfigFromFiles `"$dir`" -Extension $Ext" "загрузка $dir"
        Designer "/UpdateDBCfg -Extension $Ext" 'применение'
        Designer "/CheckModules -ThinClient -WebClient -Server -ExternalConnection -Extension $Ext" 'проверка модулей'
        Designer "/DumpCfg `"$out`" -Extension $Ext" "выгрузка $out"
    }
}
