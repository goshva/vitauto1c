<#
.SYNOPSIS
    Очистка репозитория vitauto для форка: удаление легаси 1С, отчётов и мусора, облегчение истории.
.DESCRIPTION
    Работает только с файлами, которые есть в git (git ls-files): неотслеживаемые
    файлы и каталоги не трогаются. По умолчанию — режим проверки (DryRun).

    Категории (включаются флагами):
      (без флага)     мусор: старые диффы .cfe, дубликаты матрицы, скриншоты, отчёты-артефакты
      -RemoveLegacy1C выгрузка конфигурации 1С src\ (≈632 МБ), дампы метаданных
                      docs\migration\source\, инструменты разбора 1С, старый коллектор
      -RemoveReports  отчёты прогонов tasks\ (сохраняются impl-prompts и файлы, нужные CI)
      -RemoveRequirements  index.html, process.html и текстовые ТЗ: удалять только после
                      tools\settings-export.ps1 (иначе нечем перегенерировать матрицу)

    Защита: перед удалением каждая цель проверяется на ссылки в коде и документации.
    Если ссылки есть, цель пропускается с предупреждением; удалить вопреки — -Force.

    История: -OrphanBranch создаёт ветку с одним коммитом и текущим деревом —
    так в форк не попадает 632 МБ истории выгрузки 1С. Исходные ветки не меняются.
.PARAMETER DryRun
    Только показать план и размеры (по умолчанию включён).
.PARAMETER Apply
    Выполнить удаление (противоположность DryRun).
.PARAMETER RemoveLegacy1C
    Удалить легаси 1С: src\, docs\migration\source\, tools\migration\onec-*.js, pgtrace\.
.PARAMETER RemoveReports
    Удалить отчёты прогонов из tasks\ (impl-prompts и файлы, нужные CI, сохраняются).
.PARAMETER RemoveRequirements
    Удалить исходники требований: index.html, process.html, текстовые ТЗ.
.PARAMETER Force
    Удалять цели даже при найденных ссылках; только осознанно.
.PARAMETER NoCommit
    Не создавать коммит (оставить изменения в индексе).
.PARAMETER OrphanBranch
    Имя ветки для чистого форка (например, fork-ready). Требует -Apply.
.PARAMETER WriteForkDoc
    Записать docs\FORK.md с чек-листом форка.
.EXAMPLE
    .\tools\fork-cleanup.ps1
.EXAMPLE
    .\tools\fork-cleanup.ps1 -Apply -RemoveLegacy1C -RemoveReports -OrphanBranch fork-ready
