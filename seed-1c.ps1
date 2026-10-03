#Requires -Version 5.1
<#
.SYNOPSIS
  Наполнение базы 1С демо-данными АРМ закупок и продаж (seed) по seed\data.json.

  Что создаётся: виды услуг, формы оплаты, контрагенты с договорами, номенклатура,
  пользователи с ролями интерфейса АРМ, заказы покупателей (номера клиента SEED-*) и строки АРМ
  в статусах матрицы. Повторный запуск дублей не создаёт.

  Как работает:
    - строки АРМ появляются через документ «Заказ покупателя» — регистр заполняет само расширение;
    - на время заполнения безопасный режим расширения отключается и затем возвращается
      (-KeepSafeModeOff — не возвращать: в безопасном режиме заказы в АРМ не попадают);
    - запись идёт через COM-соединение 1С (seed\seed.js, cscript той же разрядности, что платформа);
      библиотека типов comcntr.dll при необходимости регистрируется для текущего пользователя.

  База должна быть закрыта в конфигураторе; расширение АРМЗакупокИПродаж — установлено
  (для ролей кладовщика, главного механика, клиента и поставщика — версия v2.4 и новее).

.EXAMPLE
  .\seed-1c.ps1                                   # база из 1c-env.json или D:\1c_bases\autoservice
  .\seed-1c.ps1 -IbDir D:\1c\test_v21
  .\seed-1c.ps1 -IbDir D:\1c\test_v21 -KeepSafeModeOff
  .\seed-1c.ps1 -ConnectionString 'Srvr="localhost";Ref="autoservice";Usr="Админ";Pwd=""'
#>
param(
    [string]$IbDir,                      # каталог файловой базы; по умолчанию из 1c-env.json
    [string]$IbUser = 'Админ',
    [string]$IbPassword = '',
    [string]$ConnectionString,           # вместо -IbDir/-IbUser/-IbPassword (например, серверная база)
    [string]$DataFile,                   # по умолчанию seed\data.json
    [switch]$KeepSafeModeOff             # не возвращать безопасный режим расширения после заполнения
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $DataFile) { $DataFile = Join-Path $Root 'seed\data.json' }
$SeedJs = Join-Path $Root 'seed\seed.js'
$TypeLibId = '{98AC3B5B-5323-418F-8F07-E32F231D2393}'

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

