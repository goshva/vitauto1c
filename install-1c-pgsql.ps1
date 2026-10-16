#Requires -Version 5.1
<#
.SYNOPSIS
  Клиент-серверный вариант: 1С:Предприятие 8.3.27.2342 (сервер) + PostgreSQL 18 для 1С + конфигурация "Автосервис"
  + расширения АРМЗакупокИПродаж и АРМ_OData (все .cfe рядом со скриптом, последняя версия каждого).
  Файловый вариант (база из .dt, без PostgreSQL и сервера 1С) — install-1c.ps1.

  Шаги:
    0. Полное удаление прошлой установки (службы, процессы, MSI, каталоги данных, список баз)
       и артефактов файлового варианта: файловая база из .dt (-FileIbDir) и её запись в списке баз
    1. Исходники: уже распакованы — пропуск; иначе архив (есть и цел — без сети; нет или битый — докачка
       с Яндекс.Диска) -> распаковка. -Redownload — скачать и распаковать заново
    2. PostgreSQL для 1С: уже установлен (служба pg_ctl, есть расширение mchar) — используется как есть, шаг 0 его
       не удаляет; иначе — из установщика PostgreSQL_1C_*_Setup.exe: локального (-BaseDir или -PgSetup, подпись
       Postgres Professional) или скачанного с -PgSetupUrl (repo.postgres.ru, запасной — Яндекс.Диск; проверка
       подписи, для Яндекс.Диска и SHA256); распаковка
       программы, VC++ x64, initdb, служба postgresql-1c-<версия>. Нет и его — архив 15.13-1.1C с Яндекс.Диска (MSI).
       -ReinstallPostgres — удалить найденный PostgreSQL для 1С вместе с данными и поставить заново.
       -PgMajor 18 (по умолчанию): найденный PostgreSQL ниже 18 (например, 15.13) не используется — ставится 18
       рядом (свободный порт), базы кластера 1С из старого копируются в 18 (pg_dump/pg_restore) и регистрация
       переключается на новый порт (шаг 3в; -NoMovePgBases — не переносить). Старый PostgreSQL с данными остаётся
    3. Тихая установка 1С (клиенты + сервер) + служба агента сервера
    3б. Технологический журнал: logcfg.xml в conf по разрядности установленной платформы + рестарт агента
    4. Создание базы на сервере 1С. ВЫШЕ ВСЕГО — бэкап рабочей базы в -BaseDir («бэкап 20260805.dt»; из нескольких —
       самый свежий по дате в имени; -SourceDt — явный файл, -NoBackupDt — не брать). Без бэкапа — база из
       autoservice.zip (1Cv8.1CD): её выгрузка этим скриптом
       (<IbName>.dt с меткой .src/.ext) берётся готовой, иначе база выгружается заново; .dt/.cf из архива — только
       если 1Cv8.1CD в нём нет; посторонние .dt не используются. autoservice.zip новее распаковки — распаковывается
       заново (вместе с ним пропадает и старая выгрузка). Ход выгрузки и загрузки — время, объём, %, окончание
    4в. Пользователю «Администратор» (-AdminUser) — пустой пароль (вход «Админ»/«Автосервис» через COM); им же —
        конфигуратор и запуск 1С. Пользователя нет (база из autoservice.zip) — работа под «Админ»
    5. Проверка подключения (порты, PostgreSQL, вход конфигуратором) и записи ТЖ
    6. Вопрос «заполнить демо-данными АРМ?» -> seed-1c.ps1 со строкой соединения серверной базы и пользователем 1С
       (-Seed — без вопроса, -NoSeed — пропустить, -SeedKeepSafeModeOff — оставить безопасный режим выключенным)
    7. Запуск 1С:Предприятие (тонкий клиент) в серверную базу под «Администратор» / «Админ» без пароля (-NoLaunch — не запускать)

  Архивы и распакованные исходники лежат в -BaseDir (по умолчанию D:\1c — общий с install-1c.ps1) и повторно
  не скачиваются. Ключ -DeleteArchives удаляет архивы после распаковки.
  Файловая база файлового варианта (-FileIbDir) по умолчанию сохраняется (её можно перенести migrate-1c-pgsql.ps1);
  удалить вместе с прошлой установкой — ключ -RemoveFileIb.
  Трассировка — технологический журнал 1С (событие DBPOSTGRS). -NoTrace отключает настройку и проверку ТЖ.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-1c-pgsql.ps1
  powershell -ExecutionPolicy Bypass -File .\install-1c-pgsql.ps1 -Force -DeleteArchives
  .\install-1c-pgsql.ps1 -Force -Seed -SeedKeepSafeModeOff   # без вопросов: переустановка + демо-данные АРМ
  .\install-1c-pgsql.ps1 -ExtensionFile АРМЗакупокИПродаж,АРМ_OData   # расширения по имени (последняя версия .cfe)
  .\install-1c-pgsql.ps1 -ExtensionFile ''                             # без расширений

  Расширения на сервере: на время UpdateDBCfg регламентные задания базы запрещаются (rac), их сеансы завершаются,
  затем запрет снимается; после — расширения включаются (активно, без безопасного режима: odata\ext-activate.js),
  у АРМ_OData — полный состав OData (odata\enable-odata.ps1).
#>
param(
    [string]      $BaseDir = $(if ($PSScriptRoot -like 'D:\*') { $PSScriptRoot } else { 'D:\1c' }),   # архивы, исходники, логи (как install-1c.ps1)
    [SecureString]$PgPassword,                      # если не задан — будет запрошен
    [string]      $PgUser = 'postgres',
    [int]         $PgPort = 5432,              # для новой установки; у найденного PostgreSQL — его порт
    [string]      $PgDataDir = 'C:\PGDATA15',     # для новой установки из архива (MSI 15.13); из -PgSetup — <диск BaseDir>:\PostgreSQL 1C\<версия>\data
    [string]      $PgSetup,                         # установщик PostgreSQL_1C_*_Setup.exe; по умолчанию — поиск в -BaseDir и рядом со скриптом
    # откуда скачать установщик PostgreSQL для 1С, если его нет локально: ссылки по порядку, первая доступная ('' — не скачивать)
    [string[]]    $PgSetupUrl = @('https://repo.postgres.ru/1c/1c-18/win/PostgreSQL_1C_18.4_64bit_Setup.exe',
        'https://disk.yandex.ru/d/bpPS8da1z_f6dw'),
    [switch]      $ReinstallPostgres,               # удалить найденный PostgreSQL для 1С (с данными!) и поставить заново
    [int]         $PgMajor = 18,                # нужная версия PostgreSQL для 1С: найденный старше/равен — используется; младше — ставится рядом,
    # базы кластера 1С из старого переносятся (pg_dump/pg_restore), старый с данными остаётся
    [switch]      $NoMovePgBases,                   # не переносить базы кластера 1С из старого PostgreSQL в новый
    # --- источник базы ---
    [string]      $SourceDt,                        # бэкап .dt для базы; по умолчанию — самый свежий *.dt в -BaseDir («бэкап 20260805.dt»)
    [switch]      $NoBackupDt,                      # не брать бэкап из -BaseDir — база из autoservice.zip
    [switch]      $ReloadIb,                        # база уже есть, а бэкап другой/свежее — загрузить его поверх без вопроса
    [string]      $AdminUser = 'Администратор',   # этому пользователю ИБ после загрузки ставится пустой пароль ('' — не менять)
    [string]      $SrvInfoDir = 'C:\srvinfo',      # каталог кластера 1С
    [string]      $IbName = 'autoservice',     # имя базы в кластере и в PostgreSQL
    [string]      $IbTitle = 'Автосервис',      # имя в списке баз
    [string]      $Server1C = 'localhost',
    [switch]      $Force,                           # удалять прошлую установку без подтверждения
    [switch]      $DeleteArchives,                  # удалить архивы после распаковки
    [switch]      $Redownload,                      # скачать и распаковать исходники заново, даже если они уже есть
    [string]      $IbUser,                          # пользователь 1С в базе «Автосервис» (если есть список пользователей)
    [SecureString]$IbPassword,                      # его пароль; при -IbUser без пароля будет запрошен
    [string[]]    $ExtensionFile,                    # .cfe или имена расширений (АРМЗакупокИПродаж,АРМ_OData); не задан — все рядом со скриптом; '' — не подключать
    [double]      $EstDbGB = 6,                 # оценка размера базы в PostgreSQL (для проверки места)
    [switch]      $SkipSpaceCheck,                    # пропустить проверку свободного места на диске
    # --- демо-данные АРМ (seed-1c.ps1) и запуск после установки ---
    [switch]      $Seed,                              # заполнить без вопроса
    [switch]      $NoSeed,                            # не заполнять и не спрашивать
    [switch]      $SeedKeepSafeModeOff,               # передать seed -KeepSafeModeOff (оставить безопасный режим расширения выключенным)
    [switch]      $NoLaunch,                          # не запускать 1С:Предприятие (Админ, пустой пароль) в конце
    # --- технологический журнал 1С (logcfg.xml) ---
    [switch]      $NoTrace,                           # не настраивать и не проверять ТЖ
    [string]      $TechLogDir = 'D:\1c\tj',  # каталог файлов ТЖ (HDD, не SSD с базой)
    [int]         $TechLogThresholdMs = 200,         # логировать запросы к PostgreSQL (DBPOSTGRS) дольше N мс
    [string]      $LogcfgPath,                        # по умолчанию <корень 1cv8>\conf\logcfg.xml по разрядности установленной платформы
    # --- файловая установка (install-1c.ps1): база сохраняется, удаляется на шаге 0 только с -RemoveFileIb ---
    [string]      $FileIbDir = 'D:\1c_bases\autoservice',
    [switch]      $RemoveFileIb
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------- Запуск от администратора ----------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Перезапуск с правами администратора...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Key -in 'PgPassword', 'IbPassword') { continue }   # SecureString не передать в другой процесс — спросим заново
        if ($kv.Value -is [switch]) { if ($kv.Value) { $argList += "-$($kv.Key)" } }
        elseif ($kv.Value -is [array]) { $argList += "-$($kv.Key)", "`"$($kv.Value -join ',')`"" }   # -ExtensionFile А,Б
        else { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

$PlatformVersion = '8.3.27.2342'
$Sources = [ordered]@{
    # Content — по каким файлам понять, что каталог уже распакован (уже есть — не скачиваем и не распаковываем)
    Platform = @{ Url = 'https://disk.yandex.ru/d/WmdHaZZr45QoXA'; File = 'windows_8_3_27_2342.rar'; Dir = 'platform_8_3_27_2342'; Content = @('1CEnterprise*.msi') }
    Postgres = @{ Url = 'https://disk.yandex.ru/d/B2Lpn8-7A0WVEg'; File = 'postgresql_15.13_1.1C_x64.zip'; Dir = 'postgresql_15.13_1.1C'; Content = @('*.msi') }
    Config   = @{ Url = 'https://disk.yandex.ru/d/xl9suLCSUGRpPA'; File = 'autoservice.zip'; Dir = 'config_autoservice'; Content = @('1Cv8.1CD', '*.dt', '*.cf') }
}
$UnpackedMark = '.unpacked'   # пишется после успешной распаковки; без него неполная распаковка не считается готовой
# Корни, где может лежать 1cv8 / 7-Zip: Program Files обеих разрядностей и D:\Program Files (install-1c.ps1)
$ProgramRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ } | Select-Object -Unique

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir ("install_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))) | Out-Null

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

# =====================================================================
#  Вспомогательные функции
# =====================================================================
function Get-7Zip {
    $candidates = @($ProgramRoots | ForEach-Object { Join-Path $_ '7-Zip\7z.exe' })   # в т.ч. поставленный install-1c.ps1
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    Write-Host '  7-Zip не найден, устанавливаю...'
    $inst = Join-Path $env:TEMP '7z-x64.exe'
    & curl.exe -L --fail -o $inst 'https://www.7-zip.org/a/7z2409-x64.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось скачать 7-Zip' }
    Start-Process $inst -ArgumentList '/S' -Wait
    Remove-Item $inst -Force
    if (-not (Test-Path $candidates[0])) { throw '7-Zip не установился' }
    return $candidates[0]
}

# API публичных ресурсов Яндекс.Диска: несколько попыток с растущим таймаутом; на каждой — сначала curl.exe
# (быстрый: ~3 с), при сбое — Invoke-RestMethod (в Windows PowerShell 5.1 запрос .NET бывает в разы медленнее —
# автоопределение прокси, TLS — и упирался в 30 с). Ошибка — после всех попыток.
function Invoke-YandexApi([string]$Path, [string]$PublicUrl) {
    $uri = "https://cloud-api.yandex.net/v1/disk/public/resources$Path" + "?public_key=$([uri]::EscapeDataString($PublicUrl))"
    $last = ''
    foreach ($t in 30, 60, 120, 180) {
        $json = & curl.exe -s -L --fail --connect-timeout 30 --max-time $t $uri 2>$null
        if ($LASTEXITCODE -eq 0 -and $json) {
            try { return ($json -join "`n") | ConvertFrom-Json } catch { $last = "ответ не JSON: $($_.Exception.Message)" }
        }
        else { $last = "curl: код $LASTEXITCODE" }
        try { return Invoke-RestMethod -Uri $uri -UseBasicParsing -TimeoutSec $t }
        catch { $last = "$last; $($_.Exception.Message)" }
        Warn "Яндекс.Диск не ответил за $t с ($last) — повтор"
        Start-Sleep -Seconds 5
    }
    throw "Яндекс.Диск недоступен ($PublicUrl): $last"
}
function Get-YandexSize([string]$PublicUrl) {
    [int64](Invoke-YandexApi '' $PublicUrl).size
}

# Скачивание с докачкой до нужного размера
function Get-YandexFile([string]$PublicUrl, [string]$OutFile, [int64]$Size) {
    for ($try = 1; $try -le 10; $try++) {
        $have = if (Test-Path $OutFile) { (Get-Item $OutFile).Length } else { 0 }
        if ($have -eq $Size) { break }
        if ($have -gt $Size) { Remove-Item $OutFile -Force; $have = 0 }
        # ссылка на скачивание живёт недолго — берём новую на каждую попытку
        $href = (Invoke-YandexApi '/download' $PublicUrl).href
        if (-not $href) { throw "Яндекс.Диск не вернул ссылку для $PublicUrl" }
        Write-Host ("  Скачивание -> {0} ({1:N0} из {2:N0} МБ, попытка {3})" -f $OutFile, ($have / 1MB), ($Size / 1MB), $try)
        # обрыв «зависших» соединений: меньше 1 КБ/с дольше минуты — следующая попытка с докачкой
        $curlOpt = @('-L', '--fail', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '60')
        if ($have -gt 0) { & curl.exe @curlOpt -C - -o $OutFile $href } else { & curl.exe @curlOpt -o $OutFile $href }
        if ($LASTEXITCODE -ne 0) { Warn "curl вернул $LASTEXITCODE, продолжаю докачку"; Start-Sleep -Seconds 5 }
    }
    if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -ne $Size) { throw "Не удалось полностью скачать $PublicUrl" }
}

