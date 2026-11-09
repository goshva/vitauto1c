<#
.SYNOPSIS
    Выгрузка настроек vitauto (права, процессы, статусы, роли) в один JSON для переноса на другой сервер.
.DESCRIPTION
    Собирает действующие настройки в файл settings\settings-export.json:

      matrix      — матрица прав: роли x колонки x маска прав по статусам
                    (канон: pwa\src\odata\matrix.json, копии в backend\internal\arm и domain)
      processes   — процессы: группы полей, контекст, узлы (pwa\src\lib\process-presets.json)
      statuses    — порядок статусов и перевод значений 1С -> коды API
      dictionary  — справочник статусов из БД (arm.line_status), если заполнен
      users       — пользователи и роли из БД (только с -IncludeUsers; без паролей)

    Выгрузка идемпотентна: повторный запуск даёт тот же JSON, кроме exportedAt.
    Контрольная сумма (sha256) считается по содержимому без самого поля checksum.

    Настройки сейчас встроены в бинарник при сборке (//go:embed). Чтобы применить
    выгрузку на другом сервере, после tools\settings-import.ps1 нужна пересборка:
    tools\build-seed-app.ps1. Когда появится хранение настроек в БД, импорт
    перестанет требовать пересборку — формат выгрузки это уже учитывает.
.PARAMETER OutDir
    Каталог выгрузки (по умолчанию settings в корне репозитория).
.PARAMETER Name
    Базовое имя файла без расширения (по умолчанию settings-export).
.PARAMETER PgPort
    Порт PostgreSQL демо-стенда (по умолчанию 5434). 0 — не обращаться к БД.
.PARAMETER PgPassword
    Пароль postgres (по умолчанию postgres).
.PARAMETER DbName
    База (по умолчанию vitauto_app).
.PARAMETER IncludeUsers
    Включить пользователей и роли из БД (логин, имя, роль; без паролей).
.PARAMETER IncludeCredentialHashes
    Включить bcrypt-хеши паролей. Только для переноса стенда целиком: хеши
    позволяют войти с теми же паролями. В чужие репозитории такое класть нельзя.
.PARAMETER Force
    Перезаписать существующий файл выгрузки.
.EXAMPLE
    .\tools\settings-export.ps1 -IncludeUsers
.EXAMPLE
    .\tools\settings-export.ps1 -PgPort 0 -OutDir D:\transfer
#>
param(
    [string]$OutDir = '',
    [string]$Name = 'settings-export',
    [int]$PgPort = 5434,
    [string]$PgPassword = 'postgres',
    [string]$DbName = 'vitauto_app',
    [switch]$IncludeUsers,
    [switch]$IncludeCredentialHashes,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutDir) { $OutDir = Join-Path $Root 'settings' }

$MatrixCanon = Join-Path $Root 'pwa\src\odata\matrix.json'
$MatrixCopies = @(
    (Join-Path $Root 'pwa\src\odata\matrix.json'),
    (Join-Path $Root 'backend\internal\arm\matrix.json'),
    (Join-Path $Root 'backend\internal\domain\matrix.json')
)
$ProcessesPath = Join-Path $Root 'pwa\src\lib\process-presets.json'
$Psql = 'C:\Program Files\PostgreSQL 1C\18\bin\psql.exe'

function Write-Step($t) { Write-Host "  [..] $t" -ForegroundColor Yellow }
function Write-Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn2($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) { throw "Нет файла настроек: $Path" }
    return (Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Invoke-PsqlJson([string]$Sql) {
    # psql отдаёт одну строку JSON; ошибки подключения не должны ронять выгрузку файлов.
    # Возвращает обёртку @{ data = <разобранный JSON> }: пустой массив — валидный результат,
    # поэтому отдавать сам массив нельзя (PowerShell развернёт его в $null).
    if (-not (Test-Path $Psql)) { return $null }
    $old = $env:PGPASSWORD
    $env:PGPASSWORD = $PgPassword
    try {
        $out = & $Psql -h 127.0.0.1 -p $PgPort -U postgres -d $DbName -A -t -v ON_ERROR_STOP=1 -c $Sql 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        $text = ($out | Out-String).Trim()
        if (-not $text) { return $null }
        $parsed = $text | ConvertFrom-Json
        return [pscustomobject]@{ data = $parsed }
    } catch {
        return $null
    } finally {
        $env:PGPASSWORD = $old
    }
}

# ── Матрица прав ────────────────────────────────────────────────────────────
Write-Step 'Матрица прав (matrix.json)...'
$matrix = Read-JsonFile $MatrixCanon

$hashes = @{}
foreach ($p in $MatrixCopies) {
    if (Test-Path $p) {
        $hashes[$p] = (Get-FileHash $p -Algorithm SHA256).Hash
    } else {
        Write-Warn2 "копия матрицы отсутствует: $p"
    }
}
$distinct = @($hashes.Values | Sort-Object -Unique)
if ($distinct.Count -gt 1) {
    Write-Warn2 "копии matrix.json расходятся — беру канон $MatrixCanon, остальные нужно синхронизировать"
}

$roles = @()
if ($matrix.roles) { $roles = @($matrix.roles.PSObject.Properties.Name) }
Write-Ok ("ролей: {0}, статусов: {1}" -f $roles.Count, @($matrix.statuses).Count)

# ── Процессы ────────────────────────────────────────────────────────────────
Write-Step 'Процессы (process-presets.json)...'
$processes = Read-JsonFile $ProcessesPath
$nodeCount = 0
if ($processes.nodes) { $nodeCount = @($processes.nodes).Count }
Write-Ok "узлов процесса: $nodeCount"

# ── БД: статусы и пользователи ──────────────────────────────────────────────
$dictionary = $null
$users = $null
$dbReached = $false

if ($PgPort -gt 0) {
    Write-Step "БД $DbName на порту $PgPort..."
    $dictRes = Invoke-PsqlJson @'
select coalesce(json_agg(json_build_object('name', name, 'api', api_status, 'title', title, 'ord', ord) order by ord), '[]'::json)
from arm.line_status;
'@
    if ($null -ne $dictRes) {
        $dbReached = $true
        $dictionary = @($dictRes.data)
        Write-Ok ("справочник статусов: {0} строк" -f $dictionary.Count)
    } else {
        Write-Warn2 'БД недоступна — статусы и пользователи не выгружены (файлы матрицы и процессов выгружены)'
    }

    if ($IncludeUsers -and $dbReached) {
        $usersRes = Invoke-PsqlJson @'
select coalesce(json_agg(json_build_object(
         'login', c.login,
         'name', u.name,
         'roles', coalesce((select json_agg(r.role order by r.role) from arm.user_role r where r.user_id = u.id), '[]'::json),
         'mustChange', c.must_change
       ) order by c.login), '[]'::json)
from auth.credential c join auth."user" u on u.id = c.user_id;
'@
        if ($null -ne $usersRes) {
            $users = @($usersRes.data)
            Write-Ok ("пользователей: {0}" -f $users.Count)
        }
    }
}

# Хеши паролей — только по явному запросу
$credentials = $null
if ($IncludeCredentialHashes -and $dbReached) {
    Write-Warn2 'в выгрузку попадут bcrypt-хеши паролей — не публикуйте этот файл'
    $credRes = Invoke-PsqlJson @'
select coalesce(json_agg(json_build_object('login', login, 'hash', password_hash) order by login), '[]'::json)
from auth.credential;
'@
    if ($null -ne $credRes) { $credentials = @($credRes.data) }
}

# ── Метаданные источника ────────────────────────────────────────────────────
$commit = ''
$branch = ''
$dirty = $false
try {
    Push-Location $Root
    $commit = (& git rev-parse --short HEAD 2>$null)
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
    $dirty = [bool](& git status --porcelain 2>$null)
} catch { } finally { Pop-Location }

# ── Сборка выгрузки ─────────────────────────────────────────────────────────
$payload = [ordered]@{
    application = [ordered]@{
        name    = 'vitauto'
        version = '0.1.0'
    }
    source      = [ordered]@{
        host      = $env:COMPUTERNAME
        database  = if ($dbReached) { $DbName } else { $null }
        pgPort    = if ($dbReached) { $PgPort } else { $null }
        gitBranch = $branch
        gitCommit = $commit
        gitDirty  = $dirty
    }
    matrix      = [ordered]@{
        source     = $matrix.source
        statuses   = @($matrix.statuses)
        statusEnum = $matrix.statusEnum
        roles      = $matrix.roles
    }
    processes   = [ordered]@{
        source  = $processes.source
        groups  = $processes.groups
        context = @($processes.context)
        nodes   = @($processes.nodes)
    }
    statusDictionary = $dictionary
    users            = $users
    credentials      = $credentials
}

$payloadJson = ($payload | ConvertTo-Json -Depth 12)
$sha = [System.Security.Cryptography.SHA256]::Create()
$checksum = 'sha256:' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payloadJson))).Replace('-', '').ToLowerInvariant())
$sha.Dispose()

