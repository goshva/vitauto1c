# full-seed.ps1 -- Full seed DB vitauto_app
# Usage: .\seed\full-seed.ps1

param(
    [string]$PgHost = "localhost",
    [int]$Port = 5432,
    [string]$Db = "vitauto_app",
    [string]$User = "postgres",
    [string]$Password = "postgres",
    [switch]$SkipClean
)

$Root = (Get-Item $PSScriptRoot).Parent.FullName
$Psql = "C:\Program Files\PostgreSQL 1C\18\bin\psql.exe"

if (-not (Test-Path $Psql)) {
    Write-Error "psql not found: $Psql"
    exit 1
}

$env:PGHOST = $PgHost
$env:PGPORT = "$Port"
$env:PGDATABASE = $Db
$env:PGUSER = $User
$env:PGPASSWORD = $Password
$env:PGCLIENTENCODING = "UTF8"

function Run-Sql {
    param(
        [string]$File,
        [string]$Label
    )
    $FullPath = Join-Path $Root $File
    if (-not (Test-Path $FullPath)) {
        Write-Error "File not found: $FullPath"
        exit 1
    }
    Write-Host ">>> ${Label} -- $File" -ForegroundColor Cyan
    & $Psql -P pager=off -v ON_ERROR_STOP=1 -f $FullPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Error: $File"
        exit 1
    }
    Write-Host "  OK" -ForegroundColor Green
}

# STEP 0: Clean
if (-not $SkipClean) {
    Run-Sql "seed\clean.sql" "Clean"
}

# STEP 1: NSI
Run-Sql "seed\demo-app.sql" "NSI"

# STEP 2: Scenarios (creates customer orders ZK-001..007)
Run-Sql "seed\demo-data.sql" "Scenarios"

# STEP 3: Stages (reference customer orders: FK arm.line.customer_order_id)
Run-Sql "seed\demo-stages.sql" "Stages"

# Summary
Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Green
& $Psql -P pager=off -A -t -f (Join-Path $Root "seed\summary.sql")
Write-Host ""
Write-Host "Done!" -ForegroundColor Green