# Исходники уже распакованы: есть отметка успешной распаковки и нужные файлы.
# Каталог от прежних версий скрипта (без отметки) принимается по наличию файлов — отметка дописывается.
function Test-Unpacked($src) {
    if ($Redownload) { return $false }
    $dest = Join-Path $BaseDir $src.Dir
    if (-not (Test-Path $dest)) { return $false }
    $found = Get-ChildItem $dest -Recurse -File -Include $src.Content -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 0 } | Select-Object -First 1
    if (-not $found) { return $false }
    $mark = Join-Path $dest $UnpackedMark
    # архив новее распаковки (положили обновлённый, например autoservice.zip с более полной базой) — распаковать заново
    $archive = Join-Path $BaseDir $src.File
    $markTime = if (Test-Path $mark) { (Get-Item $mark).LastWriteTime } else { (Get-Item $dest).LastWriteTime }
    if ((Test-Path $archive) -and (Get-Item $archive).LastWriteTime -gt $markTime) {
        Warn ("{0} новее распакованного {1} ({2:dd.MM.yyyy HH:mm} > {3:dd.MM.yyyy HH:mm}) — распаковываю заново" -f $src.File, $dest, (Get-Item $archive).LastWriteTime, $markTime)
        return $false
    }
    if (-not (Test-Path $mark)) { Set-Content $mark "$($src.File)`r`n$($found.FullName)" -Encoding UTF8 }
    return $true
}

# Проверить архив (наличие, размер, целостность); при проблемах — докачать/перекачать
function Confirm-Archive($src) {
    $archive = Join-Path $BaseDir $src.File
    # архив уже есть и цел — сеть не нужна
    if ((Test-Path $archive) -and -not $Redownload) {
        Write-Host "  Архив найден: $($src.File), проверка целостности..."
        & $script:SevenZip t $archive -bso0 -bsp0
        if ($LASTEXITCODE -eq 0) { Ok ("архив в порядке ({0:N1} МБ), скачивание не нужно" -f ((Get-Item $archive).Length / 1MB)); return $archive }
        Warn 'архив неполный или повреждён — сверяю размер с Яндекс.Диском и докачиваю'
    }
    if ($Redownload -and (Test-Path $archive)) { Remove-Item $archive -Force; Write-Host "  -Redownload: архив $($src.File) удалён, скачиваю заново" }
    $size = Get-YandexSize $src.Url
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        if (Test-Path $archive) {
            $have = (Get-Item $archive).Length
            if ($have -eq $size) { Write-Host "  Архив найден: $($src.File), проверка целостности..." }
            else { Warn ("архив неполный: {0:N0} из {1:N0} МБ" -f ($have / 1MB), ($size / 1MB)) }
        }
        else {
            Write-Host "  Архив $($src.File) не найден"
        }
        Get-YandexFile $src.Url $archive $size
        & $script:SevenZip t $archive -bso0 -bsp0
        if ($LASTEXITCODE -eq 0) { Ok ("архив в порядке ({0:N1} МБ)" -f ($size / 1MB)); return $archive }
        Warn 'архив повреждён — удаляю и скачиваю заново'
        Remove-Item $archive -Force
    }
    throw "Не удалось получить целый архив $($src.File)"
}

function Expand-Source($src) {
    $dest = Join-Path $BaseDir $src.Dir
    if (Test-Unpacked $src) {
        Ok "исходники уже есть: $dest — скачивание и распаковка пропущены (заново: -Redownload)"
        return $dest
    }
    $archive = Confirm-Archive $src
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Host "  Распаковка -> $dest"
    & $script:SevenZip x $archive "-o$dest" -y -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw "Ошибка распаковки $archive" }
    Set-Content (Join-Path $dest $UnpackedMark) $src.File -Encoding UTF8
    if ($DeleteArchives) { Remove-Item $archive -Force; Ok 'распаковано, архив удалён' }
    else { Ok 'распаковано (архив сохранён для повторных запусков)' }
    return $dest
}

# Свободно ГБ на диске, которому принадлежит путь
function Get-FreeGB([string]$Path) {
    $qualifier = (Split-Path -Qualifier $Path) + '\'
    [math]::Round((Get-PSDrive -Name $qualifier.TrimEnd(':\') -ErrorAction SilentlyContinue).Free / 1GB, 1)
}

# Проверка свободного места перед установкой. Считает потребности по каждому диску
# (распаковка + .dt на диске BaseDir, программы на системном, база на диске PgDataDir).
function Assert-FreeSpace {
    Write-Host '  Оценка требуемого места на диске...'
    $need = @{}   # буква диска -> нужно ГБ
    function Add-Need([string]$path, [double]$gb) {
        $d = (Split-Path -Qualifier $path).ToUpper()
        $need[$d] = [math]::Round(($need[$d] + $gb), 1)
    }

    # Архивы: если их нет — придётся скачать; при распаковке архив и папка лежат вместе
    foreach ($src in $Sources.Values) {
        if (Test-Unpacked $src) { continue }         # уже распаковано — ни скачивания, ни распаковки
        $archive = Join-Path $BaseDir $src.File
        if ((Test-Path $archive) -and -not $Redownload) {
            $gb = (Get-Item $archive).Length / 1GB
        }
        else {
            $gb = (Get-YandexSize $src.Url) / 1GB
            Add-Need $BaseDir $gb                    # сам архив
        }
        Add-Need $BaseDir ($gb * 1.6)                # распакованное содержимое
    }
    Add-Need $BaseDir 2.5                            # autoservice.dt (резервная копия)
    Add-Need $env:ProgramFiles 2.5                   # PostgreSQL + платформа 1С
    Add-Need $PgDataDir $EstDbGB                     # база в PostgreSQL
    if ($PgSetupRemote -and -not $PgSetupFile) { Add-Need $BaseDir ($PgSetupRemote.Size / 1GB) }   # скачиваемый установщик PostgreSQL

    $buffer = 2.0                                    # запас на журналы, temp, рост
    $fail = $false
    foreach ($d in $need.Keys) {
        $req = [math]::Round(($need[$d] + $buffer), 1)
        $free = Get-FreeGB "$d\"
        if ($free -ge $req) { Ok "диск $d : нужно ~$req ГБ, свободно $free ГБ" }
        else { Warn "диск $d : нужно ~$req ГБ, свободно только $free ГБ — не хватает $([math]::Round($req - $free,1)) ГБ"; $fail = $true }
    }
    if ($fail) {
        throw "Недостаточно места на диске. Освободите место или задайте другой диск ключами -BaseDir/-PgDataDir, либо пропустите проверку ключом -SkipSpaceCheck."
    }
}

# Вызов psql через 127.0.0.1 (без ::1 -> без WSAEACCES-шума в stderr).
# EAP локально ослаблен: вывод psql в stderr не должен ронять скрипт под -ErrorAction Stop.
# Возвращает объект { Out; Code }.
function Invoke-Psql {
    param(
        [string]$Bin, [int]$Port, [string]$User, [string]$Db, [string]$Sql,
        [string]$PwPlain, [switch]$Tuple
    )
    $env:PGPASSWORD = $PwPlain
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $flag = if ($Tuple) { '-tAc' } else { '-c' }
        $out = & (Join-Path $Bin 'psql.exe') -w -h 127.0.0.1 -p $Port -U $User -d $Db $flag $Sql 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
    [pscustomobject]@{ Out = (($out | Out-String).Trim()); Code = $code }
}

function Invoke-Msi([string]$Action, [string]$Target, [string]$ArgsLine, [string]$LogName) {
    $log = Join-Path $LogDir $LogName
    $p = Start-Process msiexec.exe -ArgumentList "$Action `"$Target`" $ArgsLine /norestart /l*v `"$log`"" -Wait -PassThru
    # msiexec пишет в лог командную строку и свойства — вычищаем пароль
    if ($script:PgPasswordPlain -and (Test-Path $log)) {
        $text = [IO.File]::ReadAllText($log)
        if ($text.Contains($script:PgPasswordPlain)) {
            [IO.File]::WriteAllText($log, $text.Replace($script:PgPasswordPlain, '********'), [Text.Encoding]::Unicode)
        }
    }
    return $p.ExitCode   # 0 / 3010 (нужна перезагрузка) — успех
}

function Get-UninstallEntries {
    $keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName }
}

# bin PostgreSQL 15.13-1.1C после установки MSI из архива
function Find-PgBin {
    Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '15*' } |
    Sort-Object { $_.Name -notlike '*1C*' } |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_ctl.exe') } |
    Select-Object -First 1
}

# 64-битный Program Files (скрипт может оказаться в 32-битном PowerShell)
$ProgramFiles64 = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }

# Установленные экземпляры PostgreSQL — по службам «pg_ctl runservice -N … -D <данные>».
# For1C — сборка для 1С (есть расширение mchar); порт — из postgresql.conf / postgresql.auto.conf (по умолчанию 5432).
function Find-ExistingPg {
    foreach ($s in Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'pg_ctl\.exe"?\s+runservice' }) {
        $exe = if ($s.PathName -match '^"([^"]+pg_ctl\.exe)"') { $Matches[1] } elseif ($s.PathName -match '^(\S+pg_ctl\.exe)') { $Matches[1] } else { $null }
        if (-not $exe -or -not (Test-Path $exe)) { continue }
        $bin = Split-Path -Parent $exe
        $root = Split-Path -Parent $bin
        $data = if ($s.PathName -match '-D\s+"([^"]+)"') { $Matches[1] } elseif ($s.PathName -match '-D\s+(\S+)') { $Matches[1] } else { '' }
        $port = 5432
        foreach ($cf in 'postgresql.conf', 'postgresql.auto.conf') {
            $p = Join-Path $data $cf
            if ($data -and (Test-Path $p)) { foreach ($l in Get-Content $p) { if ($l -match '^\s*port\s*=\s*(\d+)') { $port = [int]$Matches[1] } } }
        }
        $ver = try { ((& (Join-Path $bin 'postgres.exe') -V) -replace '^.*\)\s*', '').Trim() } catch { '?' }
        $for1C = [bool](@("$root\share\extension\mchar.control", "$root\share\postgresql\extension\mchar.control") | Where-Object { Test-Path $_ })
        [pscustomobject]@{ Service = $s.Name; State = $s.State; Bin = $bin; Root = $root; Data = $data; Port = $port; Version = $ver; For1C = $for1C }
    }
}

# Локальный установщик PostgreSQL для 1С (Postgres Professional, NSIS): PostgreSQL_1C_<версия>_64bit_Setup.exe
# в -BaseDir или рядом со скриптом; несколько — берётся старшая версия. -PgSetup — явный путь.
function Find-PgSetup {
    if ($PgSetup) { if (Test-Path $PgSetup) { return Get-Item $PgSetup } else { throw "Установщик PostgreSQL не найден: $PgSetup" } }
    $dirs = @($BaseDir, $PSScriptRoot) | Where-Object { $_ } | Select-Object -Unique
    Get-ChildItem $dirs -Filter 'PostgreSQL_1C_*_Setup.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { Test-PgSetupSigned $_.FullName } |
    Sort-Object { try { [version]($_.Name -replace '^PostgreSQL_1C_(\d+(?:\.\d+)*)_.*$', '$1' -replace '^(\d+)$', '$1.0') } catch { [version]'0.0' } } -Descending |
    Select-Object -First 1
}

# Бэкапы рабочей базы — .dt в корне -BaseDir (например «бэкап 20260805.dt») или -SourceDt.
# Свежесть — по дате в имени (ГГГГММДД), без неё — по дате файла; берётся самый свежий. Файл проверяется
# по заголовку выгрузки 1С («1CIBDmpF»). Возвращает { File; Date; Older } или $null.
function Find-BackupDt {
    $files = if ($SourceDt) {
        if (-not (Test-Path -LiteralPath $SourceDt)) { throw "Бэкап не найден: $SourceDt" }
        @(Get-Item -LiteralPath $SourceDt)
    }
    else { @(Get-ChildItem -LiteralPath $BaseDir -Filter '*.dt' -File -ErrorAction SilentlyContinue) }
    $list = foreach ($f in $files) {
        $hdr = New-Object byte[] 8
        try { $s = [IO.File]::OpenRead($f.FullName); [void]$s.Read($hdr, 0, 8); $s.Close() } catch { continue }
        if ([Text.Encoding]::ASCII.GetString($hdr) -ne '1CIBDmpF') { Warn "$($f.Name) — не выгрузка 1С (.dt), пропущен"; continue }
        $d = $f.LastWriteTime
        if ($f.BaseName -match '(20\d{2})(\d{2})(\d{2})') { try { $d = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Hour 0 -Minute 0 -Second 0 } catch { } }
        [pscustomobject]@{ File = $f; Date = $d }
    }
    $sorted = @($list | Sort-Object Date, { $_.File.LastWriteTime } -Descending)
    if (-not $sorted) { return $null }
    [pscustomobject]@{ File = $sorted[0].File; Date = $sorted[0].Date; Older = @($sorted | Select-Object -Skip 1) }
}

