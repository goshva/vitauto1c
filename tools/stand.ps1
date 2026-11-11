<#
.SYNOPSIS
    Единая точка запуска демо-стенда vitauto: остановка, проверка версии на GitHub, сборка, старт, логи.
.DESCRIPTION
    Что делает:

      1. Проверяет версию: git fetch и сравнение HEAD с upstream. Если на GitHub есть
         новые коммиты — git pull --ff-only и пересборка (PWA + exe).
      2. Пересобирает приложение, если исходники новее собранного exe (или -Rebuild).
      3. Поднимает PostgreSQL (pg_ctl), если порт не отвечает.
      4. Останавливает прошлый экземпляр: процессы vitauto-desktop и любой процесс,
         держащий порт 18180, включая «зависшие» (сначала мягко, затем taskkill /F).
      5. Запускает стенд и ждёт health: статус должен стать ok, а база — ok.
      6. Пишет подробный лог в logs\stand-<дата>.log; уровень задаётся -LogLevel.

    Режимы логирования (от самого подробного):
      trace — плюс вывод всех внешних команд (git, npm, go);
      debug — плюс ключевые решения: сравнение версий, что пересобирается и почему;
      info  — обычный ход событий (по умолчанию);
      warn/error — только проблемы.

    Действия (-Action):
      start   — проверить версию, собрать при необходимости, поднять стенд (по умолчанию);
      restart — остановить и запустить заново;
      stop    — остановить стенд и освободить порт;
      status  — показать версию, сборку, процессы, БД и health, ничего не меняя;
      update  — проверить GitHub, обновить и пересобрать, стенд не запускать;
      logs    — показать хвост лога приложения и лога запуска (-Tail строк).
.PARAMETER Action
    start | restart | stop | status | update | logs.
.PARAMETER NoUpdate
    Не обращаться к GitHub (полезно без сети).
.PARAMETER Rebuild
    Пересобрать PWA и exe даже без изменений в git.
.PARAMETER NoBuild
    Не собирать, даже если обнаружены новые коммиты (только предупредить).
.PARAMETER ForcePull
    Разрешить git pull при незакоммиченных изменениях (по умолчанию пропускается).
.PARAMETER LogLevel
    trace | debug | info | warn | error.
.PARAMETER LogFile
    Путь к логу запуска (по умолчанию logs\stand-<yyyyMMdd>.log в корне репозитория).
.PARAMETER Quiet
    Не писать в консоль (для ярлыка). Ошибки показываются окном.
.PARAMETER HealthTimeoutSec
    Сколько секунд ждать готовности стенда после запуска (по умолчанию 90).
.PARAMETER Addr
    Адрес приложения host:port (по умолчанию 127.0.0.1:18180).
.PARAMETER PgPort
    Порт PostgreSQL демо-стенда (по умолчанию 5434).
.PARAMETER MakeShortcut
    Пересоздать ярлык на рабочем столе так, чтобы он запускал этот скрипт
    (проверка версии + сборка + старт), а не сразу exe.
.PARAMETER SkipDb
    Не поднимать PostgreSQL (если он управляется отдельно).
.PARAMETER Tail
    Сколько строк логов показывать в -Action logs (по умолчанию 40).
.EXAMPLE
    .\tools\stand.ps1
.EXAMPLE
    .\tools\stand.ps1 -Action restart -LogLevel debug
.EXAMPLE
    .\tools\stand.ps1 -Action status
.EXAMPLE
    .\tools\stand.ps1 -MakeShortcut
