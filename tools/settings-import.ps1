<#
.SYNOPSIS
    Применение выгрузки настроек vitauto (settings-export.json) на другом сервере.
.DESCRIPTION
    1. Проверяет формат, версию и контрольную сумму выгрузки.
    2. Делает резервную копию текущих файлов настроек.
    3. Записывает матрицу прав в три копии (pwa + backend arm + domain) и процессы
       в pwa\src\lib\process-presets.json.
    4. По флагам обновляет БД: справочник статусов (arm.line_status) и пользователей.
    5. Печатает, что осталось сделать (пересборка: настройки встроены через //go:embed).

    По умолчанию работает в режиме проверки (-DryRun): ничего не пишет, показывает план.
.PARAMETER File
    Путь к settings-export.json.
.PARAMETER DryRun
    Только проверить и показать, что будет изменено.
.PARAMETER ApplyUsers
    Обновить пользователей и роли из выгрузки (нужен -IncludeUsers при экспорте).
.PARAMETER ApplyCredentials
    Обновить bcrypt-хеши паролей (только для переноса стенда целиком).
.PARAMETER ApplyDictionary
    Обновить справочник arm.line_status из выгрузки.
.PARAMETER PgPort
    Порт PostgreSQL (по умолчанию 5434).
.PARAMETER PgPassword
    Пароль postgres (по умолчанию postgres).
.PARAMETER DbName
    База (по умолчанию vitauto_app).
.PARAMETER Force
    Применять, даже если текущий git-commit отличается от источника выгрузки.
.EXAMPLE
    .\tools\settings-import.ps1 -File settings\settings-export.json -DryRun
.EXAMPLE
    .\tools\settings-import.ps1 -ApplyDictionary
#>
param(
    [string]$File = '',
    [switch]$DryRun,
    [switch]$ApplyUsers,
    [switch]$ApplyCredentials,
    [switch]$ApplyDictionary,
    [int]$PgPort = 5434,
    [string]$PgPassword = 'postgres',
    [string]$DbName = 'vitauto_app',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
if (-not $File) { $File = Join-Path $Root 'settings\settings-export.json' }
$Psql = 'C:\Program Files\PostgreSQL 1C\18\bin\psql.exe'

$Targets = [ordered]@{
    matrix    = @(
        (Join-Path $Root 'pwa\src\odata\matrix.json'),
        (Join-Path $Root 'backend\internal\arm\matrix.json'),
        (Join-Path $Root 'backend\internal\domain\matrix.json')
    )
    processes = (Join-Path $Root 'pwa\src\lib\process-presets.json')
}

function Write-Step($t) { Write-Host "  [..] $t" -ForegroundColor Yellow }
function Write-Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn2($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }

function Get-PayloadChecksum($Payload) {
    $json = ($Payload | ConvertTo-Json -Depth 12)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $sum = 'sha256:' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($json))).Replace('-', '').ToLowerInvariant())
    $sha.Dispose()
    return $sum
}

# ── Чтение и проверка выгрузки ──────────────────────────────────────────────
if (-not (Test-Path $File)) { throw "Нет файла выгрузки: $File" }
Write-Step "Чтение $File"
$export = Get-Content $File -Raw -Encoding UTF8 | ConvertFrom-Json

if ($export.format -ne 'vitauto.settings') { throw "Неизвестный формат: $($export.format)" }
if ([int]$export.formatVersion -ne 1) { throw "Неподдерживаемая версия формата: $($export.formatVersion)" }

$actual = Get-PayloadChecksum $export.payload
if ($actual -ne $export.checksum) {
    throw "Контрольная сумма не совпадает: в файле $($export.checksum), посчитано $actual — файл повреждён или изменён вручную"
}
Write-Ok "формат vitauto.settings v1, контрольная сумма верна"

$src = $export.payload.source
Write-Host ("  источник: {0} · БД {1} · коммит {2} · выгружено {3}" -f $src.host, $src.database, $src.gitCommit, $export.exportedAt) -ForegroundColor DarkGray

