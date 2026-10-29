#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка п. 1.10 (АРМ v2.23): сервер применяет матрицу прав к прямым записям регистра АРМ через стандартный OData.
  Только для копии базы: пишет в регистр (комментарий строки, затем возвращает прежний).
  Ожидается: разрешённое поле — 200; системное поле, чужая отметка, удаление не менеджером, недопустимый переход статуса — отказ: HTTP 500
  (исключение ПередЗаписью платформа отдаёт кодом 500) с текстом АРМODATA{... "matrix_denied" ...}.

.EXAMPLE
  .\tools\check-odata-matrix.ps1 -OdataUrl http://127.0.0.1:18090/dev/odata/standard.odata -Password 1
#>
param(
    [Parameter(Mandatory)][string]$OdataUrl,
    [string]$Password = '1'
)
$ErrorActionPreference = 'Stop'
if ($OdataUrl -match '/(vitauto|autoservice|autoservice_main)/') { throw 'Публикация рабочей базы — проверка только для копии' }
$E = 'InformationRegister_Арм_ДанныеЗакупокИПродаж'
$fails = 0
function AuthHeader($u) { @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${u}:$Password")); Accept = 'application/json' } }
function KeyPath($r) {
    "$E(ДокументЗаказПокупателя_Key=guid'$($r.ДокументЗаказПокупателя_Key)',ДокументЗаказПоставщика_Key=guid'$($r.ДокументЗаказПоставщика_Key)'," +
    "ДокументПриходнаяНакладная_Key=guid'$($r.ДокументПриходнаяНакладная_Key)',КлючСвязиСтрок='$($r.КлючСвязиСтрок)',ВидОперации='$($r.ВидОперации)'," +
    "ИдентификаторЗаписи='$($r.ИдентификаторЗаписи)',РучнаяПравка=$(([string]$r.РучнаяПравка).ToLower()),НомерЗаказаКлиента='$($r.НомерЗаказаКлиента)')"
}
function Send($user, $method, $r, $body) {
    try {
        $p = @{ UseBasicParsing = $true; Method = $method; Uri = "$OdataUrl/$(KeyPath $r)?`$format=json"; Headers = (AuthHeader $user); TimeoutSec = 180 }
        if ($body) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json)) }
        $x = Invoke-WebRequest @p; return "$($x.StatusCode)"
    } catch { $m = "$($_.ErrorDetails.Message)"; return "$([int]$_.Exception.Response.StatusCode) $(if ($m -match 'matrix_denied') { 'matrix_denied' }) $($m -replace '\s+', ' ' | Select-Object -First 1)" }
}
function Expect($name, $got, $want) {
    $ok = $got -like "$want*"
    if (-not $ok) { $script:fails++ }
    Write-Host ("{0} {1} — {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($got.Length -gt 200) { $got.Substring(0, 200) } else { $got })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}

$rows = (Invoke-RestMethod -UseBasicParsing "$OdataUrl/$E`?`$format=json&`$filter=Удаление eq false" -Headers (AuthHeader 'arm.admin') -TimeoutSec 180).value
$sale = $rows | Where-Object { $_.ВидОперации -eq 'Продажа' -and $_.СтатусСтроки -eq 'ВРаботе' -and $_.АвторСтроки_Key -eq '00000000-0000-0000-0000-000000000000' } | Select-Object -First 1
if (-not $sale) { throw 'Нет строки продажи «В работе» без отметки' }
$was = $sale.КомментарийКСтроке

Expect 'менеджер: комментарий строки «В работе» (матрица разрешает)' (Send 'arm.manager' 'Patch' $sale @{ КомментарийКСтроке = 'check-odata-matrix' }) '200'
Expect 'менеджер: «Дата отправки на сборку» (системная, роли не правят)' (Send 'arm.manager' 'Patch' $sale @{ ДатаОтправкиНаСборку = '2026-10-29T00:00:00' }) '500 matrix_denied'
Expect 'кладовщик: цена продажи' (Send 'arm.storekeeper' 'Patch' $sale @{ Цена = 1 }) '500 matrix_denied'
Expect 'менеджер: отметка строки с автором «кладовщик»' (Send 'arm.manager' 'Patch' $sale @{ ОтметкаСтроки = $true; АвторСтроки_Key = (Invoke-RestMethod -UseBasicParsing "$OdataUrl/Catalog_Пользователи?`$format=json&`$filter=Description eq 'arm.storekeeper'&`$select=Ref_Key" -Headers (AuthHeader 'arm.admin')).value[0].Ref_Key }) '500 matrix_denied'
Expect 'кладовщик: удаление строки' (Send 'arm.storekeeper' 'Delete' $sale $null) '500 matrix_denied'
Expect 'менеджер: статус «В работе» -> «Выполнено» (нет такого перехода)' (Send 'arm.manager' 'Patch' $sale @{ СтатусСтроки = 'Выполнено' }) '500 matrix_denied'
Expect 'администратор: «Дата отправки на сборку» (администратор правит всё)' (Send 'arm.admin' 'Patch' $sale @{ ДатаОтправкиНаСборку = '0001-01-01T00:00:00' }) '200'
Expect 'возврат комментария' (Send 'arm.admin' 'Patch' $sale @{ КомментарийКСтроке = $was }) '200'

if ($fails) { Write-Host "ИТОГ: ошибок $fails" -ForegroundColor Red; exit 1 } else { Write-Host 'ИТОГ: все проверки пройдены' -ForegroundColor Green }