#>
param(
    [ValidateSet('start', 'restart', 'stop', 'status', 'update', 'logs')]
    [string]$Action = 'start',
    [switch]$NoUpdate,
    [switch]$Rebuild,
    [switch]$NoBuild,
    [switch]$ForcePull,
    [ValidateSet('trace', 'debug', 'info', 'warn', 'error')]
    [string]$LogLevel = 'info',
    [string]$LogFile = '',
    [switch]$Quiet,
    [int]$HealthTimeoutSec = 90,
    [string]$Addr = '127.0.0.1:18180',
    [int]$PgPort = 5434,
    [switch]$MakeShortcut,
    [switch]$SkipDb,
    [int]$Tail = 40
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Пути и константы ────────────────────────────────────────────────────────
$Root = Split-Path $PSScriptRoot -Parent
$Exe = Join-Path $Root 'bin\VITAUTO.exe'
$PwaDir = Join-Path $Root 'pwa'
$BuildScript = Join-Path $Root 'tools\build-seed-app.ps1'
$SeedScript = Join-Path $Root 'tools\seed-stand.ps1'

$AppData = Join-Path $env:LOCALAPPDATA 'VITAUTO'
$AppLog = Join-Path $AppData 'logs\app.log'
$PosLog = Join-Path $AppData 'logs\postgres.log'

$Url = "http://$Addr/"
$PgBin = 'C:\Program Files\PostgreSQL 1C\18\bin'
$PgData = 'D:\vitauto_app\pgdata'
$DbName = 'vitauto_app'

if (-not $LogFile) {
    $logDir = Join-Path $Root 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $LogFile = Join-Path $logDir ('stand-' + (Get-Date -Format 'yyyyMMdd') + '.log')
}
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile -Parent) | Out-Null

$Levels = @{ trace = 0; debug = 1; info = 2; warn = 3; error = 4 }
$MinLevel = $Levels[$LogLevel]

# ── Логирование ─────────────────────────────────────────────────────────────
function Write-Log {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('trace', 'debug', 'info', 'warn', 'error')][string]$Level = 'info'
    )
    if ($Levels[$Level] -lt $MinLevel) { return }
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
    $line = '{0} [{1,-5}] {2}' -f $stamp, $Level.ToUpperInvariant(), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    if ($Quiet) { return }
    $color = switch ($Level) {
        'trace' { 'DarkGray' }
        'debug' { 'Gray' }
        'info' { 'White' }
        'warn' { 'Yellow' }
        'error' { 'Red' }
    }
    Write-Host $line -ForegroundColor $color
}

function Show-ErrorBox([string]$Message) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.Popup($Message, 0, 'VITAUTO — запуск стенда', 16)
    } catch { }
}

function Fail([string]$Message) {
    Write-Log $Message -Level error
    if ($Quiet) { Show-ErrorBox("$Message`n`nЛог: $LogFile") }
    exit 1
}

# ── Запуск внешних команд с логированием ────────────────────────────────────
function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$File,
        [string[]]$Arguments = @(),
        [string]$What = '',
        [switch]$AllowFail,
        [string]$OutFile = ''
    )
    $display = if ($What) { $What } else { "$File $($Arguments -join ' ')" }
    Write-Log "запуск: $display" -Level debug

    # Вывод пишем в файл, а не в пайп: команды вроде pg_ctl оставляют долгоживущий
    # дочерний процесс (postgres), который наследует канал и держит его открытым —
    # и PowerShell, и вызывающая сторона ждут вечно. Оператор & ждёт только саму
    # команду (в отличие от Start-Process -Wait, который ждёт и потомков).
    $toFile = if ($OutFile) { $OutFile } else { [System.IO.Path]::GetTempFileName() }
    $temp = (-not $OutFile)
    $lines = @()
    try {
        # Внешняя команда может писать в stderr и при нормальной работе
        # (pg_ctl предупреждает, git — про прогресс): при ErrorActionPreference=Stop
        # такие строки превращаются в исключение, поэтому здесь ошибки не останавливают.
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $File @Arguments *>> $toFile
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEap
        }
        if ($null -eq $code) { $code = 0 }   # команда без кода возврата

        if (Test-Path $toFile) {
            $lines = @(Get-Content -LiteralPath $toFile -Tail 200 -ErrorAction SilentlyContinue)
            foreach ($line in $lines) { if ("$line".Trim()) { Write-Log "  | $line" -Level trace } }
            if (-not $temp) { Write-Log "  вывод: $toFile" -Level trace }
        }

        if ($code -ne 0 -and -not $AllowFail) {
            throw "$display — код возврата $code; вывод: $toFile"
        }
        return [pscustomobject]@{ Code = $code; Output = $lines }
    } finally {
        if ($temp) { Remove-Item $toFile -Force -ErrorAction SilentlyContinue }
    }
}

