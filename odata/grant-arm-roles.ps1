#Requires -Version 5.1
<#
.SYNOPSIS
  Пользователи PWA arm.* в серверной базе: роль расширения АРМ (Арм_Пользователь; arm.admin — Арм_Администратор),
  вход 1С:Предприятия разрешён, элемент «Пользователи» действителен, роль интерфейса в Арм_ПраваПользователей (если нет).
  Без роли АРМ OData отвечает 401: аутентификация проходит, но «Доступ запрещён: Чтение» регистра АРМ.

  До АРМ v2.22 / АРМ_OData 1.2 роли АРМ не давали прав на регистры АРМ, и через OData работал только пользователь
  с ПолныеПрава (-FullRights). С АРМ v2.23 роль АРМ даёт права на объекты АРМ, а роль АРМ_OData 1.3
  АрмOData_Пользователь (скрипт добавляет её, если она есть в базе) — на команды PWA; прямые записи через OData
  сервер проверяет по матрице. -FullRights оставлен для баз со старыми версиями расширений.

  Остальные роли не трогает. Пароль — только с -Password. Пользователей ИБ не создаёт (создать в 1С: Пользователи).
  Роли пишутся напрямую пользователю ИБ: если позже переписать его группы доступа БСП, роль АРМ может сняться —
  тогда запустить скрипт снова (или добавить роль АРМ в профиль группы доступа).

.EXAMPLE
  .\odata\grant-arm-roles.ps1                              # localhost\vitauto, под «Автосервис» без пароля
  .\odata\grant-arm-roles.ps1 -Password '<пароль>'         # заодно задать всем arm.* пароль
  .\odata\grant-arm-roles.ps1 -FullRights -Password '<пароль>'      # + ПолныеПрава: только АРМ ≤ v2.22 / АРМ_OData ≤ 1.2
  .\odata\grant-arm-roles.ps1 -IbName autoservice_main
#>
param(
    [string]$Server = 'localhost',
    [string]$IbName = 'vitauto',
    [string]$IbUser = 'Автосервис',
    [string]$IbPassword = '',
    [string]$Password,
    [switch]$FullRights,               # + роль ПолныеПрава (иначе регистры АРМ через OData не читаются)
    [string]$CheckUrl                  # по умолчанию http://127.0.0.1:8090/<IbName>/odata/standard.odata
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP ("arm-roles-{0:yyyyMMddHHmmss}" -f (Get-Date)); New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [IO.File]::WriteAllText("$tmp\r.js", [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'grant-arm-roles.js'), [Text.Encoding]::UTF8), [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText("$tmp\c.txt", "Srvr=`"$Server`";Ref=`"$IbName`";Usr=`"$IbUser`";Pwd=`"$IbPassword`"", [Text.Encoding]::Unicode)
    $jsArgs = @('//nologo', '//E:JScript', "$tmp\r.js", "$tmp\c.txt", "$tmp\out.txt", $(if ($FullRights) { '1' } else { '0' }))
    if ($PSBoundParameters.ContainsKey('Password')) { $jsArgs += $Password }
    # V83.COMConnector платформы x86 — 32-битный cscript
    & "$env:WINDIR\SysWOW64\cscript.exe" @jsArgs | Out-Null
    $out = [IO.File]::ReadAllLines("$tmp\out.txt", [Text.Encoding]::Unicode)
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor $(if ($_ -like 'ERROR*') { 'Red' } elseif ($_ -match '^SKIP|WARN') { 'Yellow' } else { 'Green' }) }

    # проверка входа через OData (только если пароль известен)
    if ($PSBoundParameters.ContainsKey('Password')) {
        if (-not $CheckUrl) { $CheckUrl = "http://127.0.0.1:8090/$IbName/odata/standard.odata" }
        Write-Host "`n  Вход OData: $CheckUrl"
        foreach ($u in 'arm.manager', 'arm.storekeeper', 'arm.supply', 'arm.admin', 'arm.mechanic') {
            $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${u}:$Password"))
            try {
                $r = Invoke-WebRequest -UseBasicParsing "$CheckUrl/InformationRegister_Арм_ДанныеЗакупокИПродаж/`$count" -Headers @{ Authorization = $auth } -TimeoutSec 120
                Write-Host ("  {0,-16} HTTP {1}, строк АРМ: {2}" -f $u, $r.StatusCode, $r.Content) -ForegroundColor Green
            }
            catch { Write-Host ("  {0,-16} {1}" -f $u, $_.Exception.Message) -ForegroundColor Red }
        }
    }
    if ($out -match '^ERROR') { exit 1 }
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
