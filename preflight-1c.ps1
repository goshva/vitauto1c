#Requires -Version 5.1
<#
.SYNOPSIS
  Предварительная проверка машины перед работой с расширением (по install-check.md)
  и запуск unpack-cfe.ps1 с найденными параметрами.

  Определяет:
    - установлена ли платформа 1С, где, и её разрядность (32/64 — по заголовку 1cv8.exe);
    - каталог conf платформы и где должен лежать logcfg.xml; пишет ли ТЖ;
    - файловую базу из списка баз, её размер и не открыта ли она сейчас;
    - лицензию 1С;
    - актуальный .cfe (последняя версия <имя>_vN.cfe рядом со скриптом), v8unpack,
      актуальны ли исходники в src\.
  Ищет неудалённые артефакты (только сообщает, ничего не удаляет):
    - PostgreSQL 1C, её служба и каталоги (C:\PGDATA15, C:\srvinfo), служба сервера 1С;
    - logcfg.xml в каталоге conf другой разрядности, старые logcfg.xml.bak.*;
    - каталоги распаковки и архивы установщика;
    - записи в списке баз, указывающие на несуществующие каталоги;
    - задача/процесс старого коллектора pgtrace.

  Результат сохраняется в 1c-env.json (для других скриптов), затем вызывается
  unpack-cfe.ps1 -Path <актуальный .cfe> [-V8Unpack <путь>] -SrcDir <src>.
  Распаковка пропускается, если исходники новее .cfe (-ForceUnpack — распаковать всё равно).

.EXAMPLE
  .\preflight-1c.ps1                 # проверка + распаковка при необходимости
  .\preflight-1c.ps1 -NoUnpack       # только проверка
  .\preflight-1c.ps1 -ForceUnpack
#>
param(
    [string]  $PlatformVersion = '8.3.27.2342',
    [string]  $IbTitle         = 'Автосервис',
    [string[]]$BaseDirs        = @('D:\1c', 'C:\soft\1c'),   # где искать архивы/распаковку установщика (плюс папка скрипта)
    [string]  $TechLogDir      = 'D:\1c\tj',
    [string]  $SrcDir,                                      # по умолчанию .\src рядом со скриптом
    [string]  $EnvFile,                                     # по умолчанию .\1c-env.json
    [switch]  $NoUnpack,
    [switch]  $ForceUnpack
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $SrcDir)  { $SrcDir  = Join-Path $Root 'src' }
if (-not $EnvFile) { $EnvFile = Join-Path $Root '1c-env.json' }

$Issues = New-Object System.Collections.ArrayList   # {Level: error|warn|artifact; Text}
function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Info($text) { Write-Host "       $text" }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow; [void]$Issues.Add([pscustomobject]@{ Level = 'warn'; Text = $text }) }
function Fail($text) { Write-Host "  [X]  $text" -ForegroundColor Red;    [void]$Issues.Add([pscustomobject]@{ Level = 'error'; Text = $text }) }
function Artifact($text) { Write-Host "  [~]  $text" -ForegroundColor Magenta; [void]$Issues.Add([pscustomobject]@{ Level = 'artifact'; Text = $text }) }

# Разрядность exe по PE-заголовку: x86 (32) или x64 (64)
function Get-PeBits([string]$File) {
    $fs = [IO.File]::Open($File, 'Open', 'Read', 'ReadWrite')
    try {
        $br = New-Object IO.BinaryReader($fs)
        $fs.Position = 0x3C; $pe = $br.ReadInt32()
        $fs.Position = $pe + 4; $machine = $br.ReadUInt16()
    } finally { $fs.Dispose() }
    switch ($machine) { 0x14C { 32 } 0x8664 { 64 } default { 0 } }
}

# Последняя версия расширения: <имя>_v<версия>.cfe с наибольшей версией (как в install-1c*.ps1)
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

# Секции ibases.v8i: имя + строка подключения
function Get-IbList([string]$File) {
    if (-not (Test-Path $File)) { return @() }
    $name = $null
    foreach ($line in [IO.File]::ReadAllLines($File, [Text.Encoding]::UTF8)) {
        if ($line -match '^\[(.+)\]\s*$') { $name = $Matches[1] }
        elseif ($name -and $line -match '^Connect=(.*)$') {
            $conn = $Matches[1]
            $path = if ($conn -match 'File="?([^";]+)"?;') { $Matches[1] } else { $null }
            [pscustomobject]@{ Title = $name; Connect = $conn; FilePath = $path }
            $name = $null
        }
    }
}