try {
    foreach ($f in $DataFile, $SeedJs) { if (-not (Test-Path $f)) { throw "Не найден файл: $f" } }

    # ---------- база ----------
    Step 'База'
    if (-not $ConnectionString) {
        if (-not $IbDir) {
            $envFile = Join-Path $Root '1c-env.json'
            if (Test-Path $envFile) { $IbDir = (Get-Content $envFile -Raw -Encoding UTF8 | ConvertFrom-Json).Infobase.Dir }
            if (-not $IbDir) { $IbDir = 'D:\1c_bases\autoservice' }
        }
        $ibFile = Join-Path $IbDir '1Cv8.1CD'
        if (-not (Test-Path $ibFile)) { throw "Файловая база не найдена: $ibFile" }
        $ConnectionString = "File=`"$IbDir`";Usr=`"$IbUser`";Pwd=`"$IbPassword`""
        Ok "файловая база: $IbDir, пользователь «$IbUser»"
    } else {
        Ok 'строка соединения задана параметром'
    }

    # ---------- COM-соединитель ----------
    Step 'COM-соединитель 1С'
    $clsid = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\V83.COMConnector\CLSID' -ErrorAction SilentlyContinue).'(default)'
    if (-not $clsid) { throw 'V83.COMConnector не зарегистрирован — установлена ли платформа 1С?' }
    $dll32 = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\WOW6432Node\CLSID\$clsid\InprocServer32" -ErrorAction SilentlyContinue).'(default)'
    $dll64 = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\InprocServer32" -ErrorAction SilentlyContinue).'(default)'
    $is64os = [Environment]::Is64BitOperatingSystem
    if ($is64os -and $dll32 -and (Test-Path $dll32)) { $bits = 32; $dll = $dll32; $sysDir = Join-Path $env:WINDIR 'SysWOW64' }
    elseif ($dll64 -and (Test-Path $dll64))          { $bits = $(if ($is64os) { 64 } else { 32 }); $dll = $dll64; $sysDir = Join-Path $env:WINDIR 'System32' }
    else { throw 'Не найден comcntr.dll, на который указывает регистрация V83.COMConnector' }
    $cscript = Join-Path $sysDir 'cscript.exe'
    $psExe   = Join-Path $sysDir 'WindowsPowerShell\v1.0\powershell.exe'
    Ok "соединитель $bits-бит: $dll"

    # Процесс с правами администратора (например, окно, оставленное install-1c.ps1) не видит COM-регистрации
    # из HKCU — библиотека типов нужна в HKLM, иначе Connect падает с пустым сообщением.
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $tlbRoots = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Classes\TypeLib', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Classes\TypeLib'
    if (-not $elevated) { $tlbRoots += 'Registry::HKEY_CURRENT_USER\Software\Classes\TypeLib' }
    $regFn = if ($elevated) { 'RegisterTypeLib' } else { 'RegisterTypeLibForUser' }
    if (-not ($tlbRoots | Where-Object { Test-Path "$_\$TypeLibId" })) {
        # установщик 1С регистрирует класс, но не библиотеку типов — без неё вызовы объектов 1С не работают
        $regScript = Join-Path $env:TEMP 'seed-1c-regtlb.ps1'
        @"
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class TL {
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode)] public static extern int LoadTypeLibEx(string file, int regkind, out IntPtr lib);
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode)] public static extern int RegisterTypeLibForUser(IntPtr lib, string fullPath, string helpDir);
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode)] public static extern int RegisterTypeLib(IntPtr lib, string fullPath, string helpDir);
}
'@
`$lib = [IntPtr]::Zero
`$hr = [TL]::LoadTypeLibEx('$dll', 2, [ref]`$lib)
if (`$hr -eq 0) { `$hr = [TL]::$regFn(`$lib, '$dll', `$null) }
exit `$hr
"@ | Set-Content $regScript -Encoding UTF8
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $regScript
        $hr = $LASTEXITCODE
        Remove-Item $regScript -ErrorAction SilentlyContinue
        if ($hr -ne 0) { throw ("Не удалось зарегистрировать библиотеку типов comcntr.dll (код 0x{0:X8})" -f $hr) }
        Ok "библиотека типов comcntr.dll зарегистрирована $(if ($elevated) { 'для всех пользователей (HKLM)' } else { 'для текущего пользователя (HKCU)' })"
    } else {
        Ok 'библиотека типов зарегистрирована'
    }

    # ---------- подготовка запуска ----------
    $work = Join-Path $env:TEMP ("seed-1c-{0}" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force $work | Out-Null
    $jsRun    = Join-Path $work 'seed.js'       # cscript читает Юникод только в UTF-16
    $connFile = Join-Path $work 'conn.txt'
    [IO.File]::WriteAllText($jsRun, [IO.File]::ReadAllText($SeedJs, [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText($connFile, $ConnectionString, [Text.Encoding]::Unicode)

    function Invoke-Seed([string]$Mode, [string]$ReportName) {
        $report = Join-Path $work $ReportName
        # //E:JScript — не зависеть от сопоставления .js (его перехватывают редакторы/Node: «Отсутствует исполняющее ядро»)
        $cmdArgs = @('//nologo', '//E:JScript', $jsRun, $Mode, $connFile, $report)
        if ($Mode -eq 'seed') { $cmdArgs += $DataFile }
        & $cscript @cmdArgs | Out-Host
        $code = $LASTEXITCODE
        $text = if (Test-Path $report) { [IO.File]::ReadAllText($report, [Text.Encoding]::Unicode) } else { '' }
        [pscustomobject]@{ Code = $code; Text = $text }
    }
    function Show-Report([string]$Text) {
        foreach ($l in ($Text -split "`r?`n")) {
            if (-not $l) { continue }
            $color = if ($l -match '\[X\]') { 'Red' } elseif ($l -match '\[!\]') { 'Yellow' } elseif ($l -match '\[OK\]') { 'Green' } else { 'Gray' }
            Write-Host $l -ForegroundColor $color
        }
    }

    # ---------- безопасный режим расширения ----------
    Step 'Безопасный режим расширения'
    # cscript возвращает 0 и при ошибке скрипта, поэтому результат читаем из отчёта и
    # перепроверяем отдельным сеансом: без отключённого режима наполнение запускать нельзя.
    $r = Invoke-Seed 'safemode-off' 'safemode-off.txt'
    if ($r.Text -notmatch 'SAFEMODE_WAS=([01])') { Show-Report $r.Text; throw 'Не удалось прочитать безопасный режим расширения (база открыта в конфигураторе? расширение не установлено?)' }
    $wasSafe = $Matches[1] -eq '1'
    if ($r.Text -match 'USER_PROTECTION_OFF=(.+)') { Warn "1С потребовала подтверждение опасного действия — защита от опасных действий снята для расширения и пользователя «$($Matches[1].Trim())»" }
    $check = Invoke-Seed 'safemode-get' 'safemode-get.txt'
    if ($check.Text -notmatch 'SAFEMODE_NOW=0') {
        # защита пользователя снимается со следующего сеанса — одна повторная попытка
        [void](Invoke-Seed 'safemode-off' 'safemode-off2.txt')
        $check = Invoke-Seed 'safemode-get' 'safemode-get2.txt'
    }
    if ($check.Text -notmatch 'SAFEMODE_NOW=0') {
        Show-Report $r.Text
        throw 'Безопасный режим расширения отключить не удалось — наполнение не запущено. Снимите флажок «Безопасный режим» у расширения в конфигураторе (Конфигурация → Расширения конфигурации) и запустите снова.'
    }
    if ($wasSafe) { Ok 'безопасный режим был включён — отключён на время заполнения (проверено отдельным сеансом)' } else { Ok 'безопасный режим уже отключён' }

    # ---------- наполнение ----------
    $seedCode = 1
    try {
        Step 'Наполнение'
        $r = Invoke-Seed 'seed' 'seed.txt'
        Show-Report $r.Text
        $seedCode = $r.Code
    } finally {
        if ($wasSafe -and -not $KeepSafeModeOff) {
            Step 'Возврат безопасного режима'
            $b = Invoke-Seed 'safemode-on' 'safemode-on.txt'
            if ($b.Text -match 'SAFEMODE_NOW=1') {
                Ok 'безопасный режим расширения включён обратно'
                Warn 'в безопасном режиме обработчики расширения на документах не работают: новые заказы в АРМ не попадут'
            } else { Show-Report $b.Text; Warn 'не удалось вернуть безопасный режим — проверьте расширение в конфигураторе' }
        } elseif ($wasSafe) {
            Warn 'безопасный режим оставлен отключённым (-KeepSafeModeOff)'
        }
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($seedCode -eq 0) { Write-Host "`nГОТОВО" -ForegroundColor Green } else { Write-Host "`nЗавершено с ошибками" -ForegroundColor Red }
    exit $seedCode
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}
