#Requires -Version 5.1
<#
.SYNOPSIS
  Чистая переустановка: 1С:Предприятие 8.3.27.2342 + PostgreSQL 15.13-1.1C + конфигурация "Автосервис".

  Шаги:
    0. Полное удаление прошлой установки (службы, процессы, MSI, каталоги данных, список баз)
    1. Проверка архивов (наличие, размер, целостность) -> докачка при необходимости -> распаковка
    2. Тихая установка PostgreSQL (+ initdb и служба, если MSI их не создал)
    3. Тихая установка 1С (клиенты + сервер) + служба агента сервера
    3б. Технологический журнал (logcfg.xml) + рестарт агента
    4. Создание базы на сервере 1С из cf/dt
    5. Проверка подключения (порты, PostgreSQL, вход конфигуратором) и записи ТЖ

  Архивы по умолчанию сохраняются в -BaseDir, чтобы повторный запуск не качал 3.7 ГБ заново.
  Ключ -DeleteArchives удаляет их после распаковки.
  Трассировка — технологический журнал 1С (не Redis/pgtrace). -NoTrace отключает настройку и проверку ТЖ.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1
  powershell -ExecutionPolicy Bypass -File .\install-1c.ps1 -Force -DeleteArchives
#>
param(
    [string]      $BaseDir     = $(if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\soft\1c' }),
    [SecureString]$PgPassword,                      # если не задан — будет запрошен
    [string]      $PgUser      = 'postgres',
    [int]         $PgPort      = 5432,
    [string]      $PgDataDir   = 'C:\PGDATA15',     # только латиница в пути!
    [string]      $SrvInfoDir  = 'C:\srvinfo',      # каталог кластера 1С
    [string]      $IbName      = 'autoservice',     # имя базы в кластере и в PostgreSQL
    [string]      $IbTitle     = 'Автосервис',      # имя в списке баз
    [string]      $Server1C    = 'localhost',
    [switch]      $Force,                           # удалять прошлую установку без подтверждения
    [switch]      $DeleteArchives,                  # удалить архивы после распаковки
    [string]      $IbUser,                          # пользователь 1С в базе «Автосервис» (если есть список пользователей)
    [SecureString]$IbPassword,                      # его пароль; при -IbUser без пароля будет запрошен
    [string]      $ExtensionFile = $(if ($PSScriptRoot) { Join-Path $PSScriptRoot 'АРМЗакупокИПродаж_v1.cfe' } else { 'АРМЗакупокИПродаж_v1.cfe' }),  # расширение (.cfe) рядом со скриптом; '' — не подключать
    [string]      $ExtensionName,                    # имя расширения в базе; по умолчанию — из имени файла
    [double]      $EstDbGB       = 6,                 # оценка размера базы в PostgreSQL (для проверки места)
    [switch]      $SkipSpaceCheck,                    # пропустить проверку свободного места на диске
    # --- технологический журнал 1С (logcfg.xml) ---
    [switch]      $NoTrace,                           # не настраивать и не проверять ТЖ
    [string]      $TechLogDir          = 'D:\1c\tj',  # каталог файлов ТЖ (HDD, не SSD с базой)
    [int]         $TechLogThresholdMs  = 200,         # логировать события DBMS дольше N мс
    [string]      $LogcfgPath          = 'C:\Program Files\1cv8\conf\logcfg.xml'
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
        if ($kv.Key -in 'PgPassword', 'IbPassword') { continue }   # SecureString не передать в другой процесс — спросим заново
        if ($kv.Value -is [switch]) { if ($kv.Value) { $argList += "-$($kv.Key)" } }
        else { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

$PlatformVersion = '8.3.27.2342'
$Sources = [ordered]@{
    Platform = @{ Url = 'https://disk.yandex.ru/d/WmdHaZZr45QoXA'; File = 'windows_8_3_27_2342.rar';       Dir = 'platform_8_3_27_2342' }
    Postgres = @{ Url = 'https://disk.yandex.ru/d/B2Lpn8-7A0WVEg'; File = 'postgresql_15.13_1.1C_x64.zip'; Dir = 'postgresql_15.13_1.1C' }
    Config   = @{ Url = 'https://disk.yandex.ru/d/xl9suLCSUGRpPA'; File = 'autoservice.zip';               Dir = 'config_autoservice' }
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
        $archive = Join-Path $BaseDir $src.File
        if (Test-Path $archive) {
            $gb = (Get-Item $archive).Length / 1GB
        } else {
            $gb = (Get-YandexSize $src.Url) / 1GB
            Add-Need $BaseDir $gb                    # сам архив
        }
        Add-Need $BaseDir ($gb * 1.6)                # распакованное содержимое
    }
    Add-Need $BaseDir 2.5                            # промежуточный autoservice.dt
    Add-Need $env:ProgramFiles 2.5                   # PostgreSQL + платформа 1С
    Add-Need $PgDataDir $EstDbGB                     # база в PostgreSQL

    $buffer = 2.0                                    # запас на журналы, temp, рост
    $fail = $false
    foreach ($d in $need.Keys) {
        $req  = [math]::Round(($need[$d] + $buffer), 1)
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
    } finally {
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

function Find-PgBin {
    Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '15*' } |
        Sort-Object { $_.Name -notlike '*1C*' } |
        ForEach-Object { Join-Path $_.FullName 'bin' } |
        Where-Object { Test-Path (Join-Path $_ 'pg_ctl.exe') } |
        Select-Object -First 1
}

function Find-1CBin {
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
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

# Удалить из списка баз (ibases.v8i) секции, указывающие на нашу серверную базу
function Remove-IbFromList {
    $pattern = "Srvr=`"?$([regex]::Escape($Server1C))`"?;Ref=`"?$([regex]::Escape($IbName))`"?;"
    foreach ($f in @("$env:APPDATA\1C\1CEStart\ibases.v8i")) {
        if (-not (Test-Path $f)) { continue }
        $text  = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
        $parts = [regex]::Split($text, '(?m)^(?=\[)')
        $kept  = $parts | Where-Object { $_ -notmatch $pattern }
        if (@($kept).Count -ne @($parts).Count) {
            [IO.File]::WriteAllText($f, (-join $kept), (New-Object Text.UTF8Encoding $true))
            Ok "база удалена из списка: $f"
        }
    }
}

# =====================================================================
try {
    if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString 'Пароль суперпользователя PostgreSQL (для новой установки)' }
    if ($PgPassword.Length -eq 0) { throw 'Пароль PostgreSQL не задан' }
    if ($IbUser -and -not $IbPassword) { $IbPassword = Read-Host -AsSecureString "Пароль пользователя 1С '$IbUser' (Enter — пустой)" }
    # открытый текст нужен msiexec/initdb/psql/1С — держим только в памяти
    $PgPasswordPlain = (New-Object Net.NetworkCredential('', $PgPassword)).Password
    # psql (Windows) шлёт пароль в CP1251, 1С — в UTF-8. При не-ASCII символах хэш md5
    # совпадёт только с одним из них -> "password authentication failed". Требуем ASCII.
    if ($PgPasswordPlain.ToCharArray() | Where-Object { [int]$_ -gt 126 -or [int]$_ -lt 32 }) {
        throw 'Пароль PostgreSQL должен состоять только из ASCII: латиница, цифры, спецсимволы (без кириллицы и пробелов по краям). Иначе psql и 1С используют разные кодировки и вход не пройдёт.'
    }

    $SevenZip = Get-7Zip

    # =================================================================
    Step '0. Удаление прошлой установки'
    $oldProducts = Get-UninstallEntries | Where-Object {
        ($_.DisplayName -match '^1[CС]' -and $_.DisplayVersion -eq $PlatformVersion) -or
        ($_.DisplayName -like 'PostgreSQL*' -and ($_.DisplayName -like '*1C*' -or $_.DisplayVersion -like '15.*1C*'))
    }
    $ourPaths = @("1cv8\$PlatformVersion", 'PostgreSQL\15*1C', $PgDataDir, $SrvInfoDir)
    $isOurs   = { param($path) foreach ($p in $ourPaths) { if ($path -and $path -like "*$p*") { return $true } }; $false }
    $oldServices = Get-CimInstance Win32_Service | Where-Object { & $isOurs $_.PathName }
    $oldDirs = @($PgDataDir, $SrvInfoDir) + ($Sources.Values | ForEach-Object { Join-Path $BaseDir $_.Dir }) |
               Where-Object { Test-Path $_ }

    if (-not ($oldProducts -or $oldServices -or $oldDirs)) {
        Ok 'следов прошлой установки нет'
    } else {
        Write-Host '  Будет удалено:' -ForegroundColor Yellow
        $oldProducts | ForEach-Object { Write-Host "    программа: $($_.DisplayName) $($_.DisplayVersion)" }
        $oldServices | ForEach-Object { Write-Host "    служба:    $($_.Name)" }
        $oldDirs     | ForEach-Object { Write-Host "    каталог:   $_" }
        Write-Host '  ВНИМАНИЕ: данные баз PostgreSQL в этих каталогах будут потеряны.' -ForegroundColor Red
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
    Write-Host '  -- PostgreSQL 1C'
    $PgDistDir   = Expand-Source $Sources.Postgres
    Write-Host '  -- Конфигурация "Автосервис"'
    $ConfDir     = Expand-Source $Sources.Config

    # =================================================================
    Step '2. Установка PostgreSQL 15.13-1.1C'
    # Порт может быть занят другим PostgreSQL (например, обычным 17-м) — берём первый свободный
    $busy = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object LocalPort)
    if ($busy -contains $PgPort) {
        $free = ($PgPort + 1)..($PgPort + 20) | Where-Object { $busy -notcontains $_ } | Select-Object -First 1
        Warn "порт $PgPort занят другим процессом — PostgreSQL 1C будет на порту $free"
        $PgPort = $free
    }
    $pgMsi = Get-ChildItem $PgDistDir -Recurse -Filter '*.msi' | Select-Object -First 1
    if (-not $pgMsi) { throw "MSI PostgreSQL не найден в $PgDistDir" }
    # MSI ставит только программу: initdb внутри инсталлятора падает (например, на спецсимволах
    # пароля) и удаляет свой лог, а служба по умолчанию лезет на занятый порт 5432.
    # Кластер и службу создаём сами — ошибки initdb видны прямо в консоли.
    $code = Invoke-Msi '/i' $pgMsi.FullName "/qn INTERNALLAUNCH=1 DOSERVICE=0 DOINITDB=0 LISTENPORT=$PgPort" 'postgres_msi.log'
    if ($code -notin 0, 3010) { throw "Установка PostgreSQL завершилась с кодом $code (см. logs\postgres_msi.log)" }
    $PgBin = Find-PgBin
    if (-not $PgBin) { throw 'PostgreSQL установлен, но bin\pg_ctl.exe не найден' }
    Ok "PostgreSQL: $PgBin"

    # Если инсталлятор всё же создал свою службу — убираем, чтобы не конфликтовала
    Get-CimInstance Win32_Service | Where-Object { $_.PathName -like "*$PgBin*" } | ForEach-Object {
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        & sc.exe delete "$($_.Name)" | Out-Null
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
    } finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
    if ($rc -ne 0) { throw "initdb завершился с кодом $rc (сообщения выше)" }
    $conf = Join-Path $PgDataDir 'postgresql.conf'
    Add-Content $conf "`nport = $PgPort`nlisten_addresses = '*'"
    & icacls $PgDataDir /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null   # NETWORK SERVICE

    $pgSvcName = 'postgresql-1c-15'
    & (Join-Path $PgBin 'pg_ctl.exe') register -N $pgSvcName -U 'NT AUTHORITY\NetworkService' -D $PgDataDir -S auto -w
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось зарегистрировать службу PostgreSQL' }
    try { Start-Service -Name $pgSvcName }
    catch { throw "Служба $pgSvcName не запустилась — смотрите $PgDataDir\log и журнал событий Windows (Application)" }
    Ok "служба PostgreSQL: $pgSvcName (Running, порт $PgPort)"

    # Ранняя проверка входа: ловим проблему с паролем здесь, а не на шаге 4
    $chk = Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -Sql 'select 1' -PwPlain $PgPasswordPlain -Tuple
    if ($chk.Code -ne 0) { throw "PostgreSQL запущен, но вход $PgUser не проходит: $($chk.Out)" }
    Ok "вход $PgUser на порт $PgPort проверен"

    # =================================================================
    Step "3. Установка 1С:Предприятие $PlatformVersion"
    $msi1C = Get-ChildItem $PlatformDir -Recurse -Filter '1CEnterprise*.msi' | Select-Object -First 1
    if (-not $msi1C) { throw "MSI 1С не найден в $PlatformDir" }
    $msiDir = $msi1C.DirectoryName
    $mst = @('adminstallrelogon.mst', '1049.mst') | Where-Object { Test-Path (Join-Path $msiDir $_) }
    $transforms = if ($mst) { "TRANSFORMS=`"$($mst -join ';')`"" } else { '' }
    $args1C = "/qn $transforms DESIGNERALLCLIENTS=1 THICKCLIENT=1 THINCLIENTFILE=1 THINCLIENT=1 " +
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
    Start-Sleep -Seconds 10   # даём кластеру подняться

    # =================================================================
    if (-not $NoTrace) {
        Step '3б. Технологический журнал (logcfg.xml)'
        New-Item -ItemType Directory -Force -Path $TechLogDir | Out-Null
        # ragent обычно работает как Local System; NETWORK SERVICE — на случай смены учётки
        & icacls $TechLogDir /grant '*S-1-5-18:(OI)(CI)F' /T /Q | Out-Null
        & icacls $TechLogDir /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null

        $confDir = Split-Path -Parent $LogcfgPath
        New-Item -ItemType Directory -Force -Path $confDir | Out-Null
        if (Test-Path $LogcfgPath) {
            $bak = "$LogcfgPath.bak.{0:yyyyMMddHHmmss}" -f (Get-Date)
            Copy-Item $LogcfgPath $bak -Force
            Ok "старый logcfg сохранён: $bak"
        }

        # duration в logcfg — в стотысячных долях секунды (10000 = 1 с) → N мс = N*10
        $durationUnits = [math]::Max(0, $TechLogThresholdMs) * 10
        $logcfgXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<!-- Сгенерировано install-1c.ps1: ТЖ DBMS >= $TechLogThresholdMs мс -> $TechLogDir -->
<config xmlns="http://v8.1c.ru/v8/tech-log">
  <log location="$TechLogDir" history="24">
    <event>
      <eq property="name" value="DBMS"/>
      <ge property="duration" value="$durationUnits"/>
    </event>
    <property name="all"/>
  </log>
</config>
"@
        [IO.File]::WriteAllText($LogcfgPath, $logcfgXml, (New-Object Text.UTF8Encoding $false))
        Ok "записан $LogcfgPath (порог DBMS $TechLogThresholdMs мс, каталог $TechLogDir)"

        Write-Host "  Перезапуск службы $($agentSvc.Name) для применения logcfg..."
        Restart-Service -Name $agentSvc.Name -Force
        Start-Sleep -Seconds 3
        if (-not (Wait-LocalPorts -Ports @(1540, 1541) -TimeoutSec 90)) {
            Warn 'порты 1540/1541 не поднялись за 90 с после рестарта агента — проверьте службу вручную'
        } else {
            Ok 'агент 1С снова слушает 1540/1541'
        }
    } else {
        Warn 'технологический журнал пропущен (-NoTrace)'
    }

    # =================================================================
    Step "4. Создание информационной базы '$IbName'"
    $v8     = Join-Path $Bin1C '1cv8.exe'
    $ibPath = "$Server1C\$IbName"

    # Пользователь 1С (если в базе есть список пользователей) — нужен для выгрузки и проверки
    $ibAuth = ''
    if ($IbUser) {
        $ibPwdPlain = if ($IbPassword) { (New-Object Net.NetworkCredential('', $IbPassword)).Password } else { '' }
        $ibAuth = "/N `"$IbUser`" /P `"$ibPwdPlain`""
    }

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

    $extBaked = $false   # расширение уже встроено в .dt (применено к файловой базе до миграции)
    $cfFile = Get-ChildItem $ConfDir -Recurse -Include '*.dt', '*.cf' | Sort-Object { $_.Extension -ne '.dt' } | Select-Object -First 1
    if (-not $cfFile) {
        # Файловая база (1Cv8.1CD) — сюда встраиваем расширение и выгружаем в .dt вместе с данными
        $fileDb = Get-ChildItem $ConfDir -Recurse -Filter '1Cv8.1CD' | Select-Object -First 1
        if ($fileDb) {
            $fdir   = $fileDb.DirectoryName
            $dtPath = Join-Path $ConfDir "$IbName.dt"
            Write-Host "  Найдена файловая база: $fdir"

            # Расширение выгодно применить здесь, к файловой базе: доступ монопольный,
            # фоновых заданий нет. Тогда .dt уже содержит расширение и на сервере
            # не потребуется UpdateDBCfg (который упирается в блокировку фоновыми заданиями).
            $applyExt = [bool]$ExtensionFile
            if ($applyExt -and -not (Test-Path $ExtensionFile)) { throw "Файл расширения не найден: $ExtensionFile" }
            if ($applyExt -and -not $ExtensionName) {
                $ExtensionName = ([IO.Path]::GetFileNameWithoutExtension($ExtensionFile)) -replace '_v[\d.]+$', ''
            }

            # Первая операция служит и проверкой входа: LoadCfg расширения (если есть) либо сразу DumpIB.
            # Подбор пользователя: заданный -> без пользователя -> Админ/Администратор -> запрос (3 раза).
            $tries    = if ($ibAuth) { @($ibAuth) } else { @('', '/N "Админ" /P ""', '/N "Администратор" /P ""') }
            $firstOp  = if ($applyExt) { "/LoadCfg `"$ExtensionFile`" -Extension `"$ExtensionName`"" } else { "/DumpIB `"$dtPath`"" }
            $firstTag = if ($applyExt) { 'ext_load' } else { 'dumpib' }
            if ($applyExt) { Write-Host "  Подключение расширения '$ExtensionName' к файловой базе..." }
            else           { Write-Host '  Выгрузка в .dt (может занять несколько минут)...' }
            $done = $false
            for ($i = 0; -not $done; $i++) {
                if ($i -lt $tries.Count) { $auth = $tries[$i] }
                elseif ($i -lt $tries.Count + 3) {
                    Warn 'нужен пользователь 1С с правами администратора в базе "Автосервис"'
                    $u  = Read-Host '  Имя пользователя 1С'
                    $pw = Read-Host -AsSecureString '  Пароль (Enter — пустой)'
                    $ibPwdPlain = (New-Object Net.NetworkCredential('', $pw)).Password
                    $auth = "/N `"$u`" /P `"$ibPwdPlain`""
                }
                else { throw 'Не удалось войти в файловую базу — нужны имя и пароль пользователя 1С с правами администратора' }
                try {
                    Invoke-1C "DESIGNER /F `"$fdir`" $auth $firstOp" $firstTag
                    $done = $true
                    $ibAuth = $auth   # тот же пользователь окажется и в серверной базе после загрузки
                } catch {
                    $log = Join-Path $LogDir "1c_$firstTag.log"
                    $authError = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
                    if (-not $authError) { throw }
                }
            }
            if ($applyExt) {
                # применяем расширение к файловой базе (монопольно) и выгружаем один раз
                Invoke-1C "DESIGNER /F `"$fdir`" $ibAuth /UpdateDBCfg -Extension `"$ExtensionName`"" 'ext_apply'
                Ok "расширение '$ExtensionName' встроено в базу до миграции"
                $extBaked = $true
                Write-Host '  Выгрузка в .dt (может занять несколько минут)...'
                Invoke-1C "DESIGNER /F `"$fdir`" $ibAuth /DumpIB `"$dtPath`"" 'dumpib'
            }
            Ok ("выгружено: {0} ({1:N0} МБ)" -f $dtPath, ((Get-Item $dtPath).Length / 1MB))
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

    $exists = (Invoke-Psql -Bin $PgBin -Port $PgPort -User $PgUser -Db postgres -PwPlain $PgPasswordPlain `
                           -Sql "SELECT 1 FROM pg_database WHERE datname='$IbName'" -Tuple).Out -eq '1'
    if ($exists) {
        Ok "база '$IbName' уже есть в PostgreSQL — создание пропущено"
    } else {
        $conn = "Srvr=`"$Server1C`";Ref=`"$IbName`";DBMS=PostgreSQL;DBSrvr=`"localhost port=$PgPort`";DB=`"$IbName`";" +
                "DBUID=`"$PgUser`";DBPwd=`"$PgPasswordPlain`";CrSQLDB=Y;SchJobDn=N;Locale=ru"
        $connArg = "`"$($conn -replace '"','""')`""
        if (-not $SkipSpaceCheck) {
            # Загрузка .dt в PostgreSQL кратно раздувается (индексы, WAL) — проверяем диск базы
            $dtGB   = [math]::Round($cfFile.Length / 1GB, 1)
            $needGB = [math]::Round($dtGB * 3 + 2, 1)
            $freeGB = Get-FreeGB "$PgDataDir\"
            if ($freeGB -lt $needGB) {
                throw "Для загрузки базы на диске $((Split-Path -Qualifier $PgDataDir)) нужно ~$needGB ГБ (.dt = $dtGB ГБ), свободно $freeGB ГБ. Освободите место."
            }
            Ok "место под базу: нужно ~$needGB ГБ, свободно $freeGB ГБ"
        }
        if ($cfFile.Extension -eq '.cf') {
            Invoke-1C "CREATEINFOBASE $connArg /UseTemplate `"$($cfFile.FullName)`" /AddToList `"$IbTitle`"" 'create'
        } else {
            Invoke-1C "CREATEINFOBASE $connArg /AddToList `"$IbTitle`"" 'create'
            Invoke-1C "DESIGNER /S `"$ibPath`" /RestoreIB `"$($cfFile.FullName)`"" 'restore'
        }
        Ok "база создана: $ibPath"
    }

    # =================================================================
    #  Расширение конфигурации (.cfe)
    if ($ExtensionFile -and $extBaked) {
        Ok "расширение '$ExtensionName' уже в базе (встроено до миграции)"
    } elseif ($ExtensionFile) {
        # Источник — не файловая база (.dt/.cf/шаблон): применяем на сервере.
        # Здесь возможна блокировка фоновыми заданиями — ретраим с паузой.
        Step '4б. Подключение расширения конфигурации'
        if (-not (Test-Path $ExtensionFile)) { throw "Файл расширения не найден: $ExtensionFile" }
        if (-not $ExtensionName) {
            $ExtensionName = ([IO.Path]::GetFileNameWithoutExtension($ExtensionFile)) -replace '_v[\d.]+$', ''
        }
        if (-not $ibAuth) { $ibAuth = '/N "Админ" /P ""' }   # серверная база наследует пользователей из файловой
        Ok "файл: $ExtensionFile  ->  расширение '$ExtensionName'"
        Invoke-1C "DESIGNER /S `"$ibPath`" $ibAuth /LoadCfg `"$ExtensionFile`" -Extension `"$ExtensionName`"" 'ext_load'
        $applied = $false
        for ($i = 1; $i -le 6 -and -not $applied; $i++) {
            try {
                Invoke-1C "DESIGNER /S `"$ibPath`" $ibAuth /UpdateDBCfg -Extension `"$ExtensionName`"" 'ext_apply'
                $applied = $true
            } catch {
                $log = Join-Path $LogDir '1c_ext_apply.log'
                $locked = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'блокировк|заблокирована|monopol|exclusive')
                if (-not $locked -or $i -eq 6) { throw }
                Warn "база занята фоновыми заданиями, повтор через 15 с (попытка $i из 6)"
                Start-Sleep -Seconds 15
            }
        }
        Ok "расширение '$ExtensionName' подключено и применено"
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
        Invoke-1C "DESIGNER /S `"$ibPath`" $ibAuth /DumpCfg `"$tmpCf`"" 'check'
        Remove-Item $tmpCf -ErrorAction SilentlyContinue
        Ok "1С: конфигуратор подключился к $ibPath"
    } catch { Warn $_.Exception.Message; $allOk = $false }

    if (-not $NoTrace) {
        Write-Host '  Ожидание записи технологического журнала (15 с)...'
        Start-Sleep -Seconds 15
        if (Test-TechLogFresh -Dir $TechLogDir -Since $tjMark) {
            Ok "технологический журнал пишет в $TechLogDir"
        } else {
            Warn "ТЖ не дал новых файлов в $TechLogDir после проверки входа."
            Warn "Проверьте права на каталог, наличие $LogcfgPath и что служба агента перезапускалась."
        }
    }

    if ($allOk) { Write-Host "`nГОТОВО. База: $ibPath ($IbTitle)" -ForegroundColor Green }
    else        { Write-Host "`nЗавершено с предупреждениями, смотрите $LogDir" -ForegroundColor Yellow }
    if (-not $NoTrace) {
        Write-Host "Технологический журнал:" -ForegroundColor Green
        Write-Host "  logcfg:  $LogcfgPath"
        Write-Host "  каталог: $TechLogDir (DBMS >= $TechLogThresholdMs мс, history 24 ч)"
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
