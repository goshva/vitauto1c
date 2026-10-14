#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка стандартного интерфейса OData публикации 1С и соответствия операциям PWA (REST API АРМ /api/arm/v1).

  1. Служебный документ и $metadata: сколько наборов сущностей опубликовано, есть ли объекты АРМ.
  2. Чтение данных, которые показывает PWA: строки АРМ, справочники, заказы, права, матрица.
  3. Запись через OData (только с -Write): правка поля строки АРМ (как PATCH /lines/{id}) — с возвратом значения.
  4. Таблица «операция PWA -> OData»: покрывается / частично / нет (бизнес-логика модулей АРМ через OData недоступна).
  Отчёт — в консоль и odata\odata-check-report.md.

.EXAMPLE
  .\odata\odata-check.ps1 -BaseUrl http://127.0.0.1:8090/odata215 -User Админ
  .\odata\odata-check.ps1 -BaseUrl http://127.0.0.1:8090/odata215 -User Админ -Write
#>
param(
    [string]$BaseUrl = 'http://127.0.0.1:8090/odata215',
    [string]$User = 'Админ',
    [string]$Password = '',
    [switch]$Write,
    [string]$Report = (Join-Path $PSScriptRoot 'odata-check-report.md')
)
$ErrorActionPreference = 'Stop'
$od = $BaseUrl.TrimEnd('/') + '/odata/standard.odata'
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:$Password"))
$md = New-Object Collections.Generic.List[string]
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Esc([string]$s) { [uri]::EscapeDataString($s) }
function Short([string]$s, [int]$n = 160) { $s = ($s -replace '\s+', ' ').Trim(); if ($s.Length -gt $n) { $s.Substring(0, $n) + '…' } else { $s } }

# HTTP к OData: тело в UTF-8; возвращает { Status; Json; Text; Ms }
function OData([string]$Method, [string]$Path, $Body) {
    $req = [Net.HttpWebRequest]::Create("$od/$Path")
    $req.Method = $Method; $req.Headers['Authorization'] = $auth; $req.Accept = 'application/json'; $req.Timeout = 120000
    if ($null -ne $Body) {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
        $req.ContentType = 'application/json; charset=utf-8'; $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    }
    $t0 = Get-Date
    try { $res = $req.GetResponse() } catch [Net.WebException] { $res = $_.Exception.Response; if (-not $res) { throw } }
    $rd = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8); $text = $rd.ReadToEnd(); $rd.Close()
    $json = $null; try { if ($text -match '^\s*[\{\[]') { $json = $text | ConvertFrom-Json } } catch { }
    [pscustomobject]@{ Status = [int]$res.StatusCode; Json = $json; Text = $text; Ms = [int]((Get-Date) - $t0).TotalMilliseconds }
}

Write-Host "`n=== 1. Интерфейс OData: $od ===" -ForegroundColor Cyan
$svc = OData GET '?$format=json'
if ($svc.Status -ne 200) { throw "OData не отвечает: HTTP $($svc.Status) $(Short $svc.Text 300)" }
$sets = @($svc.Json.value | ForEach-Object { $_.name })
$byKind = $sets | Group-Object { ($_ -split '_')[0] } | Sort-Object Count -Descending
Ok "наборов сущностей: $($sets.Count) ($($svc.Ms) мс)"
$byKind | ForEach-Object { Write-Host ("       {0,-28} {1}" -f $_.Name, $_.Count) }
$meta = OData GET '$metadata'
Ok ("`$metadata: {0:N0} КБ ({1} мс)" -f ($meta.Text.Length / 1KB), $meta.Ms)
$armSets = $sets | Where-Object { $_ -match 'Арм_' }
Ok "объекты АРМ: $($armSets -join ', ')"
$armEnums = @([regex]::Matches($meta.Text, '<EnumType Name="(Арм_[^"]+)"') | ForEach-Object { $_.Groups[1].Value })
Ok "перечисления АРМ (в OData — типы EnumType в `$metadata, не наборы): $($armEnums -join ', ')"

$md.Add('# OData и PWA: проверка'); $md.Add('')
$md.Add("Публикация: ``$od``, пользователь «$User». Дата: $(Get-Date -Format 'dd.MM.yyyy HH:mm').")
$md.Add(''); $md.Add("Наборов сущностей: **$($sets.Count)**, " + '`$metadata` — ' + "$([math]::Round($meta.Text.Length / 1KB)) КБ."); $md.Add('')
$md.Add('| Вид | Наборов |'); $md.Add('|---|---|'); $byKind | ForEach-Object { $md.Add("| $($_.Name) | $($_.Count) |") }
$armList = ($armSets | ForEach-Object { '`' + $_ + '`' }) -join ', '
$md.Add(''); $md.Add("Объекты АРМ: $armList"); $md.Add('')
$md.Add("Перечисления АРМ — типы ``EnumType`` в ``$('$')metadata`` (1С не публикует перечисления как наборы): $(($armEnums | ForEach-Object { '`' + $_ + '`' }) -join ', ')"); $md.Add('')

