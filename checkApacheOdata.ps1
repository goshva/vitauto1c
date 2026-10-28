#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка и запуск Apache с публикацией стандартного интерфейса OData 1С (vitauto1c / АРМ_OData).
  При необходимости: установка Apache 2.4, модуль wsap24 (из платформы 1С), conf httpd-1c.conf,
  каталог публикации, webinst, проверка OData.

  Основано на:
    - install-1c-pgsql.ps1 (база D:\1c, платформа 8.3.27.2342, сервер 1С localhost)
    - odata/start-apache.ps1, odata/README.md (ветка techdebt/arm-v2.22)

  Платформа 1С на сервере 32-битная (Program Files (x86)) — Apache нужен тоже 32-битный (win32):
  64-битный httpd не загрузит wsap24.dll. Архив httpd-2.4*-win32-*.zip в -BaseDir / рядом со скриптом
  берётся без скачивания.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\checkApacheOdata.ps1
  .\checkApacheOdata.ps1 -ForceInstall
  .\checkApacheOdata.ps1 -IbName autoservice -PublishName autoservice
  .\checkApacheOdata.ps1 -NoPublish -ODataUrl http://127.0.0.1:8090/vitauto/odata/standard.odata/
#>
param(
    [string] $BaseDir       = $(if ($PSScriptRoot -like 'D:\*') { $PSScriptRoot } else { 'D:\1c' }),
    [string] $ApacheRoot    = 'D:\1c\apache',
    [string] $Httpd         = 'D:\1c\apache\Apache24\bin\httpd.exe',
    [string] $Conf          = 'D:\1c\apache\httpd-1c.conf',
    [int]    $ListenPort    = 8090,
    [string] $PlatformVersion = '8.3.27.2342',
    [string] $Server1C      = 'localhost',
    [string] $IbName        = 'vitauto',              # база в кластере 1С (рабочая — vitauto)
    [string] $PublishName   = 'vitauto',              # URL: http://host:port/<PublishName>/
    [string] $PublishDir,                             # по умолчанию <ApacheRoot>\www\<PublishName>
    [string] $ODataUser     = 'Автосервис',
    [string] $ODataPassword = '',
    [string] $ODataUrl,                               # явный URL проверки; иначе собирается из порта/имени
    [string] $ApacheZipUrl  = 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.66-251206-win32-VS17.zip',
    # ApacheLounge хранит только последние сборки: старая ссылка отдаёт HTML — тогда положите zip в BaseDir
    [switch] $ForceInstall,                           # переустановить Apache, даже если httpd есть
    [switch] $NoPublish,                              # не вызывать webinst (только Apache + проверка URL)
    [switch] $SkipODataCheck,                         # не делать запрос OData после старта
    [switch] $Restart                                 # остановить httpd и запустить заново
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------- права ----------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Перезапуск с правами администратора...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Value -is [switch]) { if ($kv.Value) { $argList += "-$($kv.Key)" } }
        else { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

if (-not $PublishDir) { $PublishDir = Join-Path $ApacheRoot "www\$PublishName" }
if (-not $ODataUrl) {
    $ODataUrl = "http://127.0.0.1:$ListenPort/$PublishName/odata/standard.odata/"
}

$LogDir = Join-Path $BaseDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir, $ApacheRoot | Out-Null
$transcript = Join-Path $LogDir ("apache_odata_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))
Start-Transcript -Path $transcript | Out-Null

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }

$ProgramRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') |
    Where-Object { $_ } | Select-Object -Unique

function Find-1CBin {
    foreach ($root in $ProgramRoots) {
        $b = Join-Path $root "1cv8\$PlatformVersion\bin"
        if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
        # любая 8.3.*, если нужной версии нет
        $any = Get-ChildItem (Join-Path $root '1cv8') -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^8\.3\.' } |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($any) {
            $b = Join-Path $any.FullName 'bin'
            if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
        }
    }
    $null
}

