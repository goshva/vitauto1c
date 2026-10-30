<#
  Проверка этапа миграции 1С -> PostgreSQL + Go + Vue (tasks/migration-pg-go-vue.md, раздел 15).
  Этап закрыт, если все проверки PASS (код возврата 0). Протокол пишется в docs/migration/gates/stage-<N>.md.
  К базе 1С обращается только на чтение; по умолчанию копия vitauto_dev, рабочая vitauto запрещена.

  .\tools\migration\gate.ps1 -Stage 0
  .\tools\migration\gate.ps1 -Stage 0 -Base vitauto_dev -PgPort 5433 -NoReport
#>
param(
  [Parameter(Mandatory = $true)][ValidateRange(0, 11)][int]$Stage,
  [string]$Base = 'vitauto_dev',
  [int]$PgPort = 5433,
  [string]$Psql = 'C:\Program Files\PostgreSQL 1C\18\bin\psql.exe',
  [switch]$NoReport
)
$ErrorActionPreference = 'Stop'
if ($Base -eq 'vitauto' -and $Stage -lt 11) { throw "Рабочая база vitauto до этапа 11 не используется; укажите копию (-Base vitauto_dev)." }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# портативные инструменты сервера (go, task, oapi-codegen, node) — если их нет в PATH
foreach ($d in @("$env:LOCALAPPDATA\Programs\go1.27.3\go\bin", "$env:USERPROFILE\go\bin", "$env:LOCALAPPDATA\Programs\node-v22.23.4-win-x64")) {
  if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path = "$d;$env:Path" }
}
$plan =Join-Path $root 'tasks\migration-pg-go-vue.md'
$mapPath = Join-Path $root 'docs\migration\storage-map.json'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Id, [string]$Title, [string]$Status, [string]$Details) {
  $results.Add([pscustomobject]@{ Id = $Id; Title = $Title; Status = $Status; Details = $Details })
}
function Invoke-Check([string]$Id, [string]$Title, [scriptblock]$Body) {
  try {
    $r = & $Body
    if ($r -is [array]) { $r = $r[-1] }
    if ($r.Status) { Add-Result $Id $Title $r.Status $r.Details } else { Add-Result $Id $Title 'FAIL' 'проверка не вернула результат' }
  } catch { Add-Result $Id $Title 'FAIL' $_.Exception.Message }
}
function Pass([string]$d) { [pscustomobject]@{ Status = 'PASS'; Details = $d } }
function Fail([string]$d) { [pscustomobject]@{ Status = 'FAIL'; Details = $d } }
function Pending([string]$d) { [pscustomobject]@{ Status = 'PENDING'; Details = $d } }
function Read-Map { Get-Content $mapPath -Raw -Encoding UTF8 | ConvertFrom-Json }
function Invoke-Psql([string]$Sql) {
  if (-not (Test-Path $Psql)) { throw "psql не найден: $Psql" }
  if (-not $env:PGPASSWORD) { $env:PGPASSWORD = 'postgres' }
  $out = & $Psql -h localhost -p $PgPort -U postgres -d $Base -At -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql: код $LASTEXITCODE" }
  return ($out | Out-String).Trim()
}
function Assert-RepoPath([string]$rel, [string]$what) {
  if (-not (Test-Path (Join-Path $root $rel))) { throw "$what нет ($rel) — этап не начат" }
}
function Invoke-Tool([string]$Dir, [string]$Exe, [string[]]$ToolArgs) {
  Push-Location (Join-Path $root $Dir)
  try {
    $out = & $Exe @ToolArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { return Fail ("$Exe $($ToolArgs -join ' '): код $LASTEXITCODE. " + ($out.Trim() -split "`n" | Select-Object -Last 3) -join ' ') }
    return Pass "$Exe $($ToolArgs -join ' '): OK"
  } finally { Pop-Location }
}

# ключевые объекты 1С, которые обязаны быть в карте (раздел 7.2)
$KeyObjects = @(
  'Справочник.Организации', 'Справочник.Контрагенты', 'Справочник.ДоговорыКонтрагентов', 'Справочник.Номенклатура',
  'Справочник.ПартииНоменклатуры', 'Справочник.КлассификаторЕдиницИзмерения', 'Справочник.ВидыЦен', 'Справочник.асАвтомобили',
  'Справочник.асМодели', 'Справочник.Арм_ВидыУслуги', 'Справочник.Арм_ФормыОплаты', 'Справочник.Пользователи',
  'Справочник.СтруктурныеЕдиницы', 'Документ.ЗаказПокупателя', 'Документ.ЗаказПоставщику', 'Документ.ПриходнаяНакладная',
  'Документ.РасходнаяНакладная', 'РегистрСведений.ЦеныНоменклатуры', 'РегистрСведений.асАвтомобили', 'РегистрСведений.асЦеныАвторабот',
  'РегистрСведений.Арм_ДанныеЗакупокИПродаж', 'РегистрСведений.Арм_ПраваПользователей', 'РегистрСведений.Арм_Уведомления',
  'РегистрНакопления.Запасы', 'Перечисление.Арм_СтатусыАРМ', 'Перечисление.Арм_ВидыОпераций', 'Перечисление.Арм_РолиИнтерфейса'
)