Write-Host "`n=== 2. Данные, которые показывает PWA ===" -ForegroundColor Cyan
$reg = 'InformationRegister_Арм_ДанныеЗакупокИПродаж'
$probe = [ordered]@{
    'GET /lines (строки АРМ)'                 = "${reg}?`$top=5&`$format=json"
    'GET /lines — количество'                 = "${reg}/`$count"
    'GET /lines?status=… (фильтр по статусу)'  = "${reg}?`$filter=" + (Esc "СтатусСтроки eq 'Черновик'") + "&`$top=3&`$format=json"
    'GET /directories/counterparties'         = "Catalog_Контрагенты?`$top=3&`$select=Ref_Key,Description&`$format=json"
    'GET /directories/contracts'              = "Catalog_ДоговорыКонтрагентов?`$top=3&`$select=Ref_Key,Description,Owner,Owner_Type&`$format=json"
    'GET /directories/nomenclature'           = "Catalog_Номенклатура?`$top=3&`$select=Ref_Key,Description,Артикул&`$format=json"
    'GET /directories/batches'                = "Catalog_ПартииНоменклатуры?`$top=3&`$format=json"
    'GET /directories/service-types'          = "Catalog_Арм_ВидыУслуги?`$format=json"
    'GET /directories/payment-forms'          = "Catalog_Арм_ФормыОплаты?`$format=json"
    'GET /documents/customer_order/{id}'      = "Document_ЗаказПокупателя?`$top=1&`$format=json"
    'GET /documents/supplier_order/{id}'      = "Document_ЗаказПоставщику?`$top=1&`$format=json"
    'роли пользователей (POST /session -> роль)' = "InformationRegister_Арм_ПраваПользователей?`$format=json"
}
$results = [ordered]@{}
foreach ($k in $probe.Keys) {
    $r = OData GET $probe[$k]
    $n = if ($r.Json -and ($r.Json.PSObject.Properties.Name -contains 'value')) { @($r.Json.value).Count } elseif ($r.Status -eq 200) { $r.Text.Trim() } else { '' }
    $results[$k] = $r
    if ($r.Status -eq 200) { Ok ("{0,-45} HTTP 200, {1} ({2} мс)" -f $k, $(if ($r.Json) { "записей: $n" } else { "значение: $n" }), $r.Ms) }
    else { Warn ("{0,-45} HTTP {1}: {2}" -f $k, $r.Status, (Short $r.Text)) }
}
$line = if ($results['GET /lines (строки АРМ)'].Json) { @($results['GET /lines (строки АРМ)'].Json.value)[0] } else { $null }
if ($line) {
    $fields = @($line.PSObject.Properties.Name)
    Ok "поля строки АРМ в OData: $($fields.Count) (например: $(($fields | Select-Object -First 8) -join ', '))"
}