# Пароль пользователя ИБ (по умолчанию «Администратор») — пустой: вход без пароля под ним, «Админ» или «Автосервис»
# (у них полные права), затем смена пароля через COM (tools\ib-admin-reset.js). Возвращает @{ Login; Users; Reset; After }.
function Reset-IbUserPassword([string]$Conn, [string]$User) {
    $js = Join-Path $PSScriptRoot 'tools\ib-admin-reset.js'
    if (-not (Test-Path $js)) { Warn "нет $js — пароль не изменён"; return $null }
    $tmp = Join-Path $LogDir 'admin_reset'; New-Item -ItemType Directory -Force $tmp | Out-Null
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText($js, [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", $Conn, [Text.Encoding]::Unicode)
    & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript "$tmp\r.js" "$tmp\c.txt" "$tmp\out.txt" $User | Out-Null
    $r = @{}
    if (Test-Path "$tmp\out.txt") { foreach ($l in [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode)) { $k, $v = $l -split '=', 2; $r[$k] = $v } }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return $r
}

# Установщик подписан Postgres Professional и подпись действительна (неполный/подменённый файл не пройдёт)
function Test-PgSetupSigned([string]$Path) {
    $sig = Get-AuthenticodeSignature -FilePath $Path -ErrorAction SilentlyContinue
    $ok = $sig -and $sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'Postgres Professional'
    if (-not $ok) { Warn "$Path — подпись Postgres Professional не подтверждена ($($sig.Status)), файл не используется" }
    return [bool]$ok
}

# Прямая ссылка (https://repo.postgres.ru/…): HEAD через curl.exe (с переходами) — код и размер последнего ответа
function Get-DirectHead([string]$Url) {
    for ($i = 1; $i -le 3; $i++) {
        $h = & curl.exe -sIL --connect-timeout 30 --max-time 90 $Url 2>$null
        if ($LASTEXITCODE -eq 0 -and $h) {
            $code = 0; $size = 0
            foreach ($l in $h) {
                if ($l -match '^HTTP/\S+\s+(\d+)') { $code = [int]$Matches[1]; $size = 0 }
                elseif ($l -match '^(?i)content-length:\s*(\d+)') { $size = [int64]$Matches[1] }
            }
            if ($code -eq 200 -and $size -gt 0) { return [pscustomobject]@{ Code = $code; Size = $size } }
            Warn "$Url — ответ $code"
        }
        else { Warn "$Url не ответил (curl: код $LASTEXITCODE), повтор" }
        Start-Sleep -Seconds 5
    }
    $null
}
# Скачивание по прямой ссылке с докачкой (curl -C -): обрывы и «зависшие» соединения — следующая попытка
function Get-DirectFile([string]$Url, [string]$OutFile, [int64]$Size) {
    for ($try = 1; $try -le 10; $try++) {
        $have = if (Test-Path $OutFile) { (Get-Item $OutFile).Length } else { 0 }
        if ($have -eq $Size) { break }
        if ($have -gt $Size) { Remove-Item $OutFile -Force; $have = 0 }
        Write-Host ("  Скачивание -> {0} ({1:N0} из {2:N0} МБ, попытка {3})" -f $OutFile, ($have / 1MB), ($Size / 1MB), $try)
        $curlOpt = @('-L', '--fail', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '60')
        if ($have -gt 0) { & curl.exe @curlOpt -C - -o $OutFile $Url } else { & curl.exe @curlOpt -o $OutFile $Url }
        if ($LASTEXITCODE -ne 0) { Warn "curl вернул $LASTEXITCODE, продолжаю докачку"; Start-Sleep -Seconds 5 }
    }
    if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -ne $Size) { throw "Не удалось полностью скачать $Url" }
}

# Установщик по -PgSetupUrl (ссылки по порядку, первая доступная): прямая ссылка — имя из адреса, размер из HEAD;
# Яндекс.Диск — имя, размер и SHA256 из API публичного ресурса. $null — ни одна не доступна.
function Get-PgSetupRemote {
    foreach ($u in ($PgSetupUrl | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        try {
            if ($u -match '^https?://(disk\.yandex\.|yadi\.sk)') {
                $meta = Invoke-YandexApi '' $u
                if ($meta.type -ne 'file' -or $meta.name -notmatch '^PostgreSQL_1C_\d+.*\.exe$') { Warn "по $u не установщик PostgreSQL_1C_*.exe ($($meta.type) $($meta.name))"; continue }
                return [pscustomobject]@{ Name = $meta.name; Size = [int64]$meta.size; Sha256 = $meta.sha256; Url = $u; Yandex = $true }
            }
            $name = [uri]::UnescapeDataString(([uri]$u).Segments[-1])
            if ($name -notmatch '^PostgreSQL_1C_\d+.*\.exe$') { Warn "$u — не установщик PostgreSQL_1C_*.exe"; continue }
            $head = Get-DirectHead $u
            if (-not $head) { Warn "$u недоступен"; continue }
            return [pscustomobject]@{ Name = $name; Size = $head.Size; Sha256 = $null; Url = $u; Yandex = $false }
        }
        catch { Warn "$u недоступен: $($_.Exception.Message)" }
    }
    $null
}

# Скачать установщик в -BaseDir (с докачкой) и проверить SHA256 (Яндекс.Диск) и подпись Postgres Professional
function Get-PgSetupDownload($Remote) {
    $out = Join-Path $BaseDir $Remote.Name
    Write-Host ("  Скачивание {0} ({1:N0} МБ) с {2}" -f $Remote.Name, ($Remote.Size / 1MB), $Remote.Url)
    if ($Remote.Yandex) { Get-YandexFile $Remote.Url $out $Remote.Size } else { Get-DirectFile $Remote.Url $out $Remote.Size }
    if ($Remote.Sha256 -and (Get-FileHash $out -Algorithm SHA256).Hash -ne $Remote.Sha256.ToUpper()) {
        Remove-Item $out -Force; throw "SHA256 скачанного $($Remote.Name) не совпадает с Яндекс.Диском — файл удалён, запустите снова"
    }
    if (-not (Test-PgSetupSigned $out)) { Remove-Item $out -Force; throw "$($Remote.Name): подпись Postgres Professional не подтверждена — файл удалён" }
    Ok ("скачано и проверено ({0}подпись Postgres Professional): {1}" -f $(if ($Remote.Sha256) { 'SHA256, ' } else { '' }), $out)
    return Get-Item $out
}

# Установка из NSIS-установщика без его мастера: программа распаковывается 7-Zip в
# <Program Files>\PostgreSQL 1C\<major> (bin, lib, share), VC++ 2015-2022 x64 — из того же установщика, если нет.
# Кластер (initdb) и службу дальше создаёт скрипт — как для MSI: ошибки видны в консоли, порт и каталог данных наши.
function Install-PgFromSetup($Setup, [string]$Major) {
    $root = Join-Path $ProgramFiles64 "PostgreSQL 1C\$Major"
    if (Test-Path (Join-Path $root 'bin\pg_ctl.exe')) {
        Ok "программа PostgreSQL уже распакована: $root"
    }
    else {
        Write-Host "  Распаковка $($Setup.Name) -> $root"
        & $script:SevenZip x -tNsis $Setup.FullName "-o$root" 'bin' 'lib' 'share' 'license.txt' '3rd_party_licenses.txt' -y -bso0 -bsp0
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $root 'bin\pg_ctl.exe'))) { throw "Не удалось распаковать $($Setup.FullName) (7-Zip вернул $LASTEXITCODE)" }
        Ok "программа PostgreSQL распакована: $root"
    }
    $vc = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
    if (-not $vc -or $vc.Installed -ne 1) {
        $tmp = Join-Path $env:TEMP 'pg_vcredist'
        & $script:SevenZip x -tNsis $Setup.FullName "-o$tmp" '$1' -y -bso0 -bsp0
        $redist = Join-Path $tmp 'vc_redist.x64.exe'
        Move-Item (Join-Path $tmp '$1') $redist -Force
        Write-Host '  Установка Microsoft Visual C++ 2015-2022 x64 (нужна PostgreSQL)...'
        $p = Start-Process $redist -ArgumentList '/install /quiet /norestart' -Wait -PassThru
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -notin 0, 1638, 3010) { throw "Установка VC++ x64 завершилась с кодом $($p.ExitCode)" }
        Ok 'Visual C++ 2015-2022 x64 установлен'
    }
    else { Ok "Visual C++ 2015-2022 x64 уже есть ($($vc.Version))" }
    return (Join-Path $root 'bin')
}

function Find-1CBin {
    foreach ($root in $ProgramRoots) {
        $b = Join-Path $root "1cv8\$PlatformVersion\bin"
        if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
    }
}

