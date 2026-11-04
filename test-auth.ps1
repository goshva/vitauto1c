# Тест авторизации Go API
$body = '{"login":"Менеджер","password":"manager123"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:18100/api/v1/session' -Method POST -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "Content: $($r.Content)"
