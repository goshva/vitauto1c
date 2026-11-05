# check-env.ps1 — проверка окружения для запуска vitauto1c (Go API + PWA + PostgreSQL)
param(
    [string]$ProjectRoot = "D:\soft\vitauto1c",
    [string]$PgBin       = "C:\Program Files\PostgreSQL 1C\18\bin",
    [int]   $PgPort      = 5432,
    [string]$PgUser      = "postgres",
    [string]$PgPassword  = "postgres",
    [string]$DbName      = "vitauto_app",
    [int]   $GoApiPort   = 18100,
    [int]   $PwaPort     = 5173,
    [string]$DumpFile    = "D:\1c_bases\backup\vitauto_app.dump"
)
$ErrorActionPreference = "Continue"
$ok = 0; $fail = 0
function Report([string]$name, [bool]$pass, [string]$detail = "") {
    if ($pass) { $script:ok++;   Write-Host ("[ OK ] {0,-38} {1}" -f $name, $detail) -ForegroundColor Green }
    else       { $script:fail++; Write-Host ("[FAIL] {0,-38} {1}" -f $name, $detail) -ForegroundColor Red }
}

Write-Host "=== 1. Пути проекта ===" -ForegroundColor Cyan
Report "Корень проекта"        (Test-Path $ProjectRoot)                          $ProjectRoot
Report "backend\go.mod"        (Test-Path (Join-Path $ProjectRoot "backend\go.mod"))
Report "pwa\package.json"      (Test-Path (Join-Path $ProjectRoot "pwa\package.json"))
Report "Дамп vitauto_app.dump" (Test-Path $DumpFile)                             $DumpFile
if (Test-Path $DumpFile) {
    $mb = [math]::Round((Get-Item $DumpFile).Length / 1MB, 1)
    Write-Host ("       размер дампа: {0} МБ" -f $mb) -ForegroundColor DarkGray
}

Write-Host "`n=== 2. Инструменты в PATH ===" -ForegroundColor Cyan
foreach ($t in @("go", "node", "npm")) {
    $c = Get-Command $t -ErrorAction SilentlyContinue
    Report $t ($null -ne $c) $(if ($c) { $c.Source } else { "не найден в PATH" })
}
if (Get-Command go -ErrorAction SilentlyContinue) {
    $goVer = (& go version) -replace '^go version ', ''
    Write-Host ("       go version: {0}" -f $goVer) -ForegroundColor DarkGray
}

Write-Host "`n=== 3. PostgreSQL ===" -ForegroundColor Cyan
$portOpen = Test-NetConnection 127.0.0.1 -Port $PgPort -InformationLevel Quiet -WarningAction SilentlyContinue
Report "Порт $PgPort слушается" $portOpen
$psql = Join-Path $PgBin "psql.exe"
Report "psql.exe" (Test-Path $psql) $psql

if ($portOpen -and (Test-Path $psql)) {
    $env:PGPASSWORD = $PgPassword
    $env:PGCLIENTENCODING = "UTF8"
    $dbExists = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -Atc "select 1 from pg_database where datname='$DbName'" 2>$null
    Report "База $DbName существует" ($dbExists -eq "1")
    if ($dbExists -eq "1") {
        $counts = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d $DbName -Atc @"
select 'arm.line', count(*) from arm.line
union all select 'auth.credential', count(*) from auth.credential
union all select 'auth.user', count(*) from auth.\"user\"
union all select 'legacy.object', count(*) from legacy.object
union all select 'doc.customer_order', count(*) from doc.customer_order
union all select 'ref.nomenclature', count(*) from ref.nomenclature
"@ 2>$null
        if ($counts) {
            foreach ($line in $counts) {
                $parts = $line -split '\|'
                $n = [int]$parts[1]
                Report ("  данных в {0}" -f $parts[0]) ($n -gt 0) ("строк: {0}" -f $n)
            }
        } else {
            Report "Схемы/таблицы в $DbName" $false "не удалось прочитать (схемы нет?)"
        }
        # проверка целостности схемы
        $schemas = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d $DbName -Atc "select string_agg(schema_name, ',' order by schema_name) from information_schema.schemata where schema_name in ('arm','doc','ref','stock','legacy','auth','sys','integration','onec')" 2>$null
        Report "Схемы arm/doc/ref/stock/legacy/auth/sys" ($schemas -match "arm.*auth") $schemas
    }
}

Write-Host "`n=== 4. Go-модули ===" -ForegroundColor Cyan
$backend = Join-Path $ProjectRoot "backend"
if (Test-Path (Join-Path $backend "go.mod")) {
    Push-Location $backend
    try {
        $verify = & go mod verify 2>&1
        Report "go mod verify" ($LASTEXITCODE -eq 0) ($verify | Select-Object -Last 1)
        $env:GO111MODULE = "on"
        $list = & go list -m all 2>&1
        Report "go list -m all" ($LASTEXITCODE -eq 0) ("модулей: {0}" -f (($list | Measure-Object -Line).Lines))
    } finally { Pop-Location }
}

Write-Host "`n=== 5. Собранный vitauto-api ===" -ForegroundColor Cyan
$apiExe = Join-Path $ProjectRoot "deploy\bin\vitauto-api.exe"
Report "vitauto-api.exe собран" (Test-Path $apiExe) $apiExe
if (Test-Path $apiExe) {
    $age = ((Get-Date) - (Get-Item $apiExe).LastWriteTime).TotalHours
    Write-Host ("       возраст сборки: {0:N1} ч" -f $age) -ForegroundColor DarkGray
}
$healthRunning = $false
try {
    $h = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$GoApiPort/api/v1/health" -TimeoutSec 3
    $healthRunning = $true
    Report "vitauto-api отвечает на /health" $true $h.Content
} catch {
    Report "vitauto-api отвечает на /health" $false "не запущен или ошибка"
}

Write-Host "`n=== 6. PWA ===" -ForegroundColor Cyan
$pwa = Join-Path $ProjectRoot "pwa"
$nm = Test-Path (Join-Path $pwa "node_modules")
Report "node_modules установлены" $nm
if ($nm) {
    $pkgCount = (Get-ChildItem (Join-Path $pwa "node_modules") -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Host ("       папок в node_modules: {0}" -f $pkgCount) -ForegroundColor DarkGray
}
$lock = Test-Path (Join-Path $pwa "package-lock.json")
Report "package-lock.json" $lock
try {
    $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$PwaPort/" -TimeoutSec 3
    Report "PWA отвечает на $PwaPort" ($r.StatusCode -eq 200) ("HTTP {0}" -f $r.StatusCode)
} catch {
    Report "PWA отвечает на $PwaPort" $false "не запущен"
}

Write-Host "`n=== Итог ===" -ForegroundColor Cyan
Write-Host ("Проверок пройдено: {0}, провалено: {1}" -f $ok, $fail) -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
if ($fail -gt 0) { exit 1 } else { exit 0 }