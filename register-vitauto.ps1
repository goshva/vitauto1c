#Requires -Version 5.1
param(
    [string] $DumpPath         = 'D:\1c_bases\backup\autoservice_20261014_1832.dump',
    [string] $IbName           = 'vitauto',
    [string] $IbTitle          = 'VitAuto',
    [int]    $PgPort           = 5433,
    [string] $PgUser           = 'postgres',
    [string] $Server1C         = 'localhost',
    [string] $PlatformVersion  = '8.3.27.2342',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Restarting elevated...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Value -is [switch]) { if ($kv.Value) { $argList += "-$($kv.Key)" } }
        else { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

$ProgramRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ } | Select-Object -Unique

$PgBin = $null
foreach ($root in @(
    'C:\Program Files\PostgreSQL 1C\18\bin',
    'C:\Program Files\PostgreSQL 1C\15\bin',
    "$env:ProgramFiles\PostgreSQL\15\bin"
)) {
    if (Test-Path (Join-Path $root 'psql.exe')) { $PgBin = $root; break }
}
if (-not $PgBin) {
    $found = Get-ChildItem 'C:\Program Files\PostgreSQL*' -Recurse -Filter 'psql.exe' -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($found) { $PgBin = $found.DirectoryName }
}
if (-not $PgBin) { throw 'PostgreSQL bin (psql.exe) not found' }

$Bin1C = $null
foreach ($root in $ProgramRoots) {
    $b = Join-Path $root "1cv8\$PlatformVersion\bin"
    if (Test-Path (Join-Path $b '1cv8.exe')) { $Bin1C = $b; break }
}
if (-not $Bin1C) { throw "1C platform $PlatformVersion not found" }

$psql   = Join-Path $PgBin 'psql.exe'
$pgrest = Join-Path $PgBin 'pg_restore.exe'
$v8     = Join-Path $Bin1C '1cv8.exe'
$LogDir = 'D:\1c\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path -LiteralPath $DumpPath)) {
    throw "Dump not found: $DumpPath"
}

$sec = Read-Host -AsSecureString 'PostgreSQL superuser password'
$PgPasswordPlain = (New-Object Net.NetworkCredential('', $sec)).Password
if (-not $PgPasswordPlain) { throw 'Password is empty' }
if ($PgPasswordPlain.ToCharArray() | Where-Object { [int]$_ -gt 126 -or [int]$_ -lt 32 }) {
    throw 'PostgreSQL password must be ASCII only'
}

function Invoke-Psql {
    param([string]$Db = 'postgres', [string]$Sql, [switch]$Tuple)
    $env:PGPASSWORD = $PgPasswordPlain
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $flag = if ($Tuple) { '-tAc' } else { '-c' }
        $out = & $psql -w -h 127.0.0.1 -p $PgPort -U $PgUser -d $Db $flag $Sql 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
    [pscustomobject]@{ Out = (($out | Out-String).Trim()); Code = $code }
}

Step '1. Check PostgreSQL'
$chk = Invoke-Psql -Sql 'SELECT version()' -Tuple
if ($chk.Code -ne 0) { throw "Cannot login to PostgreSQL on port $PgPort : $($chk.Out)" }
Ok $chk.Out

Step "2. PostgreSQL database '$IbName'"

$exists = (Invoke-Psql -Sql "SELECT 1 FROM pg_database WHERE datname='$IbName'" -Tuple).Out -eq '1'
$needRestore = $true

if ($exists -and -not $Force) {
    $cfg = (Invoke-Psql -Db $IbName -Sql 'SELECT count(*) FROM config' -Tuple).Out
    if ($cfg -match '^\d+$' -and [int]$cfg -ge 1000) {
        Ok "DB '$IbName' already exists and is not empty (config rows: $cfg) - skip restore"
        $needRestore = $false
    } else {
        Warn "DB '$IbName' exists but looks empty (config: $cfg) - will recreate"
    }
}

