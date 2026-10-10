#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка и перенос в PostgreSQL рабочей файловой базы «Автосервис»
  D:\ПАПКА\1с автосервис\1C\Autoservice (вход: пользователь «Автосервис», пароль пустой).

  1. Проверка существования: каталог, файл 1Cv8.1CD, размер, дата изменения; база не открыта в 1С
  2. Проверка входа «Автосервис» без пароля (конфигуратор)
  3. Сведения о базе через COM: конфигурация и версия, пользователи, расширения, строки АРМ
  4. Перенос — migrate-1c-pgsql.ps1: резервная копия .dt (готовая свежая или новая выгрузка), база в кластере 1С
     на PostgreSQL, загрузка, расширение АРМ последней версии рядом со скриптом, сверка «было/стало»

  Нужны сервер 1С и PostgreSQL 1C (install-1c-pgsql.ps1). Исходная база не изменяется.

.EXAMPLE
  .\migrate-autoservice.ps1 -CheckOnly           # только проверки 1–3 и готовность сервера, без переноса
  .\migrate-autoservice.ps1                      # проверки и перенос в базу autoservice_main
  .\migrate-autoservice.ps1 -IbName autoservice_main2 -KeepExtension   # своё имя; расширение — как в исходной базе
#>
param(
    [string]      $SrcIbDir  = 'D:\ПАПКА\1с автосервис\1C\Autoservice',
    [string]      $SrcUser   = 'Автосервис',              # пароль пустой
    [string]      $IbName    = 'autoservice_main',        # база в кластере 1С и БД PostgreSQL (autoservice — демо-база install-1c-pgsql.ps1)
    [string]      $IbTitle   = 'Автосервис (рабочая, PostgreSQL)',
    [int]         $PgPort    = 5432,
    [SecureString]$PgPassword,                            # не задан — спросит migrate-1c-pgsql.ps1
    [switch]      $KeepExtension,                         # не обновлять расширение АРМ (оставить из исходной базы)
    [string]      $ExtensionFile,                         # .cfe; по умолчанию — последняя версия рядом со скриптом
    [switch]      $FreshDt,                               # выгрузить .dt заново, даже если есть свежая копия
    [switch]      $CheckOnly
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$PlatformVersion = '8.3.27.2342'
function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

try {
    # =================================================================
    Step "1. Существование базы $SrcIbDir"
    if (-not (Test-Path -LiteralPath $SrcIbDir -PathType Container)) {
        $cands = @(foreach ($d in 'D:\ПАПКА', 'D:\1c_bases', 'C:\1c_bases') {
            Get-ChildItem -LiteralPath $d -Recurse -Depth 4 -Filter '1Cv8.1CD' -ErrorAction SilentlyContinue | ForEach-Object DirectoryName })
        throw "Каталога базы нет: $SrcIbDir" + $(if ($cands) { "`n  Найдены файловые базы: $($cands -join '; ')`n  Укажите нужную: -SrcIbDir <каталог>" } else { '' })
    }
    $cd = Join-Path $SrcIbDir '1Cv8.1CD'
    if (-not (Test-Path -LiteralPath $cd)) { throw "В $SrcIbDir нет файла базы 1Cv8.1CD" }
    $fi = Get-Item -LiteralPath $cd
    Ok ("файл базы: {0} ({1:N2} ГБ, изменён {2:dd.MM.yyyy HH:mm})" -f $fi.FullName, ($fi.Length / 1GB), $fi.LastWriteTime)
    try { $fs = [IO.File]::Open($fi.FullName, 'Open', 'Read', 'None'); $fs.Close(); Ok 'база не открыта в 1С (файл не занят)' }
    catch { throw "База открыта в 1С или другой программой ($($_.Exception.InnerException.Message)) — закройте все сеансы и запустите снова" }

    $bin = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ } |
           ForEach-Object { Join-Path $_ "1cv8\$PlatformVersion\bin" } | Where-Object { Test-Path (Join-Path $_ '1cv8.exe') } | Select-Object -First 1
    if (-not $bin) { throw "Платформа 1С $PlatformVersion не найдена — сначала install-1c-pgsql.ps1" }

    # =================================================================
    Step "2. Вход «$SrcUser» без пароля"
    $tmp = Join-Path $env:TEMP ("migrate-autoservice-{0:yyyyMMddHHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
    $out = Join-Path $tmp 'login.log'; $res = Join-Path $tmp 'login.result'
    Start-Process (Join-Path $bin '1cv8.exe') -ArgumentList ("DESIGNER /F `"$SrcIbDir`" /N `"$SrcUser`" /P `"`" /DumpCfg `"$tmp\probe.cf`" " +
        "/DisableStartupDialogs /DisableStartupMessages /Out `"$out`" /DumpResult `"$res`"") -Wait
    $code = if (Test-Path $res) { (Get-Content $res -Raw).Trim() } else { '-1' }
    if ($code -ne '0') {
        $msg = if (Test-Path $out) { (Get-Content $out -Raw -Encoding UTF8).Trim() } else { '' }
        throw "Вход «$SrcUser» без пароля не прошёл (код $code): $msg"
    }
    Ok "конфигуратор открыл базу под «$SrcUser»"

    # =================================================================
    Step '3. Сведения о базе (COM)'
    $js = Join-Path $tmp 'info.js'; $txt = Join-Path $tmp 'info.txt'; $cf = Join-Path $tmp 'conn.txt'
    @'
var fso = new ActiveXObject("Scripting.FileSystemObject");
var f = fso.OpenTextFile(WScript.Arguments(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(WScript.Arguments(1), true, true);
try {
  var c = new ActiveXObject("V83.COMConnector").Connect(cs), md = c.Metadata;
  OUT.WriteLine("Конфигурация: " + md.Synonym + " " + md.Version);
  var u = c.InfoBaseUsers.GetUsers(), names = [];
  for (var i = 0; i < u.Count(); i++) names.push(u.Get(i).Name);
  OUT.WriteLine("Пользователи ИБ (" + u.Count() + "): " + names.join(", "));
  var e = c.ConfigurationExtensions.Get();
  for (var i = 0; i < e.Count(); i++) OUT.WriteLine("Расширение: " + e.Get(i).Name + (e.Get(i).Version ? " " + e.Get(i).Version : "") + (e.Get(i).SafeMode ? " (безопасный режим)" : ""));
  var q = function (t) { try { var s = c.NewObject("Query", "ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ " + t + " КАК Т").Execute().Select(); s.Next(); return s.Get(0); } catch (x) { return "нет"; } };
  OUT.WriteLine("Номенклатура: " + q("Справочник.Номенклатура") + ", контрагенты: " + q("Справочник.Контрагенты") +
                ", заказы покупателей: " + q("Документ.ЗаказПокупателя") + ", строки АРМ: " + q("РегистрСведений.Арм_ДанныеЗакупокИПродаж"));
} catch (x) { OUT.WriteLine("ОШИБКА: " + x.message); }
OUT.Close();
'@ | ForEach-Object { [IO.File]::WriteAllText($js, $_, [Text.Encoding]::Unicode) }
    [IO.File]::WriteAllText($cf, "File=`"$SrcIbDir`";Usr=`"$SrcUser`";Pwd=`"`"", [Text.Encoding]::Unicode)
    & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript $js $cf $txt | Out-Null
    if (Test-Path $txt) {
        foreach ($l in [IO.File]::ReadAllLines($txt, [Text.Encoding]::Unicode)) { if ($l -match '^ОШИБКА') { Warn $l } else { Ok $l } }
    } else { Warn 'COM-сведения не получены (comcntr не зарегистрирован? запустите seed-1c.ps1 или install-1c-pgsql.ps1)' }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    # =================================================================
    Step "4. Перенос в PostgreSQL: $IbName$(if ($CheckOnly) { ' (только проверки)' })"
    $mig = @{ SrcIbDir = $SrcIbDir; SrcUser = $SrcUser; SrcPassword = (New-Object Security.SecureString)
              IbName = $IbName; IbTitle = $IbTitle; PgPort = $PgPort }
    if ($PgPassword) { $mig.PgPassword = $PgPassword }
    if ($CheckOnly)  { $mig.CheckOnly = $true }
    if ($FreshDt)    { $mig.FreshDt = $true }
    if (-not $KeepExtension) {
        if (-not $ExtensionFile) {
            $ExtensionFile = Get-ChildItem $Root -Filter 'АРМЗакупокИПродаж_v*.cfe' -File |
                Sort-Object { [version](($_.BaseName -replace '^.*_v', '') + $(if ($_.BaseName -notmatch '_v\d+\.') { '.0' })) } -Descending |
                Select-Object -First 1 -ExpandProperty FullName
        }
        if ($ExtensionFile) { $mig.ExtensionFile = $ExtensionFile; Ok "расширение АРМ в новой базе: $(Split-Path -Leaf $ExtensionFile) (оставить старое: -KeepExtension)" }
        else { Warn 'рядом со скриптом нет АРМЗакупокИПродаж_v*.cfe — расширение останется из исходной базы' }
    } else { Ok 'расширение АРМ — из исходной базы (-KeepExtension)' }

    & (Join-Path $Root 'migrate-1c-pgsql.ps1') @mig
    exit $LASTEXITCODE
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
