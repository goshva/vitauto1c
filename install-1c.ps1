#Requires -Version 5.1
<#
.SYNOPSIS
  Файловый вариант: 1С:Предприятие 8.3.27.2342 (клиенты) + файловая база "Автосервис" из .dt.
  Без PostgreSQL и без сервера 1С. Клиент-серверный вариант (PostgreSQL) — install-1c-pgsql.ps1.

  Шаги:
    0. Полное удаление прошлой установки (процессы, MSI платформы, каталог базы, список баз)
       и всего, что осталось от клиент-серверной: PostgreSQL 1C и её службы, данные (C:\PGDATA15),
       кластер 1С (C:\srvinfo), служба сервера 1С, дистрибутивы PostgreSQL, коллектор pgtrace
    1. Проверка архивов (наличие, размер, целостность) -> докачка при необходимости -> распаковка
    2. Тихая установка 1С (толстый/тонкий клиент + конфигуратор, без сервера)
    2б. Технологический журнал: logcfg.xml в conf по разрядности установленной платформы
    3. Создание файловой базы в -IbDir: из .dt (RestoreIB), .cf (шаблон) или копией 1Cv8.1CD
    3б. Подключение расширения (.cfe)
    4. Проверка (файл базы, вход конфигуратором) и записи ТЖ

  Архивы по умолчанию сохраняются в -BaseDir, чтобы повторный запуск не качал их заново.
  Ключ -DeleteArchives удаляет их после распаковки.
  Трассировка — технологический журнал 1С. -NoTrace отключает настройку и проверку ТЖ.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1 -Force -DeleteArchives -IbDir D:\1c_bases\autoservice