function Get-Size([string]$Path) {
    [math]::Round(((Get-ChildItem $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB))
}

$envInfo = [ordered]@{ CheckedAt = (Get-Date).ToString('s'); Machine = $env:COMPUTERNAME }

# =====================================================================
Step "Платформа 1С $PlatformVersion"
$roots = @(
    @{ Dir = Join-Path $env:ProgramFiles '1cv8' },
    @{ Dir = Join-Path ${env:ProgramFiles(x86)} '1cv8' }
)
$installed = foreach ($r in $roots) {
    if (-not (Test-Path $r.Dir)) { continue }
    Get-ChildItem $r.Dir -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | ForEach-Object {
        $exe = Join-Path $_.FullName 'bin\1cv8.exe'
        if (Test-Path $exe) {
            [pscustomobject]@{ Version = $_.Name; Root = $r.Dir; Bin = Split-Path $exe; Bits = Get-PeBits $exe }
        }
    }
}
$installed = @($installed)
$platform  = $installed | Where-Object Version -eq $PlatformVersion | Sort-Object Bits -Descending | Select-Object -First 1
foreach ($p in $installed) { Info "найдена $($p.Version), $($p.Bits)-бит: $($p.Bin)" }
if (-not $platform) {
    Fail "платформа $PlatformVersion не установлена — запустите install-1c.ps1"
} else {
    Ok "платформа $PlatformVersion, $($platform.Bits)-бит: $($platform.Bin)"
    $other = $installed | Where-Object { $_.Version -eq $PlatformVersion -and $_.Bin -ne $platform.Bin }
    foreach ($o in $other) { Artifact "вторая копия $PlatformVersion ($($o.Bits)-бит): $($o.Bin)" }
}
$uninst = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                           'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName }

# conf и технологический журнал: платформа читает logcfg.xml из <корень 1cv8>\conf своей разрядности
$confDir = if ($platform) { Join-Path $platform.Root 'conf' } else { $null }
$logcfg  = if ($confDir) { Join-Path $confDir 'logcfg.xml' } else { $null }
if ($platform) {
    if (Test-Path $logcfg) {
        Ok "logcfg.xml на месте: $logcfg"
        $loc = ([xml](Get-Content $logcfg -Raw -Encoding UTF8)).config.log.location
        if ($loc) { $TechLogDir = $loc }
    } else {
        Warn "logcfg.xml нет в $confDir — технологический журнал не пишется"
    }
    foreach ($r in $roots) {
        $wrong = Join-Path $r.Dir 'conf\logcfg.xml'
        if ($r.Dir -ne $platform.Root -and (Test-Path $wrong)) {
            Artifact "logcfg.xml в каталоге другой разрядности (платформа его не читает): $wrong"
        }
    }
}
$baks = foreach ($r in $roots) { Get-ChildItem (Join-Path $r.Dir 'conf') -Filter 'logcfg.xml.bak.*' -ErrorAction SilentlyContinue }
foreach ($b in $baks) { Artifact "старая копия logcfg: $($b.FullName)" }
$tjFiles = @(Get-ChildItem $TechLogDir -Recurse -File -ErrorAction SilentlyContinue)
if ($tjFiles.Count) { Ok "ТЖ: $($tjFiles.Count) файлов в $TechLogDir, последний $(($tjFiles | Sort-Object LastWriteTime)[-1].LastWriteTime)" }
else { Warn "ТЖ: в $TechLogDir нет файлов" }

$lic = @(Get-ChildItem "$env:ProgramData\1C\licenses", "$env:APPDATA\1C\licenses" -Filter '*.lic' -ErrorAction SilentlyContinue)
if ($lic) { Ok "лицензия: $($lic[0].FullName)" } else { Warn 'файлов лицензии 1С нет — активируйте комьюнити-лицензию' }

$envInfo.Platform = [ordered]@{
    Version   = $PlatformVersion
    Installed = [bool]$platform
    Bits      = if ($platform) { $platform.Bits } else { $null }
    Bin       = if ($platform) { $platform.Bin } else { $null }
    Exe       = if ($platform) { Join-Path $platform.Bin '1cv8.exe' } else { $null }
    ConfDir   = $confDir
    Logcfg    = $logcfg
    TechLogDir = $TechLogDir
    License   = if ($lic) { $lic[0].FullName } else { $null }
}

# =====================================================================
Step "Информационная база «$IbTitle»"
$ibList = @(Get-IbList "$env:APPDATA\1C\1CEStart\ibases.v8i")
$ib = $ibList | Where-Object Title -eq $IbTitle | Select-Object -First 1
$ibDir = $null
if (-not $ib) {
    Warn "базы «$IbTitle» нет в списке баз ($env:APPDATA\1C\1CEStart\ibases.v8i)"
} elseif (-not $ib.FilePath) {
    Info "база «$IbTitle» серверная: $($ib.Connect)"
} else {
    $ibDir  = $ib.FilePath
    $ibFile = Join-Path $ibDir '1Cv8.1CD'
    if (Test-Path $ibFile) {
        $f = Get-Item $ibFile
        Ok ("файловая база: {0} ({1:N0} МБ, изменена {2})" -f $ibDir, ($f.Length / 1MB), $f.LastWriteTime)
        $locked = $false
        try { ([IO.File]::Open($ibFile, 'Open', 'Read', 'None')).Dispose() } catch { $locked = $true }
        if ($locked) { Warn 'база сейчас открыта (конфигуратор/клиент) — применить расширение скриптом не получится' }
    } else {
        Fail "в списке есть «$IbTitle», но файла нет: $ibFile"
    }
}
foreach ($e in $ibList | Where-Object { $_.FilePath -and -not (Test-Path (Join-Path $_.FilePath '1Cv8.1CD')) }) {
    Artifact "запись в списке баз без файла базы: [$($e.Title)] $($e.FilePath)"
}
$procs = @(Get-CimInstance Win32_Process -Filter "Name like '1cv8%'" -ErrorAction SilentlyContinue)
foreach ($p in $procs) { Info "запущено: $($p.Name) (PID $($p.ProcessId))" }
$envInfo.Infobase = [ordered]@{ Title = $IbTitle; Connect = if ($ib) { $ib.Connect } else { $null }; Dir = $ibDir }

# =====================================================================
Step 'Расширение и инструменты'
$cfe = $null
try { $cfe = Find-LatestExtension $Root } catch { Fail $_.Exception.Message }
if ($cfe) {
    $all = Get-ChildItem $Root -Filter '*.cfe' -File | ForEach-Object Name
    Ok "актуальный .cfe: $(Split-Path -Leaf $cfe)  (всего: $($all -join ', '))"
} elseif (-not ($Issues | Where-Object Level -eq 'error')) {
    Fail "рядом со скриптом нет .cfe ($Root)"
}

$v8unpack = $null
$cmd = Get-Command v8unpack -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmd) { $v8unpack = $cmd.Source }
elseif (Test-Path (Join-Path $Root 'tools\v8unpack.exe')) { $v8unpack = Join-Path $Root 'tools\v8unpack.exe' }
if ($v8unpack) { Ok "v8unpack: $v8unpack" } else { Info 'v8unpack не найден — unpack-cfe.ps1 скачает его в tools\' }

$srcState = 'none'
if ($cfe) {
    $dest = Join-Path $SrcDir ([IO.Path]::GetFileNameWithoutExtension($cfe))
    if (Test-Path $dest) {
        $srcTime = (Get-Item $dest).LastWriteTime
        if ($srcTime -ge (Get-Item $cfe).LastWriteTime) { $srcState = 'actual'; Ok "исходники актуальны: $dest" }
        else { $srcState = 'stale'; Warn "исходники старше .cfe: $dest" }
    } else {
        Info "исходников ещё нет: $dest"
    }
    # папки в src для версий, которых больше нет рядом со скриптом
    $cfeNames = Get-ChildItem $Root -Filter '*.cfe' -File | ForEach-Object BaseName
    foreach ($d in Get-ChildItem $SrcDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin $cfeNames }) {
        Artifact "исходники без .cfe: $($d.FullName)"
    }
}
$envInfo.Extension = [ordered]@{ File = $cfe; SrcDir = $SrcDir; SrcState = $srcState; V8Unpack = $v8unpack }