$writeResult = 'не проверялась (запуск без -Write)'
if ($Write -and $line) {
    Write-Host "`n=== 3. Запись через OData (как PATCH /lines/{id}) ===" -ForegroundColor Cyan
    # ключ записи независимого регистра сведений — все измерения
    $dims = 'ДокументЗаказПокупателя_Key', 'ДокументЗаказПоставщика_Key', 'ДокументПриходнаяНакладная_Key', 'КлючСвязиСтрок', 'ВидОперации', 'ИдентификаторЗаписи', 'РучнаяПравка', 'НомерЗаказаКлиента'
    $key = ($dims | Where-Object { $line.PSObject.Properties.Name -contains $_ } | ForEach-Object {
        $v = $line.$_
        if ($_ -like '*_Key') { "$_=guid'$v'" } elseif ($v -is [bool]) { "$_=$($v.ToString().ToLower())" } else { "$_='$($v -replace "'", "''")'" } }) -join ','
    $was = $line.КомментарийКСтроке2
    $p = OData PATCH "${reg}($key)?`$format=json" @{ КомментарийКСтроке2 = 'OData-проверка' }
    $chk = OData GET "${reg}($key)?`$format=json&`$select=КомментарийКСтроке2"
    $back = OData PATCH "${reg}($key)?`$format=json" @{ КомментарийКСтроке2 = [string]$was }
    if ($p.Status -in 200, 204 -and $chk.Json.КомментарийКСтроке2 -eq 'OData-проверка') {
        $writeResult = "PATCH записи регистра — HTTP $($p.Status), значение записано и возвращено (HTTP $($back.Status))"; Ok $writeResult
    } else { $writeResult = "PATCH — HTTP $($p.Status): $(Short $p.Text 200)"; Warn $writeResult }
}

# Операции PWA (REST API АРМ, openapi/arm-pwa*.openapi.yaml) и что из них даёт OData
$map = @(
    @('POST/GET/DELETE /session', 'вход, роль, выход', 'частично', 'OData — Basic-авторизация пользователем ИБ на каждый запрос; роль АРМ — чтение InformationRegister_Арм_ПраваПользователей; сессий/токенов нет'),
    @('GET /matrix', 'матрица прав роль × статус × колонка', 'нет', 'матрица — код модуля Арм_МатрицаПрав, не данные; в OData не публикуется'),
    @('GET /lines', 'строки АРМ с фильтрами', 'да', "$reg, `$filter/`$select/`$orderby/`$top; права по матрице (скрытые колонки) OData не применяет"),
    @('GET /lines/{id}', 'одна строка', 'да', "$reg(<все измерения>)"),
    @('PATCH /lines/{id}', 'правка поля по правам роли', 'частично', "запись в регистр напрямую: без проверки матрицы, без пересчёта цен/сумм, без журнала Арм_Журнал — $writeResult"),
    @('POST /lines', 'новая строка заказа', 'нет', 'строки создаёт расширение при записи заказа покупателя; прямой POST в регистр обходит ключи связи и заказ'),
    @('DELETE /lines/{id}', 'пометка строки на удаление', 'частично', 'DELETE записи регистра удаляет её физически (в АРМ — флаг Удаление и правка заказа)'),
    @('POST /lines/{id}/mark, GET/POST /selection', 'отметки строк пользователя', 'частично', 'поля ОтметкаСтроки/АвторСтроки можно писать PATCH, но без логики «только автор»'),
    @('POST /lines/transition', 'переходы процессов (резерв, комплектация, УПД, возврат, закрыть)', 'нет', 'бизнес-логика Арм_ОбщегоНазначенияАРМ (статусы закупки и продажи, даты, документы)'),
    @('POST /sales/jobs, /sales/prepared', '«В работе», «Подготовлено»', 'нет', 'создание заказов поставщику/документов — код АРМ'),
    @('POST /sales/customer-orders, .../{id}/post, DELETE .../{id}', 'заказ покупателя: создать, провести, удалить', 'частично', 'Document_ЗаказПокупателя: POST/PATCH/DELETE и действие Post() есть в OData, но строки АРМ создаются только с включёнными обработчиками расширения (не в безопасном режиме)'),
    @('POST /sales/supplier-orders', 'заказ поставщику', 'частично', 'Document_ЗаказПоставщику через OData; связь со строками закупки (ДокументЗаказПоставщика) — код АРМ'),
    @('POST /sales/shipments', 'отгрузка (расходная накладная)', 'частично', 'Document_РасходнаяНакладная + Post(); заполнение по строкам АРМ — код АРМ'),
    @('POST /sales/imports', 'импорт листа покупателя', 'нет', 'разбор Excel/CSV и создание заказа — код АРМ'),
    @('POST /supply/status', 'канбан снабжения', 'нет', 'Арм_ОбщегоНазначенияАРМ.ИзменитьСтатусыВРегистреСнабжения (статус закупки и продажи, В9)'),
    @('GET /jobs/{id}', 'фоновые задания', 'нет', 'фоновые задания в OData не публикуются'),
    @('GET /documents/{kind}/{id}', 'карточка документа', 'да', 'Document_<вид>(guid''…'') с табличными частями'),
    @('GET /directories/*', 'шесть справочников', 'да', 'Catalog_Контрагенты, Catalog_ДоговорыКонтрагентов, Catalog_Номенклатура, Catalog_ПартииНоменклатуры, Catalog_Арм_ВидыУслуги, Catalog_Арм_ФормыОплаты')
)
$md.Add('## Операции PWA → OData'); $md.Add('')
$md.Add('| Операция PWA (REST API АРМ) | Что делает | OData | Как / почему |'); $md.Add('|---|---|---|---|')
foreach ($m in $map) { $md.Add("| ``$($m[0])`` | $($m[1]) | **$($m[2])** | $($m[3]) |") }
$md.Add(''); $md.Add('## Чтение данных (HTTP)'); $md.Add(''); $md.Add('| Что | Запрос | Ответ |'); $md.Add('|---|---|---|')
foreach ($k in $results.Keys) { $r = $results[$k]; $md.Add("| $k | ``$($probe[$k] -replace '\|', '%7C')`` | HTTP $($r.Status), $($r.Ms) мс |") }
$md.Add(''); $md.Add("Запись: $writeResult")
[IO.File]::WriteAllText($Report, ($md -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $true))
$cnt = $map | Group-Object { $_[2] } | ForEach-Object { "$($_.Name): $($_.Count)" }
Write-Host "`n=== 4. Операции PWA через OData: $($cnt -join ', ') (из $($map.Count)) ===" -ForegroundColor Cyan
Write-Host "Отчёт: $Report"