#>
param(
    [string]      $BaseDir     = $(if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\soft\1c' }),
    [string]      $IbDir       = 'C:\1c_bases\autoservice',   # каталог файловой базы (1Cv8.1CD)
    [string]      $IbTitle     = 'Автосервис',      # имя в списке баз
    [switch]      $Force,                           # удалять прошлую установку без подтверждения
    [switch]      $DeleteArchives,                  # удалить архивы после распаковки
    [string]      $IbUser,                          # пользователь 1С в базе «Автосервис» (если есть список пользователей)
    [SecureString]$IbPassword,                      # его пароль; при -IbUser без пароля будет запрошен
    [string]      $ExtensionFile,                    # путь к .cfe; не задан — последняя версия <имя>_vN.cfe рядом со скриптом; '' — не подключать
    [string]      $ExtensionName,                    # имя расширения в базе; по умолчанию — из имени файла
    [double]      $EstDbGB       = 6,                 # оценка размера файловой базы (для проверки места)
    [switch]      $SkipSpaceCheck,                    # пропустить проверку свободного места на диске
    # --- технологический журнал 1С (logcfg.xml) ---
    [switch]      $NoTrace,                           # не настраивать и не проверять ТЖ
    [string]      $TechLogDir          = 'D:\1c\tj',  # каталог файлов ТЖ (HDD, не SSD с базой)
    [int]         $TechLogThresholdMs  = 200,         # логировать обращения к файловой СУБД дольше N мс
    [string]      $LogcfgPath,                        # по умолчанию <корень 1cv8>\conf\logcfg.xml по разрядности установленной платформы
    # --- остатки клиент-серверной установки (install-1c-pgsql.ps1) — удаляются на шаге 0 ---
    [string]      $PgDataDir   = 'C:\PGDATA15',
    [string]      $SrvInfoDir  = 'C:\srvinfo'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------- Запуск от администратора ----------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
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

$PlatformVersion = '8.3.27.2342'
$Sources = [ordered]@{
    Platform = @{ Url = 'https://disk.yandex.ru/d/WmdHaZZr45QoXA'; File = 'windows_8_3_27_2342.rar'; Dir = 'platform_8_3_27_2342' }
    Config   = @{ Url = 'https://disk.yandex.ru/d/xl9suLCSUGRpPA'; File = 'autoservice.zip';         Dir = 'config_autoservice' }
}

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir ("install_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))) | Out-Null

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

# =====================================================================
#  Вспомогательные функции
# =====================================================================
function Get-7Zip {
    $candidates = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe")
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

# Проверить архив (наличие, размер, целостность); при проблемах — докачать/перекачать
function Confirm-Archive($src) {
    $archive = Join-Path $BaseDir $src.File
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
    $archive = Confirm-Archive $src
    $dest    = Join-Path $BaseDir $src.Dir
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Host "  Распаковка -> $dest"
    & $script:SevenZip x $archive "-o$dest" -y -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw "Ошибка распаковки $archive" }
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
# (архивы и распаковка на диске BaseDir, программы на системном, база на диске IbDir).
function Assert-FreeSpace {
    Write-Host '  Оценка требуемого места на диске...'
    $need = @{}   # буква диска -> нужно ГБ
    function Add-Need([string]$path, [double]$gb) {
        $d = (Split-Path -Qualifier $path).ToUpper()
        $need[$d] = [math]::Round(($need[$d] + $gb), 1)
    }

    # Архивы: если их нет — придётся скачать; при распаковке архив и папка лежат вместе
    foreach ($src in $Sources.Values) {
        $archive = Join-Path $BaseDir $src.File
        if (Test-Path $archive) {
            $gb = (Get-Item $archive).Length / 1GB
        } else {
            $gb = (Get-YandexSize $src.Url) / 1GB
            Add-Need $BaseDir $gb                    # сам архив
        }
        Add-Need $BaseDir ($gb * 1.6)                # распакованное содержимое
    }
    Add-Need $env:ProgramFiles 1.5                   # платформа 1С
    Add-Need $IbDir $EstDbGB                         # файловая база

    $buffer = 2.0                                    # запас на журналы, temp, рост
    $fail = $false
    foreach ($d in $need.Keys) {
        $req  = [math]::Round(($need[$d] + $buffer), 1)
        $free = Get-FreeGB "$d\"
        if ($free -ge $req) { Ok "диск $d : нужно ~$req ГБ, свободно $free ГБ" }
        else { Warn "диск $d : нужно ~$req ГБ, свободно только $free ГБ — не хватает $([math]::Round($req - $free,1)) ГБ"; $fail = $true }
    }
    if ($fail) {
        throw "Недостаточно места на диске. Освободите место или задайте другой диск ключами -BaseDir/-IbDir, либо пропустите проверку ключом -SkipSpaceCheck."
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
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
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

# logcfg.xml читается из <корень 1cv8>\conf той разрядности, что и платформа:
# 32-бит — Program Files (x86)\1cv8\conf, 64-бит — Program Files\1cv8\conf.
# $Bin = ...\1cv8\<версия>\bin -> ...\1cv8\conf\logcfg.xml
function Get-LogcfgPath([string]$Bin) {
    Join-Path (Split-Path -Parent (Split-Path -Parent $Bin)) 'conf\logcfg.xml'
}

# Удалить logcfg.xml и logcfg.xml.bak.*, записанные этими скриптами в других местах
# (каталог conf другой разрядности платформа не читает). Чужие файлы не трогаем.
function Remove-StrayLogcfg([string]$Keep) {
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
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

# =====================================================================
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
    Step '0. Удаление прошлой установки'
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
    $oldDirs = @($IbDir, $PgDataDir, $SrvInfoDir) + ($Sources.Values | ForEach-Object { Join-Path $BaseDir $_.Dir }) +
               @(Get-ChildItem $BaseDir -Directory -Filter 'postgresql_15*' -ErrorAction SilentlyContinue | ForEach-Object FullName) |
               Where-Object { $_ -and (Test-Path $_) }
    $pgArchives = @(Get-ChildItem $BaseDir -File -Filter 'postgresql_15*.zip' -ErrorAction SilentlyContinue)
    $pgtraceTask = (cmd /c 'schtasks /Query /TN pgtrace >nul 2>nul && echo yes') -eq 'yes'

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

        $leftovers = $oldDirs + @(
            (Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -Filter '15*1C*' -ErrorAction SilentlyContinue | ForEach-Object FullName),
            "$env:ProgramFiles\1cv8\$PlatformVersion", "${env:ProgramFiles(x86)}\1cv8\$PlatformVersion"
        ) | Where-Object { $_ -and (Test-Path $_) }
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
    Step '1. Проверка свободного места и архивов'
    if ($SkipSpaceCheck) { Warn 'проверка свободного места пропущена (-SkipSpaceCheck)' } else { Assert-FreeSpace }
    Write-Host '  -- Платформа 1С'
    $PlatformDir = Expand-Source $Sources.Platform
    Write-Host '  -- Конфигурация "Автосервис"'
    $ConfDir     = Expand-Source $Sources.Config

    # =================================================================
    Step "2. Установка 1С:Предприятие $PlatformVersion (без сервера)"
    $msi1C = Get-ChildItem $PlatformDir -Recurse -Filter '1CEnterprise*.msi' | Select-Object -First 1
    if (-not $msi1C) { throw "MSI 1С не найден в $PlatformDir" }
    $msiDir = $msi1C.DirectoryName
    $mst = @('adminstallrelogon.mst', '1049.mst') | Where-Object { Test-Path (Join-Path $msiDir $_) }
    $transforms = if ($mst) { "TRANSFORMS=`"$($mst -join ';')`"" } else { '' }
    $args1C = "/qn $transforms DESIGNERALLCLIENTS=1 THICKCLIENT=1 THINCLIENTFILE=1 THINCLIENT=1 " +
              "WEBSERVEREXT=0 SERVER=0 SERVERCLIENT=0 CONFREPOSSERVER=0 CONVERTER77=0 LANGUAGES=RU"
    Push-Location $msiDir
    try { $code = Invoke-Msi '/i' $msi1C.FullName $args1C '1c_msi.log' } finally { Pop-Location }
    if ($code -notin 0, 3010) { throw "Установка 1С завершилась с кодом $code (см. logs\1c_msi.log)" }
    $Bin1C = Find-1CBin
    if (-not $Bin1C) { throw "1С установлена, но 1cv8.exe $PlatformVersion не найден" }
    Ok "1С: $Bin1C"

    # =================================================================
    if (-not $NoTrace) {
        Step '2б. Технологический журнал (logcfg.xml)'
        New-Item -ItemType Directory -Force -Path $TechLogDir | Out-Null
        # 1С в файловом режиме пишет ТЖ от имени пользователя, запустившего клиент
        & icacls $TechLogDir /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null   # BUILTIN\Users

        if (-not $LogcfgPath) { $LogcfgPath = Get-LogcfgPath $Bin1C }
        $bits = if ($Bin1C -like "${env:ProgramFiles(x86)}*") { 32 } else { 64 }
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
        $tmpCf = Join-Path $env:TEMP 'check_conn.cf'
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