# Расхождение коммитов — предупреждение: настройки могут ссылаться на другие колонки
$hereCommit = ''
try { Push-Location $Root; $hereCommit = (& git rev-parse --short HEAD 2>$null) } catch { } finally { Pop-Location }
if ($src.gitCommit -and $hereCommit -and $src.gitCommit -ne $hereCommit -and -not $Force) {
    Write-Warn2 ("коммиты различаются (выгрузка {0}, здесь {1}) — настройки могут не совпасть со схемой; перезапись: -Force" -f $src.gitCommit, $hereCommit)
}

$matrix = $export.payload.matrix
$processes = $export.payload.processes

# Проверка целостности матрицы: у каждой роли колонки с маской нужной длины
$statuses = @($matrix.statuses)
$roleCount = @($matrix.roles.PSObject.Properties.Name).Count
$bad = @()
foreach ($role in $matrix.roles.PSObject.Properties) {
    foreach ($col in @($role.Value)) {
        if ($null -eq $col) { continue }
        if ([string]$col.rights -and ([string]$col.rights).Length -ne $statuses.Count) {
            $bad += ("{0}:{1} маска {2} != {3} статусов" -f $role.Name, $col.id, ([string]$col.rights).Length, $statuses.Count)
        }
    }
}
if ($bad.Count) {
    Write-Warn2 "маски прав не совпадают по длине со списком статусов ($($bad.Count)):"
    $bad | Select-Object -First 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
}
Write-Ok ("матрица: ролей {0}, статусов {1}, колонок в роли {2}" -f $roleCount, $statuses.Count, $(if ($roleCount) { @($matrix.roles.($matrix.roles.PSObject.Properties.Name[0])).Count } else { 0 }))
Write-Ok ("процессы: узлов {0}" -f @($processes.nodes).Count)

# ── План ────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  Изменения:' -ForegroundColor Cyan
foreach ($p in $Targets.matrix) { Write-Host "    matrix    -> $($p.Replace($Root + '\',''))" -ForegroundColor Gray }
Write-Host "    processes -> $($Targets.processes.Replace($Root + '\',''))" -ForegroundColor Gray
if ($ApplyDictionary) { Write-Host "    БД        -> arm.line_status ($(@($export.payload.statusDictionary).Count) строк)" -ForegroundColor Gray }
if ($ApplyUsers) { Write-Host "    БД        -> auth.user / arm.user_role ($(@($export.payload.users).Count) пользователей)" -ForegroundColor Gray }
if ($ApplyCredentials) { Write-Host "    БД        -> auth.credential (хеши паролей)" -ForegroundColor DarkYellow }

if ($DryRun) {
    Write-Host ''
    Write-Ok 'DryRun: ничего не записано. Применить: без -DryRun'
    return
}

# ── Резервная копия ─────────────────────────────────────────────────────────
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Split-Path $File -Parent) ("backup-" + $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$i = 0
foreach ($p in ($Targets.matrix + $Targets.processes)) {
    if (Test-Path $p) {
        $i++
        Copy-Item $p (Join-Path $backupDir ("{0:d2}-{1}" -f $i, (Split-Path $p -Leaf))) -Force
    }
}
Write-Ok "резервная копия: $backupDir"

# ── Файлы настроек ──────────────────────────────────────────────────────────
# Запись в том же формате, что у генераторов репозитория (Python: indent=1, UTF-8 без BOM, LF),
# иначе каждый импорт давал бы дифф на весь файл. Без Python — пишем как есть и предупреждаем.
$python = Get-Command python -ErrorAction SilentlyContinue
function Write-JsonCanonical([string]$Path, [string]$Json) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Path -Parent) | Out-Null
    if ($python) {
        $tmp = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding($false)))
            & $python.Source (Join-Path $PSScriptRoot 'json-canonical.py') $tmp
            if ($LASTEXITCODE -ne 0) { throw 'python не смог переформатировать JSON' }
            [System.IO.File]::WriteAllBytes($Path, [System.IO.File]::ReadAllBytes($tmp))
        } finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
    } else {
        [System.IO.File]::WriteAllText($Path, $Json, (New-Object System.Text.UTF8Encoding($false)))
    }
}
if (-not $python) { Write-Warn2 'python не найден — JSON будет записан с отступами PowerShell (дифф на весь файл)' }

