#Requires -Version 5.1
<#
.SYNOPSIS
  Веб-сервер Apache с публикациями 1С (D:\1c\apache, conf\httpd.conf, :8090): запустить, если не запущен,
  и проверить, что стандартный интерфейс OData публикации отвечает (по умолчанию зеркало /mirror). Для PWA: npm run api.
#>
param(
    [string]$ApacheRoot = 'D:\1c\apache',
    [string]$ODataUrl = 'http://127.0.0.1:8090/mirror/odata/standard.odata/'
)
$ErrorActionPreference = 'Stop'
if (Get-Process httpd -ErrorAction SilentlyContinue) {
    Write-Host '  [OK] Apache уже запущен' -ForegroundColor Green
} else {
    $Httpd = Join-Path $ApacheRoot 'bin\httpd.exe'
    if (-not (Test-Path $Httpd)) { throw "Нет $Httpd" }
    # конфигурация по умолчанию: $ApacheRoot\conf\httpd.conf (SRVROOT = $ApacheRoot)
    Start-Process $Httpd -WorkingDirectory $ApacheRoot -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (-not (Get-Process httpd -ErrorAction SilentlyContinue)) { throw "Apache не запустился — смотрите $ApacheRoot\logs\error.log" }
    Write-Host '  [OK] Apache запущен (:8090)' -ForegroundColor Green
}
Write-Host "  Проверка OData $ODataUrl (первый запрос после запуска — до 2 мин)..."
$t0 = Get-Date
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ($ODataUrl + '?$format=json') -TimeoutSec 300
    Write-Host ("  [OK] OData отвечает: HTTP {0}, {1:N0} с" -f $r.StatusCode, ((Get-Date) - $t0).TotalSeconds) -ForegroundColor Green
} catch {
    # без логина 1С отвечает 401 — публикация жива, вход выполняет PWA
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($code -eq 401) { Write-Host ("  [OK] OData отвечает (401 — нужен вход), {0:N0} с" -f ((Get-Date) - $t0).TotalSeconds) -ForegroundColor Green }
    else { Write-Host "  [!]  OData: $($_.Exception.Message)" -ForegroundColor Yellow }
}
