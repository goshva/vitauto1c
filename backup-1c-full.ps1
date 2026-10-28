#Requires -Version 5.1
<#
.SYNOPSIS
  Дамп базы PostgreSQL 1С + выгрузка конфигурации (.cf) и опционально полной ИБ (.dt)
  + снимок настроек (кластер, публикация, расширения).

  Основано на:
    https://github.com/goshva/vitauto1c/blob/techdebt/arm-v2.22/backup-1c-pgsql.ps1

  pg_dump -Fc не мешает пользователям (согласованный снимок).
  DumpCfg / DumpIB требуют вход в конфигуратор (кратковременная блокировка сеанса дизайнера).

.EXAMPLE
  .\backup-1c-full.ps1
  .\backup-1c-full.ps1 -Database autoservice -OutDir D:\1c_bases\backup -Keep 5
  .\backup-1c-full.ps1 -NoDt -NoCfg          # только PostgreSQL (как оригинал)
  .\backup-1c-full.ps1 -DumpDt               # ещё и полная выгрузка .dt (долго, большой файл)
  .\backup-1c-full.ps1 -IbUser Администратор -IbPassword (ConvertTo-SecureString '' -AsPlainText -Force)
#>
param(
    [string] $Database = 'autoservice',
    [string] $OutDir = 'D:\1c_bases\backup',
    [string] $Server1C = 'localhost',
    [string] $IbName = 'autoservice',          # имя ИБ в кластере (часто = Database)
    [string] $IbUser = 'Администратор',
    [SecureString] $IbPassword,
    [SecureString] $PgPassword,
    [string] $PgUser = 'postgres',
    [string] $PgHost = '127.0.0.1',
    [int]    $PgPort = 5432,
    [string] $PgBin,                           # авто: PostgreSQL 1C 18 / 15 / любой
    [string] $PlatformVersion = '8.3.27.2342',
    [int]    $Keep = 0,                        # сколько последних наборов оставлять (0 = не чистить)
    [ValidateRange(0, 9)] [int] $Compress = 6,
    [switch] $NoPg,                            # не делать pg_dump
    [switch] $NoCfg,                           # не выгружать .cf
    [switch] $DumpDt,                          # выгрузить полную ИБ в .dt (долго)
    [switch] $NoSettings,                      # не писать settings JSON
    [switch] $SkipSpaceCheck
)