# =====================================================================
Step 'Неудалённые артефакты'
$pg = @($uninst | Where-Object { $_.DisplayName -like 'PostgreSQL*1C*' })
foreach ($p in $pg) { Artifact "установлена $($p.DisplayName) (для файловой базы не нужна)" }
$svcs = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'PostgreSQL\\15[^\\]*1C|ragent\.exe' })
foreach ($s in $svcs) { Artifact "служба $($s.Name) ($($s.State)): $($s.PathName)" }
foreach ($d in 'C:\PGDATA15', 'C:\srvinfo') {
    if (Test-Path $d) { Artifact "каталог $d ($(Get-Size $d) МБ)" }
}
foreach ($base in @($BaseDirs) + $Root | Select-Object -Unique) {
    if (-not (Test-Path $base)) { continue }
    Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(platform_\d|config_autoservice$|postgresql_15)' } |
        ForEach-Object { Artifact "каталог распаковки установщика: $($_.FullName) ($(Get-Size $_.FullName) МБ)" }
    Get-ChildItem $base -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(windows_.*\.rar|postgresql_.*\.zip|autoservice\.zip)$' } |
        ForEach-Object { Artifact ("архив установщика: {0} ({1:N0} МБ)" -f $_.FullName, ($_.Length / 1MB)) }
}
$pgtraceTask = cmd /c 'schtasks /Query /TN pgtrace >nul 2>nul && echo yes'
if ($pgtraceTask -eq 'yes') { Artifact 'задача планировщика pgtrace (старый коллектор трассировки)' }
if (Get-Process pgtrace -ErrorAction SilentlyContinue) { Artifact 'запущен процесс pgtrace' }
if (-not ($Issues | Where-Object Level -eq 'artifact')) { Ok 'артефактов не найдено' }

