# E2E-1..3 и DATA/BUG на обеих базах. COM-шаги (seed, пользователи) — отдельно и напрямую: через CIM COM не работает.
$all = 'happy,stock,mixed_order,delivery_split,virtual_buy,defect,cancel_supplier,return,return_mgr,return_internal,car_repair_in'
$dbg = 'D:\1c\logs\run-checks.dbg'
"start $(Get-Date -Format HH:mm:ss)" | Out-File $dbg
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\1c\e2e\run-bg.ps1 -Only $all -Tag chk-file
"E2E-1 file done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\1c\e2e\run-bg-mirror.ps1 -Only $all -Tag chk-mirror
"E2E-2 mirror done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\1c\e2e\run-bg-mirror.ps1 -Only split_unpicked -Tag chk-split
"E2E-3 split done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
Set-Location C:\Users\Pavel\Desktop\vitauto1c\tools\e2e
& node check-data.mjs 'http://127.0.0.1:8090/e2e/odata/standard.odata' 'arm.manager' '1' 'D:\1c\logs\check-data-file.md' *> D:\1c\logs\check-data-file.log
"DATA file exit $LASTEXITCODE" | Out-File -Append $dbg
& node check-data.mjs 'http://127.0.0.1:8090/mirror/odata/standard.odata' 'arm.manager' '1' 'D:\1c\logs\check-data-mirror.md' *> D:\1c\logs\check-data-mirror.log
"DATA mirror exit $LASTEXITCODE" | Out-File -Append $dbg
"done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