switch ($Stage) {
  0 {
    Invoke-Check 'G0.1' 'План содержит разделы всех требований' {
      $text = Get-Content $plan -Raw -Encoding UTF8
      $need = [ordered]@{
        'инструкции по сущностям' = '## 7\. Инструкции по миграции сущностей'
        'UUID и имена таблиц'     = '## 5\. Новая база данных: имена, UUID'
        'WebSocket'               = '## 11\. Обновление данных в реальном времени \(WebSocket\)'
        'бухгалтерия'             = '## 14\. Интеграция с бухгалтерией'
        'монорепозиторий'         = '## 4\. Монорепозиторий'
        'Swagger/OpenAPI'         = '## 10\. API и документация \(OpenAPI / Swagger\)'
        'импорт'                  = '## 12\. Импорт табличных данных'
        'склады'                  = '## 13\. Склады в интерфейсе'
        'проверка этапов'         = '## 15\. Этапы и проверка каждого этапа'
        'сверка'                  = '## 9\. Сверка'
      }
      $missing = @($need.Keys | Where-Object { $text -notmatch $need[$_] })
      $stages = ([regex]::Matches($text, '(?m)^\| \*\*(\d+)\. ')).Count
      if ($missing.Count) { return Fail ('нет разделов: ' + ($missing -join ', ')) }
      if ($stages -lt 12) { return Fail "в таблице этапов $stages строк, нужно 12 (0–11)" }
      Pass "разделов $($need.Count), этапов с проверками $stages"
    }
    Invoke-Check 'G0.2' 'Карта таблиц без ошибок, ключевые объекты на месте, у каждой таблицы есть правило' {
      if (-not (Test-Path $mapPath)) { return Fail 'нет docs/migration/storage-map.json (node tools/migration/storage-map.mjs ...)' }
      $map = Read-Map
      if (@($map.errors).Count) { return Fail ('ошибки выгрузки: ' + (($map.errors | ConvertTo-Json -Compress))) }
      $main = @($map.tables | Where-Object { $_.purpose -eq 'Основная' } | ForEach-Object { $_.table })
      $absent = @($KeyObjects | Where-Object { $main -notcontains $_ })
      if ($absent.Count) { return Fail ('нет в карте: ' + ($absent -join ', ')) }
      $norule = @($map.tables | Where-Object { @('typed', 'legacy', 'enum', 'skip') -notcontains $_.rule })
      if ($norule.Count) { return Fail ('без правила: ' + (($norule | ForEach-Object { $_.table }) -join ', ')) }
      $typed = @($map.tables | Where-Object { $_.rule -eq 'typed' }).Count
      Pass "таблиц $(@($map.tables).Count), typed $typed, ключевых объектов $($KeyObjects.Count)/$($KeyObjects.Count)"
    }
    Invoke-Check 'G0.3' 'UUID: перевод _IDRRef по формуле = УникальныйИдентификатор() 1С' {
      $map = Read-Map
      $s = $map.uuidSample
      if (-not $s) { return Fail 'в карте нет образца uuidSample' }
      $nom = $map.tables | Where-Object { $_.table -eq 'Справочник.Номенклатура' -and $_.purpose -eq 'Основная' } | Select-Object -First 1
      # код передаётся как hex UTF-8: кириллица в аргументах psql искажается кодовой страницей консоли
      $hex = -join ([Text.Encoding]::UTF8.GetBytes($s.code) | ForEach-Object { $_.ToString('x2') })
      $sql = "select (substr(h,25,8)||'-'||substr(h,21,4)||'-'||substr(h,17,4)||'-'||substr(h,1,4)||'-'||substr(h,5,12)) " +
             "from (select encode(_idrref,'hex') h from $($nom.storage) where rtrim(_code::text) = convert_from(decode('$hex','hex'),'UTF8')) t"
      $got = Invoke-Psql $sql
      if ($got -ne $s.uuid) { return Fail "ожидалось $($s.uuid), формула дала '$got' ($($nom.storage), код $($s.code))" }
      Pass "$($s.object) «$($s.code)»: $got ($($nom.storage), база $Base)"
    }
    Invoke-Check 'G0.4' 'Typed-таблицы: целевая таблица, порядок загрузки, названные поля существуют' {
      $map = Read-Map
      $typed = @($map.tables | Where-Object { $_.rule -eq 'typed' })
      $bad = @($typed | Where-Object { -not $_.target -or $null -eq $_.order })
      if ($bad.Count) { return Fail ('без цели или порядка: ' + (($bad | ForEach-Object { $_.table }) -join ', ')) }
      $miss = @($typed | Where-Object { @($_.mappedMissing).Count })
      if ($miss.Count) { return Fail ('названы несуществующие поля: ' + (($miss | ForEach-Object { "$($_.table): $(@($_.mappedMissing) -join ',')" }) -join '; ')) }
      $mapped = ($typed | ForEach-Object { @($_.fields | Where-Object { $_.column }).Count } | Measure-Object -Sum).Sum
      $extra = ($typed | ForEach-Object { @($_.fields | Where-Object { -not $_.column }).Count } | Measure-Object -Sum).Sum
      Pass "typed $($typed.Count): полей в столбцах $mapped, в extra $extra"
    }
    Invoke-Check 'G0.5' 'Полный inventory: все непустые объекты 1С учтены в карте или legacy' {
      $inv = Join-Path $root 'docs\migration\inventory.json'
      if (-not (Test-Path $inv)) { return Pending 'docs/migration/inventory.json ещё не построен (migrator inventory, раздел 8)' }
      $i = Get-Content $inv -Raw -Encoding UTF8 | ConvertFrom-Json
      if (@($i.errors).Count) { return Fail ('ошибки выгрузки: ' + ($i.errors | ConvertTo-Json -Compress)) }
      if (@($i.unknown).Count) { return Fail ('неизвестные непустые таблицы: ' + (($i.unknown | ForEach-Object { $_.storage }) -join ', ')) }
      $nonEmpty = @($i.objects | Where-Object { $_.rows -gt 0 })
      $unassigned = @($nonEmpty | Where-Object { @('typed', 'legacy', 'enum', 'skip') -notcontains $_.rule })
      if ($unassigned.Count) { return Fail ("без правила: $($unassigned.Count)") }
      $t = $i.totals
      Pass "объектов $($t.objects), с данными $($t.nonEmpty), строк $($t.dataRows); таблиц PG $($t.pgTables), непустых $($t.pgNonEmpty), неизвестных 0"
    }
    Invoke-Check 'G0.6' 'Тесты документации: модель, DDD, данные, ТЗ (node --test)' {
      $node = Join-Path $env:LOCALAPPDATA 'Programs\node-v22.23.4-win-x64\node.exe'
      if (-not (Test-Path $node)) { $node = 'node' }
      Push-Location $root
      try { $out = & $node --test 'tools/migration/tests/*.test.mjs' 2>&1 | Out-String } finally { Pop-Location }
      $pass = [regex]::Match($out, '# pass (\d+)').Groups[1].Value
      $fail = [regex]::Match($out, '# fail (\d+)').Groups[1].Value
      if ($LASTEXITCODE -ne 0 -or $fail -ne '0') {
        $names = ([regex]::Matches($out, '(?m)^not ok \d+ - (.+)$') | ForEach-Object { $_.Groups[1].Value }) -join '; '
        return Fail "pass $pass, fail ${fail}: $names"
      }
      Pass "тестов $pass, все зелёные"
    }
  }
  1 {
    Invoke-Check 'G1.1' 'go build и go vet' { Assert-RepoPath 'backend\go.mod' 'Go-модуль'; $b = Invoke-Tool 'backend' 'go' @('build', './...'); if ($b.Status -ne 'PASS') { return $b }; Invoke-Tool 'backend' 'go' @('vet', './...') }
    Invoke-Check 'G1.2' 'spectral lint api/*.yaml = 0 ошибок' { Assert-RepoPath 'api\openapi.yaml' 'спецификации OpenAPI'; Invoke-Tool '.' 'npx' @('--yes', '@stoplight/spectral-cli', 'lint', 'api/openapi.yaml', 'api/asyncapi.yaml', '--fail-severity', 'error') }
    Invoke-Check 'G1.3' 'Паритет маршрутов backend.js <-> OpenAPI' { Assert-RepoPath 'backend\internal\api\parity_test.go' 'теста паритета'; Invoke-Tool 'backend' 'go' @('test', './internal/api/', '-run', 'TestRouteParity') }
    Invoke-Check 'G1.4' '/api/v1/health = 200' { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:18100/api/v1/health'; if ($r.StatusCode -eq 200) { Pass $r.Content } else { Fail "код $($r.StatusCode)" } }
    Invoke-Check 'G1.5' 'task gen не даёт изменений' { Assert-RepoPath 'Taskfile.yml' 'Taskfile'; $g = Invoke-Tool '.' 'task' @('gen'); if ($g.Status -ne 'PASS') { return $g }; $d = git -C $root status --porcelain -- api backend/internal/api pwa/src/http; if ($d) { Fail "после task gen изменены: $d" } else { Pass 'сгенерированный код актуален' } }
  }
  2 {
    Invoke-Check 'G2.1' 'goose: все миграции применены' { Assert-RepoPath 'db\migrations' 'миграций'; Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'schema-status', '--strict') }
    Invoke-Check 'G2.2' 'reconcile R1–R4, R7 = 0' { Assert-RepoPath 'backend\cmd\migrator' 'мигратора'; Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'R1,R2,R3,R4,R7', '--source', $Base) }
    Invoke-Check 'G2.3' 'id объектов 1С = Ref_Key (100%)' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'UUID', '--source', $Base) }
    Invoke-Check 'G2.4' 'COMMENT у всех столбцов' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'COMMENTS') }
  }
  3 {
    Invoke-Check 'G3.1' 'reconcile R5, R6, R8 = 0' { Assert-RepoPath 'backend\cmd\migrator' 'мигратора'; Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'R5,R6,R8', '--source', $Base) }
    Invoke-Check 'G3.2' 'Повторный прогон идемпотентен' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'IDEMPOTENT', '--source', $Base) }
  }
  4 {
    Invoke-Check 'G4.1' 'go test ./... (ответы по схеме OpenAPI)' { Assert-RepoPath 'backend\go.mod' 'Go-модуль'; Invoke-Tool 'backend' 'go' @('test', './...') }
    Invoke-Check 'G4.2' 'e2e arm-processes на Go' { Assert-RepoPath 'Taskfile.yml' 'Taskfile'; Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'SUITE=arm-processes') }
    Invoke-Check 'G4.3' 'R9' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'R9', '--source', $Base) }
  }
  5 {
    Invoke-Check 'G5.1' 'vitest' { Invoke-Tool 'pwa' 'npx' @('vitest', 'run') }
    Invoke-Check 'G5.2' 'npm run build' { Invoke-Tool 'pwa' 'npm' @('run', 'build') }
    Invoke-Check 'G5.3' 'e2e PWA на обоих бэкендах' { Assert-RepoPath 'Taskfile.yml' 'Taskfile'; $a = Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go'); if ($a.Status -ne 'PASS') { return $a }; Invoke-Tool '.' 'task' @('e2e', 'BACKEND=odata') }
  }
  6 {
    Invoke-Check 'G6.1' 'go test internal/realtime' { Assert-RepoPath 'backend\internal\realtime' 'модуля realtime'; Invoke-Tool 'backend' 'go' @('test', './internal/realtime/...') }
    Invoke-Check 'G6.2' 'e2e r01–r05' { Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'ONLY=r0') }
    Invoke-Check 'G6.3' 'нагрузка WS p95 < 1 с' { Invoke-Tool 'backend' 'go' @('run', './cmd/wsload', '--clients', '50', '--rate', '100', '--p95', '1s') }
  }
  7 {
    Invoke-Check 'G7.1' 'e2e w01–w04' { Assert-RepoPath 'backend\internal\stock' 'модуля stock'; Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'ONLY=w0') }
    Invoke-Check 'G7.2' 'R5 по складам' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'R5', '--by', 'warehouse', '--source', $Base) }
  }
  8 {
    Invoke-Check 'G8.1' 'e2e i01–i08' { Assert-RepoPath 'backend\internal\imp' 'модуля imp'; Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'ONLY=i0') }
    Invoke-Check 'G8.2' 'импорт образцов xlsx из репо' { Invoke-Tool 'backend' 'go' @('test', './internal/imp/', '-run', 'TestRepoSamples') }
    Invoke-Check 'G8.3' 'откат партии возвращает данные' { Invoke-Tool 'backend' 'go' @('test', './internal/imp/', '-run', 'TestRollback') }
  }
  9 {
    Invoke-Check 'G9.1' 'e2e x01–x06 на копии 1С' { Assert-RepoPath 'backend\internal\integration' 'модуля integration'; Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'ONLY=x0', "ONEC=$Base") }
    Invoke-Check 'G9.2' 'сверка с бухгалтерией = 0' { Invoke-Tool 'backend' 'go' @('run', './cmd/api', 'integration-reconcile', '--target', $Base, '--strict') }
  }
  10 {
    Invoke-Check 'G10.1' 'восстановление vitauto_app из бэкапа + R1' { Assert-RepoPath 'deploy\backup-app.ps1' 'скрипта бэкапа'; Invoke-Tool 'deploy' 'powershell' @('-File', 'restore-check.ps1') }
    Invoke-Check 'G10.2' 'e2e администрирования' { Invoke-Tool '.' 'task' @('e2e', 'BACKEND=go', 'ONLY=a0') }
  }
  11 {
    Invoke-Check 'G11.1' 'пять ночных сверок подряд = 0' { Assert-RepoPath 'docs\migration' 'docs/migration'; $f = @(Get-ChildItem (Join-Path $root 'docs\migration') -Filter 'reconcile-*.md' | Sort-Object Name | Select-Object -Last 5); if ($f.Count -lt 5) { return Fail "отчётов $($f.Count) из 5" }; $bad = @($f | Where-Object { (Get-Content $_.FullName -Raw -Encoding UTF8) -notmatch 'Расхождений: 0' }); if ($bad.Count) { Fail ('с расхождениями: ' + ($bad.Name -join ', ')) } else { Pass ($f.Name -join ', ') } }
    Invoke-Check 'G11.2' 'гейты 0–10 закрыты' { $open = @(0..10 | Where-Object { $p = Join-Path $root "docs\migration\gates\stage-$_.md"; -not (Test-Path $p) -or ((Get-Content $p -Raw -Encoding UTF8) -notmatch 'Итог: этап закрыт') -or ((Get-Content $p -Raw -Encoding UTF8) -notmatch '(?m)^- \[x\]') }); if ($open.Count) { Fail ('не закрыты (автопроверки или ручная отметка): ' + ($open -join ', ')) } else { Pass 'все закрыты' } }
    Invoke-Check 'G11.3' 'сверка после финальной выгрузки' { Invoke-Tool 'backend' 'go' @('run', './cmd/migrator', 'reconcile', '--checks', 'ALL', '--source', $Base) }
  }
}