# Ждать, пока localhost слушает указанные порты (после рестарта агента 1С).
function Wait-LocalPorts([int[]]$Ports, [int]$TimeoutSec = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $allUp = $true
        foreach ($p in $Ports) {
            if (-not (Test-NetConnection -ComputerName localhost -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue)) {
                $allUp = $false
                break
            }
        }
        if ($allUp) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Новее ли что-то в каталоге ТЖ относительно момента $Since (файлы и подкаталоги).
function Test-TechLogFresh([string]$Dir, [datetime]$Since) {
    if (-not (Test-Path $Dir)) { return $false }
    $items = Get-ChildItem $Dir -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($i in $items) {
        if ($i.LastWriteTime -gt $Since -or $i.CreationTime -gt $Since) { return $true }
    }
    return $false
}

# logcfg.xml читается из <корень 1cv8>\conf той разрядности, что и платформа (агент сервера тоже):
# 32-бит — Program Files (x86)\1cv8\conf, 64-бит — Program Files\1cv8\conf.
# $Bin = ...\1cv8\<версия>\bin -> ...\1cv8\conf\logcfg.xml
function Get-LogcfgPath([string]$Bin) {
    Join-Path (Split-Path -Parent (Split-Path -Parent $Bin)) 'conf\logcfg.xml'
}

# Удалить logcfg.xml и logcfg.xml.bak.*, записанные этими скриптами в других местах
# (каталог conf другой разрядности платформа не читает). Чужие файлы не трогаем.
function Remove-StrayLogcfg([string]$Keep) {
    foreach ($root in $ProgramRoots) {
        $conf = Join-Path $root '1cv8\conf'
        foreach ($f in Get-ChildItem $conf -Filter 'logcfg.xml*' -File -ErrorAction SilentlyContinue) {
            if ($f.FullName -eq $Keep) { continue }
            if ((Get-Content $f.FullName -Raw -Encoding UTF8) -match 'Сгенерировано install-1c') {
                Remove-Item $f.FullName -Force
                Ok "удалён лишний $($f.FullName)"
            }
        }
    }
}

# Удалить из списка баз (ibases.v8i) секции, указывающие на нашу серверную базу
# и на файловую базу файлового варианта (-FileIbDir)
# Список баз — общий для всех пользователей сервера: %ProgramData%\1C\1CEStart\ibases.v8i, подключённый в
# %ProgramData%\1C\1CEStart\1CEStart.cfg строкой CommonInfoBases= (личный %APPDATA% видит только запустивший скрипт)
$CommonStartDir = Join-Path $env:ProgramData '1C\1CEStart'
$CommonIbList = Join-Path $CommonStartDir 'ibases.v8i'
function Register-CommonIbList {
    New-Item -ItemType Directory -Force -Path $CommonStartDir | Out-Null
    $cfg = Join-Path $CommonStartDir '1CEStart.cfg'
    $text = if (Test-Path $cfg) { [IO.File]::ReadAllText($cfg) } else { '' }   # 1CEStart.cfg — UTF-16 LE с BOM (ReadAllText определяет по BOM)
    $line = "CommonInfoBases=$CommonIbList"
    if ($text -match "(?mi)^CommonInfoBases=$([regex]::Escape($CommonIbList))\s*$") { return }
    if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
    [IO.File]::WriteAllText($cfg, $text + $line + "`r`n", [Text.Encoding]::Unicode)
    # читать общий список должны все пользователи (наследование ProgramData обычно уже даёт Users чтение)
    & icacls $CommonStartDir /grant '*S-1-5-32-545:(OI)(CI)RX' /Q | Out-Null
    Ok "общий список баз для всех пользователей: $CommonIbList (подключён в $cfg)"
}
function Remove-IbFromList {
    $pattern = "Srvr=`"?$([regex]::Escape($Server1C))`"?;Ref=`"?$([regex]::Escape($IbName))`"?;"
    $filePattern = "File=`"?$([regex]::Escape($FileIbDir.TrimEnd('\')))\\?`"?;"
    foreach ($f in @("$env:APPDATA\1C\1CEStart\ibases.v8i", $CommonIbList)) {
        if (-not (Test-Path $f)) { continue }
        $text = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
        $parts = [regex]::Split($text, '(?m)^(?=\[)')
        $kept = $parts | Where-Object { $_ -notmatch $pattern -and (-not $RemoveFileIb -or $_ -notmatch $filePattern) }
        if (@($kept).Count -ne @($parts).Count) {
            [IO.File]::WriteAllText($f, (-join $kept), (New-Object Text.UTF8Encoding $true))
            Ok "база удалена из списка: $f"
        }
    }
}

# Добавить серверную базу в список (ibases.v8i), если её там нет. Имя занято другой базой (например, файловой
# «Автосервис» от install-1c.ps1) — запись получает имя «<IbTitle> (PostgreSQL)». 1cv8 /AddToList в этом случае
# падает с «уже зарегистрирована», поэтому список ведём сами.
function Add-ServerIbToList {
    Register-CommonIbList
    $refPattern = "Srvr=`"?$([regex]::Escape($Server1C))`"?;Ref=`"?$([regex]::Escape($IbName))`"?;"
    # запись прошлых версий скрипта в личном списке администратора — убрать, иначе у него база будет дважды
    $personal = "$env:APPDATA\1C\1CEStart\ibases.v8i"
    if (Test-Path $personal) {
        $pt = [IO.File]::ReadAllText($personal, [Text.Encoding]::UTF8)
        $parts = [regex]::Split($pt, '(?m)^(?=\[)')
        $kept = $parts | Where-Object { $_ -notmatch $refPattern }
        if (@($kept).Count -ne @($parts).Count) { [IO.File]::WriteAllText($personal, (-join $kept), (New-Object Text.UTF8Encoding $true)); Ok "база перенесена из личного списка ($personal) в общий" }
    }
    $f = $CommonIbList
    $text = if (Test-Path $f) { [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) } else { '' }
    if ($text -match $refPattern) { Ok 'база уже в общем списке баз'; return }
    $title = $IbTitle
    for ($n = 1; $text -match "(?m)^\[$([regex]::Escape($title))\]\s*$"; $n++) {
        $title = if ($n -eq 1) { "$IbTitle (PostgreSQL)" } else { "$IbTitle (PostgreSQL $n)" }
    }
    if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
    $entry = "[$title]`r`nConnect=Srvr=`"$Server1C`";Ref=`"$IbName`";`r`nID=$([guid]::NewGuid())`r`nOrderInList=0`r`nFolder=/`r`n" +
    "OrderInTree=0`r`nExternal=0`r`nClientConnectionSpeed=Normal`r`nApp=Auto`r`nWA=1`r`nVersion=8.3`r`n"
    [IO.File]::WriteAllText($f, $text + $entry, (New-Object Text.UTF8Encoding $true))
    Ok "база добавлена в список: $title"
}

# Скрыть пароль PostgreSQL (DBPwd=...) в тексте и в файлах логов: 1С пишет строку соединения в /Out как есть
function Hide-PgPassword([string]$Text) {
    if (-not $Text) { return $Text }
    $Text = [regex]::Replace($Text, '(?i)(DBPwd=)("[^"]*"|[^;]*)', '$1"***"')
    if ($script:PgPasswordPlain) { $Text = $Text.Replace($script:PgPasswordPlain, '***') }
    return $Text
}
function Clear-PgPasswordInFile([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $enc = if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
    $text = $enc.GetString($bytes); $clean = Hide-PgPassword $text
    if ($clean -ne $text) { [IO.File]::WriteAllText($Path, $clean, $enc) }
}

# Расширения .cfe: <имя>_v<версия>.cfe (v1 < v2.0 < v2.1 < v10; без суффикса — версия 0).
# Порядок подключения: АРМЗакупокИПродаж -> прочие -> АРМ_OData (его команды вызывают код АРМ).
$ExtOrder = @{ 'АРМЗакупокИПродаж' = 0; 'АРМ_OData' = 9 }
function Get-ExtCandidates([string[]]$Dirs) {
    Get-ChildItem ($Dirs | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique) -Filter '*.cfe' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $m = [regex]::Match($_.BaseName, '^(.+?)_v(\d+(?:\.\d+){0,3})$')
        $ver = if ($m.Success) { $m.Groups[2].Value } else { '0' }
        if ($ver -notmatch '\.') { $ver += '.0' }
        [pscustomobject]@{ File = $_.FullName; Name = $(if ($m.Success) { $m.Groups[1].Value } else { $_.BaseName }); Version = [version]$ver }
    }
}
# -ExtensionFile: пути к .cfe и/или имена расширений (имя -> последняя версия <имя>_v*.cfe рядом со скриптом / в -BaseDir).
# Не задан — все расширения рядом со скриптом (последняя версия каждого). '' — не подключать.
function Resolve-Extensions([string[]]$Spec, [bool]$Bound, [string[]]$Dirs) {
    $all = @(Get-ExtCandidates $Dirs)
    $latest = { param($name) $all | Where-Object Name -eq $name | Sort-Object Version -Descending | Select-Object -First 1 }
    $list = @()
    if (-not $Bound) {
        foreach ($n in ($all | Select-Object -ExpandProperty Name -Unique)) { $list += & $latest $n }
    }
    else {
        # «А,Б» одной строкой (так приходит при перезапуске с правами администратора) — тоже список
        foreach ($s in ($Spec | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
            if (Test-Path -LiteralPath $s -PathType Leaf) {
                $m = [regex]::Match([IO.Path]::GetFileNameWithoutExtension($s), '^(.+?)(?:_v[\d.]+)?$')
                $list += [pscustomobject]@{ File = (Resolve-Path -LiteralPath $s).Path; Name = $m.Groups[1].Value; Version = [version]'0.0' }
            }
            else {
                $n = [IO.Path]::GetFileNameWithoutExtension($s) -replace '_v[\d.]+$', ''
                $f = & $latest $n
                if (-not $f) { throw "Расширение «$s» не найдено: нет файла $n`_v*.cfe в $(($Dirs | Where-Object { $_ }) -join ', ')" }
                $list += $f
            }
        }
    }
    @($list | Sort-Object { if ($ExtOrder.ContainsKey($_.Name)) { $ExtOrder[$_.Name] } else { 5 } }, Name)
}
# Метка набора расширений (для .dt.ext): имя|файл|SHA1 по строке на расширение
function Get-ExtSignature($Exts) { ($Exts | ForEach-Object { "{0}|{1}|{2}" -f $_.Name, (Split-Path -Leaf $_.File), (Get-FileHash $_.File -Algorithm SHA1).Hash }) -join "`n" }

# ---------- Сервер администрирования 1С (ras/rac): на время работы скрипта ras запускается процессом ----------
$script:RasProc = $null
function Start-Rac {
    if ($script:RasProc -and -not $script:RasProc.HasExited) { return }
    $script:RasProc = Start-Process (Join-Path $Bin1C 'ras.exe') -ArgumentList 'cluster --port=1545 localhost:1540' -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 4
}
function Stop-Rac { if ($script:RasProc) { Stop-Process -Id $script:RasProc.Id -Force -ErrorAction SilentlyContinue; $script:RasProc = $null } }
function Invoke-Rac { $o = & (Join-Path $Bin1C 'rac.exe') localhost:1545 @args 2>&1; [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($o | ForEach-Object { "$_" }) } }
function Get-ClusterId { Start-Rac; ((Invoke-Rac cluster list).Out | Select-String '^cluster\s+:\s+(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value }
# Базы кластера: [{ Id; Name }]
function Get-ClusterIbs([string]$Cl) {
    $out = (Invoke-Rac infobase summary list "--cluster=$Cl").Out; $res = @(); $id = $null
    foreach ($l in $out) {
        if ($l -match '^infobase\s+:\s+(\S+)') { $id = $Matches[1] }
        elseif ($l -match '^name\s+:\s+(.+)$' -and $id) { $res += [pscustomobject]@{ Id = $id; Name = $Matches[1].Trim() }; $id = $null }
    }
    $res
}
# Свойства базы (нужен пользователь базы): кандидаты — заданный, без пользователя, Админ / Администратор / Автосервис без пароля
function Get-IbInfo([string]$Cl, [string]$Ib, [string[]]$Users) {
    foreach ($u in $Users) {
        $r = Invoke-Rac infobase info "--cluster=$Cl" "--infobase=$Ib" "--infobase-user=$u" '--infobase-pwd='
        if ($r.Code -eq 0) {
            $h = @{ User = $u }
            foreach ($l in $r.Out) { if ($l -match '^([\w-]+)\s+:\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
            return $h
        }
    }
    $null
}
# Запрет регламентных заданий и завершение сеансов базы (фоновые задания держат базу — UpdateDBCfg не проходит)
function Set-IbJobsDeny([string]$Cl, [string]$Ib, [string]$User, [string]$Pwd, [bool]$On) {
    $v = if ($On) { 'on' } else { 'off' }
    $r = Invoke-Rac infobase update "--cluster=$Cl" "--infobase=$Ib" "--infobase-user=$User" "--infobase-pwd=$Pwd" "--scheduled-jobs-deny=$v"
    if ($r.Code -ne 0) { Warn "регламентные задания: запрет $v не установлен ($($r.Out -join ' '))"; return $false }
    if ($On) {
        foreach ($s in ((Invoke-Rac session list "--cluster=$Cl" "--infobase=$Ib").Out | Select-String '^session\s+:\s+(\S+)')) {
            Invoke-Rac session terminate "--cluster=$Cl" "--session=$($s.Matches[0].Groups[1].Value)" | Out-Null
        }
        Start-Sleep -Seconds 3
    }
    $true
}
# COM-скрипт из odata\ (строка соединения — файлом UTF-16: кириллица и кавычки)
function Invoke-ComJs([string]$Js, [string]$Conn, [string[]]$Rest) {
    $tmp = Join-Path $LogDir ('comjs_' + [IO.Path]::GetFileNameWithoutExtension($Js)); New-Item -ItemType Directory -Force $tmp | Out-Null
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText($Js, [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", $Conn, [Text.Encoding]::Unicode)
    $cscript = if ($Bin1C -like "${env:ProgramFiles(x86)}*") { "$env:WINDIR\SysWOW64\cscript.exe" } else { "$env:WINDIR\System32\cscript.exe" }
    & $cscript //nologo //E:JScript "$tmp\r.js" "$tmp\c.txt" "$tmp\out.txt" @Rest | Out-Null
    $out = if (Test-Path "$tmp\out.txt") { [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode) } else { @('ERROR=нет отчёта (COM-соединитель не зарегистрирован?)') }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $out
}

# =====================================================================
try {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $Exts = @(Resolve-Extensions $ExtensionFile $PSBoundParameters.ContainsKey('ExtensionFile') @($scriptDir, $BaseDir))
    if ($Exts) { foreach ($e in $Exts) { Ok "расширение $($e.Name): $(Split-Path -Leaf $e.File)" } }
    else { Warn 'расширения подключены не будут (нет .cfe рядом со скриптом или -ExtensionFile "")' }
    $HasArm = [bool]($Exts | Where-Object Name -eq 'АРМЗакупокИПродаж')
    if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString 'Пароль суперпользователя PostgreSQL (установленного — его пароль; для новой установки — новый)' }
    if ($PgPassword.Length -eq 0) { throw 'Пароль PostgreSQL не задан' }
    if ($IbUser -and -not $IbPassword) { $IbPassword = Read-Host -AsSecureString "Пароль пользователя 1С '$IbUser' (Enter — пустой)" }
    # открытый текст нужен msiexec/initdb/psql/1С — держим только в памяти
    $PgPasswordPlain = (New-Object Net.NetworkCredential('', $PgPassword)).Password
    # psql (Windows) шлёт пароль в CP1251, 1С — в UTF-8. При не-ASCII символах хэш md5
    # совпадёт только с одним из них -> "password authentication failed". Требуем ASCII.
    if ($PgPasswordPlain.ToCharArray() | Where-Object { [int]$_ -gt 126 -or [int]$_ -lt 32 }) {
        throw 'Пароль PostgreSQL должен состоять только из ASCII: латиница, цифры, спецсимволы (без кириллицы и пробелов по краям). Иначе psql и 1С используют разные кодировки и вход не пройдёт.'
    }

    # логи прошлых запусков (до маскировки) могли сохранить пароль PostgreSQL из строки соединения
    Get-ChildItem $LogDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.log', '.txt' } |
    ForEach-Object { try { Clear-PgPasswordInFile $_.FullName } catch { } }

    $SevenZip = Get-7Zip

    # =================================================================
    #  PostgreSQL: уже установленный для 1С -> используем (шаг 0 его не трогает); нет -> локальный установщик
    #  PostgreSQL_1C_*_Setup.exe; нет и его -> архив 15.13-1.1C с Яндекс.Диска (как раньше)
    $PgAll = @(Find-ExistingPg)
    $pgMajorOf = { param($p) if ("$($p.Version)" -match '^(\d+)') { [int]$Matches[1] } else { 0 } }
    $Pg1C = @($PgAll | Where-Object For1C | Sort-Object { & $pgMajorOf $_ } -Descending)
    # найденный PostgreSQL для 1С подходит, если его версия не ниже -PgMajor (по умолчанию 18)
    $PgExisting = if ($ReinstallPostgres) { $null } else { $Pg1C | Where-Object { (& $pgMajorOf $_) -ge $PgMajor } | Sort-Object { $_.State -ne 'Running' } | Select-Object -First 1 }
    # старый (ниже -PgMajor) остаётся с данными; базы кластера 1С из него переносятся в новый на шаге 3в
    $PgOld = if ($PgExisting -or $ReinstallPostgres) { $null } else { $Pg1C | Where-Object { $_.State -eq 'Running' } | Select-Object -First 1 }
    if ($PgOld) { Warn "PostgreSQL для 1С $($PgOld.Version) (служба $($PgOld.Service), порт $($PgOld.Port)) ниже $PgMajor — будет установлен PostgreSQL $PgMajor рядом$(if (-not $NoMovePgBases) { ', базы кластера 1С перенесены в него' }); старый с данными остаётся" }
    $PgSetupFile = if ($PgExisting) { $null } else { Find-PgSetup }
    if ($PgSetupFile -and $PgSetupFile.Name -match 'PostgreSQL_1C_(\d+)' -and [int]$Matches[1] -lt $PgMajor) { Warn "$($PgSetupFile.Name) — версия ниже $PgMajor, не используется"; $PgSetupFile = $null }
    # локального установщика нет — скачаем его на шаге 1 с -PgSetupUrl (здесь только узнаём имя, размер, SHA256)
    $PgSetupRemote = if ($PgExisting -or $PgSetupFile) { $null } else { Get-PgSetupRemote }
    if ($PgSetupRemote -and $PgSetupRemote.Name -match 'PostgreSQL_1C_(\d+)' -and [int]$Matches[1] -lt $PgMajor) { Warn "$($PgSetupRemote.Name) по -PgSetupUrl — версия ниже $PgMajor"; $PgSetupRemote = $null }
    $pgSetupName = if ($PgSetupFile) { $PgSetupFile.Name } elseif ($PgSetupRemote) { $PgSetupRemote.Name } else { '' }
    $PgMajorSetup = if ($pgSetupName -match 'PostgreSQL_1C_(\d+)') { $Matches[1] } else { '' }
    if (-not $PgExisting -and -not $pgSetupName -and $PgMajor -gt 15) {
        throw "Нужен PostgreSQL для 1С ${PgMajor}: нет ни установленного, ни установщика PostgreSQL_1C_$PgMajor*_Setup.exe в $BaseDir / рядом со скриптом, ни по -PgSetupUrl. Скачайте его вручную с $($PgSetupUrl[0]) и положите в $BaseDir (или -PgMajor 15 — архив 15.13)."
    }
    foreach ($p in $PgAll | Where-Object { -not $_.For1C }) { Warn "PostgreSQL $($p.Version) (служба $($p.Service), порт $($p.Port)) — не сборка для 1С, не используется" }
    if ($PgExisting) {
        $PgDataDir = $PgExisting.Data; $PgPort = $PgExisting.Port
        Ok "PostgreSQL для 1С уже установлен: $($PgExisting.Version), служба $($PgExisting.Service) ($($PgExisting.State)), порт $PgPort, данные $PgDataDir — будет использован"
    }
    elseif ($pgSetupName) {
        if (-not $PSBoundParameters.ContainsKey('PgDataDir')) { $PgDataDir = "$(Split-Path -Qualifier $BaseDir)\PostgreSQL 1C\$PgMajorSetup\data" }
        $from = if ($PgSetupFile) { $PgSetupFile.FullName } else { "{0} ({1:N0} МБ, будет скачан с {2})" -f $PgSetupRemote.Name, ($PgSetupRemote.Size / 1MB), $PgSetupRemote.Url }
        Ok "PostgreSQL для 1С не установлен — будет установлен из $from (данные: $PgDataDir)"
    }
    else {
        Warn "PostgreSQL для 1С не установлен, установщика PostgreSQL_1C_*_Setup.exe нет ни в $BaseDir, ни по -PgSetupUrl — будет архив $($Sources.Postgres.File) с Яндекс.Диска"
    }
    if ($PgExisting -or $pgSetupName) { $Sources.Remove('Postgres') }   # архив 15.13 не нужен — ни скачивания, ни места

    # =================================================================
    Step '0. Удаление прошлой установки'
    # PostgreSQL удаляется только с -ReinstallPostgres (вместе с данными). Кластер 1С (-SrvInfoDir) хранит регистрацию
    # баз — при сохранённом PostgreSQL он тоже сохраняется, иначе базы в PostgreSQL остались бы без регистрации.
    $pgRemove = $ReinstallPostgres
    $pgTargets = if ($pgRemove) { @($PgAll | Where-Object For1C) } else { @() }
    $oldProducts = Get-UninstallEntries | Where-Object {
        ($_.DisplayName -match '^1[CС]' -and $_.DisplayVersion -eq $PlatformVersion) -or
        ($pgRemove -and $_.DisplayName -like 'PostgreSQL*' -and ($_.DisplayName -like '*1C*' -or $_.DisplayVersion -like '15.*1C*'))
    }
    $ourPaths = @("1cv8\$PlatformVersion", $SrvInfoDir)
    if ($pgRemove) { $ourPaths += @('PostgreSQL\15*1C', 'PostgreSQL 1C\', $PgDataDir) + @($pgTargets | ForEach-Object { $_.Root; $_.Data }) }
    $isOurs = { param($path) foreach ($p in $ourPaths) { if ($p -and $path -and $path -like "*$p*") { return $true } }; $false }
    $oldServices = Get-CimInstance Win32_Service | Where-Object { & $isOurs $_.PathName }
    # распакованные исходники — не «прошлая установка»: удаляются только с -Redownload;
    # файловая база файлового варианта (install-1c.ps1) — только с -RemoveFileIb (источник для migrate-1c-pgsql.ps1)
    $srcDirs = if ($Redownload) { $Sources.Values | ForEach-Object { Join-Path $BaseDir $_.Dir } } else { @() }
    $fileIb = if ($RemoveFileIb) { @($FileIbDir) } else { @() }
    $keepCluster = [bool]($PgExisting -or $PgOld)   # базы кластера лежат в найденном PostgreSQL (или переносятся из старого)
    $pgDirs = if ($pgRemove) { @($PgDataDir) + @($pgTargets | ForEach-Object { $_.Data; $_.Root }) } else { @() }
    $oldDirs = @($pgDirs) + @($(if (-not $keepCluster) { $SrvInfoDir })) + @($fileIb) + @($srcDirs) |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
    if ($keepCluster -and (Test-Path $SrvInfoDir)) { Ok "кластер 1С $SrvInfoDir сохраняется (базы в найденном PostgreSQL остаются зарегистрированными)" }
    if ($pgRemove -and $pgTargets) { Warn "-ReinstallPostgres: PostgreSQL для 1С будет удалён ВМЕСТЕ С ДАННЫМИ: $(($pgTargets | ForEach-Object { "$($_.Service) ($($_.Data))" }) -join ', ')" }
    if (-not $RemoveFileIb -and (Test-Path (Join-Path $FileIbDir '1Cv8.1CD'))) {
        Ok "файловая база $FileIbDir сохраняется (удалить вместе с установкой: -RemoveFileIb)"
    }

    if (-not ($oldProducts -or $oldServices -or $oldDirs)) {
        Ok 'следов прошлой установки нет'
    }
    else {
        Write-Host '  Будет удалено:' -ForegroundColor Yellow
        $oldProducts | ForEach-Object { Write-Host "    программа: $($_.DisplayName) $($_.DisplayVersion)" }
        $oldServices | ForEach-Object { Write-Host "    служба:    $($_.Name)" }
        $oldDirs     | ForEach-Object { Write-Host "    каталог:   $_" }
        if ($pgRemove) { Write-Host '  ВНИМАНИЕ: данные баз PostgreSQL в этих каталогах будут потеряны.' -ForegroundColor Red }
        if ($RemoveFileIb -and (Test-Path $FileIbDir)) {
            Write-Host "  ВНИМАНИЕ: файловая база $FileIbDir (файловая установка) будет удалена (-RemoveFileIb)." -ForegroundColor Red
        }
        if (-not $Force) {
            if ((Read-Host '  Продолжить? (Y/N)') -notmatch '^[YyДд]') { throw 'Отменено пользователем' }
        }

        foreach ($s in $oldServices) {
            Write-Host "  Остановка и удаление службы $($s.Name)"
            Stop-Service -Name $s.Name -Force -ErrorAction SilentlyContinue
            & sc.exe delete "$($s.Name)" | Out-Null
        }
        Get-Process -ErrorAction SilentlyContinue | Where-Object { & $isOurs $_.Path } | ForEach-Object {
            Write-Host "  Завершение процесса $($_.Name) ($($_.Id))"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 3

        foreach ($prod in $oldProducts) {
            Write-Host "  Удаление $($prod.DisplayName)"
            if ($prod.PSChildName -match '^\{[0-9A-Fa-f-]+\}$') {
                $code = Invoke-Msi '/x' $prod.PSChildName '/qn' ("uninstall_{0}.log" -f ($prod.PSChildName -replace '[{}]'))
                if ($code -notin 0, 1605, 3010) { Warn "msiexec /x вернул $code" }
            }
            elseif ($prod.UninstallString -match '^"?([^"]+\\Uninstall\.exe)"?') {
                # NSIS (PostgreSQL для 1С от Postgres Professional): тихое удаление
                $u = Start-Process $Matches[1] -ArgumentList '/S' -Wait -PassThru
                if ($u.ExitCode -ne 0) { Warn "$($Matches[1]) /S вернул $($u.ExitCode)" }
            }
            else {
                Warn "не MSI-пакет, удалите вручную: $($prod.UninstallString)"
            }
        }

        # Локальный пользователь postgres, если его создал инсталлятор PostgreSQL и он больше нигде не используется
        $pgLocal = Get-LocalUser -Name 'postgres' -ErrorAction SilentlyContinue
        $usedBy = Get-CimInstance Win32_Service | Where-Object { $_.StartName -like '*\postgres' }
        if ($pgLocal -and -not $usedBy -and ($oldProducts | Where-Object { $_.DisplayName -like 'PostgreSQL*' })) {
            Remove-LocalUser -Name 'postgres'
            Ok 'локальный пользователь postgres удалён'
        }

        # плоский список: вложенный массив в @(..., (...)) удалялся бы одной строкой из нескольких путей
        $leftovers = @($oldDirs) +
        @($(if ($pgRemove) { Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -Filter '15*1C*' -ErrorAction SilentlyContinue | ForEach-Object FullName })) +
        @($ProgramRoots | ForEach-Object { Join-Path $_ "1cv8\$PlatformVersion" }) |
        Where-Object { $_ -and (Test-Path $_) }
        foreach ($d in $leftovers) {
            Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $d) { Warn "не удалось удалить $d (файлы заняты?)" } else { Ok "удалён каталог $d" }
        }
        Remove-IbFromList
        # остановить старый коллектор Redis-трассировки, если остался от прошлых установок
        cmd /c 'schtasks /End /TN pgtrace >nul 2>nul'
        cmd /c 'schtasks /Delete /TN pgtrace /F >nul 2>nul'
        Get-Process pgtrace -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Ok 'прошлая установка удалена'
    }

    # =================================================================
    Step '1. Проверка свободного места и архивов'
    if ($SkipSpaceCheck) { Warn 'проверка свободного места пропущена (-SkipSpaceCheck)' } else { Assert-FreeSpace }
    Write-Host '  -- Платформа 1С'
    $PlatformDir = Expand-Source $Sources.Platform
    if ($Sources.Contains('Postgres')) {
        Write-Host '  -- PostgreSQL 1C (архив)'
        $PgDistDir = Expand-Source $Sources.Postgres
    }
    elseif ($PgSetupRemote -and -not $PgSetupFile) {
        Write-Host '  -- PostgreSQL для 1С (установщик)'
        $PgSetupFile = Get-PgSetupDownload $PgSetupRemote
    }
    elseif ($PgSetupFile) {
        Write-Host '  -- PostgreSQL для 1С (установщик)'
        Ok ("установщик уже есть: {0} ({1:N0} МБ, подпись Postgres Professional) — скачивание не нужно" -f $PgSetupFile.FullName, ($PgSetupFile.Length / 1MB))
    }
    Write-Host '  -- Конфигурация "Автосервис"'
    $ConfDir = Expand-Source $Sources.Config

    # =================================================================
    if ($PgExisting) {
        Step "2. PostgreSQL $($PgExisting.Version) — уже установлен"
        $PgBin = $PgExisting.Bin
        if ($PgExisting.State -ne 'Running') {
            Write-Host "  Запуск службы $($PgExisting.Service)..."
            try { Start-Service -Name $PgExisting.Service } catch { throw "Служба $($PgExisting.Service) не запускается — смотрите $PgDataDir\log и журнал событий Windows" }
        }
        Ok "служба $($PgExisting.Service) работает: порт $PgPort, данные $PgDataDir, программа $PgBin — установка пропущена"
    }
    else {
        # Порт может быть занят другим PostgreSQL (например, обычным 17-м) — берём первый свободный
        $busy = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object LocalPort)
        if ($busy -contains $PgPort) {
            $free = ($PgPort + 1)..($PgPort + 20) | Where-Object { $busy -notcontains $_ } | Select-Object -First 1
            Warn "порт $PgPort занят другим процессом — PostgreSQL 1C будет на порту $free"
            $PgPort = $free
        }
        if ($PgSetupFile) {
            Step "2. Установка PostgreSQL для 1С из $($PgSetupFile.Name)"
            $PgBin = Install-PgFromSetup $PgSetupFile $PgMajorSetup
            $pgSvcName = "postgresql-1c-$PgMajorSetup"
        }
        else {
            Step '2. Установка PostgreSQL 15.13-1.1C (архив)'
            $pgMsi = Get-ChildItem $PgDistDir -Recurse -Filter '*.msi' | Select-Object -First 1
            if (-not $pgMsi) { throw "MSI PostgreSQL не найден в $PgDistDir" }
            # MSI ставит только программу: initdb внутри инсталлятора падает (например, на спецсимволах
            # пароля) и удаляет свой лог, а служба по умолчанию лезет на занятый порт 5432.
            # Кластер и службу создаём сами — ошибки initdb видны прямо в консоли.
            $code = Invoke-Msi '/i' $pgMsi.FullName "/qn INTERNALLAUNCH=1 DOSERVICE=0 DOINITDB=0 LISTENPORT=$PgPort" 'postgres_msi.log'
            if ($code -notin 0, 3010) { throw "Установка PostgreSQL завершилась с кодом $code (см. logs\postgres_msi.log)" }
            $PgBin = Find-PgBin
            if (-not $PgBin) { throw 'PostgreSQL установлен, но bin\pg_ctl.exe не найден' }
            $pgSvcName = 'postgresql-1c-15'
        }
        Ok "PostgreSQL: $PgBin"

        # Если инсталлятор всё же создал свою службу — убираем, чтобы не конфликтовала
        Get-CimInstance Win32_Service | Where-Object { $_.PathName -like "*$PgBin*" } | ForEach-Object {
            Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
            & sc.exe delete "$($_.Name)" | Out-Null
        }
        # Каталог данных с кластером, но без службы (например, после ручного удаления службы) — не затираем молча
        if ((Test-Path (Join-Path $PgDataDir 'PG_VERSION')) -and -not $ReinstallPostgres) {
            throw "В $PgDataDir уже есть кластер PostgreSQL без службы. Зарегистрируйте службу для него (pg_ctl register) или удалите каталог / запустите с -ReinstallPostgres."
        }

        # Сразу после установки postgres.exe может ещё не запускаться (проверка антивирусом,
        # фоновые действия инсталлятора) — initdb тогда падает с "no data was returned by command".
        Write-Host '  Ожидание готовности postgres.exe...'
        $ready = $false
        for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
            $ver = try { & (Join-Path $PgBin 'postgres.exe') -V 2>$null } catch { $null }
            if ($ver -match 'PostgreSQL') { $ready = $true } else { Start-Sleep -Seconds 2 }
        }
        if (-not $ready) { throw 'postgres.exe не запускается (антивирус? нет прав?) — попробуйте запустить его вручную с ключом -V' }

        Write-Host "  Инициализация кластера в $PgDataDir (порт $PgPort)"
        $pwFile = Join-Path $env:TEMP 'pgpw.txt'
        [IO.File]::WriteAllText($pwFile, $PgPasswordPlain, (New-Object Text.UTF8Encoding $false))
        try {
            for ($i = 1; $i -le 3; $i++) {
                if (Test-Path $PgDataDir) { Remove-Item $PgDataDir -Recurse -Force }
                & (Join-Path $PgBin 'initdb.exe') -D $PgDataDir -U $PgUser --pwfile=$pwFile -E UTF8 --locale=Russian_Russia -A md5
                $rc = $LASTEXITCODE
                if ($rc -eq 0) { break }
                Warn "initdb вернул $rc, повтор через 10 с (попытка $i из 3)"
                Start-Sleep -Seconds 10
            }
        }
        finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
        if ($rc -ne 0) { throw "initdb завершился с кодом $rc (сообщения выше)" }
        $conf = Join-Path $PgDataDir 'postgresql.conf'
        Add-Content $conf "`nport = $PgPort`nlisten_addresses = '*'"
        & icacls $PgDataDir /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null   # NETWORK SERVICE

        & (Join-Path $PgBin 'pg_ctl.exe') register -N $pgSvcName -U 'NT AUTHORITY\NetworkService' -D $PgDataDir -S auto -w
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось зарегистрировать службу PostgreSQL' }
        try { Start-Service -Name $pgSvcName }
        catch { throw "Служба $pgSvcName не запустилась — смотрите $PgDataDir\log и журнал событий Windows (Application)" }
        Ok "служба PostgreSQL: $pgSvcName (Running, порт $PgPort)"
    }

    # Ранняя проверка входа: ловим проблему с паролем здесь, а не на шаге 4
    $chk = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -Sql 'select 1' -PwPlain $PgPasswordPlain -Tuple
    if ($chk.Code -ne 0) {
        if ($PgExisting) { throw "Вход $PgUser в установленный PostgreSQL (служба $($PgExisting.Service), порт $PgPort) не проходит — введите пароль, заданный при его установке: $($chk.Out)" }
        throw "PostgreSQL запущен, но вход $PgUser не проходит: $($chk.Out)"
    }
    Ok "вход $PgUser на порт $PgPort проверен ($((Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -Sql 'show server_version' -PwPlain $PgPasswordPlain -Tuple).Out))"

    # =================================================================
    Step "3. Установка 1С:Предприятие $PlatformVersion"
    $msi1C = Get-ChildItem $PlatformDir -Recurse -Filter '1CEnterprise*.msi' | Select-Object -First 1
    if (-not $msi1C) { throw "MSI 1С не найден в $PlatformDir" }
    $msiDir = $msi1C.DirectoryName
    $mst = @('adminstallrelogon.mst', '1049.mst') | Where-Object { Test-Path (Join-Path $msiDir $_) }
    $transforms = if ($mst) { "TRANSFORMS=`"$($mst -join ';')`"" } else { '' }
    # ALLUSERS=1 — установка для всех пользователей (Program Files, HKLM, общие ярлыки «Пуск» и рабочего стола);
    # у MSI 1С по умолчанию ALLUSERS=2 — «для всех» только при запуске от администратора, здесь — всегда
    $args1C = "/qn ALLUSERS=1 $transforms DESIGNERALLCLIENTS=1 THICKCLIENT=1 THINCLIENTFILE=1 THINCLIENT=1 " +
    "WEBSERVEREXT=0 SERVER=1 SERVERCLIENT=1 CONFREPOSSERVER=0 CONVERTER77=0 LANGUAGES=RU"
    Push-Location $msiDir
    try { $code = Invoke-Msi '/i' $msi1C.FullName $args1C '1c_msi.log' } finally { Pop-Location }
    if ($code -notin 0, 3010) { throw "Установка 1С завершилась с кодом $code (см. logs\1c_msi.log)" }
    $Bin1C = Find-1CBin
    if (-not $Bin1C) { throw "1С установлена, но 1cv8.exe $PlatformVersion не найден" }
    Ok "1С: $Bin1C"

    $ragent = Join-Path $Bin1C 'ragent.exe'
    if (-not (Test-Path $ragent)) { throw "ragent.exe не найден — в дистрибутиве нет сервера 1С ($Bin1C)" }
    $agentSvc = Get-CimInstance Win32_Service | Where-Object { $_.PathName -like "*$Bin1C*ragent.exe*" } | Select-Object -First 1
    if (-not $agentSvc) {
        New-Item -ItemType Directory -Force -Path $SrvInfoDir | Out-Null
        $binPath = "`"$ragent`" -srvc -agent -regport 1541 -port 1540 -range 1560:1591 -d `"$SrvInfoDir`" -debug"
        New-Service -Name "1C:Enterprise 8.3 Server Agent $PlatformVersion" `
            -DisplayName "Агент сервера 1С:Предприятия 8.3 ($PlatformVersion)" `
            -BinaryPathName $binPath -StartupType Automatic | Out-Null
        $agentSvc = Get-CimInstance Win32_Service -Filter "Name='1C:Enterprise 8.3 Server Agent $PlatformVersion'"
    }
    if ($agentSvc.State -ne 'Running') { Start-Service -Name $agentSvc.Name }
    Ok "служба сервера 1С: $($agentSvc.Name) (Running)"
    # COM-соединитель этой платформы (сброс пароля «Администратора», seed): регистрация класса и библиотеки типов —
    # после переустановки старая регистрация указывает на удалённую платформу («Error in loading DLL»)
    $comDll = Join-Path $Bin1C 'comcntr.dll'
    if (Test-Path $comDll) {
        $regsvr = if ($Bin1C -like "${env:ProgramFiles(x86)}*") { "$env:WINDIR\SysWOW64\regsvr32.exe" } else { "$env:WINDIR\System32\regsvr32.exe" }
        $rp = Start-Process $regsvr -ArgumentList "/s `"$comDll`"" -Wait -PassThru
        if ($rp.ExitCode -eq 0) { Ok "COM-соединитель зарегистрирован: $comDll" } else { Warn "regsvr32 $comDll вернул $($rp.ExitCode)" }
    }
    Start-Sleep -Seconds 10   # даём кластеру подняться

    # =================================================================
    if (-not $NoTrace) {
        Step '3б. Технологический журнал (logcfg.xml)'
        New-Item -ItemType Directory -Force -Path $TechLogDir | Out-Null
        # ragent обычно работает как Local System; NETWORK SERVICE — на случай смены учётки
        & icacls $TechLogDir /grant '*S-1-5-18:(OI)(CI)F' /T /Q | Out-Null
        & icacls $TechLogDir /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null

        if (-not $LogcfgPath) { $LogcfgPath = Get-LogcfgPath $Bin1C }
        $bits = if ($Bin1C -like "${env:ProgramFiles(x86)}*") { 32 } else { 64 }
        Ok "платформа $bits-бит — logcfg.xml: $LogcfgPath"
        Remove-StrayLogcfg $LogcfgPath

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogcfgPath) | Out-Null
        # свой прошлый logcfg (в т.ч. от файлового варианта) просто перезаписываем; чужой — сохраняем копию
        if ((Test-Path $LogcfgPath) -and ((Get-Content $LogcfgPath -Raw -Encoding UTF8) -notmatch 'Сгенерировано install-1c')) {
            $bak = "$LogcfgPath.bak.{0:yyyyMMddHHmmss}" -f (Get-Date)
            Copy-Item $LogcfgPath $bak -Force
            Ok "старый logcfg сохранён: $bak"
        }

        # duration в logcfg — в стотысячных долях секунды (10000 = 1 с) → N мс = N*10
        $durationUnits = [math]::Max(0, $TechLogThresholdMs) * 10
        $logcfgXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<!-- Сгенерировано install-1c-pgsql.ps1: ТЖ DBPOSTGRS >= $TechLogThresholdMs мс -> $TechLogDir -->
<config xmlns="http://v8.1c.ru/v8/tech-log">
  <log location="$TechLogDir" history="24">
    <event>
      <eq property="name" value="DBPOSTGRS"/>
      <ge property="duration" value="$durationUnits"/>
    </event>
    <property name="all"/>
  </log>
</config>
"@
        [IO.File]::WriteAllText($LogcfgPath, $logcfgXml, (New-Object Text.UTF8Encoding $false))
        Ok "записан $LogcfgPath (порог DBPOSTGRS $TechLogThresholdMs мс, каталог $TechLogDir)"

        Write-Host "  Перезапуск службы $($agentSvc.Name) для применения logcfg..."
        Restart-Service -Name $agentSvc.Name -Force
        Start-Sleep -Seconds 3
        if (-not (Wait-LocalPorts -Ports @(1540, 1541) -TimeoutSec 90)) {
            Warn 'порты 1540/1541 не поднялись за 90 с после рестарта агента — проверьте службу вручную'
        }
        else {
            Ok 'агент 1С снова слушает 1540/1541'
        }
    }
    else {
        Warn 'технологический журнал пропущен (-NoTrace)'
    }

    # =================================================================
    #  3в. Базы кластера 1С, лежащие в старом PostgreSQL (ниже -PgMajor), -> новый: pg_dump / pg_restore и переключение
    #  регистрации базы в кластере на новый порт. Старый PostgreSQL и его данные не трогаются (откат — вернуть порт).
    if ($PgOld -and -not $NoMovePgBases -and -not $SourceDump) {
        Step "3в. Перенос баз 1С: PostgreSQL $($PgOld.Version) (порт $($PgOld.Port)) -> $PgMajorSetup (порт $PgPort)"
        try {
            $cl = Get-ClusterId
            $ibUsers = @($(if ($IbUser) { $IbUser }), '', 'Админ', 'Администратор', 'Автосервис') | Select-Object -Unique
            foreach ($b in @(Get-ClusterIbs $cl)) {
                $info = Get-IbInfo $cl $b.Id $ibUsers
                if (-not $info) { Warn "база $($b.Name): нет входа пользователем без пароля ($(($ibUsers | Where-Object { $_ }) -join ', ')) — не переносится"; continue }
                $srv = "$($info['db-server'])"; $db = "$($info['db-name'])"
                $port = if ($srv -match 'port\s*=\s*(\d+)') { [int]$Matches[1] } else { 5432 }
                if ($info['dbms'] -ne 'PostgreSQL' -or $port -ne $PgOld.Port) { Ok "база $($b.Name): $($info['dbms']) «$srv» — переносить не нужно"; continue }
                $inNew = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain -Sql "SELECT 1 FROM pg_database WHERE datname='$db'" -Tuple).Out -eq '1'
                [void](Set-IbJobsDeny $cl $b.Id $info.User '' $true)
                try {
                    if ($inNew) { Ok "БД $db уже есть в PostgreSQL $PgMajorSetup — копирование пропущено" }
                    else {
                        $loc = (Invoke-Psql -Bin $PgOld.Bin -Port $PgOld.Port -User $PgUser -Db postgres -PwPlain $PgPasswordPlain -Sql "SELECT datcollate FROM pg_database WHERE datname='$db'" -Tuple).Out
                        if (-not $loc) { $loc = 'Russian_Russia.1251' }
                        $dump = Join-Path $BaseDir "pgmove_$db.dump"
                        $t0m = Get-Date
                        Write-Host "  $($b.Name): pg_dump из $($PgOld.Version) ..."
                        $env:PGPASSWORD = $PgPasswordPlain
                        & (Join-Path $PgBin 'pg_dump.exe') -w -h 127.0.0.1 -p $PgOld.Port -U $PgUser -Fc -Z 1 -f $dump $db
                        if ($LASTEXITCODE) { throw "pg_dump $db из PostgreSQL $($PgOld.Version) не выполнен" }
                        $c = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain -Sql "CREATE DATABASE `"$db`" WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = '$loc'"
                        if ($c.Code) { throw "CREATE DATABASE ${db}: $($c.Out)" }
                        Write-Host ("  $($b.Name): pg_restore в {0} ({1:N0} МБ) ..." -f $PgMajorSetup, ((Get-Item $dump).Length / 1MB))
                        $env:PGPASSWORD = $PgPasswordPlain
                        & (Join-Path $PgBin 'pg_restore.exe') -w -h 127.0.0.1 -p $PgPort -U $PgUser -d $db --no-owner -j 4 $dump
                        if ($LASTEXITCODE) { throw "pg_restore $db в PostgreSQL ${PgMajorSetup}: код $LASTEXITCODE" }
                        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
                        Remove-Item $dump -Force -ErrorAction SilentlyContinue
                        Ok ("БД $db скопирована в PostgreSQL $PgMajorSetup за {0:N0} мин" -f ((Get-Date) - $t0m).TotalMinutes)
                    }
                    $u = Invoke-Rac infobase update "--cluster=$cl" "--infobase=$($b.Id)" "--infobase-user=$($info.User)" '--infobase-pwd=' `
                        "--db-server=localhost port=$PgPort" "--db-user=$PgUser" "--db-pwd=$PgPasswordPlain"
                    if ($u.Code) { throw "регистрация базы $($b.Name) не переключена: $(Hide-PgPassword ($u.Out -join ' '))" }
                    Ok "база $($b.Name): кластер 1С -> PostgreSQL $PgMajorSetup (localhost port=$PgPort); в $($PgOld.Version) осталась копия"
                }
                finally {
                    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
                    [void](Set-IbJobsDeny $cl $b.Id $info.User '' $false)
                }
            }
        }
        finally { Stop-Rac }
    }

    # =================================================================
    Step "4. Создание информационной базы '$IbName'"
    $v8 = Join-Path $Bin1C '1cv8.exe'
    $ibPath = "$Server1C\$IbName"
    # =================================================================
    #  Ветка «источник — дамп PostgreSQL». Она полностью заменяет шаг 4
    #  (выбор .dt/.cf/1Cv8.1CD, /RestoreIB, CREATEINFOBASE). Всё, что
    #  относится к .dt, ниже пропускается по $skipDtPath.
    # =================================================================
    $skipDtPath = $false
    if ($SourceDump) {
        Step "4. Восстановление базы '$IbName' из дампа PostgreSQL"
        if (-not (Test-Path -LiteralPath $SourceDump)) { throw "Дамп не найден: $SourceDump" }
        $dumpFile = Get-Item -LiteralPath $SourceDump
        Ok ("источник: {0} ({1:N0} МБ, от {2:dd.MM.yyyy HH:mm})" -f `
                $dumpFile.FullName, ($dumpFile.Length / 1MB), $dumpFile.LastWriteTime)

        # --- 1. Есть ли уже БД $IbName в PostgreSQL? ---
        $exists = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain `
                -Sql "SELECT 1 FROM pg_database WHERE datname='$IbName'" -Tuple).Out -eq '1'
        if ($exists) {
            $cfgRows = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db $IbName -PwPlain $PgPasswordPlain `
                    -Sql "SELECT CASE WHEN to_regclass('public.config') IS NULL THEN -1 ELSE (SELECT count(*) FROM config) END" -Tuple).Out
            if ($cfgRows -match '^\d+$' -and [int]$cfgRows -ge 1000) {
                Ok "БД '$IbName' уже есть в PostgreSQL и непустая (config: $cfgRows строк) — восстановление пропущено"
            }
            else {
                Warn "БД '$IbName' есть, но пустая или неполная (config: $cfgRows) — удаляю и создаю заново"
                $drop = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain `
                    -Sql ("ALTER DATABASE `"$IbName`" ALLOW_CONNECTIONS false; " +
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$IbName' AND pid <> pg_backend_pid(); " +
                    "DROP DATABASE `"$IbName`";")
                if ($drop.Code) { throw "Не удалось удалить БД $IbName (есть активные сеансы?): $($drop.Out)" }
                $exists = $false
            }
        }
        if (-not $exists) {
            # --- 2. Создать пустую БД ---
            $c = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain `
                -Sql "CREATE DATABASE `"$IbName`" WITH TEMPLATE = template0 ENCODING = 'UTF8'"
            if ($c.Code) { throw "CREATE DATABASE ${IbName}: $($c.Out)" }
            Ok "создана пустая БД $IbName"

            # --- 3. pg_restore ---
            $t0 = Get-Date
            Write-Host ("  pg_restore -> {0} ({1:N0} МБ, может занять несколько минут)..." -f $IbName, ($dumpFile.Length / 1MB))
            $env:PGPASSWORD = $PgPasswordPlain
            try {
                & (Join-Path $PgBin 'pg_restore.exe') -w -h 127.0.0.1 -p $PgPort -U $PgUser `
                    -d $IbName --no-owner --no-privileges -j 4 $dumpFile.FullName
                $rc = $LASTEXITCODE
            }
            finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
            if ($rc -ne 0) { throw "pg_restore завершился с кодом $rc (сообщения выше). База '$IbName' может быть неполной — удалите её и запустите снова." }
            Ok ("дамп восстановлен за {0:N0} мин" -f ((Get-Date) - $t0).TotalMinutes)
        }

        # --- 4. Регистрация БД в кластере 1С: через rac, без CREATEINFOBASE ---
        Start-Rac
        $cl = Get-ClusterId
        if (-not $cl) { throw "Кластер 1С не найден (ragent слушает 1540?) — проверьте службу агента" }
        $ib = Get-ClusterIbs $cl | Where-Object Name -eq $IbName | Select-Object -First 1
        if (-not $ib) {
            # Если записи нет — создаём её временным CREATEINFOBASE с CrSQLDB=N (БД уже создана).
            # Имя занято — 1С ответит ошибкой, но запись уже будет; ошибку глушим и проверяем через rac.
            $conn = "Srvr=`"$Server1C`";Ref=`"$IbName`";DBMS=PostgreSQL;DBSrvr=`"localhost port=$PgPort`";" +
            "DB=`"$IbName`";DBUID=`"$PgUser`";DBPwd=`"$PgPasswordPlain`";CrSQLDB=N;SchJobDn=N;Locale=ru"
            $connArg = "`"$($conn -replace '"','""')`""
            Write-Host "  Регистрация базы '$IbName' в кластере 1С..."
            try { Invoke-1C "CREATEINFOBASE $connArg" 'create' -Title 'Регистрация базы в кластере' }
            catch { Warn "CREATEINFOBASE вернул ошибку (база могла быть уже зарегистрирована): $($_.Exception.Message)" }
            $ib = Get-ClusterIbs $cl | Where-Object Name -eq $IbName | Select-Object -First 1
            if (-not $ib) { throw "База '$IbName' не появилась в кластере после CREATEINFOBASE — проверьте вручную через rac" }
            Ok "база '$IbName' зарегистрирована в кластере 1С"
        }
        else {
            Ok "база '$IbName' уже зарегистрирована в кластере 1С"
        }

        # --- 5. Переключить регистрацию на наш порт/БД ---
        $ibUsers = @($(if ($IbUser) { $IbUser }), '', 'Админ', 'Администратор', 'Автосервис') | Select-Object -Unique
        $info = Get-IbInfo $cl $ib.Id $ibUsers
        if (-not $info) {
            Warn "не удалось прочитать свойства базы '$IbName' через rac (нет входа без пароля с правами администратора ИБ)"
        }
        else {
            $curSrv = "$($info['db-server'])"
            $curDb = "$($info['db-name'])"
            $curUser = "$($info['db-user'])"
            $curPort = if ($curSrv -match 'port\s*=\s*(\d+)') { [int]$Matches[1] } else { 5432 }
            if ($curPort -ne $PgPort -or $curDb -ne $IbName -or $curUser -ne $PgUser) {
                Write-Host "  Регистрация: $curSrv / db=$curDb / user=$curUser -> localhost port=$PgPort / db=$IbName / user=$PgUser"
                $u = Invoke-Rac infobase update "--cluster=$cl" "--infobase=$($ib.Id)" `
                    "--infobase-user=$($info.User)" '--infobase-pwd=' `
                    "--db-server=localhost port=$PgPort" "--db-user=$PgUser" "--db-pwd=$PgPasswordPlain"
                if ($u.Code) { throw "Не удалось переключить регистрацию базы: $(Hide-PgPassword ($u.Out -join ' '))" }
                Ok "регистрация базы переключена на localhost port=$PgPort / db=$IbName"
            }
            else {
                Ok "регистрация базы уже указывает на localhost port=$PgPort / db=$IbName"
            }
        }
        Stop-Rac

        # --- 6. Маркер источника ---
        Set-Content (Join-Path $LogDir "ib_$IbName.source") `
        ("{0}|{1}|{2:yyyy-MM-dd HH:mm:ss}" -f $dumpFile.FullName, $dumpFile.Length, $dumpFile.LastWriteTime) -Encoding UTF8
        Add-ServerIbToList
        Ok "база готова: $ibPath ($IbTitle)"
        $skipDtPath = $true
    }

    if (-not $skipDtPath) {
        # Пользователь 1С (если в базе есть список пользователей) — нужен для выгрузки и проверки
        $ibAuth = ''
        if ($IbUser) {
            $ibPwdPlain = if ($IbPassword) { (New-Object Net.NetworkCredential('', $IbPassword)).Password } else { '' }
            $ibAuth = "/N `"$IbUser`" /P `"$ibPwdPlain`""
        }

        # Пакетный 1cv8. Долгие операции (-Title) показывают ход: время, объём, процент и ожидаемое окончание.
        # -Progress — scriptblock, возвращающий @{ Done = байт; Total = байт (оценка) }; без него — только время.
        # Ошибка входа (пользователь/пароль) в логе последнего запуска 1С с этим тегом
        function Test-AuthErrorLog([string]$Tag) {
            $log = Join-Path $LogDir "1c_$Tag.log"
            (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
        }

        function Invoke-1C([string]$ArgsLine, [string]$Tag, [string]$Title, [scriptblock]$Progress, [int]$EveryS = 20) {
            $out = Join-Path $LogDir "1c_$Tag.log"
            $res = Join-Path $LogDir "1c_$Tag.result"
            Remove-Item $res -ErrorAction SilentlyContinue
            $p = Start-Process $v8 -ArgumentList "$ArgsLine /DisableStartupDialogs /DisableStartupMessages /Out `"$out`" /DumpResult `"$res`"" -PassThru
            $t0 = Get-Date
            if ($Title) { Write-Host ("  {0}: начало {1:HH:mm:ss}" -f $Title, $t0) }
            while (-not $p.WaitForExit($EveryS * 1000)) {
                if (-not $Title) { continue }
                $el = (Get-Date) - $t0
                $line = "    … {0:hh\:mm\:ss} прошло" -f $el
                $pr = $null
                if ($Progress) { try { $pr = & $Progress } catch { $pr = $null } }
                if ($pr -and $pr.Done -gt 0 -and $pr.Total -gt 0) {
                    $pct = [math]::Min(99, [math]::Floor(100 * $pr.Done / $pr.Total))
                    $line += ", {0:N0} из ~{1:N0} МБ ({2}%)" -f ($pr.Done / 1MB), ($pr.Total / 1MB), $pct
                    if ($pct -ge 3) {
                        $eta = $t0.AddSeconds($el.TotalSeconds * 100 / $pct)
                        $line += ", окончание ≈ {0:HH:mm} (ещё ~{1:N0} мин)" -f $eta, [math]::Max(1, ($eta - (Get-Date)).TotalMinutes)
                    }
                }
                Write-Host $line
            }
            if ($Title) { Write-Host ("  {0}: завершено за {1:hh\:mm\:ss}" -f $Title, ((Get-Date) - $t0)) }
            Clear-PgPasswordInFile $out                               # CREATEINFOBASE пишет в лог строку соединения с паролем
            $code = if (Test-Path $res) { (Get-Content $res -Raw).Trim() } else { '-1' }
            if ($code -ne '0') {
                if (Test-Path $out) { Get-Content $out -Encoding UTF8 | ForEach-Object { Write-Host (Hide-PgPassword $_) } }
                throw "1С ($Tag) завершилась с кодом $code, лог: $out"
            }
        }

        $extBaked = $false   # расширение уже встроено в .dt (применено к файловой базе до миграции)
        $dtPath = $null    # .dt, выгруженный из файловой базы (остаётся резервной копией для повторных запусков)
        # Приоритет — база из autoservice.zip (1Cv8.1CD в $ConfDir): в ней больше всего данных.
        #  1) её выгрузка этим скриптом (<IbName>.dt + метка .src/.ext) — берём, выгрузка долгая;
        #  2) иначе выгружаем базу из архива заново;
        #  3) .dt/.cf, лежащие в архиве, — только если 1Cv8.1CD в архиве нет. Посторонние .dt не используются.
        # 0) ВЫШЕ ВСЕГО — бэкап рабочей базы в -BaseDir («бэкап 20260805.dt» и более свежие): самая полная и свежая база.
        $backupDt = if ($NoBackupDt -or $SourceDump) { $null } else { Find-BackupDt }
        $zipDb = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.1CD' | Where-Object Length -gt 0 | Select-Object -First 1
        $ourDt = Join-Path $ConfDir "$IbName.dt"
        $ourDtOk = (Test-Path $ourDt) -and ((Test-Path "$ourDt.src") -or (Test-Path "$ourDt.ext")) -and (Get-Item $ourDt).Length -gt 0
        if ($backupDt) {
            $cfFile = $backupDt.File
            Ok ("источник — бэкап рабочей базы: {0} ({1:N0} МБ, от {2:dd.MM.yyyy}) — приоритет над {3}" -f $cfFile.FullName, ($cfFile.Length / 1MB), $backupDt.Date, $Sources.Config.File)
            foreach ($o in $backupDt.Older) { Write-Host ("  более старый бэкап не используется: {0} ({1:dd.MM.yyyy})" -f $o.File.Name, $o.Date) }
            $SourceIsBackup = $true
        }
        elseif ($zipDb) {
            Ok ("база из {0}: {1} ({2:N0} МБ) — основной источник" -f $Sources.Config.File, $zipDb.FullName, ($zipDb.Length / 1MB))
            $cfFile = if ($ourDtOk) { Get-Item $ourDt } else { $null }
            $foreign = Get-ChildItem $ConfDir -Recurse -Include '*.dt', '*.cf' | Where-Object { $_.FullName -ne $ourDt }
            foreach ($x in $foreign) { Warn "$($x.FullName) — не выгрузка базы из $($Sources.Config.File), не используется" }
        }
        else {
            $cfFile = Get-ChildItem $ConfDir -Recurse -Include '*.dt', '*.cf' | Sort-Object { $_.Extension -ne '.dt' } | Select-Object -First 1
            if ($cfFile) { Ok "в $($Sources.Config.File) нет 1Cv8.1CD — источник: $($cfFile.Name) из архива" }
        }
        if ($cfFile -and $cfFile.Extension -eq '.dt' -and -not $backupDt) {
            Ok ("найдена выгрузка этой базы: {0} ({1:N0} МБ, от {2:dd.MM.yyyy HH:mm}) — повторная выгрузка не нужна" -f
                $cfFile.FullName, ($cfFile.Length / 1MB), $cfFile.LastWriteTime)
            $extMark = "$($cfFile.FullName).ext"
            if ($Exts -and (Test-Path $extMark)) {
                $was = (Get-Content $extMark -Raw).Trim() -replace "`r", ''
                if ($was -eq (Get-ExtSignature $Exts)) {
                    $extBaked = $true
                    Ok "в .dt уже встроены расширения: $(($Exts | ForEach-Object { Split-Path -Leaf $_.File }) -join ', ')"
                }
                else { Warn "в .dt другой набор расширений — $(($Exts | ForEach-Object Name) -join ', ') будут загружены на сервере" }
            }
            Write-Host '  (выгрузить заново: удалите этот .dt или запустите с -Redownload)'
        }
        elseif (-not $cfFile -and $zipDb) {
            Write-Host "  Выгрузки базы из $($Sources.Config.File) ещё нет — выгружаю её в .dt"
        }
        if (-not $cfFile) {
            # Файловая база (1Cv8.1CD) — сюда встраиваем расширение и выгружаем в .dt вместе с данными
            $fileDb = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.1CD' | Select-Object -First 1
            if ($fileDb) {
                $fdir = $fileDb.DirectoryName
                $dtPath = Join-Path $ConfDir "$IbName.dt"
                Write-Host "  Найдена файловая база: $fdir"

                # Расширение выгодно применить здесь, к файловой базе: доступ монопольный,
                # фоновых заданий нет. Тогда .dt уже содержит расширение и на сервере
                # не потребуется UpdateDBCfg (который упирается в блокировку фоновыми заданиями).
                $applyExt = [bool]$Exts
                $ext0 = if ($applyExt) { $Exts[0] } else { $null }

                # Первая операция служит и проверкой входа: LoadCfg первого расширения (если есть) либо сразу DumpIB.
                # Подбор пользователя: заданный -> без пользователя -> Админ/Администратор -> запрос (3 раза).
                $tries = if ($ibAuth) { @($ibAuth) } else { @('', '/N "Админ" /P ""', '/N "Администратор" /P ""') }
                $firstOp = if ($applyExt) { "/LoadCfg `"$($ext0.File)`" -Extension `"$($ext0.Name)`"" } else { "/DumpIB `"$dtPath`"" }
                $firstTag = if ($applyExt) { 'ext_load' } else { 'dumpib' }
                # ход выгрузки: размер .dt против оценки (~55% от 1Cv8.1CD — по замерам «Автосервиса»: 1,8 ГБ -> 1 011 МБ)
                $dumpProgress = { @{ Done = [double](Get-Item $dtPath -ErrorAction SilentlyContinue).Length; Total = [double]$fileDb.Length * 0.55 } }
                $firstTitle = if ($applyExt) { "Подключение расширения $($ext0.Name)" } else { 'Выгрузка в .dt' }
                $firstProg = if ($applyExt) { $null } else { $dumpProgress }
                if ($applyExt) { Write-Host "  Подключение расширений к файловой базе: $(($Exts | ForEach-Object Name) -join ', ')..." }
                else { Write-Host '  Выгрузка в .dt (может занять несколько минут)...' }
                $done = $false
                for ($i = 0; -not $done; $i++) {
                    if ($i -lt $tries.Count) { $auth = $tries[$i] }
                    elseif ($i -lt $tries.Count + 3) {
                        Warn 'нужен пользователь 1С с правами администратора в базе "Автосервис"'
                        $u = Read-Host '  Имя пользователя 1С'
                        $pw = Read-Host -AsSecureString '  Пароль (Enter — пустой)'
                        $ibPwdPlain = (New-Object Net.NetworkCredential('', $pw)).Password
                        $auth = "/N `"$u`" /P `"$ibPwdPlain`""
                    }
                    else { throw 'Не удалось войти в файловую базу — нужны имя и пароль пользователя 1С с правами администратора' }
                    try {
                        Invoke-1C "DESIGNER /F `"$fdir`" $auth $firstOp" $firstTag -Title $firstTitle -Progress $firstProg
                        $done = $true
                        $ibAuth = $auth   # тот же пользователь окажется и в серверной базе после загрузки
                    }
                    catch {
                        $log = Join-Path $LogDir "1c_$firstTag.log"
                        $authError = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
                        if (-not $authError) { throw }
                    }
                }
                if ($applyExt) {
                    # применяем расширения к файловой базе (монопольно, фоновых заданий нет) и выгружаем один раз
                    foreach ($e in $Exts) {
                        if ($e -ne $ext0) { Invoke-1C "DESIGNER /F `"$fdir`" $ibAuth /LoadCfg `"$($e.File)`" -Extension `"$($e.Name)`"" 'ext_load' -Title "Подключение расширения $($e.Name)" }
                        Invoke-1C "DESIGNER /F `"$fdir`" $ibAuth /UpdateDBCfg -Extension `"$($e.Name)`"" 'ext_apply' -Title "Применение расширения $($e.Name)"
                        Ok "расширение $($e.Name) ($(Split-Path -Leaf $e.File)) встроено в базу до миграции"
                    }
                    $extBaked = $true
                    Write-Host '  Выгрузка в .dt (может занять несколько минут)...'
                    Invoke-1C "DESIGNER /F `"$fdir`" $ibAuth /DumpIB `"$dtPath`"" 'dumpib' -Title 'Выгрузка в .dt' -Progress $dumpProgress
                }
                # какое расширение встроено в .dt — чтобы повторный запуск мог взять .dt как есть
                # .src — выгрузка сделана из базы архива (иначе такой .dt на повторном запуске не берётся)
                Set-Content "$dtPath.src" ("{0}|{1}|{2:yyyy-MM-dd HH:mm:ss}" -f $Sources.Config.File, $fileDb.FullName, (Get-Date)) -Encoding UTF8
                if ($extBaked) {
                    Set-Content "$dtPath.ext" (Get-ExtSignature $Exts) -Encoding UTF8
                }
                else { Remove-Item "$dtPath.ext" -ErrorAction SilentlyContinue }
                Ok ("выгружено: {0} ({1:N0} МБ) — остаётся резервной копией для повторных запусков" -f $dtPath, ((Get-Item $dtPath).Length / 1MB))
                $cfFile = Get-Item $dtPath
            }
        }
        if (-not $cfFile) {
            # Шаблон (setup.exe + *.efd) — тихо ставим его в папку конфигурации
            $setup = Get-ChildItem $ConfDir -Recurse -Filter 'setup.exe' | Select-Object -First 1
            if ($setup -and (Get-ChildItem $setup.DirectoryName -Filter '*.efd')) {
                Write-Host '  Найден шаблон конфигурации, тихая установка шаблона...'
                Start-Process $setup.FullName -ArgumentList "/s /d `"$(Join-Path $ConfDir 'tmplts')`"" -Wait
                $cfFile = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.cf' | Select-Object -First 1
            }
        }
        if (-not $cfFile) { throw "В $ConfDir не найдены .dt/.cf/1Cv8.1CD" }
        Ok ("источник базы: {0} ({1:N0} МБ)" -f $cfFile.FullName, ($cfFile.Length / 1MB))
        # ход загрузки .dt: рост БД в PostgreSQL против оценки (~1,65 x .dt — замер: бэкап 1 161 МБ -> БД 1 893 МБ)
        $restoreProgress = {
            $sz = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain -Sql "SELECT pg_database_size('$IbName')" -Tuple).Out
            @{ Done = $(if ($sz -match '^\d+$') { [double]$sz } else { 0 }); Total = [double]$cfFile.Length * 1.65 }
        }

        $exists = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain `
                -Sql "SELECT 1 FROM pg_database WHERE datname='$IbName'" -Tuple).Out -eq '1'
        # Есть, но пустая: прошлый запуск создал базу и прервался до загрузки .dt (конфигурация пустой базы —
        # десятки строк в таблице config, загруженной УНФ — десятки тысяч) — загружаем, а не пропускаем
        # Какой источник загружен в базу — пишется после каждой загрузки (logs\ib_<IbName>.source). Бэкап сменился
        # (появился или стал свежее) — база уже есть: спросить, загрузить ли его поверх (-ReloadIb — без вопроса).
        $srcSig = "{0}|{1}|{2:yyyy-MM-dd HH:mm:ss}" -f $cfFile.FullName, $cfFile.Length, $cfFile.LastWriteTime
        $stateFile = Join-Path $LogDir "ib_$IbName.source"
        $loadedSig = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { '' }
        $emptyIb = $false
        if ($exists -and $cfFile.Extension -ne '.cf') {
            $cfgRows = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db $IbName -PwPlain $PgPasswordPlain `
                    -Sql 'SELECT count(*) FROM config' -Tuple).Out
            $emptyIb = ($cfgRows -match '^\d+$') -and ([int]$cfgRows -lt 1000)
        }
        if ($emptyIb) {
            Warn "база '$IbName' есть в PostgreSQL, но пустая (конфигурация: $cfgRows записей) — загружаю $($cfFile.Name)"
            Invoke-1C "DESIGNER /S `"$ibPath`" /RestoreIB `"$($cfFile.FullName)`"" 'restore' -Title 'Загрузка .dt в базу на сервере' -Progress $restoreProgress -EveryS 30
            Set-Content $stateFile $srcSig -Encoding UTF8
            Add-ServerIbToList
            Ok "база загружена: $ibPath"
        }
        elseif ($exists -and $SourceIsBackup -and $loadedSig -ne $srcSig) {
            $was = if ($loadedSig) { Split-Path -Leaf ($loadedSig -replace '\|.*$') } else { 'неизвестно (загружена до этой версии скрипта)' }
            Warn "база '$IbName' уже есть, но в ней не $($cfFile.Name) (загружено: $was)"
            $reload = $ReloadIb -or ((Read-Host "  Загрузить $($cfFile.Name) поверх базы '$IbName'? Все данные в ней будут заменены (Y/N)") -match '^[YyДд]')
            if ($reload) {
                # загрузка поверх — под пользователем существующей базы: без пользователя -> Админ / Администратор / Автосервис
                $reloaded = $false
                foreach ($a in @($(if ($ibAuth) { $ibAuth }), '', '/N "Админ" /P ""', '/N "Администратор" /P ""', '/N "Автосервис" /P ""') | Select-Object -Unique) {
                    try {
                        Invoke-1C "DESIGNER /S `"$ibPath`" $a /RestoreIB `"$($cfFile.FullName)`"" 'restore' -Title "Загрузка $($cfFile.Name) поверх базы" -Progress $restoreProgress -EveryS 30
                        $reloaded = $true; break
                    }
                    catch { if (-not (Test-AuthErrorLog 'restore')) { throw } }
                }
                if (-not $reloaded) { throw "Не удалось войти в базу '$IbName' для загрузки (нужен пользователь без пароля с правами администратора) — или удалите базу и запустите снова" }
                Set-Content $stateFile $srcSig -Encoding UTF8
                Ok "база '$IbName' заменена содержимым $($cfFile.Name)"
            }
            else { Ok "база '$IbName' оставлена как есть (загрузить бэкап позже: -ReloadIb)" }
            Add-ServerIbToList
        }
        elseif ($exists) {
            Ok "база '$IbName' уже есть в PostgreSQL — создание пропущено$(if ($loadedSig -eq $srcSig) { " (в ней уже $($cfFile.Name))" })"
            Add-ServerIbToList
        }
        else {
            $conn = "Srvr=`"$Server1C`";Ref=`"$IbName`";DBMS=PostgreSQL;DBSrvr=`"localhost port=$PgPort`";DB=`"$IbName`";" +
            "DBUID=`"$PgUser`";DBPwd=`"$PgPasswordPlain`";CrSQLDB=Y;SchJobDn=N;Locale=ru"
            $connArg = "`"$($conn -replace '"','""')`""
            if (-not $SkipSpaceCheck) {
                # Загрузка .dt в PostgreSQL кратно раздувается (индексы, WAL) — проверяем диск базы
                $dtGB = [math]::Round($cfFile.Length / 1GB, 1)
                $needGB = [math]::Round($dtGB * 3 + 2, 1)
                $freeGB = Get-FreeGB "$PgDataDir\"
                if ($freeGB -lt $needGB) {
                    throw "Для загрузки базы на диске $((Split-Path -Qualifier $PgDataDir)) нужно ~$needGB ГБ (.dt = $dtGB ГБ), свободно $freeGB ГБ. Освободите место."
                }
                Ok "место под базу: нужно ~$needGB ГБ, свободно $freeGB ГБ"
            }
            # без /AddToList: при занятом имени в списке баз 1С возвращает ошибку уже после создания базы
            if ($cfFile.Extension -eq '.cf') {
                Invoke-1C "CREATEINFOBASE $connArg /UseTemplate `"$($cfFile.FullName)`"" 'create' -Title 'Создание базы из шаблона'
            }
            else {
                Invoke-1C "CREATEINFOBASE $connArg" 'create' -Title 'Создание пустой базы в кластере и PostgreSQL'
                Invoke-1C "DESIGNER /S `"$ibPath`" /RestoreIB `"$($cfFile.FullName)`"" 'restore' -Title 'Загрузка .dt в базу на сервере' -Progress $restoreProgress -EveryS 30
            }
            Set-Content $stateFile $srcSig -Encoding UTF8
            Add-ServerIbToList
            Ok "база создана: $ibPath"
        }
        # .dt не удаляем: это резервная копия, повторный запуск возьмёт её и не будет выгружать файловую базу заново
        if ($cfFile.Extension -eq '.dt') { Ok ("резервная копия сохранена: {0} ({1:N0} МБ)" -f $cfFile.FullName, ($cfFile.Length / 1MB)) }
    }

    # =================================================================
    #  Пустой пароль «Администратора» и пользователь для конфигуратора/запуска. Вход проверяется на самой базе
    #  на сервере: у бэкапа рабочей базы свои пользователи (там «Администратор» с паролем, «Автосервис» без пароля).
    Step "4в. Пользователь «$AdminUser»: пустой пароль"
    $LaunchUser = 'Админ'
    if ($AdminUser) {
        $rs = Reset-IbUserPassword "Srvr=`"$Server1C`";Ref=`"$IbName`";" $AdminUser
        if (-not $rs -or -not $rs.LOGIN -or $rs.LOGIN -like 'ERR*') {
            Warn "вход в базу через COM не удался ($(if ($rs) { $rs.LOGIN })) — пароль «$AdminUser» не изменён"
        }
        else {
            Ok "вход в базу: «$($rs.LOGIN)»; пользователи: $($rs.USERS)"
            switch -Wildcard ($rs.RESET) {
                'OK' { Ok "пароль «$AdminUser» сброшен — теперь пустой" }
                'ALREADY' { Ok "у «$AdminUser» пароль уже пустой" }
                'NOUSER' { Warn "пользователя «$AdminUser» в базе нет — пароль не менялся" }
                default { Warn "пароль «$AdminUser» не изменён: $($rs.RESET)" }
            }
            if ($rs.LOGIN_AFTER -eq 'OK') { $LaunchUser = $AdminUser; Ok "«$AdminUser» входит без пароля" }
            else { $LaunchUser = $rs.LOGIN }
            $ibAuth = "/N `"$LaunchUser`" /P `"`""     # им же — расширение, проверка, seed
        }
    }

    # =================================================================
    #  Расширение конфигурации (.cfe)
    if (-not $ibAuth) { $ibAuth = "/N `"$LaunchUser`" /P `"`"" }   # серверная база наследует пользователей из источника
    $ibUserName = if ($ibAuth -match '/N "([^"]*)"') { $Matches[1] } else { '' }
    $ibUserPwd = if ($ibAuth -match '/P "([^"]*)"') { $Matches[1] } else { '' }
    if ($Exts -and $extBaked) {
        Ok "расширения уже в базе (встроены до миграции): $(($Exts | ForEach-Object Name) -join ', ')"
    }
    elseif ($Exts) {
        # Источник — не файловая база (.dt/.cf/шаблон): применяем на сервере. Новые объекты расширения требуют
        # монопольного режима, а его держат фоновые задания сервера — на время применения регламентные задания
        # запрещаются (rac), их сеансы завершаются; после — запрет снимается.
        Step '4б. Подключение расширений конфигурации'
        $cl = Get-ClusterId
        $ibId = (Get-ClusterIbs $cl | Where-Object Name -eq $IbName | Select-Object -First 1).Id
        if (-not $ibId) { Warn "база $IbName не найдена в кластере через rac — фоновые задания не запрещаются" }
        $denied = $ibId -and (Set-IbJobsDeny $cl $ibId $ibUserName $ibUserPwd $true)
        if ($denied) { Ok 'регламентные задания запрещены, сеансы базы завершены' }
        try {
            foreach ($e in $Exts) {
                Ok "файл: $(Split-Path -Leaf $e.File)  ->  расширение '$($e.Name)'"
                Invoke-1C "DESIGNER /S `"$ibPath`" $ibAuth /LoadCfg `"$($e.File)`" -Extension `"$($e.Name)`"" 'ext_load'
                $applied = $false
                for ($i = 1; $i -le 6 -and -not $applied; $i++) {
                    try {
                        Invoke-1C "DESIGNER /S `"$ibPath`" $ibAuth /UpdateDBCfg -Extension `"$($e.Name)`"" 'ext_apply'
                        $applied = $true
                    }
                    catch {
                        $log = Join-Path $LogDir '1c_ext_apply.log'
                        $locked = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'блокировк|заблокирована|monopol|exclusive')
                        if (-not $locked -or $i -eq 6) { throw }
                        Warn "база занята (сеанс фонового задания), повтор через 15 с (попытка $i из 6)"
                        if ($ibId) { [void](Set-IbJobsDeny $cl $ibId $ibUserName $ibUserPwd $true) }
                        Start-Sleep -Seconds 15
                    }
                }
                Ok "расширение '$($e.Name)' подключено и применено"
            }
        }
        finally {
            if ($denied) { [void](Set-IbJobsDeny $cl $ibId $ibUserName $ibUserPwd $false); Ok 'регламентные задания снова разрешены' }
            Stop-Rac
        }
    }
    # Расширения включены (активно, без безопасного режима — иначе АРМ не видит своих данных, а АРМ_OData не может
    # менять состав OData); у АРМ_OData — полный состав стандартного интерфейса OData
    if ($Exts) {
        $comConn = "Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$ibUserName`";Pwd=`"$ibUserPwd`""
        $activateJs = Join-Path $scriptDir 'odata\ext-activate.js'
        foreach ($e in $Exts) {
            if (-not (Test-Path $activateJs)) { Warn "нет $activateJs — проверьте вручную, что расширение $($e.Name) активно и не в безопасном режиме"; break }
            foreach ($l in (Invoke-ComJs $activateJs $comConn @($e.Name))) {
                if ($l -match '^ERROR=(.*)') { Warn "$($e.Name): $($Matches[1])" } else { Ok ($l -replace '^OK ', '') }
            }
        }
        $enableOData = Join-Path $scriptDir 'odata\enable-odata.ps1'
        if (($Exts | Where-Object Name -eq 'АРМ_OData') -and (Test-Path $enableOData)) {
            & $enableOData -ConnectionString $comConn | Select-Object -First 2
        }
        $comConn = $null
    }

    # =================================================================
    Step '5. Проверка подключения'
    $allOk = $true
    $tjMark = Get-Date
    foreach ($port in 1540, 1541, $PgPort) {
        if (Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) { Ok "порт $port открыт" }
        else { Warn "порт $port не отвечает"; $allOk = $false }
    }

    $pgVer = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db $IbName -PwPlain $PgPasswordPlain -Sql 'SELECT version()' -Tuple
    if ($pgVer.Code -eq 0) { Ok "PostgreSQL: подключение к БД '$IbName' — $($pgVer.Out)" } else { Warn 'PostgreSQL: нет подключения к БД'; $allOk = $false }

    try {
        $tmpCf = Join-Path $env:TEMP 'check_conn.cf'
        # .dt взят готовым — пользователь ещё не подобран: заданный -> без пользователя -> Админ/Администратор
        $checkTries = if ($ibAuth) { @($ibAuth) } else { @('', '/N "Админ" /P ""', '/N "Администратор" /P ""') }
        for ($i = 0; ; $i++) {
            try { Invoke-1C "DESIGNER /S `"$ibPath`" $($checkTries[$i]) /DumpCfg `"$tmpCf`"" 'check'; $ibAuth = $checkTries[$i]; break }
            catch {
                $log = Join-Path $LogDir '1c_check.log'
                $authError = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
                if (-not $authError -or $i -ge $checkTries.Count - 1) { throw }
            }
        }
        Remove-Item $tmpCf -ErrorAction SilentlyContinue
        Ok "1С: конфигуратор подключился к $ibPath$(if ($ibAuth -match '/N "([^"]*)"') { " (пользователь «$($Matches[1])»)" })"
    }
    catch { Warn $_.Exception.Message; $allOk = $false }

    if (-not $NoTrace) {
        Write-Host '  Ожидание записи технологического журнала (15 с)...'
        Start-Sleep -Seconds 15
        if (Test-TechLogFresh -Dir $TechLogDir -Since $tjMark) {
            Ok "технологический журнал пишет в $TechLogDir"
        }
        else {
            Warn "ТЖ не дал новых файлов в $TechLogDir после проверки входа."
            Warn "Проверьте права на каталог, наличие $LogcfgPath и что служба агента перезапускалась."
        }
    }

    if ($allOk) { Write-Host "`nГОТОВО. База: $ibPath ($IbTitle)" -ForegroundColor Green }
    else { Write-Host "`nЗавершено с предупреждениями, смотрите $LogDir" -ForegroundColor Yellow }
    if (-not $NoTrace) {
        Write-Host "Технологический журнал:" -ForegroundColor Green
        Write-Host "  logcfg:  $LogcfgPath"
        Write-Host "  каталог: $TechLogDir (DBPOSTGRS >= $TechLogThresholdMs мс, history 24 ч)"
    }

    # =================================================================
    #  Демо-данные АРМ (seed-1c.ps1 рядом со скриптом): спросить, при согласии — передать базу и пользователя
    $seedScript = Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }) 'seed-1c.ps1'
    $doSeed = $false
    if ($NoSeed) { }
    elseif (-not $allOk) { Warn 'установка с предупреждениями — seed не предлагается (запустите seed-1c.ps1 вручную)' }
    elseif (-not $HasArm) { Warn 'расширение АРМ не подключено — seed не предлагается' }
    elseif (-not (Test-Path $seedScript)) { Warn "нет $seedScript — seed не предлагается" }
    elseif ($Seed) { $doSeed = $true }
    else {
        if ($SourceIsBackup) { Warn "база загружена из бэкапа рабочей базы ($($cfFile.Name)) — seed добавит в неё демо-заказы SEED-309-*" }
        $doSeed = (Read-Host "`n  Заполнить базу демо-данными АРМ (seed: сценарии из seed\Шаблон деталей.xlsx)? (Y/N)") -match '^[YyДд]'
    }

    # пользователь, под которым конфигуратор вошёл в базу (подобран на шаге 4); '' — в базе нет пользователей
    $seedUser = ''; $seedPwd = ''
    if ($ibAuth -match '/N "([^"]*)" /P "([^"]*)"') { $seedUser = $Matches[1]; $seedPwd = $Matches[2] }
    if ($doSeed) {
        Step '6. Демо-данные АРМ (seed)'
        # серверная база — строкой соединения (seed-1c.ps1 -ConnectionString), COM-соединитель той же разрядности
        $seedConn = "Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$seedUser`";Pwd=`"$seedPwd`""
        $seedArgs = @{ ConnectionString = $seedConn }
        if ($SeedKeepSafeModeOff) { $seedArgs.KeepSafeModeOff = $true }
        Write-Host "  seed-1c.ps1 -ConnectionString 'Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$seedUser`";Pwd=***'$(if ($SeedKeepSafeModeOff) { ' -KeepSafeModeOff' })"
        & $seedScript @seedArgs
        $seedCode = $LASTEXITCODE
        $seedConn = $null; $seedArgs = $null
        if ($seedCode -eq 0) { Ok 'демо-данные АРМ загружены' }
        else { Warn "seed завершился с кодом $seedCode — повторить: .\seed-1c.ps1 -ConnectionString 'Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$seedUser`";Pwd=`"`"'" }
    }
    elseif (-not $NoSeed -and $allOk -and $HasArm) {
        Write-Host "  seed пропущен. Позже: .\seed-1c.ps1 -ConnectionString 'Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$seedUser`";Pwd=`"`"'"
    }
    $seedPwd = $null

    # =================================================================
    #  Запуск 1С:Предприятие под администратором 1С (пустой пароль) — сразу в серверную базу
    if ($allOk -and -not $NoLaunch) {
        Step '7. Запуск 1С:Предприятие'
        $client = Join-Path $Bin1C '1cv8c.exe'                 # тонкий клиент; нет — 1cv8.exe ENTERPRISE
        $launch = if (Test-Path $client) { @{ Exe = $client; Args = '' } } else { @{ Exe = $v8; Args = 'ENTERPRISE ' } }
        # пользователь — «Администратор» после сброса пароля (шаг 4в) или «Админ» у базы из autoservice.zip
        Start-Process $launch.Exe -ArgumentList "$($launch.Args)/S `"$ibPath`" /N `"$LaunchUser`" /P `"`""
        Ok "запущен $(Split-Path -Leaf $launch.Exe): база $ibPath, пользователь «$LaunchUser» (пароль пустой)"
    }
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Строка $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
    Write-Host "Логи: $LogDir" -ForegroundColor Red
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    $PgPasswordPlain = $null
    $ibPwdPlain = $null
    Stop-Transcript | Out-Null
}