# =====================================================================
Step 'Диски'
$disks = foreach ($d in Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used + $_.Free) -gt 0 }) {
    $gb = [math]::Round($d.Free / 1GB, 1)
    if ($gb -lt 10) { Warn "$($d.Name): свободно $gb ГБ (меньше 10 ГБ)" } else { Ok "$($d.Name): свободно $gb ГБ" }
    [ordered]@{ Drive = $d.Name; FreeGB = $gb }
}
$envInfo.Disks  = @($disks)
$envInfo.Issues = @($Issues)

[IO.File]::WriteAllText($EnvFile, ($envInfo | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

$errs = @($Issues | Where-Object Level -eq 'error').Count
$warn = @($Issues | Where-Object Level -eq 'warn').Count
$arts = @($Issues | Where-Object Level -eq 'artifact').Count
Write-Host "`nИтог: ошибок $errs, предупреждений $warn, артефактов $arts. Сведения: $EnvFile" -ForegroundColor $(if ($errs) { 'Red' } elseif ($warn -or $arts) { 'Yellow' } else { 'Green' })

# =====================================================================
if ($NoUnpack) { exit ([int]($errs -gt 0)) }
if (-not $cfe) { Write-Host 'Распаковка пропущена: нет актуального .cfe' -ForegroundColor Red; exit 1 }
if ($srcState -eq 'actual' -and -not $ForceUnpack) {
    Write-Host 'Распаковка не нужна: исходники новее .cfe (-ForceUnpack — распаковать заново)' -ForegroundColor Green
    exit ([int]($errs -gt 0))
}

Step 'Распаковка (unpack-cfe.ps1)'
$unpackArgs = @{ Path = @($cfe); SrcDir = $SrcDir }
if ($v8unpack) { $unpackArgs.V8Unpack = $v8unpack }
$shown = "unpack-cfe.ps1 -Path `"$cfe`" -SrcDir `"$SrcDir`""
if ($v8unpack) { $shown += " -V8Unpack `"$v8unpack`"" }
Info $shown
& (Join-Path $Root 'unpack-cfe.ps1') @unpackArgs
exit $LASTEXITCODE