if ($needRestore) {
    if ($exists) {
        Write-Host "  Dropping existing DB '$IbName'..."
        [void](Invoke-Psql -Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$IbName' AND pid <> pg_backend_pid()")
        $d = Invoke-Psql -Sql "DROP DATABASE IF EXISTS `"$IbName`""
        if ($d.Code -ne 0) { throw "DROP DATABASE failed: $($d.Out)" }
    }

    Write-Host "  Creating DB '$IbName'..."
    $c = Invoke-Psql -Sql @"
CREATE DATABASE `"$IbName`"
  WITH TEMPLATE = template0
       ENCODING = 'UTF8'
       LOCALE_PROVIDER = libc
       LOCALE = 'Russian_Russia.1251'
"@
    if ($c.Code -ne 0) { throw "CREATE DATABASE failed: $($c.Out)" }
    Ok 'Database created'

    $sizeMb = [math]::Round((Get-Item $DumpPath).Length / 1MB, 0)
    Write-Host "  Restoring dump ($sizeMb MB) - may take 10-40 min..."
    $t0 = Get-Date
    $env:PGPASSWORD = $PgPasswordPlain
    try {
        & $pgrest -w -h 127.0.0.1 -p $PgPort -U $PgUser -d $IbName --no-owner -j 4 $DumpPath
        $rc = $LASTEXITCODE
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }

    $cfg = (Invoke-Psql -Db $IbName -Sql 'SELECT count(*) FROM config' -Tuple).Out
    if ($cfg -notmatch '^\d+$' -or [int]$cfg -lt 1000) {
        throw "After pg_restore config is empty/broken (rows: $cfg). pg_restore exit: $rc"
    }
    $mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 0)
    Ok "Dump restored in $mins min, config rows: $cfg"
}

Step "3. Register IB '$IbName' in 1C cluster"

$agentOk = $false
foreach ($port in 1540, 1541) {
    if (Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
        $agentOk = $true
        Ok "port $port is listening"
    } else {
        Warn "port $port is not responding"
    }
}
if (-not $agentOk) {
    throw '1C server agent is not listening on 1540/1541. Start the service first.'
}

$outLog  = Join-Path $LogDir "1c_register_${IbName}.log"
$resFile = Join-Path $LogDir "1c_register_${IbName}.result"
Remove-Item $outLog, $resFile -ErrorAction SilentlyContinue

$conn = "Srvr=`"$Server1C`";Ref=`"$IbName`";DBMS=PostgreSQL;" +
        "DBSrvr=`"localhost port=$PgPort`";DB=`"$IbName`";" +
        "DBUID=`"$PgUser`";DBPwd=`"$PgPasswordPlain`";CrSQLDB=N;SchJobDn=N;Locale=ru"

Write-Host '  CREATEINFOBASE (CrSQLDB=N)...'
Start-Process $v8 -ArgumentList @(
    "CREATEINFOBASE `"$conn`"",
    '/DisableStartupDialogs',
    '/DisableStartupMessages',
    "/Out `"$outLog`"",
    "/DumpResult `"$resFile`""
) -Wait | Out-Null

$code = if (Test-Path $resFile) { (Get-Content $resFile -Raw).Trim() } else { '-1' }

if (Test-Path $outLog) {
    $text = [IO.File]::ReadAllText($outLog)
    $text = $text.Replace($PgPasswordPlain, '***')
    $text = [regex]::Replace($text, '(?i)(DBPwd=)("[^"]*"|[^;]*)', '$1"***"')
    [IO.File]::WriteAllText($outLog, $text)
}

if ($code -eq '0') {
    Ok "IB registered: $Server1C\$IbName"
} else {
    $logText = if (Test-Path $outLog) { Get-Content $outLog -Raw -Encoding UTF8 } else { '' }
    if ($logText -match 'already registered|already exists') {
        Warn 'IB already registered in cluster - OK'
        Ok "using existing registration $Server1C\$IbName"
    } else {
        if ($logText) { Write-Host $logText }
        throw "CREATEINFOBASE failed with code $code. Log: $outLog"
    }
}

Step '4. Add to common IB list'

$CommonStartDir = Join-Path $env:ProgramData '1C\1CEStart'
$CommonIbList   = Join-Path $CommonStartDir 'ibases.v8i'
New-Item -ItemType Directory -Force -Path $CommonStartDir | Out-Null

$cfgPath = Join-Path $CommonStartDir '1CEStart.cfg'
$cfgText = if (Test-Path $cfgPath) { [IO.File]::ReadAllText($cfgPath) } else { '' }
$line = "CommonInfoBases=$CommonIbList"
if ($cfgText -notmatch "(?mi)^CommonInfoBases=$([regex]::Escape($CommonIbList))\s*$") {
    if ($cfgText -and -not $cfgText.EndsWith("`n")) { $cfgText += "`r`n" }
    [IO.File]::WriteAllText($cfgPath, $cfgText + $line + "`r`n", [Text.Encoding]::Unicode)
    & icacls $CommonStartDir /grant '*S-1-5-32-545:(OI)(CI)RX' /Q | Out-Null
}

$refPattern = "Srvr=`"?$([regex]::Escape($Server1C))`"?;Ref=`"?$([regex]::Escape($IbName))`"?;"
$text = if (Test-Path $CommonIbList) { [IO.File]::ReadAllText($CommonIbList, [Text.Encoding]::UTF8) } else { '' }

if ($text -match $refPattern) {
    Ok 'already in common IB list'
} else {
    $title = $IbTitle
    for ($n = 1; $text -match "(?m)^\[$([regex]::Escape($title))\]\s*$"; $n++) {
        $title = if ($n -eq 1) { "$IbTitle (PostgreSQL)" } else { "$IbTitle (PostgreSQL $n)" }
    }
    if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
    $entry = "[$title]`r`nConnect=Srvr=`"$Server1C`";Ref=`"$IbName`";`r`nID=$([guid]::NewGuid())`r`n" +
             "OrderInList=0`r`nFolder=/`r`nOrderInTree=0`r`nExternal=0`r`n" +
             "ClientConnectionSpeed=Normal`r`nApp=Auto`r`nWA=1`r`nVersion=8.3`r`n"
    [IO.File]::WriteAllText($CommonIbList, $text + $entry, (New-Object Text.UTF8Encoding $true))
    Ok "added to list as: $title"
}

Step '5. Check'
$pg = Invoke-Psql -Db $IbName -Sql 'SELECT version()' -Tuple
if ($pg.Code -eq 0) { Ok "PostgreSQL connection to '$IbName' - OK" }
else { Warn "no connection: $($pg.Out)" }

Write-Host ''
Write-Host 'DONE.' -ForegroundColor Green
Write-Host "  1C cluster : $Server1C\$IbName"
Write-Host "  PostgreSQL : localhost:$PgPort / $IbName"
Write-Host "  IB list    : $CommonIbList"
Write-Host ''
Write-Host 'Start thin client:'
Write-Host "  & `"$Bin1C\1cv8c.exe`" /S `"$Server1C\$IbName`""
Write-Host ''

$PgPasswordPlain = $null
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue