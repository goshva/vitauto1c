#Requires -Version 5.1
<#
.SYNOPSIS
  Файловый вариант: 1С:Предприятие 8.3.27.2342 (клиенты) + файловая база "Автосервис" из .dt.
  Без PostgreSQL и без сервера 1С. Клиент-серверный вариант (PostgreSQL) — install-1c-pgsql.ps1.

  Режимы (первый аргумент):
    install  установка (по умолчанию)
    setup    перед установкой спросить, куда ставить: архивы и логи, базу, технологический журнал
             (показывает свободное место на дисках; каталоги, заданные ключами, не спрашиваются)
    search   найти прошлые установки и артефакты на всех дисках (программы, службы, каталоги и архивы
             установщика, файловые базы, кэши 1С), показать размер и предложить удалить;
             -List — только показать. Базы данных удаляются только по номеру с подтверждением.

  Шаги установки:
    0. Проверка свободного места (до удаления, с учётом освобождаемого) и
       полное удаление прошлой установки (процессы, MSI платформы, каталог базы, список баз)
       и всего, что осталось от клиент-серверной: PostgreSQL 1C и её службы, данные (C:\PGDATA15),
       кластер 1С (C:\srvinfo), служба сервера 1С, дистрибутивы PostgreSQL, коллектор pgtrace
    1. Исходники: уже распакованы — пропуск; иначе архив (есть и цел — без сети; нет или битый — докачка
       с Яндекс.Диска) -> распаковка. -Redownload — скачать и распаковать заново
    2. Тихая установка 1С в -ProgramsDir\1cv8 (толстый/тонкий клиент + конфигуратор, без сервера)
    2б. Технологический журнал: logcfg.xml в conf по разрядности установленной платформы
    3. Создание файловой базы в -IbDir: из .dt (RestoreIB), .cf (шаблон) или копией 1Cv8.1CD
    3б. Подключение расширения (.cfe)
    4. Проверка (файл базы, вход конфигуратором) и записи ТЖ
    5. Вопрос «заполнить демо-данными АРМ?» -> seed-1c.ps1 с каталогом базы и пользователем 1С этой установки
       (-Seed — без вопроса, -NoSeed — пропустить, -SeedKeepSafeModeOff — оставить безопасный режим выключенным)
    6. Запуск 1С:Предприятие (тонкий клиент) в базу под пользователем «Админ» с пустым паролем (-NoLaunch — не запускать)

  Всё ставится на диск D: (архивы, программы, база, ТЖ); пути на других дисках отклоняются.
  Архивы по умолчанию сохраняются в -BaseDir, чтобы повторный запуск не качал их заново.
  Ключ -DeleteArchives удаляет их после распаковки. Распакованные исходники (-BaseDir\platform_*,
  config_autoservice) при переустановке сохраняются и повторно не скачиваются; -Redownload — заново.
  Трассировка — технологический журнал 1С. -NoTrace отключает настройку и проверку ТЖ.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1 -Force -DeleteArchives -IbDir D:\1c_bases\autoservice
  .\install-1c.ps1 -Force -Seed -SeedKeepSafeModeOff   # без вопросов: переустановка + демо-данные АРМ
  .\install-1c.ps1 setup                 # выбрать каталоги и установить
  .\install-1c.ps1 search -List          # показать, что занимает место
  .\install-1c.ps1 search                # показать и выбрать, что удалить
#>
param(
    # Режим: install — установка (по умолчанию); setup — сначала спросить, куда ставить;
    #        search — найти прошлые установки и артефакты и предложить удалить (установка не выполняется)
    [Parameter(Position = 0)]
    [ValidateSet('install', 'setup', 'search')]
    [string]      $Action      = 'install',
    [switch]      $List,                            # для search: только показать найденное, ничего не удалять
    [string]      $BaseDir     = $(if ($PSScriptRoot -like 'D:\*') { $PSScriptRoot } else { 'D:\1c' }),
    [string]      $IbDir       = 'D:\1c_bases\autoservice',   # каталог файловой базы (1Cv8.1CD)
    [string]      $ProgramsDir = 'D:\Program Files',   # куда ставить программы: платформа 1С (<...>\1cv8\<версия>) и 7-Zip
    [string]      $IbTitle     = 'Автосервис',      # имя в списке баз
    [switch]      $Force,                           # удалять прошлую установку без подтверждения
    [switch]      $DeleteArchives,                  # удалить архивы после распаковки
    [switch]      $Redownload,                      # скачать и распаковать исходники заново, даже если они уже есть
    [string]      $IbUser,                          # пользователь 1С в базе «Автосервис» (если есть список пользователей)
    [SecureString]$IbPassword,                      # его пароль; при -IbUser без пароля будет запрошен
    [string]      $ExtensionFile,                    # путь к .cfe; не задан — последняя версия <имя>_vN.cfe рядом со скриптом; '' — не подключать
    [string]      $ExtensionName,                    # имя расширения в базе; по умолчанию — из имени файла
    [double]      $EstDbGB       = 3,                 # оценка размера файловой базы (для проверки места); фактически ~1,9 ГБ
    [switch]      $SkipSpaceCheck,                    # пропустить проверку свободного места на диске
    # --- демо-данные АРМ (seed-1c.ps1) после установки: без ключей — вопрос Y/N ---
    [switch]      $Seed,                              # заполнить без вопроса
    [switch]      $NoSeed,                            # не заполнять и не спрашивать
    [switch]      $SeedKeepSafeModeOff,               # передать seed -KeepSafeModeOff (оставить безопасный режим расширения выключенным)
    [switch]      $NoLaunch,                          # не запускать 1С:Предприятие (Админ, пустой пароль) в конце
    # --- технологический журнал 1С (logcfg.xml) ---
    [switch]      $NoTrace,                           # не настраивать и не проверять ТЖ
    [string]      $TechLogDir          = 'D:\1c\tj',  # каталог файлов ТЖ (HDD, не SSD с базой)
    [int]         $TechLogThresholdMs  = 200,         # логировать обращения к файловой СУБД дольше N мс
    [string]      $LogcfgPath,                        # по умолчанию <корень 1cv8>\conf\logcfg.xml установленной платформы
    # --- остатки клиент-серверной установки (install-1c-pgsql.ps1) — удаляются на шаге 0 ---
    [string]      $PgDataDir   = 'C:\PGDATA15',
    [string]      $SrvInfoDir  = 'C:\srvinfo'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------- Запуск от администратора ----------
$ScriptBound = $PSBoundParameters   # какие параметры заданы явно (для setup)
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$listOnly  = $Action -eq 'search' -and $List   # просмотр найденного не требует прав администратора
if (-not $listOnly -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Перезапуск с правами администратора...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Key -eq 'IbPassword') { continue }   # SecureString не передать в другой процесс — спросим заново
        if ($kv.Value -is [switch]) { if ($kv.Value) { $argList += "-$($kv.Key)" } }
        else { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

# Всё — только на диск D:. Остатки прошлых установок (Program Files на C:, PGDATA15, srvinfo) по-прежнему ищутся и удаляются.
$TargetDrive = 'D:'
function Assert-TargetDrive {
    $paths = [ordered]@{ BaseDir = $BaseDir; IbDir = $IbDir; ProgramsDir = $ProgramsDir }
    if (-not $NoTrace) { $paths.TechLogDir = $TechLogDir; if ($LogcfgPath) { $paths.LogcfgPath = $LogcfgPath } }
    foreach ($kv in $paths.GetEnumerator()) {
        $q = Split-Path -Qualifier $kv.Value -ErrorAction SilentlyContinue
        if ($q -ne $TargetDrive) { throw "-$($kv.Key) = '$($kv.Value)': установка только на диск $TargetDrive" }
    }
    if (-not (Test-Path "$TargetDrive\")) { throw "Диск $TargetDrive не найден" }
}
# Корни, где может лежать 1cv8 / 7-Zip: наш каталог программ и стандартные Program Files (там — остатки прошлых установок)
$ProgramRoots = @($ProgramsDir, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } | Select-Object -Unique

$PlatformVersion = '8.3.27.2342'
$Sources = [ordered]@{
    # Content — по каким файлам понять, что каталог уже распакован (уже есть — не скачиваем и не распаковываем)
    Platform = @{ Url = 'https://disk.yandex.ru/d/WmdHaZZr45QoXA'; File = 'windows_8_3_27_2342.rar'; Dir = 'platform_8_3_27_2342'; Content = @('1CEnterprise*.msi') }
    Config   = @{ Url = 'https://disk.yandex.ru/d/xl9suLCSUGRpPA'; File = 'autoservice.zip';         Dir = 'config_autoservice';   Content = @('1Cv8.1CD', '*.dt', '*.cf') }
}
$UnpackedMark = '.unpacked'   # пишется после успешной распаковки; без него неполная распаковка не считается готовой

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

# =====================================================================
#  Вспомогательные функции
# =====================================================================
function Get-7Zip {
    $candidates = @($ProgramRoots | ForEach-Object { Join-Path $_ '7-Zip\7z.exe' })
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    Write-Host "  7-Zip не найден, устанавливаю в $ProgramsDir\7-Zip..."
    $inst = Join-Path $BaseDir '7z-x64.exe'
    & curl.exe -L --fail -o $inst 'https://www.7-zip.org/a/7z2409-x64.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось скачать 7-Zip' }
    Start-Process $inst -ArgumentList '/S', "/D=$ProgramsDir\7-Zip" -Wait
    Remove-Item $inst -Force
    if (-not (Test-Path $candidates[0])) { throw '7-Zip не установился' }
    return $candidates[0]
}

function Get-YandexSize([string]$PublicUrl) {
    $key = [uri]::EscapeDataString($PublicUrl)
    [int64](Invoke-RestMethod -Uri "https://cloud-api.yandex.net/v1/disk/public/resources?public_key=$key" -UseBasicParsing).size
}

# Скачивание с докачкой до нужного размера
function Get-YandexFile([string]$PublicUrl, [string]$OutFile, [int64]$Size) {
    $key = [uri]::EscapeDataString($PublicUrl)
    for ($try = 1; $try -le 10; $try++) {
        $have = if (Test-Path $OutFile) { (Get-Item $OutFile).Length } else { 0 }
        if ($have -eq $Size) { break }
        if ($have -gt $Size) { Remove-Item $OutFile -Force; $have = 0 }
        # ссылка на скачивание живёт недолго — берём новую на каждую попытку
        $href = (Invoke-RestMethod -Uri "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=$key" -UseBasicParsing).href
        if (-not $href) { throw "Яндекс.Диск не вернул ссылку для $PublicUrl" }
        Write-Host ("  Скачивание -> {0} ({1:N0} из {2:N0} МБ, попытка {3})" -f $OutFile, ($have / 1MB), ($Size / 1MB), $try)
        if ($have -gt 0) { & curl.exe -L --fail -C - -o $OutFile $href } else { & curl.exe -L --fail -o $OutFile $href }
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
    $size    = Get-YandexSize $src.Url
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        if (Test-Path $archive) {
            $have = (Get-Item $archive).Length
            if ($have -eq $size) { Write-Host "  Архив найден: $($src.File), проверка целостности..." }
            else { Warn ("архив неполный: {0:N0} из {1:N0} МБ" -f ($have / 1MB), ($size / 1MB)) }
        } else {
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
# (архивы и распаковка на диске BaseDir, программы на диске ProgramsDir, база на диске IbDir).
# $Reclaim: буква диска -> сколько ГБ освободится при удалении прошлой установки (проверка идёт до удаления).
function Assert-FreeSpace([hashtable]$Reclaim = @{}) {
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
        } else {
            $gb = (Get-YandexSize $src.Url) / 1GB
            Add-Need $BaseDir $gb                    # сам архив
        }
        Add-Need $BaseDir ($gb * 1.6)                # распакованное содержимое
    }
    Add-Need $ProgramsDir 1.5                        # платформа 1С
    Add-Need $IbDir $EstDbGB                         # файловая база

    $buffer = 2.0                                    # запас на журналы, temp, рост
    $fail = $false
    foreach ($d in $need.Keys) {
        $req  = [math]::Round(($need[$d] + $buffer), 1)
        $free = Get-FreeGB "$d\"
        $back = [math]::Round([double]$Reclaim[$d], 1)
        $have = [math]::Round($free + $back, 1)
        $backText = if ($back -gt 0) { " + освободится ~$back ГБ от прошлой установки" } else { '' }
        if ($have -ge $req) { Ok "диск $d : нужно ~$req ГБ, свободно $free ГБ$backText" }
        else { Warn "диск $d : нужно ~$req ГБ, свободно только $free ГБ$backText — не хватает $([math]::Round($req - $have,1)) ГБ"; $fail = $true }
    }
    if ($fail) {
        throw "Недостаточно места на диске — прошлая установка НЕ удалена. Освободите место (.\install-1c.ps1 search), выберите другой диск (.\install-1c.ps1 setup или ключи -BaseDir/-IbDir) либо пропустите проверку ключом -SkipSpaceCheck."
    }
}

function Invoke-Msi([string]$Action, [string]$Target, [string]$ArgsLine, [string]$LogName) {
    $log = Join-Path $LogDir $LogName
    $p = Start-Process msiexec.exe -ArgumentList "$Action `"$Target`" $ArgsLine /norestart /l*v `"$log`"" -Wait -PassThru
    return $p.ExitCode   # 0 / 3010 (нужна перезагрузка) — успех
}

function Get-UninstallEntries {
    $keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName }
}

function Find-1CBin {
    foreach ($root in $ProgramRoots) {
        $b = Join-Path $root "1cv8\$PlatformVersion\bin"
        if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
    }
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

# logcfg.xml читается из <корень 1cv8>\conf установленной платформы
# (по умолчанию D:\Program Files\1cv8\conf; у старых установок — Program Files [(x86)]\1cv8\conf).
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

$IbListFile = "$env:APPDATA\1C\1CEStart\ibases.v8i"
$IbListPattern = "File=`"?$([regex]::Escape($IbDir.TrimEnd('\')))\\?`"?;"

# Удалить из списка баз (ibases.v8i) секции, указывающие на нашу файловую базу
function Remove-IbFromList {
    if (-not (Test-Path $IbListFile)) { return }
    $text  = [IO.File]::ReadAllText($IbListFile, [Text.Encoding]::UTF8)
    $parts = [regex]::Split($text, '(?m)^(?=\[)')
    # плюс запись серверной базы клиент-серверной установки (install-1c-pgsql.ps1, значения по умолчанию)
    $kept  = $parts | Where-Object { $_ -notmatch $IbListPattern -and $_ -notmatch 'Srvr="?localhost"?;Ref="?autoservice"?;' }
    if (@($kept).Count -ne @($parts).Count) {
        [IO.File]::WriteAllText($IbListFile, (-join $kept), (New-Object Text.UTF8Encoding $true))
        Ok "база удалена из списка: $IbListFile"
    }
}

# Добавить базу в список (если её там ещё нет) — для случая копии готового 1Cv8.1CD
function Add-IbToList {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $IbListFile) | Out-Null
    $text = if (Test-Path $IbListFile) { [IO.File]::ReadAllText($IbListFile, [Text.Encoding]::UTF8) } else { '' }
    if ($text -match $IbListPattern) { return }
    if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
    $entry = "[$IbTitle]`r`nConnect=File=`"$IbDir`";`r`nID=$([guid]::NewGuid())`r`nOrderInList=0`r`nFolder=/`r`n" +
             "OrderInTree=0`r`nExternal=0`r`nClientConnectionSpeed=Normal`r`nApp=Auto`r`nWA=1`r`nVersion=8.3`r`n"
    [IO.File]::WriteAllText($IbListFile, $text + $entry, (New-Object Text.UTF8Encoding $true))
    Ok "база добавлена в список: $IbTitle"
}

# Последняя версия расширения рядом со скриптом: <имя>_v<версия>.cfe с наибольшей версией
# (v1 < v2.0 < v2.1 < v10). Файл без суффикса версии считается версией 0. Нет .cfe — ''.
function Find-LatestExtension([string]$Dir) {
    $cands = Get-ChildItem $Dir -Filter '*.cfe' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $m   = [regex]::Match($_.BaseName, '^(.+?)_v(\d+(?:\.\d+){0,3})$')
        $ver = if ($m.Success) { $m.Groups[2].Value } else { '0' }
        if ($ver -notmatch '\.') { $ver += '.0' }
        [pscustomobject]@{
            File    = $_.FullName
            Name    = if ($m.Success) { $m.Groups[1].Value } else { $_.BaseName }
            Version = [version]$ver
        }
    }
    if (-not $cands) { return '' }
    $names = @($cands | Select-Object -ExpandProperty Name -Unique)
    if ($names.Count -gt 1) {
        throw "Рядом со скриптом несколько разных расширений ($($names -join ', ')) — укажите нужное ключом -ExtensionFile"
    }
    ($cands | Sort-Object Version -Descending | Select-Object -First 1).File
}

function Get-DirSizeGB([string]$Path) {
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    [math]::Round([double]$sum / 1GB, 2)
}

# =====================================================================
#  Режим setup: выбор каталогов установки
# =====================================================================
# Спрашивает только те каталоги, которые не заданы ключами. Всё — только на диске D:.
function Select-InstallDirs {
    Step 'Куда устанавливать (setup)'
    $drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady })
    Write-Host '  Диски:'
    foreach ($d in $drives) {
        Write-Host ("    {0}  свободно {1,7:N1} ГБ из {2,7:N1} ГБ" -f $d.Name.TrimEnd('\'), ($d.AvailableFreeSpace / 1GB), ($d.TotalSize / 1GB))
    }
    Write-Host "  Всё ставится на диск $TargetDrive; платформа 1С (~1,5 ГБ) — в $ProgramsDir\1cv8."
    $best = $TargetDrive

    function Read-Dir([string]$Title, [string]$Default) {
        while ($true) {
            $v = Read-Host "  $Title [$Default]"
            if (-not $v) { $v = $Default }
            $q = Split-Path -Qualifier $v -ErrorAction SilentlyContinue
            if ($q -eq $TargetDrive) { return $v.TrimEnd('\') }
            Warn "нужен полный путь на диске $TargetDrive, например $best\1c — получено: $v"
        }
    }
    # значение по умолчанию: текущее, если оно на диске D:; иначе — запасное
    function Get-Default([string]$Current, [string]$Fallback) {
        $q = Split-Path -Qualifier $Current -ErrorAction SilentlyContinue
        if ($q -eq $TargetDrive) { $Current } else { $Fallback }
    }

    if (-not $ScriptBound.ContainsKey('BaseDir')) {
        $script:BaseDir = Read-Dir 'Архивы, распаковка и логи (до ~10 ГБ, подойдёт медленный диск)' "$best\1c"
    }
    if (-not $ScriptBound.ContainsKey('IbDir')) {
        $script:IbDir = Read-Dir "Файловая база (~$EstDbGB ГБ, лучше быстрый диск)" (Get-Default $IbDir "$best\1c_bases\autoservice")
    }
    if (-not $NoTrace -and -not $ScriptBound.ContainsKey('TechLogDir')) {
        $script:TechLogDir = Read-Dir 'Технологический журнал (не на диске с базой)' (Get-Default $TechLogDir (Join-Path $script:BaseDir 'tj'))
    }
    Ok "архивы и логи: $script:BaseDir"
    Ok "база:          $script:IbDir"
    if (-not $NoTrace) { Ok "журнал:        $script:TechLogDir" }
}

# =====================================================================
#  Режим search: прошлые установки и артефакты
# =====================================================================
# Ищет на всех несъёмных дисках: программы 1С и PostgreSQL 1C, их службы, каталоги и архивы установщика,
# файловые базы, кэши 1С. Показывает размер и предлагает удалить. Базы данных удаляются только по номеру.
function Invoke-Search {
    Step 'Поиск прошлых установок и артефактов (search)'
    $items   = New-Object System.Collections.ArrayList
    $claimed = New-Object System.Collections.Generic.List[string]   # каталоги, уже попавшие в список
    function Add-Found([string]$Kind, [string]$Path, [double]$GB, [string]$Note, [bool]$Protected = $false, $Data = $null) {
        [void]$items.Add([pscustomobject]@{ N = 0; Kind = $Kind; Path = $Path; GB = [math]::Round($GB, 2); Note = $Note; Protected = $Protected; Data = $Data })
    }
    function Test-Claimed([string]$Path) {
        foreach ($c in $claimed) { if ($Path.StartsWith($c + '\', [StringComparison]::OrdinalIgnoreCase) -or $Path -ieq $c) { return $true } }
        $false
    }

    # базы из списка баз: путь -> имя
    $ibTitles = @{}
    $v8i = "$env:APPDATA\1C\1CEStart\ibases.v8i"
    if (Test-Path $v8i) {
        $title = $null
        foreach ($line in [IO.File]::ReadAllLines($v8i, [Text.Encoding]::UTF8)) {
            if ($line -match '^\[(.+)\]\s*$') { $title = $Matches[1] }
            elseif ($title -and $line -match '^Connect=File="?([^";]+)"?;') { $ibTitles[$Matches[1].TrimEnd('\')] = $title }
        }
    }

    # программы и службы
    $products = @(Get-UninstallEntries | Where-Object {
        $_.DisplayName -match '^1[CС]' -or ($_.DisplayName -like 'PostgreSQL*' -and ($_.DisplayName -like '*1C*' -or $_.DisplayVersion -like '*1C*'))
    })
    foreach ($p in $products) { Add-Found 'программа' "$($p.DisplayName) $($p.DisplayVersion)" ([double]$p.EstimatedSize / 1MB) $p.InstallLocation $false $p }
    foreach ($s in Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'ragent\.exe|PostgreSQL\\15[^\\]*1C' }) {
        Add-Found 'служба' $s.Name 0 "$($s.State): $($s.PathName)" $false $s
    }
    # остатки в Program Files (и в -ProgramsDir) без записи об установке
    foreach ($root in $ProgramRoots) {
        foreach ($d in Get-ChildItem (Join-Path $root '1cv8') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' }) {
            if (-not ($products | Where-Object { $_.DisplayVersion -eq $d.Name })) { Add-Found 'остатки платформы' $d.FullName (Get-DirSizeGB $d.FullName) 'программа не зарегистрирована'; $claimed.Add($d.FullName) }
        }
        foreach ($d in Get-ChildItem (Join-Path $root 'PostgreSQL') -Directory -Filter '15*1C*' -ErrorAction SilentlyContinue) {
            if (-not ($products | Where-Object { $_.DisplayName -like 'PostgreSQL*' })) { Add-Found 'остатки PostgreSQL' $d.FullName (Get-DirSizeGB $d.FullName) 'программа не зарегистрирована'; $claimed.Add($d.FullName) }
        }
    }

    # каталоги и файлы на дисках (до 4 уровней от корня, системные каталоги пропускаются)
    $skipTop = 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', '$Recycle.Bin',
               'System Volume Information', 'Recovery', 'PerfLogs', 'Documents and Settings', '$WinREAgent'
    $dirRe   = '^(platform_\d|config_autoservice$|postgresql_15|PGDATA\d*$|srvinfo$)'
    $fileRe  = '^(windows_.*\.rar|postgresql_.*\.zip|autoservice\.zip|.*\.dt)$'
    foreach ($drive in [IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady }) {
        Write-Host "  поиск на $($drive.Name) ..."
        $tops = @(Get-ChildItem -LiteralPath $drive.Name -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $skipTop -notcontains $_.Name })
        $dirs = $tops + @($tops | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory -Recurse -Depth 2 -Force -ErrorAction SilentlyContinue })
        foreach ($d in $dirs) {
            if (Test-Claimed $d.FullName) { continue }
            if ($d.Name -match $dirRe) {
                Add-Found 'каталог установщика' $d.FullName (Get-DirSizeGB $d.FullName) 'распаковка дистрибутива или данные PostgreSQL / кластера 1С'
                $claimed.Add($d.FullName)
            }
            elseif (Test-Path -LiteralPath ([IO.Path]::Combine($d.FullName, '1Cv8.1CD'))) {
                $t = $ibTitles[$d.FullName]
                $note = if ($t) { "в списке баз: «$t»" } else { 'нет в списке баз (копия?)' }
                Add-Found 'БАЗА ДАННЫХ' $d.FullName (Get-DirSizeGB $d.FullName) $note $true
                $claimed.Add($d.FullName)
            }
            elseif ($d.Name -eq 'logs' -and (Get-ChildItem -LiteralPath $d.FullName -Filter 'install_*.log' -ErrorAction SilentlyContinue | Select-Object -First 1)) {
                Add-Found 'логи установки' $d.FullName (Get-DirSizeGB $d.FullName) ''
                $claimed.Add($d.FullName)
            }
            else {
                foreach ($f in Get-ChildItem -LiteralPath $d.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $fileRe }) {
                    if ($f.Extension -eq '.dt' -and $f.Length -lt 50MB) { continue }
                    Add-Found 'архив / выгрузка' $f.FullName ($f.Length / 1GB) ''
                }
            }
        }
    }
    # кэши 1С текущего пользователя — пересоздаются платформой
    foreach ($c in "$env:LOCALAPPDATA\1C\1cv8", "$env:APPDATA\1C\1cv8") {
        if (Test-Path $c) { $gb = Get-DirSizeGB $c; if ($gb -ge 0.05) { Add-Found 'кэш 1С' $c $gb 'пересоздаётся при запуске 1С' } }
    }

    if (-not $items.Count) { Ok 'ничего не найдено'; return }

    $n = 0
    $sorted = @($items | Sort-Object GB -Descending)
    foreach ($it in $sorted) { $it.N = ++$n }
    Write-Host ''
    Write-Host ("  {0,3}  {1,8}  {2,-20} {3}" -f '№', 'ГБ', 'Что', 'Где') -ForegroundColor Cyan
    foreach ($it in $sorted) {
        $color = if ($it.Protected) { 'Yellow' } else { 'Gray' }
        Write-Host ("  {0,3}  {1,8:N2}  {2,-20} {3}" -f $it.N, $it.GB, $it.Kind, $it.Path) -ForegroundColor $color
        if ($it.Note) { Write-Host ("                 {0}" -f $it.Note) -ForegroundColor DarkGray }
    }
    Write-Host ''
    foreach ($g in $sorted | Where-Object { $_.Path -match '^[A-Za-z]:' } | Group-Object { $_.Path.Substring(0, 2).ToUpper() }) {
        $all  = [math]::Round(($g.Group | Measure-Object GB -Sum).Sum, 1)
        $safe = [math]::Round(($g.Group | Where-Object { -not $_.Protected } | Measure-Object GB -Sum).Sum, 1)
        Write-Host "  Диск $($g.Name) найдено $all ГБ, из них без баз данных $safe ГБ; сейчас свободно $(Get-FreeGB "$($g.Name)\") ГБ"
    }
    if ($List) { Write-Host "`n  Режим -List: ничего не удалено." ; return }

    Write-Host ''
    Write-Host '  Что удалить? Номера через запятую или пробел; all — всё, кроме баз данных; Enter — ничего.' -ForegroundColor Cyan
    Write-Host '  Базы данных (жёлтые) удаляются только по номеру, и это необратимо.' -ForegroundColor Yellow
    $answer = if ($Force) { 'all' } else { Read-Host '  Удалить' }
    if (-not $answer) { Write-Host '  Ничего не удалено.'; return }
    $selected = if ($answer -match '^(all|все|всё)$') { @($sorted | Where-Object { -not $_.Protected }) }
                else { $nums = [regex]::Matches($answer, '\d+') | ForEach-Object { [int]$_.Value }; @($sorted | Where-Object { $nums -contains $_.N }) }
    if (-not $selected) { Write-Host '  Ничего не выбрано.'; return }
    $bases = @($selected | Where-Object Protected)
    if ($bases -and -not $Force) {
        Write-Host '  Будут удалены БАЗЫ ДАННЫХ:' -ForegroundColor Red
        $bases | ForEach-Object { Write-Host "    $($_.Path)  $($_.Note)" -ForegroundColor Red }
        if ((Read-Host '  Введите «да», чтобы удалить и базы') -notmatch '^(да|yes)$') { $selected = @($selected | Where-Object { -not $_.Protected }); Warn 'базы данных оставлены' }
    }

    $before = @{}; foreach ($d in [IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady }) { $before[$d.Name] = $d.AvailableFreeSpace }
    $order = @{ 'служба' = 0; 'программа' = 1 }
    foreach ($it in $selected | Sort-Object { if ($order.ContainsKey($_.Kind)) { $order[$_.Kind] } else { 2 } }) {
        switch ($it.Kind) {
            'служба' {
                Stop-Service -Name $it.Data.Name -Force -ErrorAction SilentlyContinue
                & sc.exe delete "$($it.Data.Name)" | Out-Null
                Ok "служба удалена: $($it.Data.Name)"
            }
            'программа' {
                if ($it.Data.PSChildName -match '^\{[0-9A-Fa-f-]+\}$') {
                    $p = Start-Process msiexec.exe -ArgumentList "/x $($it.Data.PSChildName) /qn /norestart" -Wait -PassThru
                    if ($p.ExitCode -in 0, 1605, 3010) { Ok "программа удалена: $($it.Path)" } else { Warn "msiexec /x вернул $($p.ExitCode): $($it.Path)" }
                } else { Warn "не MSI-пакет, удалите вручную: $($it.Data.UninstallString)" }
            }
            default {
                Remove-Item -LiteralPath $it.Path -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $it.Path) { Warn "не удалось удалить (файлы заняты?): $($it.Path)" } else { Ok "удалено: $($it.Path)" }
                if ($it.Protected -and (Test-Path $v8i)) {
                    # убрать базу из списка баз
                    $text  = [IO.File]::ReadAllText($v8i, [Text.Encoding]::UTF8)
                    $parts = [regex]::Split($text, '(?m)^(?=\[)')
                    $kept  = $parts | Where-Object { $_ -notmatch "File=`"?$([regex]::Escape($it.Path))\\?`"?;" }
                    if (@($kept).Count -ne @($parts).Count) { [IO.File]::WriteAllText($v8i, (-join $kept), (New-Object Text.UTF8Encoding $true)); Ok 'база убрана из списка баз' }
                }
            }
        }
    }
    Write-Host ''
    foreach ($d in [IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady }) {
        $freed = ($d.AvailableFreeSpace - [double]$before[$d.Name]) / 1GB
        Write-Host ("  {0} свободно {1:N1} ГБ (освобождено {2:N1} ГБ)" -f $d.Name.TrimEnd('\'), ($d.AvailableFreeSpace / 1GB), $freed) -ForegroundColor Green
    }
}

# =====================================================================
if ($Action -eq 'search') { Invoke-Search; exit }
if ($Action -eq 'setup') {
    Select-InstallDirs
    $IbListPattern = "File=`"?$([regex]::Escape($IbDir.TrimEnd('\')))\\?`"?;"   # каталог базы мог измениться
}
Assert-TargetDrive

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir ("install_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))) | Out-Null

try {
    if (-not $PSBoundParameters.ContainsKey('ExtensionFile')) {
        $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
        $ExtensionFile = Find-LatestExtension $scriptDir
        if ($ExtensionFile) { Ok "расширение: последняя версия рядом со скриптом — $(Split-Path -Leaf $ExtensionFile)" }
        else { Warn 'рядом со скриптом нет .cfe — расширение подключено не будет' }
    }
    if ($IbUser -and -not $IbPassword) { $IbPassword = Read-Host -AsSecureString "Пароль пользователя 1С '$IbUser' (Enter — пустой)" }
    $SevenZip = Get-7Zip

    # =================================================================
    Step '0. Проверка места и удаление прошлой установки'
    # Файловый вариант PostgreSQL не использует: вместе с прошлой установкой удаляется всё,
    # что осталось от клиент-серверной (install-1c-pgsql.ps1): PostgreSQL 1C, её службы, данные,
    # каталог кластера 1С, дистрибутивы PostgreSQL и коллектор pgtrace.
    $oldProducts = Get-UninstallEntries | Where-Object {
        ($_.DisplayName -match '^1[CС]' -and $_.DisplayVersion -eq $PlatformVersion) -or
        ($_.DisplayName -like 'PostgreSQL*' -and ($_.DisplayName -like '*1C*' -or $_.DisplayVersion -like '15.*1C*'))
    }
    $ourPaths = @("1cv8\$PlatformVersion", 'PostgreSQL\15*1C', $PgDataDir, $SrvInfoDir)
    $isOurs   = { param($path) foreach ($p in $ourPaths) { if ($path -and $path -like "*$p*") { return $true } }; $false }
    $oldServices = Get-CimInstance Win32_Service | Where-Object { & $isOurs $_.PathName }
    # распакованные исходники (платформа, конфигурация) — не «прошлая установка»: удаляются только с -Redownload
    $srcDirs = if ($Redownload) { $Sources.Values | ForEach-Object { Join-Path $BaseDir $_.Dir } } else { @() }
    $oldDirs = @($IbDir, $PgDataDir, $SrvInfoDir) + @($srcDirs) +
               @(Get-ChildItem $BaseDir -Directory -Filter 'postgresql_15*' -ErrorAction SilentlyContinue | ForEach-Object FullName) |
               Where-Object { $_ -and (Test-Path $_) }
    $pgArchives = @(Get-ChildItem $BaseDir -File -Filter 'postgresql_15*.zip' -ErrorAction SilentlyContinue)
    $pgtraceTask = (cmd /c 'schtasks /Query /TN pgtrace >nul 2>nul && echo yes') -eq 'yes'

    # Место проверяем ДО удаления: если его не хватит, прошлая установка остаётся нетронутой.
    # В расчёт идёт то, что освободится при удалении.
    if ($SkipSpaceCheck) { Warn 'проверка свободного места пропущена (-SkipSpaceCheck)' }
    else {
        $reclaim = @{}
        foreach ($d in $oldDirs) {
            $q = (Split-Path -Qualifier $d).ToUpper()
            $reclaim[$q] = [double]$reclaim[$q] + (Get-DirSizeGB $d)
        }
        $sysDrive = (Split-Path -Qualifier $env:ProgramFiles).ToUpper()
        foreach ($prod in $oldProducts) {   # EstimatedSize — в КБ; диск — по InstallLocation, иначе системный
            $q = if ($prod.InstallLocation) { (Split-Path -Qualifier $prod.InstallLocation).ToUpper() } else { $sysDrive }
            $reclaim[$q] = [double]$reclaim[$q] + ([double]$prod.EstimatedSize / 1MB)
        }
        Assert-FreeSpace $reclaim
    }

    if (-not ($oldProducts -or $oldServices -or $oldDirs -or $pgArchives -or $pgtraceTask)) {
        Ok 'следов прошлой установки нет'
    } else {
        Write-Host '  Будет удалено:' -ForegroundColor Yellow
        $oldProducts | ForEach-Object { Write-Host "    программа: $($_.DisplayName) $($_.DisplayVersion)" }
        $oldServices | ForEach-Object { Write-Host "    служба:    $($_.Name)" }
        $oldDirs     | ForEach-Object { Write-Host "    каталог:   $_" }
        $pgArchives  | ForEach-Object { Write-Host "    архив:     $($_.FullName)" }
        if ($pgtraceTask) { Write-Host '    задача:    pgtrace (старый коллектор трассировки)' }
        Write-Host "  ВНИМАНИЕ: данные файловой базы в $IbDir будут потеряны." -ForegroundColor Red
        if ($oldProducts | Where-Object { $_.DisplayName -like 'PostgreSQL*' }) {
            Write-Host "  ВНИМАНИЕ: PostgreSQL 1C и её базы в $PgDataDir будут удалены (клиент-серверная установка)." -ForegroundColor Red
        }
        if ($oldServices | Where-Object { $_.PathName -like '*ragent.exe*' }) {
            Write-Host '  ВНИМАНИЕ: найдена служба сервера 1С этой версии (клиент-серверная установка) — она будет удалена.' -ForegroundColor Red
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
            } else {
                Warn "не MSI-пакет, удалите вручную: $($prod.UninstallString)"
            }
        }

        # Локальный пользователь postgres, если его создал инсталлятор PostgreSQL и он больше нигде не используется
        $pgLocal = Get-LocalUser -Name 'postgres' -ErrorAction SilentlyContinue
        $usedBy  = Get-CimInstance Win32_Service | Where-Object { $_.StartName -like '*\postgres' }
        if ($pgLocal -and -not $usedBy -and ($oldProducts | Where-Object { $_.DisplayName -like 'PostgreSQL*' })) {
            Remove-LocalUser -Name 'postgres'
            Ok 'локальный пользователь postgres удалён'
        }

        $leftovers = @($oldDirs) +
            @(Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -Filter '15*1C*' -ErrorAction SilentlyContinue | ForEach-Object FullName) +
            @($ProgramRoots | ForEach-Object { Join-Path $_ "1cv8\$PlatformVersion" }) |
            Where-Object { $_ -and (Test-Path $_) }
        foreach ($d in $leftovers) {
            Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $d) { Warn "не удалось удалить $d (файлы заняты?)" } else { Ok "удалён каталог $d" }
        }
        foreach ($a in $pgArchives) { Remove-Item $a.FullName -Force; Ok "удалён дистрибутив $($a.Name)" }
        Remove-IbFromList
        cmd /c 'schtasks /End /TN pgtrace >nul 2>nul'
        cmd /c 'schtasks /Delete /TN pgtrace /F >nul 2>nul'
        Get-Process pgtrace -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Ok 'прошлая установка удалена'
    }

    # =================================================================
    Step '1. Проверка архивов'
    Write-Host '  -- Платформа 1С'
    $PlatformDir = Expand-Source $Sources.Platform
    Write-Host '  -- Конфигурация "Автосервис"'
    $ConfDir     = Expand-Source $Sources.Config

    # =================================================================
    $PlatformInstallDir = Join-Path $ProgramsDir "1cv8\$PlatformVersion"
    Step "2. Установка 1С:Предприятие $PlatformVersion в $PlatformInstallDir (без сервера)"
    $msi1C = Get-ChildItem $PlatformDir -Recurse -Filter '1CEnterprise*.msi' | Select-Object -First 1
    if (-not $msi1C) { throw "MSI 1С не найден в $PlatformDir" }
    $msiDir = $msi1C.DirectoryName
    $mst = @('adminstallrelogon.mst', '1049.mst') | Where-Object { Test-Path (Join-Path $msiDir $_) }
    $transforms = if ($mst) { "TRANSFORMS=`"$($mst -join ';')`"" } else { '' }
    $args1C = "/qn $transforms DESIGNERALLCLIENTS=1 THICKCLIENT=1 THINCLIENTFILE=1 THINCLIENT=1 " +
              "WEBSERVEREXT=0 SERVER=0 SERVERCLIENT=0 CONFREPOSSERVER=0 CONVERTER77=0 LANGUAGES=RU " +
              "INSTALLDIR=`"$PlatformInstallDir`""
    Push-Location $msiDir
    try { $code = Invoke-Msi '/i' $msi1C.FullName $args1C '1c_msi.log' } finally { Pop-Location }
    if ($code -notin 0, 3010) { throw "Установка 1С завершилась с кодом $code (см. logs\1c_msi.log)" }
    $Bin1C = Find-1CBin
    if (-not $Bin1C) { throw "1С установлена, но 1cv8.exe $PlatformVersion не найден" }
    if ((Split-Path -Qualifier $Bin1C) -ne $TargetDrive) { Warn "1С установилась не на $TargetDrive (INSTALLDIR проигнорирован?): $Bin1C" }
    Ok "1С: $Bin1C"

    # =================================================================
    if (-not $NoTrace) {
        Step '2б. Технологический журнал (logcfg.xml)'
        New-Item -ItemType Directory -Force -Path $TechLogDir | Out-Null
        # 1С в файловом режиме пишет ТЖ от имени пользователя, запустившего клиент
        & icacls $TechLogDir /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null   # BUILTIN\Users

        if (-not $LogcfgPath) { $LogcfgPath = Get-LogcfgPath $Bin1C }
        $bits = if ($msi1C.Name -match 'x86-64|x64') { 64 } else { 32 }
        Ok "платформа $bits-бит — logcfg.xml: $LogcfgPath"
        Remove-StrayLogcfg $LogcfgPath

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogcfgPath) | Out-Null
        # свой прошлый logcfg просто перезаписываем; чужой — сохраняем копию
        if ((Test-Path $LogcfgPath) -and ((Get-Content $LogcfgPath -Raw -Encoding UTF8) -notmatch 'Сгенерировано install-1c')) {
            $bak = "$LogcfgPath.bak.{0:yyyyMMddHHmmss}" -f (Get-Date)
            Copy-Item $LogcfgPath $bak -Force
            Ok "старый logcfg сохранён: $bak"
        }

        # Файловая СУБД пишет события DBV8DBEng (DBMS — только для внешних СУБД).
        # duration в logcfg — в стотысячных долях секунды (10000 = 1 с) → N мс = N*10
        $durationUnits = [math]::Max(0, $TechLogThresholdMs) * 10
        $logcfgXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<!-- Сгенерировано install-1c.ps1: ТЖ DBV8DBEng >= $TechLogThresholdMs мс -> $TechLogDir -->
<config xmlns="http://v8.1c.ru/v8/tech-log">
  <log location="$TechLogDir" history="24">
    <event>
      <eq property="name" value="DBV8DBEng"/>
      <ge property="duration" value="$durationUnits"/>
    </event>
    <property name="all"/>
  </log>
</config>
"@
        [IO.File]::WriteAllText($LogcfgPath, $logcfgXml, (New-Object Text.UTF8Encoding $false))
        Ok "записан $LogcfgPath (порог DBV8DBEng $TechLogThresholdMs мс, каталог $TechLogDir)"
    } else {
        Warn 'технологический журнал пропущен (-NoTrace)'
    }

    # =================================================================
    Step "3. Создание файловой базы в $IbDir"
    $v8 = Join-Path $Bin1C '1cv8.exe'

    function Invoke-1C([string]$ArgsLine, [string]$Tag) {
        $out = Join-Path $LogDir "1c_$Tag.log"
        $res = Join-Path $LogDir "1c_$Tag.result"
        Remove-Item $res -ErrorAction SilentlyContinue
        Start-Process $v8 -ArgumentList "$ArgsLine /DisableStartupDialogs /DisableStartupMessages /Out `"$out`" /DumpResult `"$res`"" -Wait
        $code = if (Test-Path $res) { (Get-Content $res -Raw).Trim() } else { '-1' }
        if ($code -ne '0') {
            if (Test-Path $out) { Get-Content $out -Encoding UTF8 | Write-Host }
            throw "1С ($Tag) завершилась с кодом $code, лог: $out"
        }
    }

    # Пользователь 1С (если в базе есть список пользователей). $null — ещё не подобран.
    $script:ibAuth = $null
    if ($IbUser) {
        $ibPwdPlain = if ($IbPassword) { (New-Object Net.NetworkCredential('', $IbPassword)).Password } else { '' }
        $script:ibAuth = "/N `"$IbUser`" /P `"$ibPwdPlain`""
    }

    # Операция конфигуратора над файловой базой. Первая такая операция подбирает пользователя:
    # без пользователя -> Админ/Администратор -> запрос (3 раза).
    function Invoke-1CIb([string]$Op, [string]$Tag) {
        if ($null -ne $script:ibAuth) {
            Invoke-1C "DESIGNER /F `"$IbDir`" $($script:ibAuth) $Op" $Tag
            return
        }
        $tries = @('', '/N "Админ" /P ""', '/N "Администратор" /P ""')
        for ($i = 0; ; $i++) {
            if ($i -lt $tries.Count) { $auth = $tries[$i] }
            elseif ($i -lt $tries.Count + 3) {
                Warn 'нужен пользователь 1С с правами администратора в базе "Автосервис"'
                $u  = Read-Host '  Имя пользователя 1С'
                $pw = Read-Host -AsSecureString '  Пароль (Enter — пустой)'
                $script:ibPwdPlain = (New-Object Net.NetworkCredential('', $pw)).Password
                $auth = "/N `"$u`" /P `"$($script:ibPwdPlain)`""
            }
            else { throw 'Не удалось войти в базу — нужны имя и пароль пользователя 1С с правами администратора' }
            try {
                Invoke-1C "DESIGNER /F `"$IbDir`" $auth $Op" $Tag
                $script:ibAuth = $auth
                return
            } catch {
                $log = Join-Path $LogDir "1c_$Tag.log"
                $authError = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
                if (-not $authError) { throw }
            }
        }
    }

    $ibFile = Join-Path $IbDir '1Cv8.1CD'
    if (Test-Path $ibFile) {
        Ok "база уже есть ($ibFile) — создание пропущено"
        Add-IbToList
    } else {
        # Источник: .dt -> .cf -> готовая файловая база 1Cv8.1CD -> шаблон (setup.exe + *.efd)
        $src = Get-ChildItem $ConfDir -Recurse -Include '*.dt', '*.cf' | Sort-Object { $_.Extension -ne '.dt' } | Select-Object -First 1
        $srcDb = $null
        if (-not $src) {
            $srcDb = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.1CD' | Select-Object -First 1
        }
        if (-not $src -and -not $srcDb) {
            $setup = Get-ChildItem $ConfDir -Recurse -Filter 'setup.exe' | Select-Object -First 1
            if ($setup -and (Get-ChildItem $setup.DirectoryName -Filter '*.efd')) {
                Write-Host '  Найден шаблон конфигурации, тихая установка шаблона...'
                Start-Process $setup.FullName -ArgumentList "/s /d `"$(Join-Path $ConfDir 'tmplts')`"" -Wait
                $src = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.cf' | Select-Object -First 1
            }
        }
        if (-not $src -and -not $srcDb) { throw "В $ConfDir не найдены .dt/.cf/1Cv8.1CD" }
        $srcItem = if ($src) { $src } else { $srcDb }
        Ok ("источник базы: {0} ({1:N0} МБ)" -f $srcItem.FullName, ($srcItem.Length / 1MB))

        if (-not $SkipSpaceCheck) {
            # Файловая база из .dt заметно больше самого .dt (индексы, итоги)
            $srcGB  = [math]::Round($srcItem.Length / 1GB, 1)
            $needGB = if ($srcDb) { [math]::Round($srcGB + 1, 1) } else { [math]::Round($srcGB * 3 + 1, 1) }
            $freeGB = Get-FreeGB $IbDir
            if ($freeGB -lt $needGB) {
                throw "Для базы на диске $((Split-Path -Qualifier $IbDir)) нужно ~$needGB ГБ (источник = $srcGB ГБ), свободно $freeGB ГБ. Освободите место."
            }
            Ok "место под базу: нужно ~$needGB ГБ, свободно $freeGB ГБ"
        }

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $IbDir) | Out-Null
        $conn    = "File=`"$IbDir`";Locale=ru"
        $connArg = "`"$($conn -replace '"','""')`""
        if ($srcDb) {
            Write-Host "  Копирование файловой базы $($srcDb.DirectoryName) -> $IbDir"
            New-Item -ItemType Directory -Force -Path $IbDir | Out-Null
            Copy-Item (Join-Path $srcDb.DirectoryName '*') $IbDir -Recurse -Force
            Add-IbToList
        } elseif ($src.Extension -eq '.cf') {
            Invoke-1C "CREATEINFOBASE $connArg /UseTemplate `"$($src.FullName)`" /AddToList `"$IbTitle`"" 'create'
        } else {
            Invoke-1C "CREATEINFOBASE $connArg /AddToList `"$IbTitle`"" 'create'
            Write-Host '  Загрузка .dt (может занять несколько минут)...'
            Invoke-1C "DESIGNER /F `"$IbDir`" /RestoreIB `"$($src.FullName)`"" 'restore'
        }
        Ok "база создана: $IbDir"
    }

    # =================================================================
    #  Расширение конфигурации (.cfe). База файловая — доступ монопольный, блокировок фоновыми заданиями нет.
    if ($ExtensionFile) {
        Step '3б. Подключение расширения конфигурации'
        if (-not (Test-Path $ExtensionFile)) { throw "Файл расширения не найден: $ExtensionFile" }
        if (-not $ExtensionName) {
            $ExtensionName = ([IO.Path]::GetFileNameWithoutExtension($ExtensionFile)) -replace '_v[\d.]+$', ''
        }
        Ok "файл: $ExtensionFile  ->  расширение '$ExtensionName'"
        Invoke-1CIb "/LoadCfg `"$ExtensionFile`" -Extension `"$ExtensionName`"" 'ext_load'
        Invoke-1CIb "/UpdateDBCfg -Extension `"$ExtensionName`"" 'ext_apply'
        Ok "расширение '$ExtensionName' подключено и применено"
    }

    # =================================================================
    Step '4. Проверка'
    $allOk = $true
    $tjMark = Get-Date
    if (Test-Path $ibFile) { Ok ("файл базы: {0} ({1:N0} МБ)" -f $ibFile, ((Get-Item $ibFile).Length / 1MB)) }
    else { Warn "нет файла базы $ibFile"; $allOk = $false }

    try {
        $tmpCf = Join-Path $LogDir 'check_conn.cf'
        Invoke-1CIb "/DumpCfg `"$tmpCf`"" 'check'
        Remove-Item $tmpCf -ErrorAction SilentlyContinue
        Ok "1С: конфигуратор открыл базу $IbDir"
    } catch { Warn $_.Exception.Message; $allOk = $false }

    if (-not $NoTrace) {
        Write-Host '  Ожидание записи технологического журнала (5 с)...'
        Start-Sleep -Seconds 5
        if (Test-TechLogFresh -Dir $TechLogDir -Since $tjMark) {
            Ok "технологический журнал пишет в $TechLogDir"
        } else {
            Warn "ТЖ не дал новых файлов в $TechLogDir после проверки входа."
            Warn "Короткие запросы могут не превысить порог $TechLogThresholdMs мс — проверьте под нагрузкой или снизьте -TechLogThresholdMs."
        }
    }

    if ($allOk) { Write-Host "`nГОТОВО. База: File=`"$IbDir`" ($IbTitle)" -ForegroundColor Green }
    else        { Write-Host "`nЗавершено с предупреждениями, смотрите $LogDir" -ForegroundColor Yellow }
    if (-not $NoTrace) {
        Write-Host "Технологический журнал:" -ForegroundColor Green
        Write-Host "  logcfg:  $LogcfgPath"
        Write-Host "  каталог: $TechLogDir (DBV8DBEng >= $TechLogThresholdMs мс, history 24 ч)"
    }

    # =================================================================
    #  Демо-данные АРМ (seed-1c.ps1 рядом со скриптом): спросить, при согласии — передать базу и пользователя
    $seedScript = Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }) 'seed-1c.ps1'
    $doSeed = $false
    if ($NoSeed) { }
    elseif (-not $allOk) { Warn 'установка с предупреждениями — seed не предлагается (запустите seed-1c.ps1 вручную)' }
    elseif (-not $ExtensionFile) { Warn 'расширение АРМ не подключено — seed не предлагается' }
    elseif (-not (Test-Path $seedScript)) { Warn "нет $seedScript — seed не предлагается" }
    elseif ($Seed) { $doSeed = $true }
    else { $doSeed = (Read-Host "`n  Заполнить базу демо-данными АРМ (seed: сценарии из seed\Шаблон деталей.xlsx)? (Y/N)") -match '^[YyДд]' }

    if ($doSeed) {
        Step '5. Демо-данные АРМ (seed)'
        # пользователь, под которым конфигуратор вошёл в базу (подобран на шаге 3/3б); '' — в базе нет пользователей
        $seedUser = ''; $seedPwd = ''
        if ($script:ibAuth -match '/N "([^"]*)" /P "([^"]*)"') { $seedUser = $Matches[1]; $seedPwd = $Matches[2] }
        $seedArgs = @{ IbDir = $IbDir; IbUser = $seedUser; IbPassword = $seedPwd }
        if ($SeedKeepSafeModeOff) { $seedArgs.KeepSafeModeOff = $true }
        Write-Host "  seed-1c.ps1 -IbDir `"$IbDir`" -IbUser `"$seedUser`"$(if ($SeedKeepSafeModeOff) { ' -KeepSafeModeOff' })"
        & $seedScript @seedArgs
        $seedCode = $LASTEXITCODE
        $seedPwd = $null; $seedArgs = $null
        if ($seedCode -eq 0) { Ok 'демо-данные АРМ загружены' }
        else { Warn "seed завершился с кодом $seedCode — повторить: .\seed-1c.ps1 -IbDir `"$IbDir`"" }
    } elseif (-not $NoSeed -and $allOk -and $ExtensionFile) {
        Write-Host "  seed пропущен. Позже: .\seed-1c.ps1 -IbDir `"$IbDir`""
    }

    # =================================================================
    #  Запуск 1С:Предприятие под администратором 1С «Админ» (пустой пароль) — сразу в базу, без окна выбора
    if ($allOk -and -not $NoLaunch) {
        Step '6. Запуск 1С:Предприятие'
        $client = Join-Path $Bin1C '1cv8c.exe'                 # тонкий клиент; нет — 1cv8.exe ENTERPRISE
        $launch = if (Test-Path $client) { @{ Exe = $client; Args = '' } } else { @{ Exe = (Join-Path $Bin1C '1cv8.exe'); Args = 'ENTERPRISE ' } }
        Start-Process $launch.Exe -ArgumentList "$($launch.Args)/F `"$IbDir`" /N `"Админ`" /P `"`""
        Ok "запущен $(Split-Path -Leaf $launch.Exe): база $IbDir, пользователь «Админ» (пароль пустой)"
    }
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Строка $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
    Write-Host "Логи: $LogDir" -ForegroundColor Red
}
finally {
    $ibPwdPlain = $null
    $script:ibPwdPlain = $null
    $script:ibAuth = $null
    Stop-Transcript | Out-Null
}
