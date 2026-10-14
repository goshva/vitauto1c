#Requires -Version 5.1
<#
.SYNOPSIS
  Дамп рабочей базы 1С (PostgreSQL 18, сервер 1С localhost\autoservice) на диск D.

  pg_dump в custom-формате (-Fc): файл D:\1c_bases\backup\<база>_<ГГГГММДД_ЧЧММ>.dump — его и принимает
  restore-1c-pgsql.ps1 (как и дамп D:\dump-autoservice_main-*.sql). Работе пользователей не мешает: pg_dump снимает
  согласованный снимок, монопольный режим не нужен. Перед дампом — проверка свободного места, после — проверка
  оглавления дампа (pg_restore -l). Старые дампы этой базы сверх -Keep удаляются.

.EXAMPLE
  .\backup-1c-pgsql.ps1                                  # пароль postgres будет запрошен
  .\backup-1c-pgsql.ps1 -Database autoservice -OutDir D:\1c_bases\backup -Keep 10
#>
param(
    [string]$Database = 'autoservice',
    [string]$OutDir = 'D:\1c_bases\backup',
    [SecureString]$PgPassword,
    [string]$PgUser = 'postgres',
    [string]$PgHost = '127.0.0.1',
    [int]$PgPort = 5432,
    [string]$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin',
    [int]$Keep = 0,                       # сколько последних дампов базы оставлять (0 — не удалять)
    [ValidateRange(0, 9)] [int]$Compress = 6
)
$ErrorActionPreference = 'Stop'
$t0 = Get-Date
function Ok([string]$m) { Write-Host "  [OK] $m" -ForegroundColor Green }
foreach ($exe in 'pg_dump.exe', 'pg_restore.exe', 'psql.exe') { if (-not (Test-Path (Join-Path $PgBin $exe))) { throw "Нет $exe в $PgBin" } }
if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString "Пароль PostgreSQL ($PgUser)" }
$env:PGPASSWORD = (New-Object Net.NetworkCredential('', $PgPassword)).Password
try {
    $conn = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-w')
    $size = & (Join-Path $PgBin 'psql.exe') @conn -d postgres -At -c "SELECT pg_database_size('$Database')"
    if ($LASTEXITCODE -or -not $size) { throw "База $Database недоступна на ${PgHost}:$PgPort (пароль, имя базы?)" }
    $sizeGB = [math]::Round([double]$size / 1GB, 2)
    Ok "база ${Database}: $sizeGB ГБ"

    # место: сжатый дамп обычно меньше базы; требуем размер базы + 1 ГБ запаса
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $drive = (Resolve-Path $OutDir).Drive
    $free = [math]::Round((Get-PSDrive $drive.Name).Free / 1GB, 1)
    $need = [math]::Ceiling($sizeGB) + 1
    if ($free -lt $need) { throw "На диске $($drive.Name): свободно $free ГБ, нужно не меньше $need ГБ" }
    Ok "диск $($drive.Name): свободно $free ГБ (нужно $need)"

    $file = Join-Path $OutDir ("{0}_{1:yyyyMMdd_HHmm}.dump" -f $Database, (Get-Date))
    Write-Host "  дамп -> $file ..."
    & (Join-Path $PgBin 'pg_dump.exe') @conn -Fc -Z $Compress -f $file $Database
    if ($LASTEXITCODE) { Remove-Item $file -ErrorAction SilentlyContinue; throw "pg_dump: код $LASTEXITCODE" }
    $tables = (& (Join-Path $PgBin 'pg_restore.exe') -l $file | Select-String 'TABLE DATA').Count
    if ($LASTEXITCODE -or $tables -eq 0) { throw "Дамп $file не читается (pg_restore -l)" }
    Ok ("{0}: {1:N0} МБ, таблиц с данными {2}, за {3:N0} с" -f $file, ((Get-Item $file).Length / 1MB), $tables, ((Get-Date) - $t0).TotalSeconds)

    if ($Keep -gt 0) {
        $old = Get-ChildItem $OutDir -Filter "${Database}_*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
        foreach ($f in $old) { Remove-Item $f.FullName; Ok "удалён старый дамп $($f.Name)" }
    }
    $file
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
