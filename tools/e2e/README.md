# Сквозные тесты АРМ (тестовая база)

Сценарии полного цикла через OData и команды АРМ_OData v1.1 — тем же бэкендом, что и PWA (`pwa/src/odata/backend.js` ветки `pwa-odata`).
**Только тестовая база**: скрипты пишут документы и создают пользователей с полными правами. Перед запуском — `.dt`.

| Файл | Что делает |
|---|---|
| `seed-e2e.ps1` / `seed-e2e.js` | seed: поставщики «E2E Поставщик Альфа/Бета» и «E2E Покупатель» с договорами; номенклатура с видами НДС Общая / БезНДС / Пониженная; остатки 10 шт. — проведённая приходная накладная. Идемпотентно (поиск по наименованию, накладная перепроводится) |
| `arm-processes.e2e.js` | сценарии `happy` (под закупку), `stock` (со склада), `mixed_order` (склад + закупка у другого поставщика) |
| `run-e2e.ps1` | копирует сценарии в рабочую копию `pwa/` и запускает vitest; отчёт — markdown |

## Подготовка (один раз)

1. Рабочая копия PWA из ветки `pwa-odata`. Ветку не переключаем:
   ```powershell
   git archive origin/pwa-odata pwa odata -o D:\1c\e2e\src.zip; Expand-Archive D:\1c\e2e\src.zip D:\1c\e2e
   cd D:\1c\e2e\pwa; npm ci --include=dev     # на машине NODE_ENV=production — без --include=dev vitest не ставится
   ```
2. Публикация OData с входом по Basic: `default.vrd` без `Usr`. Публикация `/autoservice` для MCP входит под «Админ», а Apache там вырезает Authorization. Для тестов отдельная публикация `/e2e` на ту же базу:
   ```
   Alias "/e2e" "D:/1c/apache/publish/e2e"   +  <Directory …> SetHandler 1c-application, ManagedApplicationDescriptor …\e2e\default.vrd
   ```
3. Пользователи `arm.manager`, `arm.storekeeper`, `arm.supply`, `arm.admin`, `arm.mechanic` (пароль `1`). Их создаёт `odata/pwa-test-users.js` ветки `pwa-odata` через COM (cscript 32-бит, скрипт в UTF-16).
4. Seed: `.\tools\e2e\seed-e2e.ps1 -IbDir D:\1c_bases\autoservice -IAmSureThisIsTestBase -ReportPath D:\1c\logs\seed-e2e.txt`

## Запуск

```powershell
.\tools\e2e\run-e2e.ps1 -PwaDir D:\1c\e2e\pwa -Only happy,stock,mixed_order -Report D:\1c\logs\e2e-report.md
```

Apache должен быть запущен. Если запускать его из Desktop Commander через `Start-Process`, процесс завершается вместе с сессией. Надёжнее так: `Invoke-CimMethod Win32_Process Create`.

## Результаты

- v2.17: все три сценария падают на K5 («состояние заказа "" не принадлежит виду заказа»).
- v2.18: все три OK. Отчёт и проверка НДС: `tasks/e2e-report-v2.18.md`, `tasks/patch-notes-v2.18.md`.
- v2.18, остальные 8 (delivery_split, virtual_buy, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in): все OK. Отчёт — `tasks/e2e-report-v2.18-8.md`, что получилось в учёте — `tasks/e2e-findings-v2.18.md`.
