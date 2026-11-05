#Requires -Version 5.1
<#
.SYNOPSIS
  Распаковка расширений 1С (.cfe) в исходники через v8unpack (https://github.com/saby-integration/v8unpack).

  Каждый файл X.cfe распаковывается в папку <SrcDir>\X (по умолчанию .\src\X).
  Папка перед распаковкой очищается, чтобы не оставались файлы удалённых объектов (-Keep — не очищать).

  Где берётся v8unpack (по порядку):
    1. -V8Unpack <путь к exe>
    2. v8unpack в PATH (pip install v8unpack)
    3. python -m v8unpack (если модуль установлен)
    4. tools\v8unpack.exe; если его нет — скачивается из релиза GitHub

.EXAMPLE
  .\unpack-cfe.ps1                                   # все *.cfe рядом со скриптом -> .\src\<имя>
  .\unpack-cfe.ps1 .\АРМЗакупокИПродаж_v1.cfe
  .\unpack-cfe.ps1 D:\ext\*.cfe -SrcDir D:\repo\src
#>
param(
    [Parameter(Position = 0)]
    [string[]]$Path,                                    # файлы/маски .cfe; по умолчанию *.cfe рядом со скриптом
    [string]  $SrcDir,                                  # по умолчанию .\src рядом со скриптом
    [string]  $V8Unpack,                                # явный путь к v8unpack.exe
    [string]  $Temp,                                    # временная папка v8unpack (--temp)
    [switch]  $Keep                                     # не очищать папку назначения
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $SrcDir) { $SrcDir = Join-Path $Root 'src' }

$ReleaseUrl ='https://github.com/saby-integration/v8unpack/releases/download/Last/v8unpack.exe'

function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

# Возвращает команду запуска v8unpack в виде массива: exe и префиксные аргументы
function Resolve-V8Unpack {
    if ($V8Unpack) {
        if (-not (Test-Path $V8Unpack)) { throw "v8unpack не найден: $V8Unpack" }
        return , @((Resolve-Path $V8Unpack).Path)
    }
    $cmd = Get-Command v8unpack -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return , @($cmd.Source) }

    $py = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($py) {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & $py.Source -c 'import v8unpack' 2>$null | Out-Null
        $hasModule = $LASTEXITCODE -eq 0
        $ErrorActionPreference = $prev
        if ($hasModule) { return , @($py.Source, '-m', 'v8unpack') }
    }

    $exe = Join-Path $Root 'tools\v8unpack.exe'
    if (-not (Test-Path $exe)) {
        Write-Host "  v8unpack не найден, скачиваю $ReleaseUrl"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $exe) | Out-Null
        & curl.exe -L --fail -o $exe $ReleaseUrl
        if ($LASTEXITCODE -ne 0) {
            Remove-Item $exe -ErrorAction SilentlyContinue
            throw 'Не удалось скачать v8unpack.exe. Установите вручную: pip install v8unpack'
        }
        Ok "скачан $exe"
    }
    return , @($exe)
}

# ---------- список .cfe ----------
if (-not $Path) { $Path = @(Join-Path $Root '*.cfe') }
$files = foreach ($p in $Path) {
    $found = Get-ChildItem -Path $p -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.cfe' }
    if (-not $found) { Warn "не найдено .cfe: $p" }
    $found
}
$files = @($files | Sort-Object FullName -Unique)
if (-not $files) { throw 'Нет файлов .cfe для распаковки' }

$tool = Resolve-V8Unpack
Ok "v8unpack: $($tool -join ' ')"
New-Item -ItemType Directory -Force -Path $SrcDir | Out-Null

$failed = 0
foreach ($f in $files) {
    $dest = Join-Path $SrcDir $f.BaseName
    Write-Host "`n=== $($f.Name) -> $dest ===" -ForegroundColor Cyan
    if ((Test-Path $dest) -and -not $Keep) {
        Remove-Item $dest -Recurse -Force
        Write-Host '  старая папка удалена'
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    $toolArgs = @($tool | Select-Object -Skip 1) + @('-E', $f.FullName, $dest)
    if ($Temp) { $toolArgs += @('--temp', $Temp) }
    # v8unpack пишет прогресс (tqdm) в stderr — выводим напрямую в консоль в UTF-8,
    # без перехвата: иначе PowerShell 5.1 оборачивает строки в ошибки и портит кириллицу
    $prevEnc = [Console]::OutputEncoding
    $env:PYTHONIOENCODING = 'utf-8'
    try {
        [Console]::OutputEncoding = [Text.Encoding]::UTF8
        & $tool[0] @toolArgs
        $code = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $prevEnc
        Remove-Item Env:\PYTHONIOENCODING -ErrorAction SilentlyContinue
    }

    $count = @(Get-ChildItem $dest -Recurse -File -ErrorAction SilentlyContinue).Count
    if ($code -eq 0 -and $count -gt 0) { Ok "распаковано файлов: $count" }
    else { Warn "v8unpack вернул $code, файлов в папке: $count"; $failed++ }
}

if ($failed) { Write-Host "`nОшибок: $failed из $($files.Count)" -ForegroundColor Red; exit 1 }
Write-Host "`nГОТОВО: $($files.Count) расширений в $SrcDir" -ForegroundColor Green
