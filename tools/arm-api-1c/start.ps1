#Requires -Version 5.1
<#
.SYNOPSIS
  Запуск локальной публикации HTTP-сервиса АРМ (Apache 2.4 + wsap24 1С) для PWA и тестов API.
  Если Apache уже слушает порт — только проверка. После перезагрузки Windows запускать заново
  (Apache работает как обычный процесс, не служба).

.EXAMPLE
  .\tools\arm-api-1c\start.ps1
  .\tools\arm-api-1c\start.ps1 -Stop
#>
param(
    [string]$ApacheRoot = 'D:\1c\apache',
    [string]$Conf       = 'D:\1c\apache\httpd-1c.conf',
    [int]   $Port       = 8090,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$httpd = Join-Path $ApacheRoot 'Apache24\bin\httpd.exe'
$api   = "http://127.0.0.1:$Port/vitauto/hs/api/arm/v1/session"

function Listening { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }

if ($Stop) {
    Get-Process httpd -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $httpd } | Stop-Process -Force
    Write-Host "Apache остановлен"
    return
}

if (-not (Test-Path $httpd)) { throw "Нет $httpd — Apache 2.4 Win32 (apachelounge) распаковать в $ApacheRoot" }
if (-not (Test-Path $Conf))  { throw "Нет $Conf — взять tools\arm-api-1c\httpd-1c.conf" }

if (Listening) {
    Write-Host "порт $Port уже слушается"
} else {
    cmd /c "`"$httpd`" -t -f `"$Conf`" >nul 2>&1"
    if ($LASTEXITCODE -ne 0) { & $httpd -t -f $Conf; throw "Ошибка в $Conf" }
    Start-Process -FilePath $httpd -ArgumentList '-f', $Conf -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Listening); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Listening)) { throw "Apache не начал слушать порт $Port — см. $ApacheRoot\error.log" }
    Write-Host "Apache запущен: http://127.0.0.1:$Port/vitauto"
}

# первый запрос поднимает сеанс 1С (до ~10 с); ожидаемый ответ без токена — 401
try {
    $r = Invoke-WebRequest -UseBasicParsing $api -TimeoutSec 120
    Write-Host "API ответил $($r.StatusCode)"
} catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($code -eq 401) { Write-Host "API работает: $api (401 без токена — норма)" }
    else { throw "API не отвечает как ожидалось ($code): $($_.Exception.Message)" }
}
