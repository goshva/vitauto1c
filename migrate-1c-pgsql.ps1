#Requires -Version 5.1
<#
.SYNOPSIS
  Перенос файловой базы 1С (1Cv8.1CD) в клиент-серверную на PostgreSQL — с данными, пользователями и расширениями.

  Нужны: сервер 1С и PostgreSQL 1C (install-1c-pgsql.ps1), исходная база закрыта во всех сеансах.

  Шаги:
    0. Проверки: платформа, исходная база, кластер 1С (порты 1540/1541), PostgreSQL (вход, имени базы ещё нет), место
    1. Вход в исходную базу (заданный пользователь -> без пользователя -> Админ / Администратор / Автосервис -> запрос)
    2. Выгрузка исходной базы в .dt (-WorkDir) — он же резервная копия, после миграции сохраняется
    3. Создание базы в кластере 1С + БД PostgreSQL и загрузка .dt
       -Method Designer (по умолчанию): 1cv8 CREATEINFOBASE + DESIGNER /RestoreIB — база сразу зарегистрирована в кластере
       -Method Ibcmd: ibcmd infobase dump/restore (нужен ibcmd из 64-битного сервера 1С; в 32-битном дистрибутиве
         windows_8_3_27_2342 его нет). Регистрацию готовой БД в кластере ibcmd не делает — см. вывод скрипта
    4. (необязательно) Обновление расширения в новой базе: -ExtensionFile <.cfe>
    5. Проверка: вход конфигуратором и сверка количества объектов (COM): номенклатура, контрагенты, заказы, строки АРМ

  Про «ibcmd infobase copy --src=file://… --dst=dbms://…»: такой команды у ibcmd нет. Перенос делается выгрузкой
  в .dt и загрузкой в базу на СУБД (это и выполняет скрипт).

.EXAMPLE
  .\migrate-1c-pgsql.ps1 -SrcIbDir 'D:\ПАПКА\1с автосервис\1C\Autoservice'
  .\migrate-1c-pgsql.ps1 -SrcIbDir D:\1c_bases\backup\Autoservice\Autoservice -SrcUser 'Автосервис' -IbName autoservice_old
  .\migrate-1c-pgsql.ps1 -SrcIbDir D:\1c_bases\autoservice -IbName autoservice2 -ExtensionFile .\АРМЗакупокИПродаж_v2.15.cfe
  .\migrate-1c-pgsql.ps1 -SrcIbDir D:\1c_bases\autoservice -CheckOnly    # только проверки, без выгрузки и записи
#>
param(
    [string]      $SrcIbDir    = 'D:\ПАПКА\1с автосервис\1C\Autoservice',   # каталог файловой базы (1Cv8.1CD)
    [string]      $SrcUser,                                 # пользователь 1С исходной базы; не задан — подбор
    [SecureString]$SrcPassword,                             # его пароль; при -SrcUser без пароля — пустой
    [string]      $Server1C    = 'localhost',               # сервер 1С (кластер)
    [string]      $IbName      = 'autoservice',             # имя базы в кластере 1С и в PostgreSQL (латиница)
    [string]      $IbTitle,                                 # имя в списке баз; по умолчанию «<IbName> (PostgreSQL)»
    [string]      $PgHost      = 'localhost',
    [int]         $PgPort      = 5432,
    [string]      $PgUser      = 'postgres',
    [SecureString]$PgPassword,                              # если не задан — будет запрошен
    [ValidateSet('Designer', 'Ibcmd')]
    [string]      $Method      = 'Designer',
    [string]      $Ibcmd,                                   # путь к ibcmd.exe для -Method Ibcmd; по умолчанию — поиск
    [string]      $ExtensionFile,                           # .cfe — загрузить в новую базу после переноса; по умолчанию — как в исходной
    [string]      $ExtensionName,                           # имя расширения; по умолчанию — из имени файла
    [string]      $WorkDir     = 'D:\1c\migrate',           # куда выгружать .dt (остаётся резервной копией)
    [switch]      $DeleteDt,                                # удалить .dt после успешного переноса
    [switch]      $CheckOnly,                               # только проверки (шаг 0 и вход в исходную базу)
    [switch]      $SkipSpaceCheck
)

