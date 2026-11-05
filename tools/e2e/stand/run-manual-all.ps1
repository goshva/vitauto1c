$m = 'm01_import,m02_buy_full,m03_stock_vat,m04_split_picked,m05_split_unpicked_known,m06_partial_stock,m07_batch_all_or_nothing,m08_role_storekeeper,m09_zero_price,m10_reorder_twice,m11_two_orders'
$old = 'happy,stock,mixed_order,delivery_split,virtual_buy,defect,cancel_supplier,return,return_mgr,return_internal,car_repair_in'
$dbg = 'D:\1c\logs\run-manual-all.dbg'
"start $(Get-Date -Format HH:mm:ss)" | Out-File $dbg
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\1c\e2e\run-bg-mirror.ps1 -Only "$m,$old" -Tag man-mirror
"mirror done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\1c\e2e\run-bg.ps1 -Only "$m,$old" -Tag man-file
"file done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
Set-Location C:\Users\Pavel\Desktop\vitauto1c\tools\e2e
& node check-data.mjs 'http://127.0.0.1:8090/mirror/odata/standard.odata' 'arm.manager' '1' 'D:\1c\logs\man-data-mirror.md' *> $null
"DATA mirror $LASTEXITCODE" | Out-File -Append $dbg
& node check-data.mjs 'http://127.0.0.1:8090/e2e/odata/standard.odata' 'arm.manager' '1' 'D:\1c\logs\man-data-file.md' *> $null
"DATA file $LASTEXITCODE" | Out-File -Append $dbg
"done $(Get-Date -Format HH:mm:ss)" | Out-File -Append $dbg