$ErrorActionPreference = 'Stop'
$t0 = Get-Date
function Ok([string]$m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m){ Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Step([string]$m){ Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# ---------- PostgreSQL bin ----------
function Find-PgBin {
    if ($PgBin -and (Test-Path (Join-Path $PgBin 'pg_dump.exe'))) { return $PgBin }
    $cands = @(
        'C:\Program Files\PostgreSQL 1C\18\bin',
        'C:\Program Files\PostgreSQL 1C\15\bin',
        'C:\Program Files\PostgreSQL\18\bin',
        'C:\Program Files\PostgreSQL\15\bin'
    )
    foreach ($c in $cands) { if (Test-Path (Join-Path $c 'pg_dump.exe')) { return $c } }
    $fromSvc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object { $_.PathName -match 'pg_ctl\.exe' } |
        ForEach-Object {
            if ($_.PathName -match '"([^"]+pg_ctl\.exe)"') { Split-Path $Matches[1] -Parent }
            elseif ($_.PathName -match '(\S+pg_ctl\.exe)') { Split-Path $Matches[1] -Parent }
        } | Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') } | Select-Object -First 1
    if ($fromSvc) { return $fromSvc }
    $null
}

# ---------- 1С bin ----------
function Find-1CBin {
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ }
    foreach ($root in $roots) {
        $b = Join-Path $root "1cv8\$PlatformVersion\bin"
        if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
    }
    foreach ($root in $roots) {
        $any = Get-ChildItem (Join-Path $root '1cv8') -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^8\.3\.' } | Sort-Object Name -Descending | Select-Object -First 1
        if ($any -and (Test-Path (Join-Path $any.FullName 'bin\1cv8.exe'))) {
            return (Join-Path $any.FullName 'bin')
        }
    }
    $null
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmm'
$runDir = Join-Path $OutDir "${Database}_$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$manifest = [ordered]@{
    Started     = (Get-Date).ToString('o')
    Database    = $Database
    IbName      = $IbName
    Server1C    = $Server1C
    Stamp       = $stamp
    OutDir      = $runDir
    Files       = @()
    Errors      = @()
}

try {
    # =================================================================
    if (-not $NoPg) {
        Step '1. Дамп PostgreSQL (pg_dump -Fc)'
        $PgBin = Find-PgBin
        if (-not $PgBin) { throw 'pg_dump не найден. Укажите -PgBin «C:\Program Files\PostgreSQL 1C\18\bin»' }
        foreach ($exe in 'pg_dump.exe', 'pg_restore.exe', 'psql.exe') {
            if (-not (Test-Path (Join-Path $PgBin $exe))) { throw "Нет $exe в $PgBin" }
        }
        Ok "PostgreSQL tools: $PgBin"

        if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString "Пароль PostgreSQL ($PgUser)" }
        $env:PGPASSWORD = (New-Object Net.NetworkCredential('', $PgPassword)).Password

        $conn = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-w')
        $size = & (Join-Path $PgBin 'psql.exe') @conn -d postgres -At -c "SELECT pg_database_size('$Database')"
        if ($LASTEXITCODE -or -not $size) {
            throw "База $Database недоступна на ${PgHost}:$PgPort (пароль / имя / порт?)"
        }
        $sizeGB = [math]::Round([double]$size / 1GB, 2)
        Ok "база ${Database}: $sizeGB ГБ"

        if (-not $SkipSpaceCheck) {
            $drive = (Get-Item $OutDir).PSDrive.Name
            if (-not $drive) { $drive = (Resolve-Path $OutDir).Drive.Name }
            $free = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
            $need = [math]::Ceiling($sizeGB) + 1
            if ($free -lt $need) { throw "Диск ${drive}: свободно $free ГБ, нужно ≥ $need ГБ" }
            Ok "диск ${drive}: свободно $free ГБ (нужно $need)"
        }

        $dumpFile = Join-Path $runDir "${Database}.dump"
        # дублируем «плоское» имя как в оригинале — для restore-1c-pgsql.ps1
        $dumpFlat = Join-Path $OutDir ("{0}_{1}.dump" -f $Database, $stamp)
        Write-Host "  pg_dump -> $dumpFile ..."
        & (Join-Path $PgBin 'pg_dump.exe') @conn -Fc -Z $Compress -f $dumpFile $Database
        if ($LASTEXITCODE) {
            Remove-Item $dumpFile -ErrorAction SilentlyContinue
            throw "pg_dump: код $LASTEXITCODE"
        }
        $tables = (& (Join-Path $PgBin 'pg_restore.exe') -l $dumpFile | Select-String 'TABLE DATA').Count
        if ($LASTEXITCODE -or $tables -eq 0) { throw "Дамп не читается (pg_restore -l): $dumpFile" }
        Copy-Item $dumpFile $dumpFlat -Force
        Ok ("{0}: {1:N0} МБ, TABLE DATA: {2}" -f (Split-Path $dumpFlat -Leaf), ((Get-Item $dumpFile).Length / 1MB), $tables)
        $manifest.Files += @{ Type = 'pg_dump'; Path = $dumpFlat; Tables = $tables; MB = [math]::Round((Get-Item $dumpFile).Length / 1MB, 1) }

        # краткие настройки БД
        $pgSettings = & (Join-Path $PgBin 'psql.exe') @conn -d $Database -At -c @"
SELECT version();
SELECT current_setting('server_version');
SELECT current_setting('server_encoding');
SELECT current_setting('lc_collate');
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT count(*) FROM pg_extension;
"@
        $manifest.PostgreSQL = @{
            Bin     = $PgBin
            Host    = $PgHost
            Port    = $PgPort
            User    = $PgUser
            RawInfo = @($pgSettings)
        }
    }

    # =================================================================
    $Bin1C = Find-1CBin
    $ibAuth = ''
    if ($IbUser) {
        $pwdPlain = if ($IbPassword) { (New-Object Net.NetworkCredential('', $IbPassword)).Password } else { '' }
        $ibAuth = "/N `"$IbUser`" /P `"$pwdPlain`""
    }
    $ibPath = "$Server1C\$IbName"
    $v8 = if ($Bin1C) { Join-Path $Bin1C '1cv8.exe' } else { $null }

    function Invoke-1CDump([string]$ArgsLine, [string]$Tag) {
        $out = Join-Path $runDir "1c_$Tag.log"
        $res = Join-Path $runDir "1c_$Tag.result"
        Remove-Item $res -ErrorAction SilentlyContinue
        $p = Start-Process $v8 -ArgumentList "$ArgsLine /DisableStartupDialogs /DisableStartupMessages /Out `"$out`" /DumpResult `"$res`"" -PassThru
        $deadline = (Get-Date).AddHours(6)
        while (-not $p.WaitForExit(30000)) {
            if ((Get-Date) -gt $deadline) { Stop-Process -Id $p.Id -Force; throw "1С ($Tag) превысила 6 ч" }
            Write-Host ("    … {0:hh\:mm\:ss}" -f ((Get-Date) - $t0))
        }
        $code = if (Test-Path $res) { (Get-Content $res -Raw).Trim() } else { '-1' }
        if ($code -ne '0') {
            if (Test-Path $out) { Get-Content $out -Encoding UTF8 | Select-Object -Last 30 | ForEach-Object { Write-Host $_ } }
            throw "1С ($Tag) код $code, лог: $out"
        }
    }

    if (-not $NoCfg -or $DumpDt) {
        if (-not $v8 -or -not (Test-Path $v8)) {
            Warn '1cv8.exe не найден — выгрузка .cf/.dt пропущена'
            $manifest.Errors += '1cv8 not found'
        }
        else {
            Ok "1С: $Bin1C"

            if (-not $NoCfg) {
                Step '2. Выгрузка конфигурации (.cf)'
                $cfFile = Join-Path $runDir "${IbName}.cf"
                Write-Host "  DESIGNER /DumpCfg -> $cfFile"
                try {
                    Invoke-1CDump "DESIGNER /S `"$ibPath`" $ibAuth /DumpCfg `"$cfFile`"" 'dumpcfg'
                    if ((Get-Item $cfFile).Length -lt 1000) { throw '.cf слишком маленький — выгрузка не удалась?' }
                    Ok ("конфигурация: {0:N1} МБ" -f ((Get-Item $cfFile).Length / 1MB))
                    $manifest.Files += @{ Type = 'cf'; Path = $cfFile; MB = [math]::Round((Get-Item $cfFile).Length / 1MB, 1) }
                }
                catch {
                    Warn $_.Exception.Message
                    $manifest.Errors += "DumpCfg: $($_.Exception.Message)"
                    # перебор типичных пользователей
                    foreach ($tryUser in @('Админ', 'Автосервис', 'Administrator')) {
                        if ($tryUser -eq $IbUser) { continue }
                        try {
                            Write-Host "  повтор с пользователем «$tryUser»..."
                            $ibAuth = "/N `"$tryUser`" /P `"`""
                            Invoke-1CDump "DESIGNER /S `"$ibPath`" $ibAuth /DumpCfg `"$cfFile`"" 'dumpcfg'
                            Ok ("конфигурация (под «$tryUser»): {0:N1} МБ" -f ((Get-Item $cfFile).Length / 1MB))
                            $manifest.Files += @{ Type = 'cf'; Path = $cfFile; MB = [math]::Round((Get-Item $cfFile).Length / 1MB, 1) }
                            $manifest.Errors = @($manifest.Errors | Where-Object { $_ -notlike 'DumpCfg:*' })
                            break
                        }
                        catch { Warn "  ${tryUser}: $($_.Exception.Message)" }
                    }
                }
            }

            if ($DumpDt) {
                Step '3. Полная выгрузка ИБ (.dt) — может занять долго'
                $dtFile = Join-Path $runDir "${IbName}.dt"
                $dtFlat = Join-Path $OutDir ("бэкап {0:yyyyMMdd}.dt" -f (Get-Date))  # совместимо с Find-BackupDt в install
                Write-Host "  DESIGNER /DumpIB -> $dtFile"
                try {
                    Invoke-1CDump "DESIGNER /S `"$ibPath`" $ibAuth /DumpIB `"$dtFile`"" 'dumpib'
                    Copy-Item $dtFile $dtFlat -Force
                    Ok ("ИБ: {0:N0} МБ -> $dtFlat" -f ((Get-Item $dtFile).Length / 1MB))
                    $manifest.Files += @{ Type = 'dt'; Path = $dtFlat; MB = [math]::Round((Get-Item $dtFile).Length / 1MB, 1) }
                }
                catch {
                    Warn $_.Exception.Message
                    $manifest.Errors += "DumpIB: $($_.Exception.Message)"
                }
            }
        }
    }

    # =================================================================
    if (-not $NoSettings) {
        Step '4. Снимок настроек (кластер, список баз, публикация, расширения)'
        $settings = [ordered]@{
            CapturedAt      = (Get-Date).ToString('o')
            ComputerName    = $env:COMPUTERNAME
            PlatformVersion = $PlatformVersion
            Bin1C           = $Bin1C
            IbPath          = $ibPath
            Database        = $Database
            PgHost          = $PgHost
            PgPort          = $PgPort
        }

        # ibases.v8i (общий + личный)
        foreach ($f in @(
            (Join-Path $env:ProgramData '1C\1CEStart\ibases.v8i'),
            (Join-Path $env:APPDATA '1C\1CEStart\ibases.v8i')
        )) {
            if (Test-Path $f) {
                $settings["ibases_$([IO.Path]::GetFileName($f))_$([guid]::NewGuid().ToString('N').Substring(0,6))"] = @{
                    Path = $f
                    Text = [IO.File]::ReadAllText($f)
                }
            }
        }

        # srvinfo / 1CEStart.cfg
        $cfgStart = Join-Path $env:ProgramData '1C\1CEStart\1CEStart.cfg'
        if (Test-Path $cfgStart) {
            $settings['1CEStart.cfg'] = [IO.File]::ReadAllText($cfgStart)
        }

        # default.vrd публикаций Apache
        $vrdList = @()
        foreach ($root in @('D:\1c\apache', 'C:\Apache24', 'D:\1c')) {
            if (-not (Test-Path $root)) { continue }
            Get-ChildItem $root -Recurse -Filter 'default.vrd' -ErrorAction SilentlyContinue | ForEach-Object {
                $vrdList += @{ Path = $_.FullName; Text = [IO.File]::ReadAllText($_.FullName) }
            }
        }
        $settings['Publications_vrd'] = $vrdList

        # logcfg.xml (ТЖ)
        if ($Bin1C) {
            $logcfg = Join-Path (Split-Path (Split-Path $Bin1C -Parent) -Parent) 'conf\logcfg.xml'
            if (Test-Path $logcfg) {
                $settings['logcfg.xml'] = @{ Path = $logcfg; Text = [IO.File]::ReadAllText($logcfg) }
            }
        }

        # расширения .cfe рядом со скриптом / в BaseDir
        $extDirs = @($PSScriptRoot, 'D:\1c', 'C:\Bases1C\vitauto1c') | Where-Object { $_ -and (Test-Path $_) }
        $exts = Get-ChildItem $extDirs -Filter '*.cfe' -File -ErrorAction SilentlyContinue |
            Select-Object Name, FullName, Length, LastWriteTime
        $settings['Extensions_cfe'] = @($exts | ForEach-Object {
            @{ Name = $_.Name; Path = $_.FullName; MB = [math]::Round($_.Length / 1MB, 2); Modified = $_.LastWriteTime.ToString('o') }
        })

        # службы 1С / PostgreSQL
        $settings['Services'] = @(
            Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '1C|postgres|pgsql' -or $_.PathName -match 'ragent|pg_ctl' } |
            Select-Object Name, State, StartMode, PathName
        )

        $settingsFile = Join-Path $runDir 'settings.json'
        ($settings | ConvertTo-Json -Depth 8) | Set-Content $settingsFile -Encoding UTF8
        Ok "настройки: $settingsFile"
        $manifest.Files += @{ Type = 'settings'; Path = $settingsFile }

        # читаемый краткий отчёт
        $report = Join-Path $runDir 'BACKUP-REPORT.txt'
        @"
Дамп 1С / PostgreSQL
Дата:     $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
База PG:  $Database @ ${PgHost}:$PgPort
ИБ 1С:    $ibPath
Каталог:  $runDir

Файлы:
$(($manifest.Files | ForEach-Object { "  - $($_.Type): $($_.Path)$(if ($_.MB) { " ($($_.MB) МБ)" })" }) -join "`r`n")

Ошибки:
$(if ($manifest.Errors.Count) { ($manifest.Errors | ForEach-Object { "  - $_" }) -join "`r`n" } else { '  нет' })

Восстановление PostgreSQL:
  .\restore-1c-pgsql.ps1   # или pg_restore -d $Database --no-owner файл.dump

Загрузка .dt в серверную базу (install-1c-pgsql.ps1):
  положите «бэкап yyyyMMdd.dt» в D:\1c и запустите install с приоритетом бэкапа

Конфигурация .cf:
  DESIGNER /S "$ibPath" /LoadCfg "путь.cf" /UpdateDBCfg
"@ | Set-Content $report -Encoding UTF8
        Ok "отчёт: $report"
    }

    # =================================================================
    if ($Keep -gt 0) {
        Step "5. Ротация: оставить $Keep последних наборов"
        $sets = Get-ChildItem $OutDir -Directory -Filter "${Database}_*" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $Keep
        foreach ($d in $sets) {
            Remove-Item $d.FullName -Recurse -Force
            Ok "удалён $($d.Name)"
        }
        Get-ChildItem $OutDir -Filter "${Database}_*.dump" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $Keep |
            ForEach-Object { Remove-Item $_.FullName; Ok "удалён $($_.Name)" }
    }

    $manifest.Finished = (Get-Date).ToString('o')
    $manifest.DurationSec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 0)
    ($manifest | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $runDir 'manifest.json') -Encoding UTF8

    Write-Host ""
    Write-Host "ГОТОВО за $($manifest.DurationSec) с" -ForegroundColor Green
    Write-Host "  Каталог: $runDir"
    $manifest.Files | ForEach-Object { Write-Host "  $($_.Type): $($_.Path)" }
    if ($manifest.Errors.Count) {
        Write-Host "Есть предупреждения — см. manifest.json / BACKUP-REPORT.txt" -ForegroundColor Yellow
    }
    # путь к основному dump для пайплайнов
    $mainDump = $manifest.Files | Where-Object Type -eq 'pg_dump' | Select-Object -First 1
    if ($mainDump) { $mainDump.Path }
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Строка $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor DarkGray
    exit 1
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}