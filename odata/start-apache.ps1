#Requires -Version 5.1
<#
.SYNOPSIS
  Веб-сервер Apache с публикациями 1С (D:\1c\apache\httpd-1c.conf, :8090): запустить, если не запущен,
  и проверить стандартный интерфейс OData тестовой публикации (/odata215). Для PWA: npm run api.
#>
param(
    [string]$Httpd = 'D:\1c\apache\Apache24\bin\httpd.exe',
    [string]$Conf = 'D:\1c\apache\httpd-1c.conf',
    [string]$ODataUrl = 'http://127.0.0.1:8090/odata215/odata/standard.odata/',
    [string]$User = 'Админ',
    [string]$Password = ''
)
$ErrorActionPreference = 'Stop'
if (Get-Process httpd -ErrorAction SilentlyContinue) {
    Write-Host '  [OK] Apache уже запущен' -ForegroundColor Green
} else {
    if (-not (Test-Path $Httpd)) { throw "Нет $Httpd" }
    Start-Process $Httpd -ArgumentList "-f `"$Conf`"" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (-not (Get-Process httpd -ErrorAction SilentlyContinue)) { throw "Apache не запустился — смотрите D:\1c\apache\error.log" }
    Write-Host '  [OK] Apache запущен (:8090)' -ForegroundColor Green
}
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:$Password"))
Write-Host "  Проверка OData $ODataUrl (первый запрос после запуска — до 2 мин)..."
$t0 = Get-Date
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ($ODataUrl + '?$format=json') -Headers @{ Authorization = $auth } -TimeoutSec 300
    Write-Host ("  [OK] OData отвечает: HTTP {0}, {1:N0} с" -f $r.StatusCode, ((Get-Date) - $t0).TotalSeconds) -ForegroundColor Green
} catch {
    Write-Host "  [!]  OData: $($_.Exception.Message)" -ForegroundColor Yellow
}