function Test-Tcp([string]$ComputerName, [int]$Port, [int]$TimeoutMs = 1200) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($ComputerName, $Port)
        if (-not $task.Wait($TimeoutMs)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-Health([int]$TimeoutSec = 4) {
    try {
        $r = Invoke-RestMethod -Uri ($Url + 'api/v1/health') -TimeoutSec $TimeoutSec
        return [pscustomobject]@{ Ok = ($r.status -eq 'ok'); Status = $r.status; Database = $r.database; Version = $r.version }
    } catch {
        return [pscustomobject]@{ Ok = $false; Status = 'нет ответа'; Database = $null; Version = $null }
    }
}

# ── Версия и сборка ─────────────────────────────────────────────────────────
function Get-GitState {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) { throw 'git не найден в PATH' }
    $branch = (& git -C $Root rev-parse --abbrev-ref HEAD).Trim()
    $head = (& git -C $Root rev-parse --short HEAD).Trim()
    $upstream = ''
    $candidate = (& git -C $Root rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null)
    if ($LASTEXITCODE -eq 0 -and $candidate) { $upstream = "$candidate".Trim() }
    if (-not $upstream) { $upstream = "origin/$branch" }
    $dirty = @(& git -C $Root status --porcelain)
    return [pscustomobject]@{ Branch = $branch; Head = $head; Upstream = $upstream; Dirty = $dirty }
}

function Update-FromGitHub {
    param([switch]$Skip)
    $state = Get-GitState
    Write-Log "ветка $($state.Branch), локально $($state.Head), upstream $($state.Upstream)"
    if ($Skip) {
        Write-Log 'проверка GitHub пропущена (-NoUpdate)' -Level warn
        return [pscustomobject]@{ Changed = $false; State = $state }
    }

    Write-Log 'проверка версии на GitHub (git fetch)...' -Level debug
    $fetch = Invoke-External -File 'git' -Arguments @('-C', $Root, 'fetch', 'origin', '--prune') -What 'git fetch origin' -AllowFail
    if ($fetch.Code -ne 0) {
        Write-Log 'GitHub недоступен — работаю с локальной версией' -Level warn
        return [pscustomobject]@{ Changed = $false; State = $state }
    }

    $remote = (& git -C $Root rev-parse --short $state.Upstream 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $remote) {
        Write-Log "не найдена ветка $($state.Upstream) — пропускаю обновление" -Level warn
        return [pscustomobject]@{ Changed = $false; State = $state }
    }
    $remote = "$remote".Trim()

    if ($remote -eq $state.Head) {
        Write-Log "версия актуальна: $($state.Head) = $($state.Upstream)" -Level info
        return [pscustomobject]@{ Changed = $false; State = $state }
    }

    Write-Log "на GitHub новая версия: $remote (локально $($state.Head))" -Level warn
    $newCommits = @(& git -C $Root log --oneline "$($state.Head)..$($state.Upstream)" 2>$null)
    foreach ($c in $newCommits) { Write-Log "  новый коммит: $c" -Level info }

    if ($state.Dirty.Count -gt 0 -and -not $ForcePull) {
        Write-Log ("в рабочем дереве {0} незакоммиченных изменений — обновление пропущено (нужно -ForcePull)" -f $state.Dirty.Count) -Level warn
        return [pscustomobject]@{ Changed = $false; State = $state }
    }

    Write-Log 'обновление: git pull --ff-only' -Level info
    $pull = Invoke-External -File 'git' -Arguments @('-C', $Root, 'pull', '--ff-only') -What 'git pull --ff-only' -AllowFail
    if ($pull.Code -ne 0) {
        Write-Log 'git pull не удался (ветки разошлись?) — собираю текущую версию' -Level warn
        return [pscustomobject]@{ Changed = $false; State = $state }
    }
    $state = Get-GitState
    Write-Log "обновлено до $($state.Head)" -Level info
    return [pscustomobject]@{ Changed = $true; State = $state }
}