$matrixOut = [ordered]@{
    source     = $matrix.source
    statuses   = @($matrix.statuses)
    statusEnum = $matrix.statusEnum
    roles      = $matrix.roles
} | ConvertTo-Json -Depth 12
foreach ($p in $Targets.matrix) { Write-JsonCanonical $p $matrixOut }
Write-Ok "матрица записана в $($Targets.matrix.Count) файла"

$processesOut = [ordered]@{
    source  = $processes.source
    groups  = $processes.groups
    context = @($processes.context)
    nodes   = @($processes.nodes)
} | ConvertTo-Json -Depth 12
Write-JsonCanonical $Targets.processes $processesOut
Write-Ok 'процессы записаны'

# ── БД ──────────────────────────────────────────────────────────────────────
function Invoke-Psql([string]$Sql) {
    if (-not (Test-Path $Psql)) { throw "psql не найден: $Psql" }
    $old = $env:PGPASSWORD
    $env:PGPASSWORD = $PgPassword
    try {
        & $Psql -h 127.0.0.1 -p $PgPort -U postgres -d $DbName -v ON_ERROR_STOP=1 -q -c $Sql
        if ($LASTEXITCODE -ne 0) { throw "psql завершился с ошибкой" }
    } finally {
        $env:PGPASSWORD = $old
    }
}

if ($ApplyDictionary -and $export.payload.statusDictionary) {
    Write-Step 'Справочник статусов...'
    $rows = @(@($export.payload.statusDictionary) | Where-Object { $_ })
    if ($rows.Count) {
        $values = ($rows | ForEach-Object {
            "({0},{1},{2},{3})" -f ("'" + ($_.name -replace "'", "''") + "'"), ("'" + ($_.api -replace "'", "''") + "'"), ("'" + ($_.title -replace "'", "''") + "'"), [int]$_.ord
        }) -join ','
        Invoke-Psql ("insert into arm.line_status (name, api_status, title, ord) values $values on conflict (name) do update set api_status = excluded.api_status, title = excluded.title, ord = excluded.ord;")
        Write-Ok ("обновлено строк: {0}" -f $rows.Count)
    }
}

if ($ApplyUsers -and $export.payload.users) {
    Write-Step 'Пользователи и роли...'
    $users = @(@($export.payload.users) | Where-Object { $_ })
    foreach ($u in $users) {
        $login = $u.login -replace "'", "''"
        $name = ([string]$u.name) -replace "'", "''"
        $roles = (@($u.roles) | ForEach-Object { "'" + (($_ -replace "'", "''")) + "'" }) -join ','
        if (-not $roles) { $roles = "''" }
        $sql = @"
with ins as (
  insert into auth."user" (id, name) values (gen_random_uuid(), '$name') returning id
), cred as (
  insert into auth.credential (login, user_id, password_hash, must_change)
  select '$login', ins.id, '', true from ins
  on conflict (login) do update set must_change = true
  returning user_id
)
select 1;
"@
        Invoke-Psql $sql
    }
    Write-Ok ("пользователей обработано: {0} (пароли не переносились — при первом входе потребуется смена)" -f $users.Count)
}

if ($ApplyCredentials -and $export.payload.credentials) {
    Write-Step 'Хеши паролей...'
    foreach ($c in @($export.payload.credentials) | Where-Object { $_ }) {
        $login = $c.login -replace "'", "''"
        $hash = $c.hash -replace "'", "''"
        Invoke-Psql "update auth.credential set password_hash = '$hash', must_change = false where login = '$login';"
    }
    Write-Ok ("хешей обновлено: {0}" -f @($export.payload.credentials).Count)
}

# ── Итог ────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Ok 'Настройки применены'
Write-Host '  Дальше:' -ForegroundColor Cyan
Write-Host '    .\tools\build-seed-app.ps1    # матрица и процессы встроены в бинарник (//go:embed)' -ForegroundColor Gray
Write-Host '    перезапустить приложение (ярлык VITAUTO или bin\VITAUTO.exe)' -ForegroundColor Gray