$export = [ordered]@{
    format        = 'vitauto.settings'
    formatVersion = 1
    exportedAt    = (Get-Date).ToString('o')
    checksum      = $checksum
    payload       = $payload
}

# ── Запись ──────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$path = Join-Path $OutDir ($Name + '.json')
if ((Test-Path $path) -and -not $Force) {
    throw "Файл уже существует: $path (перезаписать: -Force)"
}

$json = $export | ConvertTo-Json -Depth 12
$utf8 = New-Object System.Text.UTF8Encoding($false)   # без BOM: файл читают машины и Go
[System.IO.File]::WriteAllText($path, $json, $utf8)

# Читаемый и компактный вид (indent=1, как у генераторов репозитория), если есть Python
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    & $python.Source (Join-Path $PSScriptRoot 'json-canonical.py') $path
    if ($LASTEXITCODE -ne 0) { Write-Warn2 'python не смог переформатировать выгрузку — оставлен вид PowerShell' }
}

$size = [math]::Round((Get-Item $path).Length / 1KB, 1)
$colCount = 0
if ($roles.Count -gt 0) { $colCount = @($matrix.roles.($roles[0])).Count }
$userCount = 0
if ($users) { $userCount = @($users).Count }

Write-Host ''
Write-Ok ("Выгрузка: {0} ({1} КБ)" -f $path, $size)
Write-Host ("  контрольная сумма: {0}" -f $checksum) -ForegroundColor DarkGray
Write-Host ("  роли: {0} · колонок в роли: {1} · узлов процессов: {2} · пользователей: {3}" -f `
        $roles.Count, $colCount, $nodeCount, $userCount) -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Применить на другом сервере:' -ForegroundColor Cyan
Write-Host "    .\tools\settings-import.ps1 -File `"$path`"" -ForegroundColor Gray
Write-Host '    .\tools\build-seed-app.ps1        # настройки встроены в бинарник' -ForegroundColor DarkGray