function Get-SourceStamp {
    # самый свежий файл-источник: по нему решаем, нужна ли пересборка
    $dirs = @(
        (Join-Path $Root 'backend'),
        (Join-Path $Root 'pwa\src'),
        (Join-Path $Root 'pwa\public'),
        (Join-Path $Root 'api'),
        (Join-Path $Root 'db\migrations')
    )
    $latest = [datetime]::MinValue
    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) { continue }
        Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -notmatch '\.log$' } |
            ForEach-Object { if ($_.LastWriteTime -gt $latest) { $latest = $_.LastWriteTime } }
    }
    return $latest
}

function Test-BuildNeeded($gitChanged) {
    if ($Rebuild) { Write-Log 'нужна сборка: указан -Rebuild' -Level debug; return $true }
    if (-not (Test-Path $Exe)) { Write-Log 'нужна сборка: нет bin\VITAUTO.exe' -Level debug; return $true }
    if ($gitChanged) { Write-Log 'нужна сборка: обновилась версия из GitHub' -Level debug; return $true }
    $exeTime = (Get-Item $Exe).LastWriteTime
    $srcTime = Get-SourceStamp
    if ($srcTime -gt $exeTime) {
        Write-Log ("нужна сборка: исходники новее сборки ({0} > {1})" -f $srcTime.ToString('dd.MM HH:mm'), $exeTime.ToString('dd.MM HH:mm')) -Level debug
        return $true
    }
    Write-Log ("сборка актуальна: exe от {0}" -f $exeTime.ToString('dd.MM.yyyy HH:mm')) -Level info
    return $false
}

function Invoke-Build {
    if ($NoBuild) {
        Write-Log 'сборка пропущена (-NoBuild): будет запущена предыдущая версия' -Level warn
        return
    }
    if (-not (Test-Path $BuildScript)) { throw "нет скрипта сборки: $BuildScript" }
    Write-Log 'сборка приложения (PWA + exe)...' -Level info
    $out = Invoke-External -File 'powershell' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $BuildScript
    ) -What 'build-seed-app.ps1' -AllowFail
    if ($out.Code -ne 0) {
        Fail "сборка не удалась (код $($out.Code)); подробности: $LogFile"
    }
    Write-Log ("сборка готова: {0}" -f (Get-Item $Exe).LastWriteTime.ToString('dd.MM.yyyy HH:mm')) -Level info
}

# ── PostgreSQL ──────────────────────────────────────────────────────────────
function Start-Database {
    if ($SkipDb) { Write-Log 'PostgreSQL пропущен (-SkipDb)' -Level warn; return }
    if (Test-Tcp '127.0.0.1' $PgPort) {
        Write-Log "PostgreSQL отвечает на $PgPort" -Level debug
        return
    }
    $pgCtl = Join-Path $PgBin 'pg_ctl.exe'
    if (-not (Test-Path $pgCtl)) { Fail "pg_ctl не найден: $pgCtl" }
    if (-not (Test-Path $PgData)) { Fail "нет каталога данных PostgreSQL: $PgData (развернуть: tools\seed-stand.ps1)" }

    New-Item -ItemType Directory -Force -Path (Split-Path $PosLog -Parent) | Out-Null

    # Устаревший postmaster.pid после аварийного завершения: pg_ctl отказывается
    # стартовать («another server might be running»), хотя сервера нет.
    $pidFile = Join-Path $PgData 'postmaster.pid'
    if (Test-Path $pidFile) {
        $pidText = (Get-Content -LiteralPath $pidFile -TotalCount 1 -ErrorAction SilentlyContinue)
        $oldPid = 0
        if ($pidText -and [int]::TryParse("$pidText".Trim(), [ref]$oldPid)) {
            if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
                Write-Log "устаревший postmaster.pid (PID $oldPid не работает) — удаляю" -Level warn
                Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Write-Log "PostgreSQL не отвечает на $PgPort — запускаю pg_ctl ($PgData)" -Level warn
    # Отделённый старт: pg_ctl оставляет работать postgres, который наследует
    # дескрипторы родителя. Любое ожидание вывода (пайп, файл, WaitForExit)
    # рискует не завершиться, поэтому не ждём вовсе — проверяем по порту.
    $pgArgs = @('start', '-D', $PgData, '-l', $PosLog, '-w', '-t', '60')
    $proc = Start-Process -FilePath $pgCtl -ArgumentList $pgArgs -WindowStyle Hidden -PassThru
    Write-Log "pg_ctl запущен отдельно (PID $($proc.Id))" -Level debug

    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Tcp '127.0.0.1' $PgPort) { Write-Log "PostgreSQL поднят на $PgPort" -Level info; return }
        Start-Sleep -Milliseconds 500
    }
    Fail "порт $PgPort не открылся за 30 с; логи: $PosLog"
}