# --- итог и протокол -------------------------------------------------------------------------------------------------
$ok = @($results | Where-Object { $_.Status -ne 'PASS' }).Count -eq 0
$results | Format-Table -AutoSize Id, Status, Title, Details | Out-String -Width 250 | Write-Host
$verdict = if ($ok) { 'Итог: этап закрыт' } else { 'Итог: этап не закрыт' }
Write-Host $verdict
if (-not $NoReport) {
  $commit = (git -C $root rev-parse --short HEAD).Trim()
  $branch = (git -C $root branch --show-current).Trim()
  $lines = @("# Проверка этапа $Stage", '',
    "Дата: $(Get-Date -Format 'yyyy-MM-dd HH:mm'); ветка ``$branch``, коммит ``$commit`` (до коммита протокола); база 1С ``$Base``.",
    "Команда: ``tools/migration/gate.ps1 -Stage $Stage -Base $Base``.", '',
    '| Проверка | Результат | Что проверено | Подробности |', '|---|---|---|---|')
  foreach ($r in $results) { $lines += "| $($r.Id) | $($r.Status) | $($r.Title) | $(($r.Details -replace '\|', '/') -replace "`r?`n", ' ') |" }
  $manual = @{
    0 = 'владелец утвердил вариант интеграции с бухгалтерией (раздел 14)'; 1 = 'Swagger UI /api/docs открывается, разделы видны'
    2 = '10 карточек номенклатуры и 10 строк АРМ сверены с 1С'; 3 = 'остатки трёх позиций с партиями совпадают с отчётом 1С'
    4 = 'печатные формы Go и 1С совпадают'; 5 = 'все экраны пройдены под каждой ролью'; 6 = 'два устройства: изменение видно без перезагрузки'
    7 = 'кладовщик прошёл приёмку с ячейкой'; 8 = 'оператор загрузил прайс и начальные остатки'; 9 = 'бухгалтер проверил 5 документов в 1С'
    10 = 'приёмка администратором'; 11 = 'акт переключения подписан'
  }
  $lines += @('', $verdict, '', '## Ручная проверка', '', "- [ ] $($manual[$Stage])")
  $dir = Join-Path $root 'docs\migration\gates'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $file = Join-Path $dir "stage-$Stage.md"
  [IO.File]::WriteAllText($file, ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
  Write-Host "Протокол: $file"
}
if ($ok) { exit 0 } else { exit 1 }