$ErrorActionPreference = 'Stop'
$PlatformVersion = '8.3.27.2342'
$ProgramRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ } | Select-Object -Unique
if (-not $IbTitle) { $IbTitle = "$IbName (PostgreSQL)" }

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]  $text" -ForegroundColor Yellow }

function Find-1CBin {
    foreach ($root in $ProgramRoots) {
        $b = Join-Path $root "1cv8\$PlatformVersion\bin"
        if (Test-Path (Join-Path $b '1cv8.exe')) { return $b }
    }
}
function Find-PgBin {
    foreach ($root in $ProgramRoots) {
        Get-ChildItem (Join-Path $root 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
            Sort-Object { $_.Name -notlike '*1C*' } |
            ForEach-Object { Join-Path $_.FullName 'bin' } |
            Where-Object { Test-Path (Join-Path $_ 'psql.exe') } | Select-Object -First 1
    }
}
function Get-FreeGB([string]$Path) {
    [math]::Round((Get-PSDrive -Name (Split-Path -Qualifier $Path).TrimEnd(':') -ErrorAction SilentlyContinue).Free / 1GB, 1)
}
function Test-Port([string]$HostName, [int]$Port) {
    $c = New-Object Net.Sockets.TcpClient
    try { return $c.ConnectAsync($HostName, $Port).Wait(2000) -and $c.Connected } catch { return $false } finally { $c.Dispose() }
}
# psql через 127.0.0.1/хост; вывод в stderr не роняет скрипт. Возвращает { Out; Code }.
function Invoke-Psql([string]$Db, [string]$Sql) {
    $env:PGPASSWORD = $script:PgPwdPlain
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $h = if ($PgHost -eq 'localhost') { '127.0.0.1' } else { $PgHost }
        $out = & (Join-Path $script:PgBin 'psql.exe') -w -h $h -p $PgPort -U $PgUser -d $Db -tAc $Sql 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev; Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
    [pscustomobject]@{ Out = (($out | Out-String).Trim()); Code = $code }
}
# Пакетный запуск 1cv8; код результата — из /DumpResult
function Invoke-1C([string]$ArgsLine, [string]$Tag) {
    $out = Join-Path $LogDir "1c_$Tag.log"
    $res = Join-Path $LogDir "1c_$Tag.result"
    Remove-Item $out, $res -ErrorAction SilentlyContinue
    Start-Process $script:V8 -ArgumentList "$ArgsLine /DisableStartupDialogs /DisableStartupMessages /Out `"$out`" /DumpResult `"$res`"" -Wait
    $code = if (Test-Path $res) { (Get-Content $res -Raw).Trim() } else { '-1' }
    if ($code -ne '0') {
        if (Test-Path $out) { Get-Content $out -Encoding UTF8 | ForEach-Object { Write-Host "    $_" } }
        throw "1С ($Tag) завершилась с кодом $code, лог: $out"
    }
}
function Test-AuthError([string]$Tag) {
    $log = Join-Path $LogDir "1c_$Tag.log"
    (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'не идентифицирован|Неправильн|пароль')
}
function Plain([SecureString]$s) { if ($s) { (New-Object Net.NetworkCredential('', $s)).Password } else { '' } }

# Сверка количества объектов в исходной и новой базе через COM (cscript той же разрядности, что comcntr)
function Get-Counts([string]$Conn) {
    $js = Join-Path $LogDir 'counts.js'; $out = Join-Path $LogDir 'counts.txt'; $cf = Join-Path $LogDir 'counts.conn'
    $src = @'
var fso = new ActiveXObject("Scripting.FileSystemObject");
var f = fso.OpenTextFile(WScript.Arguments(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(WScript.Arguments(1), true, true);
try {
  var c = new ActiveXObject("V83.COMConnector").Connect(cs), md = c.Metadata;
  var t = [["Справочник", "Номенклатура"], ["Справочник", "Контрагенты"], ["Справочник", "Пользователи"],
           ["Документ", "ЗаказПокупателя"], ["Документ", "РасходнаяНакладная"], ["РегистрСведений", "Арм_ДанныеЗакупокИПродаж"]];
  for (var i = 0; i < t.length; i++) {
    var kind = t[i][0] == "Справочник" ? md.Catalogs : t[i][0] == "Документ" ? md.Documents : md.InformationRegisters;
    if (!kind.Find(t[i][1])) { OUT.WriteLine(t[i][0] + "." + t[i][1] + "=нет"); continue; }
    var s = c.NewObject("Query", "ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ " + t[i][0] + "." + t[i][1] + " КАК Т").Execute().Select(); s.Next();
    OUT.WriteLine(t[i][0] + "." + t[i][1] + "=" + s.Get(0));
  }
  var e = c.ConfigurationExtensions.Get();
  for (var i = 0; i < e.Count(); i++) OUT.WriteLine("Расширение." + e.Get(i).Name + "=есть");
} catch (x) { OUT.WriteLine("ОШИБКА=" + x.message); }
OUT.Close();
'@
    [IO.File]::WriteAllText($js, $src, [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText($cf, $Conn, [Text.Encoding]::Unicode)
    try {
        & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript $js $cf $out | Out-Null
        $map = [ordered]@{}
        if (Test-Path $out) { foreach ($l in [IO.File]::ReadAllLines($out, [Text.Encoding]::Unicode)) { $k, $v = $l -split '=', 2; $map[$k] = $v } }
        return $map
    } finally { Remove-Item $cf, $out -ErrorAction SilentlyContinue }
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogDir = Join-Path $WorkDir ("logs_{0:yyyyMMdd_HHmmss}" -f (Get-Date))
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'migrate.log') | Out-Null

try {
    # =================================================================
    Step '0. Проверки'
    $Bin1C = Find-1CBin
    if (-not $Bin1C) { throw "Платформа 1С $PlatformVersion не найдена — сначала install-1c-pgsql.ps1" }
    $script:V8 = Join-Path $Bin1C '1cv8.exe'
    Ok "1С: $Bin1C"

    $srcFile = Join-Path $SrcIbDir '1Cv8.1CD'
    if (-not (Test-Path -LiteralPath $srcFile)) {
        $found = @(Get-ChildItem 'D:\1c_bases', 'C:\1c_bases' -Recurse -Depth 3 -Filter '1Cv8.1CD' -ErrorAction SilentlyContinue | ForEach-Object DirectoryName)
        throw "Исходная база не найдена: $srcFile" + $(if ($found) { "`n  Найдены файловые базы: $($found -join '; ')`n  Укажите нужную: -SrcIbDir <каталог>" } else { '' })
    }
    $srcGB = [math]::Round((Get-Item -LiteralPath $srcFile).Length / 1GB, 2)
    Ok "исходная база: $SrcIbDir ($srcGB ГБ)"
    if ($IbName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "-IbName '$IbName': только латиница, цифры и _ (имя БД PostgreSQL и базы в кластере)" }

    if (-not $SkipSpaceCheck) {
        # .dt обычно меньше 1Cv8.1CD; берём с запасом размер исходной базы + 1 ГБ
        $needDt = [math]::Round($srcGB + 1, 1); $freeW = Get-FreeGB $WorkDir
        if ($freeW -lt $needDt) { throw "Для .dt на диске $((Split-Path -Qualifier $WorkDir)) нужно ~$needDt ГБ, свободно $freeW ГБ (другой диск: -WorkDir)" }
        Ok "место под .dt: нужно ~$needDt ГБ, свободно $freeW ГБ ($WorkDir)"
    }

    $agentUp = (Test-Port $Server1C 1541) -and (Test-Port $Server1C 1540)
    if ($agentUp) { Ok "кластер 1С на $Server1C отвечает (1540/1541)" }
    elseif ($Method -eq 'Designer') { throw "Сервер 1С на $Server1C не отвечает (порты 1540/1541) — установите install-1c-pgsql.ps1 или запустите службу агента" }
    else { Warn "сервер 1С на $Server1C не отвечает — после ibcmd базу нужно будет зарегистрировать в кластере вручную" }

    if (-not (Test-Port $PgHost $PgPort)) { throw "PostgreSQL на ${PgHost}:$PgPort не отвечает — порт другой? (-PgPort; install-1c-pgsql.ps1 берёт первый свободный от 5432)" }
    Ok "PostgreSQL на ${PgHost}:$PgPort отвечает"
    if (-not $PgPassword) { $PgPassword = Read-Host -AsSecureString "Пароль PostgreSQL ($PgUser)" }
    $script:PgPwdPlain = Plain $PgPassword
    if ($script:PgPwdPlain.ToCharArray() | Where-Object { [int]$_ -gt 126 -or [int]$_ -lt 32 }) {
        throw 'Пароль PostgreSQL должен быть в ASCII (psql и 1С кодируют не-ASCII по-разному)'
    }
    $script:PgBin = Find-PgBin
    if ($script:PgBin) {
        $chk = Invoke-Psql 'postgres' 'select 1'
        if ($chk.Code -ne 0) { throw "Вход $PgUser в PostgreSQL не проходит: $($chk.Out)" }
        Ok "вход $PgUser в PostgreSQL проверен ($script:PgBin)"
        if ((Invoke-Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$($IbName.ToLower())'").Out -eq '1') {
            throw "В PostgreSQL уже есть БД '$IbName' — выберите другое имя (-IbName) или удалите её сами. Скрипт существующие базы не перезаписывает."
        }
        Ok "имя БД '$IbName' свободно"
    } else { Warn 'psql не найден — существование БД проверит 1С при создании базы' }

    # =================================================================
    Step '1. Вход в исходную базу'
    $tries = if ($SrcUser) { @("/N `"$SrcUser`" /P `"$(Plain $SrcPassword)`"") }
             else { @('', '/N "Админ" /P ""', '/N "Администратор" /P ""', '/N "Автосервис" /P ""') }
    $srcAuth = $null
    $probe = Join-Path $LogDir 'probe.cf'
    for ($i = 0; $null -eq $srcAuth; $i++) {
        if ($i -lt $tries.Count) { $auth = $tries[$i] }
        elseif ($i -lt $tries.Count + 3) {
            Warn 'нужен пользователь 1С с правами администратора в исходной базе'
            $u = Read-Host '  Имя пользователя 1С'; $pw = Read-Host -AsSecureString '  Пароль (Enter — пустой)'
            $auth = "/N `"$u`" /P `"$(Plain $pw)`""
        } else { throw 'Не удалось войти в исходную базу — нужен пользователь с правами администратора' }
        try { Invoke-1C "DESIGNER /F `"$SrcIbDir`" $auth /DumpCfg `"$probe`"" 'login'; $srcAuth = $auth }
        catch { if (-not (Test-AuthError 'login')) { throw } }
    }
    Remove-Item $probe -ErrorAction SilentlyContinue
    $srcUserName = if ($srcAuth -match '/N "([^"]*)"') { $Matches[1] } else { '' }
    Ok "вход в исходную базу: $(if ($srcUserName) { "пользователь «$srcUserName»" } else { 'без пользователя (список пользователей пуст)' })"
    if ($CheckOnly) { Write-Host "`nПРОВЕРКИ ПРОЙДЕНЫ (-CheckOnly): перенос не выполнялся" -ForegroundColor Green; return }

    # =================================================================
    Step '2. Выгрузка исходной базы в .dt'
    $dt = Join-Path $WorkDir ("{0}_{1:yyyyMMdd_HHmmss}.dt" -f $IbName, (Get-Date))
    Write-Host '  Выгрузка (база должна быть закрыта во всех сеансах; может занять несколько минут)...'
    if ($Method -eq 'Ibcmd') {
        if (-not $Ibcmd) { $Ibcmd = Get-ChildItem $ProgramRoots -Recurse -Depth 4 -Filter 'ibcmd.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
        if (-not $Ibcmd -or -not (Test-Path $Ibcmd)) { throw 'ibcmd.exe не найден (он есть только в 64-битном сервере 1С) — укажите -Ibcmd <путь> или используйте -Method Designer' }
        $uArgs = @(); if ($srcUserName) { $uArgs = @("--user=$srcUserName", "--password=$(if ($srcAuth -match '/P "([^"]*)"') { $Matches[1] })") }
        & $Ibcmd infobase dump "--db-path=$SrcIbDir" @uArgs $dt
        if ($LASTEXITCODE -ne 0) { throw "ibcmd infobase dump вернул $LASTEXITCODE" }
    } else {
        Invoke-1C "DESIGNER /F `"$SrcIbDir`" $srcAuth /DumpIB `"$dt`"" 'dumpib'
    }
    Ok ("выгружено: {0} ({1:N0} МБ) — резервная копия исходной базы" -f $dt, ((Get-Item $dt).Length / 1MB))

    # =================================================================
    Step "3. База '$IbName' на PostgreSQL ($Method)"
    $dbSrvr = if ($PgPort -eq 5432) { $PgHost } else { "$PgHost port=$PgPort" }
    $ibPath = "$Server1C\$IbName"
    if ($Method -eq 'Ibcmd') {
        & $Ibcmd infobase restore --dbms=PostgreSQL "--db-server=$dbSrvr" "--db-name=$IbName" "--db-user=$PgUser" "--db-pwd=$script:PgPwdPlain" --create-database $dt
        if ($LASTEXITCODE -ne 0) { throw "ibcmd infobase restore вернул $LASTEXITCODE" }
        Ok "БД '$IbName' создана и загружена в PostgreSQL"
        Warn "ibcmd не регистрирует базу в кластере 1С: добавьте её в консоли кластера (Новая -> Информационная база, «Создать базу данных» — НЕ отмечать)"
        Warn "  или: rac infobase --cluster=<id> create --create-database=no --name=$IbName --dbms=PostgreSQL --db-server=`"$dbSrvr`" --db-name=$IbName --db-user=$PgUser --db-pwd=*** --locale=ru"
    } else {
        $conn = "Srvr=`"$Server1C`";Ref=`"$IbName`";DBMS=PostgreSQL;DBSrvr=`"$dbSrvr`";DB=`"$IbName`";" +
                "DBUID=`"$PgUser`";DBPwd=`"$script:PgPwdPlain`";CrSQLDB=Y;SchJobDn=N;Locale=ru"
        Invoke-1C "CREATEINFOBASE `"$($conn -replace '"','""')`" /AddToList `"$IbTitle`"" 'create'
        Ok "база создана в кластере: $ibPath (в списке баз — «$IbTitle»)"
        Write-Host '  Загрузка .dt в новую базу (может занять несколько минут)...'
        Invoke-1C "DESIGNER /S `"$ibPath`" /RestoreIB `"$dt`"" 'restore'   # новая база пуста — без пользователя
        Ok 'данные загружены'
    }

    # =================================================================
    if ($ExtensionFile -and $Method -eq 'Designer') {
        Step '4. Расширение'
        if (-not (Test-Path $ExtensionFile)) { throw "Файл расширения не найден: $ExtensionFile" }
        if (-not $ExtensionName) { $ExtensionName = ([IO.Path]::GetFileNameWithoutExtension($ExtensionFile)) -replace '_v[\d.]+$', '' }
        Invoke-1C "DESIGNER /S `"$ibPath`" $srcAuth /LoadCfg `"$ExtensionFile`" -Extension `"$ExtensionName`"" 'ext_load'
        for ($i = 1; ; $i++) {
            try { Invoke-1C "DESIGNER /S `"$ibPath`" $srcAuth /UpdateDBCfg -Extension `"$ExtensionName`"" 'ext_apply'; break }
            catch {
                $log = Join-Path $LogDir '1c_ext_apply.log'
                $locked = (Test-Path $log) -and ((Get-Content $log -Raw -Encoding UTF8) -match 'блокировк|заблокирована|monopol|exclusive')
                if (-not $locked -or $i -ge 6) { throw }
                Warn "база занята фоновыми заданиями, повтор через 15 с (попытка $i из 6)"; Start-Sleep -Seconds 15
            }
        }
        Ok "расширение '$ExtensionName' загружено и применено ($(Split-Path -Leaf $ExtensionFile))"
    } elseif ($ExtensionFile) { Warn '-ExtensionFile с -Method Ibcmd не применяется: загрузите расширение после регистрации базы в кластере' }

    # =================================================================
    if ($Method -eq 'Designer') {
        Step '5. Проверка'
        $allOk = $true
        try { Invoke-1C "DESIGNER /S `"$ibPath`" $srcAuth /DumpCfg `"$probe`"" 'check'; Remove-Item $probe -ErrorAction SilentlyContinue; Ok "вход конфигуратором в $ibPath" }
        catch { Warn $_.Exception.Message; $allOk = $false }

        $srcPwd = if ($srcAuth -match '/P "([^"]*)"') { $Matches[1] } else { '' }
        $a = Get-Counts "File=`"$SrcIbDir`";Usr=`"$srcUserName`";Pwd=`"$srcPwd`""
        $b = Get-Counts "Srvr=`"$Server1C`";Ref=`"$IbName`";Usr=`"$srcUserName`";Pwd=`"$srcPwd`""
        $srcPwd = $null
        foreach ($k in @($a.Keys) + @($b.Keys | Where-Object { -not $a.Contains($_) })) {
            $va = $a[$k]; $vb = $b[$k]
            $same = ($va -eq $vb) -or ($ExtensionFile -and $k -like 'Расширение.*')
            $line = "{0,-45} было {1,-8} стало {2}" -f $k, $va, $vb
            if ($same) { Ok $line } else { Warn $line; if ($k -notlike 'Расширение.*') { $allOk = $false } }
        }
        if ($script:PgBin) {
            $tables = (Invoke-Psql $IbName "select count(*) from information_schema.tables where table_schema='public'").Out
            Ok "PostgreSQL: в БД '$IbName' таблиц: $tables"
        }
        if ($allOk) { Write-Host "`nГОТОВО. База перенесена: $ibPath (PostgreSQL ${PgHost}:$PgPort, БД $IbName)" -ForegroundColor Green }
        else        { Write-Host "`nПеренесено с расхождениями — смотрите выше и $LogDir" -ForegroundColor Yellow }
        $userArg = if ($srcUserName) { " /N `"$srcUserName`"" } else { '' }
        Write-Host "  Запуск: 1cv8c.exe /S `"$ibPath`"$userArg"
        Write-Host "  Исходная файловая база не изменялась: $SrcIbDir"
    }
    if ($DeleteDt) { Remove-Item $dt -Force; Ok "удалён $dt" } else { Write-Host "  Резервная копия: $dt" }
}
catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Логи: $LogDir" -ForegroundColor Red
    $script:failed = $true
}
finally {
    $script:PgPwdPlain = $null
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Stop-Transcript | Out-Null
}
if ($script:failed) { exit 1 }