# ── Остановка стенда ────────────────────────────────────────────────────────
function Get-StandProcesses {
    $procs = @()
    # 1. Владелец нашего порта — главный признак (имя процесса может отличаться
    #    у сборок разных версий, а порт один).
    $port = $Addr.Split(':')[1]
    foreach ($line in @(netstat -ano | Select-String ":$port\s" | Select-String 'LISTENING')) {
        $parts = ("$line".Trim() -split '\s+')
        $pidText = $parts[-1]
        if ($pidText -match '^\d+$') {
            $p = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
            if ($p) { $procs += $p }
        }
    }
    # 2. Для основного адреса добавляем процессы нашего exe, даже если они ещё
    #    не слушают порт (зависли на старте).
    if ($Addr -eq '127.0.0.1:18180') {
        foreach ($p in @(Get-Process -Name 'VITAUTO' -ErrorAction SilentlyContinue)) {
            $path = ''
            try { $path = $p.Path } catch { }
            if ($path -eq $Exe) { $procs += $p }
        }
    }
    return @($procs | Sort-Object Id -Unique)
}

function Stop-Stand {
    $procs = Get-StandProcesses
    if (-not $procs) {
        Write-Log 'стенд не запущен' -Level info
    } else {
        foreach ($p in $procs) {
            Write-Log ("останавливаю {0} (PID {1})" -f $p.ProcessName, $p.Id) -Level info
        }
        foreach ($p in $procs) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction Stop }
            catch { Write-Log ("мягко остановить PID {0} не удалось: {1}" -f $p.Id, $_.Exception.Message) -Level debug }
        }
        Start-Sleep -Seconds 2
        foreach ($p in $procs) {
            $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
            if ($alive) {
                Write-Log ("PID {0} ещё жив — taskkill /F" -f $p.Id) -Level warn
                Invoke-External -File 'taskkill' -Arguments @('/PID', "$($p.Id)", '/F', '/T') -What "taskkill $($p.Id)" -AllowFail | Out-Null
            }
        }
    }

    # окно приложения Chrome: закрываем только то, что открыто на нашем адресе
    $chromeArgs = @()
    foreach ($c in @(Get-Process chrome -ErrorAction SilentlyContinue)) {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.Id)" -ErrorAction Stop).CommandLine
            if ($cmd -and $cmd -like "*$Addr*") { $chromeArgs += $c.Id }
        } catch { }
    }
    if ($chromeArgs.Count) {
        Write-Log ("закрываю окно приложения Chrome: PID {0}" -f ($chromeArgs -join ', ')) -Level info
        foreach ($id in $chromeArgs) { Invoke-External -File 'taskkill' -Arguments @('/PID', "$id", '/F', '/T') -What "taskkill $id" -AllowFail | Out-Null }
    }

    # ждём освобождения порта
    $port = [int]$Addr.Split(':')[1]
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-Tcp '127.0.0.1' $port)) { Write-Log 'порт освобождён' -Level info; return }
        Start-Sleep -Milliseconds 500
    }
    $holder = @(netstat -ano | Select-String ":$port\s" | Select-String 'LISTENING' | ForEach-Object { "$_".Trim() })
    foreach ($h in $holder) { Write-Log "  держит порт: $h" -Level error }
    Fail ("порт $port всё ещё занят. Если стенд запущен от администратора, запустите этот скрипт тоже от администратора; " +
        "вручную: taskkill /PID <pid> /F (PID виден в строке выше)")
}