#>
param(
    [switch]$DryRun,
    [switch]$Apply,
    [switch]$RemoveLegacy1C,
    [switch]$RemoveReports,
    [switch]$RemoveRequirements,
    [switch]$Force,
    [switch]$NoCommit,
    [string]$OrphanBranch = '',
    [switch]$WriteForkDoc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
if (-not $Apply) { $DryRun = $true }
if ($Apply -and $DryRun -and $PSBoundParameters.ContainsKey('DryRun')) {
    throw 'Нельзя одновременно -Apply и -DryRun'
}
if ($Apply) { $DryRun = $false }

Push-Location $Root
try {

function Write-Step($t) { Write-Host "  [..] $t" -ForegroundColor Yellow }
function Write-Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn2($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Write-Del($t) { Write-Host "  [-]  $t" -ForegroundColor DarkGray }

# ── Что нельзя трогать: без этого падают тесты, сборка и мигратор ──────────
$Keep = @(
    'docs/migration/storage-map.json',      # читает backend/internal/onec/meta.go
    'docs/migration/inventory.json',        # читает migrator и tz.test.mjs
    'docs/migration/TZ.md',                 # читает tz.test.mjs
    'docs/migration/ddd/domain-model.json', # читают domain/ddd-тесты
    'docs/migration/ddd/node-map.json',     # читают domain/ddd-тесты
    'tasks/migration-pg-go-vue.md'          # читает tz.test.mjs
)
$KeepDirs = @(
    'tasks/impl-prompts/',                  # инструкции для агентов
    'docs/migration/ddd/generated/'         # ddd.test.mjs сверяет с генератором
)

# ── Категории ───────────────────────────────────────────────────────────────
$Junk = @(
    'diff',                                 # исторические диффы .cfe
    'column-matrix (2).json',               # дубликат канона матрицы
    'column-matrix (5).json',
    'default-matrix.js',                    # легаси-генератор матрицы
    'column-codes.js',
    'pgtrace',                              # старый коллектор трассировки
    'report.json',
    'screenshot.png',
    'photo_2026-09-25_15-18-45.jpg',
    'photo_2026-09-25_16-15-25.jpg'
)

$Legacy1C = @(
    'src',                                  # выгрузка конфигурации 1С: 4818 файлов, ≈632 МБ
    'docs/migration/source'                 # jsonl/csv дампы метаданных 1С, ≈12.8 МБ
)
$Legacy1CFiles = @(
    'tools/migration/onec-inventory.js',
    'tools/migration/onec-meta-full.js',
    'tools/migration/onec-presentations.js',
    'tools/migration/onec-storage-structure.js',
    'tools/migration/onec-uuid.mjs'
)

$Requirements = @(
    'index.html',                           # канон матрицы прав (интегрирован в matrix.json)
    'process.html',                         # процессы и сценарии (интегрированы в process-presets.json)
    'questionnaire.html',
    'ФТ_Витавто_v2_617ч.txt'
)
$RequirementsGlob = @(
    'Техническое задание*'                  # имя файла с пробелами и кавычками — матчим по маске
)

# ── Раскрытие целей в файлы, отслеживаемые git ─────────────────────────────
# core.quotepath=false: иначе имена с кириллицей приходят в кавычках с \320\... escapes
function Get-Tracked {
    return @(& git -c core.quotepath=false ls-files)
}

$tracked = Get-Tracked
$keepSet = New-Object 'System.Collections.Generic.HashSet[string]'

function Get-Targets([string[]]$Paths) {
    $out = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in $Paths) {
        $norm = $p -replace '\\', '/'
        $matched = @($tracked | Where-Object { $_ -eq $norm -or $_.StartsWith($norm + '/') })
        if (-not $matched) { continue }
        foreach ($m in $matched) {
            if ($Keep -contains $m) { continue }
            $kept = $false
            foreach ($kd in $KeepDirs) { if ($m.StartsWith($kd)) { $kept = $true; break } }
            if ($kept) { continue }
            if (-not $out.Contains($m)) { [void]$out.Add($m) }
        }
    }
    return $out
}

function Get-SizeMb([string[]]$Files) {
    $bytes = 0
    foreach ($f in $Files) {
        $full = Join-Path $Root $f
        if (Test-Path -LiteralPath $full) { $bytes += (Get-Item -LiteralPath $full).Length }
    }
    return [math]::Round($bytes / 1MB, 1)
}

# Есть ли ссылки на цель в других отслеживаемых файлах
function Get-References([string]$Path) {
    $name = Split-Path $Path -Leaf
    if ($name -eq 'src' -or $name -eq 'diff' -or $name -eq 'pgtrace') {
        # для каталогов ищем только полный путь, чтобы не ловить pwa/src повсюду
        $pattern = '(^|[^a-zA-Z0-9_/-])' + [regex]::Escape($Path) + '(/|$)'
    } else {
        $pattern = [regex]::Escape($name)
    }
    # ищем по всему дереву (git grep сам ограничен отслеживаемыми файлами),
    # результат фильтруем от самой цели
    $hits = @(& git -c core.quotepath=false grep -l -E $pattern 2>$null | Where-Object { $_ -ne $Path })
    return $hits
}

# ── План ────────────────────────────────────────────────────────────────────
$plan = [ordered]@{}
$plan['Мусор (артефакты прошлых версий)'] = @(Get-Targets $Junk)
if ($RemoveLegacy1C) {
    $plan['Легаси 1С (выгрузка конфигурации и дампы)'] = @(Get-Targets ($Legacy1C + $Legacy1CFiles))
}
if ($RemoveReports) {
    $reportFiles = @($tracked | Where-Object { $_.StartsWith('tasks/') })
    $toDrop = @($reportFiles | Where-Object {
            $f = $_
            if ($Keep -contains $f) { return $false }
            foreach ($kd in $KeepDirs) { if ($f.StartsWith($kd)) { return $false } }
            return $true
        })
    $plan['Отчёты прогонов из tasks/'] = $toDrop
}
if ($RemoveRequirements) {
    $req = @(Get-Targets $Requirements)
    foreach ($g in $RequirementsGlob) {
        $req += @($tracked | Where-Object { $_ -like $g })
    }
    $plan['Исходники требований (index.html, process.html, ТЗ)'] = $req
}

$totalMb = Get-SizeMb @($tracked)
$toRemove = New-Object 'System.Collections.Generic.List[string]'
foreach ($k in $plan.Keys) { foreach ($f in @($plan[$k])) { if (-not $toRemove.Contains($f)) { [void]$toRemove.Add($f) } } }

$blocked = New-Object 'System.Collections.Generic.HashSet[string]'

Write-Host ''
Write-Host '=== ПЛАН ОЧИСТКИ ===' -ForegroundColor Cyan
Write-Host ("  репозиторий: {0} файлов, {1} МБ" -f $tracked.Count, $totalMb) -ForegroundColor Gray
Write-Host ''

foreach ($k in $plan.Keys) {
    $files = @($plan[$k])
    if ($files.Count -eq 0) { continue }
    Write-Host ("  {0} — {1} файлов, {2} МБ" -f $k, $files.Count, (Get-SizeMb $files)) -ForegroundColor White

    # Исходники требований — единственная категория, где ссылки блокируют удаление:
    # на index.html и process.html ссылаются ТЗ, gap-analysis и генераторы матрицы.
    if ($k -like 'Исходники требований*') {
        foreach ($t in @($files | ForEach-Object { ($_ -split '/')[0] } | Sort-Object -Unique)) {
            $refs = @(Get-References $t)
            if ($refs.Count -eq 0) { continue }
            if ($Force) {
                Write-Warn2 ("на '{0}' ссылаются {1} файл(ов) — удаляю по -Force; ссылки в документации останутся битыми" -f $t, $refs.Count)
            } else {
                [void]$blocked.Add($t)
                Write-Warn2 ("на '{0}' ссылаются {1} файл(ов) — ПРОПУСК (git grep -l '{0}'); удалить: -Force" -f $t, $refs.Count)
            }
        }
    }
    $files | Select-Object -First 6 | ForEach-Object { Write-Del $_ }
    if ($files.Count -gt 6) { Write-Del ("… и ещё {0}" -f ($files.Count - 6)) }
    Write-Host ''
}

if ($blocked.Count) {
    $toRemove = @($toRemove | Where-Object { $t = ($_ -split '/')[0]; -not $blocked.Contains($t) })
    Write-Warn2 ("целей пропущено: {0} ({1})" -f $blocked.Count, (($blocked | Sort-Object) -join ', '))
    Write-Host ''
}

$toRemove = @($toRemove)
Write-Host ("  к удалению:  {0} файлов, {1} МБ" -f $toRemove.Count, (Get-SizeMb $toRemove)) -ForegroundColor Gray
Write-Host ''

if ($DryRun) {
    Write-Ok 'DryRun: ничего не удалено.'
    Write-Host '  Выполнить:' -ForegroundColor Cyan
    $flags = @()
    if ($RemoveLegacy1C) { $flags += '-RemoveLegacy1C' }
    if ($RemoveReports) { $flags += '-RemoveReports' }
    if ($RemoveRequirements) { $flags += '-RemoveRequirements' }
    if ($OrphanBranch) { $flags += "-OrphanBranch $OrphanBranch" }
    Write-Host ("    .\tools\fork-cleanup.ps1 -Apply " + ($flags -join ' ')) -ForegroundColor Gray
    return
}

# ── Удаление ────────────────────────────────────────────────────────────────
Write-Host '=== УДАЛЕНИЕ ===' -ForegroundColor Cyan
$tag = 'fork-cleanup-' + (Get-Date -Format 'yyyyMMdd-HHmm')
& git tag $tag 2>$null
if ($LASTEXITCODE -eq 0) { Write-Ok "метка для отката: $tag" }

$removed = 0
$failed = @()
foreach ($k in $plan.Keys) {
    foreach ($f in @($plan[$k])) {
        $top = ($f -split '/')[0]
        if ($blocked.Contains($top)) {
            if ($failed -notcontains $f) { $failed += $f }
            continue
        }
        & git rm -q --ignore-unmatch -- $f 2>$null
        if ($LASTEXITCODE -eq 0) { $removed++ }
    }
}
Write-Ok ("удалено файлов: {0}" -f $removed)
if ($failed.Count) { Write-Warn2 ("пропущено из-за ссылок: {0} (повтор с -Force)" -f $failed.Count) }

# ── Проверка, что нужное для тестов на месте ───────────────────────────────
$lost = @()
foreach ($k in $Keep) { if (-not (Test-Path -LiteralPath (Join-Path $Root $k))) { $lost += $k } }
if ($lost.Count) {
    Write-Warn2 'не найдены файлы, нужные тестам — восстановите из метки:'
    $lost | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
} else {
    Write-Ok 'файлы, нужные CI и мигратору, на месте'
}

# ── .gitignore ──────────────────────────────────────────────────────────────
$gitignore = Join-Path $Root '.gitignore'
$marker = '# выгрузки настроек и резервные копии импорта'
$content = Get-Content $gitignore -Raw -Encoding UTF8
if ($content -notmatch [regex]::Escape($marker)) {
    $content = $content.TrimEnd() + "`r`n`r`n$marker`r`nsettings/backup-*/`r`n"
    [System.IO.File]::WriteAllText($gitignore, $content, (New-Object System.Text.UTF8Encoding($false)))
    & git add .gitignore
    Write-Ok '.gitignore: резервные копии импорта ignored'
}

# ── Коммит ──────────────────────────────────────────────────────────────────
if (-not $NoCommit) {
    & git add -A
    $summary = (@($plan.Keys | Where-Object { $plan[$_].Count -gt 0 }) -join '; ')
    & git commit -q -m "chore(fork): очистка репозитория для форка — $summary" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok 'изменения закоммичены' }
    else { Write-Warn2 'коммит не создан (нет изменений?)' }
}

# ── Ветка форка без истории 1С ──────────────────────────────────────────────
if ($OrphanBranch) {
    Write-Step "Создание ветки $OrphanBranch с одним коммитом..."
    $current = (& git rev-parse --abbrev-ref HEAD).Trim()
    & git checkout -q --orphan $OrphanBranch 2>&1 | Out-Null
    & git add -A
    & git commit -q -m "fork: vitauto — приложение на Go + PostgreSQL (без истории выгрузки 1С)" 2>&1 | Out-Null
    Write-Ok "ветка $OrphanBranch создана (один коммит)"
    & git checkout -q $current
    Write-Host ("  Запушить в новый репозиторий: git push <url> {0}:main" -f $OrphanBranch) -ForegroundColor Gray
}

# ── Чек-лист форка ──────────────────────────────────────────────────────────
if ($WriteForkDoc) {
    $doc = Join-Path $Root 'docs\FORK.md'
    New-Item -ItemType Directory -Force -Path (Split-Path $doc -Parent) | Out-Null
    $lines = @(
        '# Форк vitauto',
        '',
        'Репозиторий очищен от легаси 1С и артефактов прошлых версий.',
        '',
        '## Что сделать после клонирования',
        '',
        '1. Сменить remote: `git remote set-url origin <новый репозиторий>`.',
        '2. Не пушить метку `fork-cleanup-*` и ветку `backup/*`, если они остались.',
        '3. Сменить демо-пароли из `seed/demo-app.sql` (администратор / admin123 и остальные).',
        '4. Применить настройки прав и процессов: `.\tools\settings-import.ps1 -File settings\settings-export.json`.',
        '5. Пересобрать приложение: `.\tools\build-seed-app.ps1` (настройки встроены через //go:embed).',
        '6. Создать базу: `.\tools\seed-stand.ps1` (схема + демо-данные).',
        '',
        '## Где теперь канон настроек',
        '',
        'Матрица прав и процессы перенесены в `settings\settings-export.json`;',
        'исходники `index.html` и `process.html` удалены. Перегенерация из них недоступна —',
        'правки прав и процессов делаются через выгрузку/импорт.',
        '',
        '## Проверка после форка',
        '',
        '```powershell',
        'go test ./...                      # в backend',
        'cd pwa; npm ci; npx vitest run; npm run build',
        '```',
        ''
    )
    [System.IO.File]::WriteAllText($doc, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    & git add $doc
    Write-Ok "чек-лист: $doc"
}

Write-Host ''
Write-Host ("  Было: {0} файлов, {1} МБ" -f $tracked.Count, $totalMb) -ForegroundColor Gray
$now = Get-Tracked
Write-Host ("  Стало: {0} файлов, {1} МБ" -f $now.Count, (Get-SizeMb $now)) -ForegroundColor Green
Write-Host ("  Откат: git reset --hard {0}" -f $tag) -ForegroundColor DarkGray

} finally {
    Pop-Location
}