function Get-7Zip {
    $cands = $ProgramRoots | ForEach-Object { Join-Path $_ '7-Zip\7z.exe' }
    foreach ($c in $cands) { if (Test-Path $c) { return $c } }
    Write-Host '  7-Zip не найден, ставлю...'
    $inst = Join-Path $env:TEMP '7z-x64.exe'
    & curl.exe -L --fail -o $inst 'https://www.7-zip.org/a/7z2409-x64.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось скачать 7-Zip' }
    Start-Process $inst -ArgumentList '/S' -Wait
    Remove-Item $inst -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $cands[0])) { throw '7-Zip не установился' }
    return $cands[0]
}

function Stop-Apache {
    Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

try {
    # =================================================================
    Step '1. Поиск платформы 1С и модуля wsap24'
    $Bin1C = Find-1CBin
    if (-not $Bin1C) {
        throw "Платформа 1С ($PlatformVersion) не найдена. Сначала запустите install-1c-pgsql.ps1"
    }
    Ok "1С: $Bin1C"

    $wsapCandidates = @(
        (Join-Path $Bin1C 'wsap24.dll'),
        (Join-Path $Bin1C 'wsap24_64.dll')
    )
    $WsapDll = $wsapCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $WsapDll) {
        # модуль веб-сервера может лежать в conf/ или рядом
        $WsapDll = Get-ChildItem (Split-Path $Bin1C -Parent) -Recurse -Filter 'wsap24*.dll' -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $WsapDll) {
        throw @"
Модуль Apache для 1С (wsap24.dll) не найден в $Bin1C.
Платформа установлена без компонента «Модули расширения веб-сервера».
Переустановите 1С с WEBSERVEREXT=1 (install_Apache.ps1 или install-1c-pgsql.ps1 этой версии)
или скопируйте wsap24.dll / wsap24_64.dll из дистрибутива в bin.
"@
    }
    Ok "модуль 1С для Apache: $WsapDll"

    $webinst = Join-Path $Bin1C 'webinst.exe'
    if (-not (Test-Path $webinst)) { Warn "webinst.exe нет в $Bin1C — публикация будет без webinst" }

    # =================================================================
    Step '2. Apache 2.4'
    $needApache = $ForceInstall -or -not (Test-Path $Httpd)
    if ($needApache) {
        Write-Host '  Установка / обновление Apache 2.4...'
        $SevenZip = Get-7Zip
        $zipLocal = @(
            (Get-ChildItem $BaseDir, $PSScriptRoot, $ApacheRoot -Filter 'httpd-2.4*.zip' -File -ErrorAction SilentlyContinue)
        ) | Sort-Object LastWriteTime -Descending | Select-Object -First 1

        $zipPath = Join-Path $ApacheRoot 'httpd-apache.zip'
        if ($zipLocal) {
            Ok "локальный архив: $($zipLocal.FullName)"
            $zipPath = $zipLocal.FullName
        }
        else {
            Write-Host "  Скачиваю $ApacheZipUrl ..."
            & curl.exe -L --fail --connect-timeout 30 --max-time 600 -o $zipPath $ApacheZipUrl
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -lt 1MB) {
                throw @"
Не удалось скачать Apache.
Скачайте вручную с https://www.apachelounge.com/download/ (httpd-2.4.x-win32-VS17.zip — 32-битный, как платформа 1С)
и положите в $BaseDir или $ApacheRoot, затем запустите снова.
"@
            }
        }

        $dest24 = Join-Path $ApacheRoot 'Apache24'
        if (Test-Path $dest24) {
            Stop-Apache
            Remove-Item $dest24 -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $ApacheRoot | Out-Null
        & $SevenZip x $zipPath "-o$ApacheRoot" -y -bso0 -bsp0
        if ($LASTEXITCODE -ne 0) { throw "Ошибка распаковки $zipPath" }

        # ApacheLounge кладёт в Apache24\
        if (-not (Test-Path $Httpd)) {
            $found = Get-ChildItem $ApacheRoot -Recurse -Filter 'httpd.exe' -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($found) {
                $Httpd = $found.FullName
                Ok "httpd найден: $Httpd"
            }
            else { throw "После распаковки httpd.exe не найден в $ApacheRoot" }
        }
        Ok "Apache установлен: $(Split-Path $Httpd -Parent)"
    }
    else {
        Ok "Apache уже есть: $Httpd"
    }

    # VC++ runtime (нужен сборкам ApacheLounge VS17): для win32 — x86
    $vc = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x86' -ErrorAction SilentlyContinue
    if (-not $vc) { $vc = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86' -ErrorAction SilentlyContinue }
    if (-not $vc -or $vc.Installed -ne 1) {
        Warn 'Visual C++ 2015-2022 x86 не найден — Apache может не запуститься. Установите vc_redist.x86.exe с сайта Microsoft.'
    }

    # =================================================================
    Step '3. Конфиг httpd-1c.conf'
    $apache24 = Split-Path (Split-Path $Httpd -Parent) -Parent   # ...\Apache24
    $modulesDir = Join-Path $apache24 'modules'
    $logsDir = Join-Path $ApacheRoot 'logs'
    $wwwRoot = Join-Path $ApacheRoot 'www'
    New-Item -ItemType Directory -Force -Path $logsDir, $wwwRoot, $PublishDir | Out-Null

    # копия wsap в modules (короткий LoadModule и без пробелов в пути)
    $wsapName = Split-Path $WsapDll -Leaf
    $wsapInMod = Join-Path $modulesDir $wsapName
    if ((Get-Item $WsapDll).FullName -ne (Get-Item $wsapInMod -ErrorAction SilentlyContinue).FullName) {
        Copy-Item $WsapDll $wsapInMod -Force
        Ok "скопирован $wsapName -> $modulesDir"
    }

    # ServerRoot в conf ApacheLounge — относительный путь; наш conf — полностью свой
    $confText = @"
# Сгенерировано check-start-apache-odata.ps1 — Apache + 1С OData :$ListenPort
Define SRVROOT "$($apache24 -replace '\\','/')"
ServerRoot "`${SRVROOT}"
Listen $ListenPort
ServerName localhost
ServerAdmin admin@localhost

LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule access_compat_module modules/mod_access_compat.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule version_module modules/mod_version.so
LoadModule mime_module modules/mod_mime.so
LoadModule dir_module modules/mod_dir.so
LoadModule alias_module modules/mod_alias.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule headers_module modules/mod_headers.so
# модуль 1С (wsap24): имя модуля в DLL — _1cws_module
LoadModule _1cws_module "modules/$wsapName"

TypesConfig conf/mime.types
DirectoryIndex default.vrd index.html

ErrorLog "$($logsDir -replace '\\','/')/error.log"
LogLevel warn
CustomLog "$($logsDir -replace '\\','/')/access.log" common

DocumentRoot "$($wwwRoot -replace '\\','/')"
<Directory "$($wwwRoot -replace '\\','/')">
    Options FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>

# публикация 1С: Alias + каталог с default.vrd (webinst добавит свой блок ниже)
Alias "/$PublishName" "$($PublishDir -replace '\\','/')"
<Directory "$($PublishDir -replace '\\','/')">
    Options FollowSymLinks
    AllowOverride None
    Require all granted
    SetHandler 1c-application
    ManagedApplicationDescriptor "$($PublishDir -replace '\\','/')/default.vrd"
</Directory>

# API АРМ (PWA): переносить только Bearer, не трогая Basic для OData
SetEnvIf Authorization "^(Bearer .+)`$" ARM_AUTH=`$1
RequestHeader set Authorization "%{ARM_AUTH}e" env=ARM_AUTH

# дополнительные публикации (по одному conf на базу): 1c-publish-<имя>.conf
IncludeOptional "$($ApacheRoot -replace '\\','/')/1c-publish-*.conf"
"@

    # чужой conf — сохранить копию
    if ((Test-Path $Conf) -and ((Get-Content $Conf -Raw -ErrorAction SilentlyContinue) -notmatch 'check-start-apache-odata')) {
        $bak = "$Conf.bak.{0:yyyyMMddHHmmss}" -f (Get-Date)
        Copy-Item $Conf $bak -Force
        Ok "старый conf сохранён: $bak"
    }
    [IO.File]::WriteAllText($Conf, $confText, (New-Object Text.UTF8Encoding $false))
    Ok "записан $Conf (Listen $ListenPort, публикация /$PublishName -> $PublishDir)"

    # =================================================================
    if (-not $NoPublish) {
        Step "4. Публикация базы '$IbName' как /$PublishName (OData)"
        $vrdBody = @"
<?xml version="1.0" encoding="UTF-8"?>
<point xmlns="http://v8.1c.ru/8.2/virtual-resource-system"
       xmlns:xs="http://www.w3.org/2001/XMLSchema"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       base="/$PublishName"
       ib="Srvr=&quot;$Server1C&quot;;Ref=&quot;$IbName&quot;;">
  <standardOdata enable="true" reuseSessions="autouse" sessionMaxAge="20" poolSize="10" poolTimeout="5"/>
</point>
"@
        $vrdPath = Join-Path $PublishDir 'default.vrd'
        if (-not (Test-Path $webinst)) {
            Warn 'webinst.exe нет — default.vrd пишется напрямую'
            [IO.File]::WriteAllText($vrdPath, $vrdBody, (New-Object Text.UTF8Encoding $false))
            Ok "default.vrd: standardOdata enable=true, Srvr=$Server1C;Ref=$IbName"
        }
        else {
            # шаблон с OData (webinst -descriptor)
            $tpl = Join-Path $LogDir 'apache-odata-template.vrd'
            [IO.File]::WriteAllText($tpl, $vrdBody, (New-Object Text.UTF8Encoding $false))

            # без пробелов и кавычек — вложенные кавычки в аргументе Start-Process ломают разбор
            $connStr = "Srvr=$Server1C;Ref=$IbName;"
            # -apache24 — Apache 2.4; -confpath — наш httpd-1c.conf
            $webinstArgs = @(
                '-publish',
                '-apache24',
                '-wsdir', $PublishName,
                '-dir', "`"$PublishDir`"",
                '-connstr', $connStr,
                '-confpath', "`"$Conf`"",
                '-descriptor', "`"$tpl`""
            )
            Write-Host "  webinst $($webinstArgs -join ' ')"
            $p = Start-Process $webinst -ArgumentList $webinstArgs -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -notin 0, $null) {
                Warn "webinst вернул $($p.ExitCode) — проверьте default.vrd"
            }
            if (-not (Test-Path $vrdPath)) {
                [IO.File]::WriteAllText($vrdPath, $vrdBody, (New-Object Text.UTF8Encoding $false))
                Ok 'default.vrd записан напрямую (webinst его не создал)'
            }
            else {
                # убедиться, что OData включён
                $raw = [IO.File]::ReadAllText($vrdPath)
                if ($raw -notmatch 'standardOdata') {
                    $raw = $raw -replace '</point>', "  <standardOdata enable=`"true`" reuseSessions=`"autouse`" sessionMaxAge=`"20`" poolSize=`"10`" poolTimeout=`"5`"/>`r`n</point>"
                    [IO.File]::WriteAllText($vrdPath, $raw, (New-Object Text.UTF8Encoding $false))
                    Ok 'в default.vrd добавлен standardOdata enable=true'
                }
                else { Ok "публикация: $vrdPath" }
            }
        }

        # права: NETWORK SERVICE / SYSTEM на bin 1С (чтение) и каталог публикации
        & icacls $Bin1C /grant '*S-1-5-20:(OI)(CI)RX' /T /Q 2>$null | Out-Null
        & icacls $PublishDir /grant '*S-1-5-20:(OI)(CI)F' /T /Q 2>$null | Out-Null
        & icacls $PublishDir /grant '*S-1-5-18:(OI)(CI)F' /T /Q 2>$null | Out-Null
        Ok 'права NETWORK SERVICE / SYSTEM на bin 1С и каталог публикации'
    }
    else {
        Warn 'публикация пропущена (-NoPublish)'
    }

    # =================================================================
    Step '5. Запуск Apache'
    if ($Restart) { Stop-Apache; Ok 'httpd остановлен (-Restart)' }

    $running = Get-Process httpd -ErrorAction SilentlyContinue
    if ($running) {
        Ok "Apache уже запущен (PID: $($running.Id -join ', ')) — новый conf применится после -Restart"
    }
    else {
        if (-not (Test-Path $Httpd)) { throw "Нет $Httpd" }
        # проверка синтаксиса; предупреждения httpd пишет в stderr — смотрим только код
        $test = cmd /c "`"$Httpd`" -t -f `"$Conf`" 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host ($test | Out-String)
            throw "httpd -t: ошибка конфига (см. выше и $logsDir\error.log)"
        }
        Ok 'httpd -t: Syntax OK'
        Start-Process $Httpd -ArgumentList "-f `"$Conf`"" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (-not (Get-Process httpd -ErrorAction SilentlyContinue)) {
            $errLog = Join-Path $logsDir 'error.log'
            if (Test-Path $errLog) { Get-Content $errLog -Tail 20 | ForEach-Object { Write-Host $_ } }
            throw "Apache не запустился — смотрите $errLog"
        }
        Ok "Apache запущен (:$ListenPort)"
    }

    if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $ListenPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
        Warn "порт $ListenPort не отвечает — брандмауэр или ошибка в error.log"
    }
    else { Ok "порт $ListenPort открыт" }

    # =================================================================
    if (-not $SkipODataCheck) {
        Step '6. Проверка OData'
        Write-Host "  URL: $ODataUrl"
        Write-Host '  первый запрос после запуска может идти до ~2 мин (1С строит модель)...'
        $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${ODataUser}:$ODataPassword"))
        $t0 = Get-Date
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri ($ODataUrl.TrimEnd('/') + '/?$format=json') `
                -Headers @{ Authorization = $auth } -TimeoutSec 300
            Ok ("OData отвечает: HTTP {0}, {1:N1} с" -f $r.StatusCode, ((Get-Date) - $t0).TotalSeconds)
            if ($r.Content -match '"value"\s*:') {
                Ok 'JSON service document получен'
            }
        }
        catch {
            $msg = $_.Exception.Message
            if ($_.Exception.Response) {
                $code = [int]$_.Exception.Response.StatusCode
                Warn "OData: HTTP $code — $msg"
                if ($code -eq 401) {
                    Warn "проверьте пользователя/пароль (-ODataUser/-ODataPassword). 401 бывает и при нехватке прав: смотрите журнал регистрации (Доступ.Отказ в доступе)."
                }
                elseif ($code -eq 404) {
                    Warn "публикация не найдена. Проверьте /$PublishName и default.vrd в $PublishDir"
                }
            }
            else {
                Warn "OData: $msg"
            }
            Warn "лог Apache: $logsDir\error.log"
            Warn "проверьте, что база на сервере 1С доступна и расширение АРМ_OData включено (odata\enable-odata.ps1)."
        }
    }

    Write-Host ""
    Write-Host "Готово." -ForegroundColor Green
    Write-Host "  Apache:     $Httpd -f `"$Conf`""
    Write-Host "  Порт:       $ListenPort"
    Write-Host "  Публикация: http://127.0.0.1:$ListenPort/$PublishName/"
    Write-Host "  OData:      $ODataUrl"
    Write-Host "  Лог:        $transcript"
    Write-Host ""
    Write-Host "Дальше:" -ForegroundColor Cyan
    Write-Host "  .\odata\enable-odata.ps1 -ConnectionString 'Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$ODataUser`";Pwd=`"$ODataPassword`"'"
    Write-Host "  .\odata\odata-check.ps1 -BaseUrl http://127.0.0.1:$ListenPort/$PublishName -User $ODataUser"
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Строка $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
    Write-Host "Лог: $transcript" -ForegroundColor Red
    exit 1
}
finally {
    Stop-Transcript | Out-Null
}