# ── Запуск ──────────────────────────────────────────────────────────────────
function Start-Stand {
    if (-not (Test-Path $Exe)) { Fail "нет $Exe — сначала сборка: tools\build-seed-app.ps1" }

    # Приложение пишет свой лог в %LOCALAPPDATA%\VITAUTO\logs. Если каталог недоступен
    # на запись (права, песочница), приложение уйдёт в поток ошибок — предупреждаем,
    # потому что иначе отладочный лог будет пустым без объяснения.
    $logDir = Join-Path $AppData 'logs'
    try {
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $probe = Join-Path $logDir 'write-probe.tmp'
        Set-Content -LiteralPath $probe -Value 'ok' -ErrorAction Stop
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Log ("каталог логов приложения недоступен на запись ({0}): лог будет только в launch.err.log" -f $_.Exception.Message) -Level warn
    }

    # уровень логирования приложения передаём в exe
    if ($LogLevel -in @('trace', 'debug')) {
        $env:VITAUTO_LOG_LEVEL = $LogLevel
        Write-Log "логирование приложения: $LogLevel" -Level debug
    } else {
        Remove-Item Env:\VITAUTO_LOG_LEVEL -ErrorAction SilentlyContinue
    }
    $env:VITAUTO_NO_UI = '1'   # ошибки показывает скрипт, окна из exe не мешают
    $env:VITAUTO_APP_ADDR = $Addr
    $env:VITAUTO_PG_PORT = "$PgPort"

    Write-Log "запуск: $Exe" -Level info
    # Потоки приложения — в файлы: приложение и его окно (Chrome) иначе наследуют
    # дескрипторы консоли скрипта и держат её открытой после выхода.
    $launchOut = Join-Path $AppData 'logs\launch.out.log'
    $launchErr = Join-Path $AppData 'logs\launch.err.log'
    $proc = Start-Process -FilePath $Exe -WorkingDirectory $Root -PassThru `
        -RedirectStandardOutput $launchOut -RedirectStandardError $launchErr
    Write-Log "процесс запущен: PID $($proc.Id)" -Level debug

    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $health = [pscustomobject]@{ Ok = $false; Status = 'нет ответа'; Database = $null; Version = $null }
    while ((Get-Date) -lt $deadline) {
        $health = Get-Health
        if ($health.Ok) { break }
        if ($proc.HasExited) {
            # exe мог завершиться штатно: порт занят живым стендом, он лишь открыл окно
            if ($proc.ExitCode -eq 0 -and $health.Ok) { break }
            Write-Log "процесс завершился с кодом $($proc.ExitCode)" -Level error
            Show-AppLogTail
            Fail "стенд не запустился (код $($proc.ExitCode)); лог приложения: $AppLog"
        }
        Start-Sleep -Milliseconds 700
    }

    if (-not $health.Ok) {
        Show-AppLogTail
        Fail ("стенд не отвечает за {0} с (health={1}, база={2}); лог приложения: {3}" -f $HealthTimeoutSec, $health.Status, $health.Database, $AppLog)
    }

    if ($proc.HasExited) {
        Write-Log ("окно открыто в уже работающем стенде (PID {0} не требуется)" -f $proc.Id) -Level debug
    }
    Write-Log ("стенд готов: {0} (база: {1}, версия: {2})" -f $Url, $health.Database, $health.Version) -Level info
    Write-Host ''
    Write-Host "  Стенд запущен:  $Url" -ForegroundColor Green
    Write-Host "  Лог запуска:    $LogFile" -ForegroundColor Gray
    Write-Host "  Лог приложения: $(Join-Path $AppData 'logs\app.log')" -ForegroundColor Gray
    Write-Host "  Логи запуска:   $(Join-Path $AppData 'logs\launch.err.log')" -ForegroundColor DarkGray
    Write-Host '  Вход: Администратор / admin123, Менеджер / manager123, Снабженец / supply123,' -ForegroundColor Gray
    Write-Host '        Кладовщик / storekeeper123, ГлавныйМеханик / chief123' -ForegroundColor Gray
}

function Show-AppLogTail {
    if (Test-Path $AppLog) {
        Write-Log 'последние строки лога приложения:' -Level error
        foreach ($l in @(Get-Content $AppLog -Tail 15 -ErrorAction SilentlyContinue)) {
            Write-Log "  | $l" -Level error
        }
    }
}

# ── Диагностика ─────────────────────────────────────────────────────────────
function Show-Status {
    Write-Log '=== СОСТОЯНИЕ СТЕНДА ===' -Level info
    $state = Get-GitState
    Write-Log ("git: ветка {0}, локально {1}, upstream {2}" -f $state.Branch, $state.Head, $state.Upstream)
    if ($state.Dirty.Count) { Write-Log ("незакоммиченных изменений: {0}" -f $state.Dirty.Count) -Level warn }

    if (-not $NoUpdate) {
        & git -C $Root fetch origin --prune 2>&1 | Out-Null
        $remote = (& git -C $Root rev-parse --short $state.Upstream 2>$null)
        if ($remote) {
            $remote = "$remote".Trim()
            if ($remote -eq $state.Head) { Write-Log "GitHub: актуальная версия ($remote)" }
            else { Write-Log "GitHub: доступна новая версия $remote (локально $($state.Head)) — .\tools\stand.ps1 -Action update" -Level warn }
        }
    }

    if (Test-Path $Exe) {
        Write-Log ("сборка: {0} ({1} КБ, {2})" -f $Exe, [math]::Round((Get-Item $Exe).Length / 1KB), (Get-Item $Exe).LastWriteTime.ToString('dd.MM.yyyy HH:mm'))
    } else {
        Write-Log 'сборка: bin\VITAUTO.exe отсутствует' -Level warn
    }

    $procs = Get-StandProcesses
    if ($procs) {
        foreach ($p in $procs) { Write-Log ("процесс: {0} PID {1} (запущен {2})" -f $p.ProcessName, $p.Id, $p.StartTime) }
    } else {
        Write-Log 'процесс: стенд не запущен' -Level warn
    }

    Write-Log ("PostgreSQL $PgPort : " + $(if (Test-Tcp '127.0.0.1' $PgPort) { 'отвечает' } else { 'НЕ отвечает' })) -Level $(if (Test-Tcp '127.0.0.1' $PgPort) { 'info' } else { 'warn' })

    if (Test-Tcp '127.0.0.1' ([int]$Addr.Split(':')[1])) {
        $h = Get-Health
        Write-Log ("health: статус {0}, база {1}, версия {2}" -f $h.Status, $h.Database, $h.Version) -Level $(if ($h.Ok) { 'info' } else { 'warn' })
        if (-not $h.Ok) { Write-Log 'стенд поднят не полностью — лечится: .\tools\stand.ps1 -Action restart' -Level warn }
    } else {
        Write-Log "health: порт $Addr не слушается" -Level warn
    }
}

function Show-Logs {
    Write-Log "лог запуска: $LogFile" -Level info
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail $Tail | ForEach-Object { Write-Host $_ } }
    Write-Host ''
    Write-Log "лог приложения: $AppLog" -Level info
    if (Test-Path $AppLog) { Get-Content $AppLog -Tail $Tail | ForEach-Object { Write-Host $_ } }
    else { Write-Log 'лог приложения пока пуст' -Level warn }
}

# ── Ярлык ───────────────────────────────────────────────────────────────────
function New-Shortcut {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'VITAUTO — демо-стенд.lnk'
    $scriptPath = Join-Path $PSScriptRoot 'stand.ps1'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Action start -Quiet' -f $scriptPath
    $lnk.WorkingDirectory = $Root
    $lnk.Description = 'VITAUTO — демо-стенд: проверка версии, сборка, запуск'
    if (Test-Path $Exe) { $lnk.IconLocation = "$Exe,0" }
    $lnk.Save()
    Write-Log "ярлык обновлён: $lnkPath" -Level info
    Write-Log 'двойной клик: проверка GitHub → сборка при необходимости → запуск стенда' -Level info
}

# ── Ротация логов приложения ────────────────────────────────────────────────
function Rotate-AppLog {
    if (-not (Test-Path $AppLog)) { return }
    $maxMb = 5
    try {
        if ((Get-Item $AppLog).Length -gt ($maxMb * 1MB)) {
            $prev = "$AppLog.1"
            Remove-Item $prev -Force -ErrorAction SilentlyContinue
            Move-Item $AppLog $prev -Force -ErrorAction Stop
            Write-Log "лог приложения превысил $maxMb МБ — предыдущий сохранён как $prev" -Level debug
        }
    } catch {
        # запущенный экземпляр держит лог открытым — перенесём при следующем запуске
        Write-Log 'лог приложения занят работающим стендом — ротация пропущена' -Level debug
    }
}

# ── Основной ход ────────────────────────────────────────────────────────────
Write-Log '========================================' -Level info
Write-Log ("VITAUTO стенд: действие '{0}', лог '{1}'" -f $Action, $LogLevel) -Level info

try {
    switch ($Action) {
        'status' {
            Show-Status
        }
        'logs' {
            Show-Logs
        }
        'stop' {
            Stop-Stand
            Write-Log 'стенд остановлен' -Level info
        }
        'update' {
            $upd = Update-FromGitHub -Skip:$NoUpdate
            if (Test-BuildNeeded $upd.Changed) {
                # exe запущенного стенда заблокирован — останавливаем перед сборкой
                Stop-Stand
                Invoke-Build
                Write-Log 'обновление завершено; запуск: .\tools\stand.ps1 -Action start' -Level info
            } else {
                Write-Log 'обновлений нет — сборка не требуется' -Level info
            }
        }
        'start' {
            $upd = Update-FromGitHub -Skip:$NoUpdate
            $built = $false
            if (Test-BuildNeeded $upd.Changed) {
                # пересборка требует свободного exe: останавливаем стенд заранее
                Stop-Stand
                Invoke-Build
                $built = $true
            }
            Start-Database

            $portBusy = Test-Tcp '127.0.0.1' ([int]$Addr.Split(':')[1])
            $health = if ($portBusy) { Get-Health } else { $null }

            # Собранный exe новее запущенного процесса — значит работает старая
            # сборка: перезапускаем, иначе правки в коде не применяются.
            $staleBin = $false
            if ($portBusy -and -not $built -and (Test-Path $Exe)) {
                foreach ($p in @(Get-StandProcesses)) {
                    try {
                        if ((Get-Item $Exe).LastWriteTime -gt $p.StartTime.AddSeconds(3)) {
                            Write-Log ("exe собран позже запуска процесса (exe {0}, процесс {1}) — нужен перезапуск" -f `
                                    (Get-Item $Exe).LastWriteTime.ToString('dd.MM HH:mm:ss'), $p.StartTime.ToString('dd.MM HH:mm:ss')) -Level info
                            $staleBin = $true
                            break
                        }
                    } catch { }
                }
            }

            # Если только что подняли PostgreSQL, пул приложения переподключается
            # не мгновенно — даём ему несколько секунд, прежде чем перезапускать.
            if ($portBusy -and $health -and -not $health.Ok) {
                for ($i = 0; $i -lt 8; $i++) {
                    Start-Sleep -Milliseconds 700
                    $health = Get-Health
                    if ($health.Ok) {
                        Write-Log 'работающий экземпляр восстановился после запуска PostgreSQL' -Level info
                        break
                    }
                }
            }

            if ($portBusy -and $health -and $health.Ok -and -not $built -and -not $staleBin) {
                # стенд жив и сборка не менялась: просто открываем окно (exe сам поймёт, что сервер уже есть)
                Write-Log 'стенд уже работает, сборка актуальна — открываю окно' -Level info
                Start-Stand
                break
            }

            if ($portBusy) {
                if ($health -and $health.Ok) {
                    Write-Log 'стенд работает, но собрана новая версия — перезапускаю' -Level info
                } else {
                    Write-Log ("найден нерабочий экземпляр (health={0}, база={1}) — останавливаю и поднимаю заново" -f $health.Status, $health.Database) -Level warn
                }
                Stop-Stand
            }
            Rotate-AppLog
            Start-Stand
        }
        'restart' {
            $upd = Update-FromGitHub -Skip:$NoUpdate
            if (Test-BuildNeeded $upd.Changed) {
                Stop-Stand
                Invoke-Build
            }
            Stop-Stand
            Start-Database
            Rotate-AppLog
            Start-Stand
        }
    }

    if ($MakeShortcut) { New-Shortcut }
    Write-Log ("готово: {0}" -f $Action) -Level info
} catch {
    Fail ("ошибка: " + $_.Exception.Message)
}
