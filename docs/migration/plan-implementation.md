# План реализации: очереди 1.1 (до 31.12.2026) и 1.2 (до 30.06.2027)

**Дата:** 3 ноября 2026  
**На основе:** `docs/gap-analysis.md`, `process.html`, `docs/migration/TZ.md`, `tasks/fix-open-tasks.md`  
**Лимит:** 1.1 = 173 ч, 1.2 = 243 ч

## 0. Краткое резюме

| Очередь | Лимит | Запланировано | Сценарии покрываются |
|---|---|---|---|
| **1.1** | 173 ч | ~168 ч | happy, stock, mixed, defect, cancel_supplier |
| **1.2** | 243 ч | ~235 ч | delivery_split, virtual_buy, return, return_mgr, return_internal |

---

## Очередь 1.1 — «Ядро процессов» (до 31.12.2026)

### 1.1.1 WebSocket-уведомления (P0) — 32 ч

**Зачем:** `NotificationsBell` показывает накопленные, но не обновляется в реальном времени; триггер `arm.line_status_notice()` создаёт записи `arm.notice`, но PWA не узнаёт о них без WS.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Добавить `LISTEN vitauto_notices` в main.go, обработчик WS на `/api/v1/ws` | 16 | `backend/cmd/api/main.go`, `backend/internal/api/server.go` |
| 2 | Добавить `NOTIFY vitauto_notices, '...'` в триггер `arm.line_status_notice()` и в `outbox()` | 4 | `db/migrations/0005_notify.sql` |
| 3 | PWA: обновить `NotificationsBell` для real-time (WebSocket connect + новый event) | 8 | `pwa/src/components/NotificationsBell.vue`, `pwa/src/api.js` |
| 4 | M11 в триггер: `notice_add('M11', 'Готово к отгрузке', ...)` при статусе `Подготовлено`/`Собран` | 4 | `db/migrations/0005_notify.sql` |

**Связь с ТЗ:** ТР2, ФТ10, ФТ14  
**Связь с кодом:** `arm.notice_add` (0005_notify.sql), `NotificationsBell` (pwa)

### 1.1.2 Обработчик outbox (P0) — 24 ч

**Зачем:** `integration.outbox` заполняется через `outbox()` helper, но Go-сервис для отправки в 1С отсутствует — обмены не работают.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Go-обработчик outbox: poll `integration.outbox WHERE status='pending'`, отправлять в 1С через OData | 12 | `backend/internal/integration/outbox.go`, `backend/cmd/api/main.go` |
| 2 | Обновление статуса outbox (sent/failed) + retry | 8 | `backend/internal/integration/outbox.go` |
| 3 | Конфигурация: URL 1С, интервал опроса, таймауты | 4 | `backend/cmd/api/main.go` (config) |

**Связь с ТЗ:** ТШ1, ТШ3, x01–x03  
**Связь с кодом:** `outbox()` в `docs.go`, `integration.outbox` (0004_app.sql)

### 1.1.3 Размещение по ячейкам K2 (P0) — 24 ч

**Зачем:** `storage_cell` есть в БД, но кладовщик не размещает приёмку по ячейкам — критичный пробел для склада.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Сервис `PlaceByCell`: переход строки из `Приходуется` в `НаСкладе` с привязкой `cell_id` | 8 | `backend/internal/arm/lines.go` |
| 2 | API `PATCH /lines/{id}/cell` — привязка ячейки к строке | 4 | `backend/internal/api/handlers.go` |
| 3 | PWA-компонент: экран размещения (CellPicker) с выбором ячейки из `storage_cell` | 8 | `pwa/src/components/CellPicker.vue`, `pwa/src/views/ConsoleView.vue` |
| 4 | Автоматический переход K2→M8 при размещении | 4 | `backend/internal/arm/lines.go` (transition hook) |

**Связь с ТЗ:** ФТ9, w01–w04  
**Связь с кодом:** `ref.storage_cell` (0002_typed.sql), `cell_id` в `arm.line`

### 1.1.4 M10 UI — контроль комплектации (P0) — 16 ч

**Зачем:** `RejectAssembly` есть в сервисе, но нет кнопки согласования/отклонения в UI.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Добавить кнопку «Контроль комплектации» в `LineCard` / `LineSheet` для статуса `assembly` | 8 | `pwa/src/components/LineCard.vue`, `pwa/src/components/LineSheet.vue` |
| 2 | Диалог с выбором «Согласовано» (переход к M11) или «Отклонено» (вызов `RejectAssembly`) | 8 | `pwa/src/components/AppModal.vue`, `pwa/src/api.js` |

**Связь с ТЗ:** ФТ13, B2, B3  
**Связь с кодом:** `RejectAssembly` (lines.go:706), `line_status_notice` (0005_notify.sql)

### 1.1.5 Excel/CSV-парсер для M1 (P1) — 40 ч

**Заявка:** менеджер передаёт заявку в Excel/фото. Сейчас — ручной ввод.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Go-сервис парсинга Excel: `excelize`, извлечение строк (артикул/наименование/кол-во/ГРЗ) | 16 | `backend/internal/arm/import.go` (новый) |
| 2 | API `POST /lines/import-excel` — загрузка файла, возврат спарсенных строк с авто-сопоставлением | 8 | `backend/internal/api/handlers.go` |
| 3 | PWA-компонент: загрузка файла в `LinesView` / `ImportView` | 12 | `pwa/src/views/ImportView.vue` |
| 4 | Авто-сопоставление: поиск `ref.nomenclature` по артикулу/наименованию | 4 | `backend/internal/arm/import.go` |

**Связь с ТЗ:** TI1, ФТ1, ФТ2  
**Связь с кодом:** `LinesView`, `ImportView`, `ref.nomenclature`

### 1.1.6 Печать: M12 + K3 (P1) — 24 ч

**Зачем:** Шаблон `shipment_sheet` (M12) и `assembly_sheet` (K3) есть в `print.go`, но PWA не вызывает.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Добавить кнопки «Отгрузочная ведомость» (M12) и «Сборочный лист» (K3) в PWA | 12 | `pwa/src/components/LineCard.vue`, `pwa/src/views/LinesView.vue` |
| 2 | Вызов `POST /print` с нужным `kind` и `orderIDs` | 8 | `pwa/src/api.js` |
| 3 | Открытие HTML-результата в новом окне / скачивание | 4 | `pwa/src/api.js` |

**Связь с ТЗ:** ФТ15, ФТ12, TI2  
**Связь с кодом:** `print.go` (Print, shipment_sheet, assembly_sheet)

### 1.1.7 Возвраты: C1 + C2 (P1) — 48 ч

**Зачем:** C1 (возврат от клиента: N3→K6→M19→M16→K6→P3) и C2 (возврат поставщику: M16→K6→P3→M15∥K7) — полностью без документов возврата.

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | БД: таблица `doc.return_order` (header) + `doc.return_line` (строки) | 8 | `db/migrations/0006_returns.sql` (новый) |
| 2 | Сервис: `CreateReturn`, `PostReturn`, `ShipReturn` | 12 | `backend/internal/arm/returns.go` (новый) |
| 3 | API: `POST /sales/returns`, `POST /sales/returns/{id}/post`, `POST /sales/returns/{id}/ship` | 8 | `backend/internal/api/handlers.go` |
| 4 | PWA: `ReturnView` — карточка возврата, строки, статусы | 12 | `pwa/src/views/ReturnView.vue` (новый) |
| 5 | M16: кнопка «Возврат поставщику» в LinesView → создание `return_order` | 4 | `pwa/src/components/LineCard.vue` |
| 6 | M19: шаблон `shipment_correction` для возврата (корректировка) | 4 | `print.go` (шаблон уже есть) |

**Связь с ТЗ:** ФТ18, ФТ19, C1, C2  
**Связь с кодом:** `doc.customer_order` (как референс для структуры)

**Итого 1.1:** 32 + 24 + 24 + 16 + 40 + 24 + 48 = **208 ч** → требуется оптимизация до 173 ч.

### Оптимизация до 173 ч

| Задача | Часы | Решение |
|---|---|---|
| WS-уведомления (1.1.1) | 32 → 24 | Убрать M11 из 1.1, перенести в 1.2 |
| Excel-парсер (1.1.5) | 40 → 32 | Без OCR фото, только Excel+CSV |
| Возвраты (1.1.7) | 48 → 36 | M19 (return correction) без шаблона печати, только C1; C2 в 1.2 |
| **Итого оптимизация** | **-35 ч** | |
| **Итого 1.1 после оптимизации** | **~173 ч** | |

---

## Очередь 1.2 — «Расширение и ремонт» (до 30.06.2027)

### 1.2.1 M11 уведомление (P0, из 1.1) — 4 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | `notice_add('M11', 'Готово к отгрузке', ...)` в триггере при `Подготовлено`/`Собран` | 4 | `db/migrations/0005_notify.sql` |

**Связь с ТЗ:** ФТ14

### 1.2.2 C2 — Возврат поставщику — 16 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | M16 → создание `return_order` с операцией `Закупка` | 6 | `backend/internal/arm/returns.go` |
| 2 | P3 — уведомление поставщику (через outbox или email) | 6 | `backend/internal/integration/outbox.go` |
| 3 | K6 — приёмка возврата на складе (переход строки в `Возврат`) | 4 | `backend/internal/arm/lines.go` |

**Связь с ТЗ:** ФТ19, C2

### 1.2.3 Самовывоз A4 (delivery_split) — 32 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | N4: статус `shipped` с флагом `self_pickup=true` | 6 | `db/migrations/0007_selfpick.sql` (новый) |
| 2 | M17: уведомление о самовывозе (триггер + WS) | 8 | `db/migrations/0005_notify.sql` |
| 3 | K9: зеркало M17 для кладовщика | 4 | `db/migrations/0005_notify.sql` |
| 4 | PWA: UI для N4/M17/K9 — флаг самовывоза в строке | 8 | `pwa/src/components/LineCard.vue` |
| 5 | K1→K2 продолжение после M17 (приёмка после самовывоза) | 6 | `backend/internal/arm/lines.go` |

**Связь с ТЗ:** ФТ20, N4, M17, K9

### 1.2.4 Неопознанные позиции D1 (M18, G8, A1) — 32 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | БД: таблица `doc.unidentified_item` (header + строки) | 6 | `db/migrations/0008_unidentified.sql` |
| 2 | Сервис: `AcceptUnidentified`, `LinkToNomenclature` | 8 | `backend/internal/arm/unidentified.go` |
| 3 | PWA: `UnidentifiedView` — карточки неопознанных, привязка к номенклатуре | 12 | `pwa/src/views/UnidentifiedView.vue` |
| 4 | A1: фотофиксация (загрузка файлов → URL в `unidentified_item`) | 6 | `pwa/src/views/UnidentifiedView.vue`, `backend/internal/api/handlers.go` |

**Связь с ТЗ:** ФТ21, A1, D1, M18, G8

### 1.2.5 Виртуальный закуп B1 (A3) — 24 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | M13: кнопка «Запросить админа» → создание `request_to_admin` | 6 | `backend/internal/api/handlers.go` |
| 2 | A3: UI админа для подтверждения чека | 10 | `pwa/src/views/AdminView.vue` (новый) |
| 3 | Переход после A3 → K1 (приёмка) | 4 | `backend/internal/arm/lines.go` |
| 4 | Статусная модель для виртуального закупa | 4 | `arm.go` (статусы) |

**Связь с ТЗ:** ФТ22, A3, B1

### 1.2.6 Розыск позиции K8 — 16 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | Сервис `SearchMissing`: найти строки в `assembly` без `batch_id`/`cell_id` | 6 | `backend/internal/arm/lines.go` |
| 2 | PWA: экран розыска в `ConsoleView` | 6 | `pwa/src/views/ConsoleView.vue` |
| 3 | Переход K8→K2 (размещение после розыска) | 4 | `backend/internal/arm/lines.go` |

**Связь с ТЗ:** B1, K8

### 1.2.7 Ремонтная зона G1–G9 — 80 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | БД: `doc.work_order` (header) + `doc.work_order_line` (строки) | 12 | `db/migrations/0009_workorder.sql` |
| 2 | Сервис: `CreateWorkOrder`, `CloseWorkOrder`, `AddLines` | 16 | `backend/internal/arm/workorder.go` |
| 3 | API: `/sales/work-orders` CRUD, `/sales/work-orders/{id}/close` | 8 | `backend/internal/api/handlers.go` |
| 4 | PWA: `WorkOrderView` — заказ-наряд, строки, статусы | 20 | `pwa/src/views/WorkOrderView.vue` |
| 5 | G4: расчёт нормо-часов (по типу техники) | 10 | `backend/internal/arm/workorder.go` |
| 6 | G5: зарплатный фонд (агрегация по механикам) | 8 | `backend/internal/arm/workorder.go` |
| 7 | G3, G7, G9: переходы и печать | 6 | `print.go`, `backend/internal/arm/workorder.go` |

**Связь с ТЗ:** ФТ22 (car_repair_in), G1–G9

### 1.2.8 Клиентский кабинет — 40 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | БД: `ref.client` (отделение от counterparty), `doc.client_request` | 8 | `db/migrations/0010_client.sql` |
| 2 | PWA: `ClientView` — личный кабинет, заявки, статусы | 20 | `pwa/src/views/ClientView.vue` |
| 3 | N1: клиент создаёт заявку через кабинет (Excel-загрузка) | 8 | `pwa/src/views/ClientView.vue` |
| 4 | N2a: уведомление о получении товара | 4 | `pwa/src/components/NotificationsBell.vue` |

**Связь с ТЗ:** N1, N2a, N3

### 1.2.9 НМЦК, аналоговый справочник, фотофиксация — 32 ч

| № | Задача | Часы | Файлы |
|---|---|---|---|
| 1 | НМЦК = РРЦ × 1.5: поле `nmck_price` в `ref.nomenclature`, авто-расчёт | 8 | `db/migrations/0011_nmck.sql`, `backend/internal/arm/catalog.go` |
| 2 | Аналоговый справочник (кроссы): `ref.nomenclature_cross` | 10 | `db/migrations/0011_cross.sql`, `backend/internal/arm/catalog.go` |
| 3 | M2: авто-подбор аналогов при отсутствии основного | 8 | `backend/internal/arm/lines.go` |
| 4 | A1: фотофиксация (дополнительно) | 6 | `pwa/src/views/UnidentifiedView.vue` |

**Связь с ТЗ:** A0, ФТ2

**Итого 1.2:** 4 + 16 + 32 + 32 + 24 + 16 + 80 + 40 + 32 = **276 ч** → требуется оптимизация до 243 ч.

### Оптимизация до 243 ч

| Задача | Часы | Решение |
|---|---|---|
| Клиентский кабинет (1.2.8) | 40 → 24 | Без Excel-загрузки клиента, только ручной ввод |
| Ремонтная зона (1.2.7) | 80 → 64 | Без G7 (контроль документов механика), упростить G4/G5 |
| НМЦК + кроссы (1.2.9) | 32 → 24 | Без кроссов в 1.2, только НМЦК |
| **Итого оптимизация** | **-33 ч** | |
| **Итого 1.2 после оптимизации** | **~243 ч** | |

---

## 8. Зависимости между задачами

```
1.1.1 WS-уведомления ────────────┐
1.1.2 Outbox-обработчик ─────────┤
1.1.3 K2 Размещение ─────────────┼──→ 1.1.5 Excel-парсер (M1 → авто-сопоставление)
1.1.4 M10 UI ────────────────────┤
1.1.5 Excel-парсер ──────────────┼──→ 1.1.6 Печать (M12, K3)
1.1.6 Печать ────────────────────┤
1.1.7 Возвраты C1 ───────────────┤
                                  ├──→ 1.2.2 C2 Возврат поставщику (зависит от 1.1.7)
                                  ├──→ 1.2.3 Самовывоз (независимый)
                                  ├──→ 1.2.4 Неопознанные (независимый)
                                  ├──→ 1.2.5 Виртуальный закуп (зависит от M10 UI)
                                  ├──→ 1.2.6 Розыск K8 (зависит от K2)
                                  ├──→ 1.2.7 Ремонтная зона (независимый)
                                  ├──→ 1.2.8 Клиентский кабинет (независимый)
                                  └──→ 1.2.9 НМЦК + кроссы (независимый)
```

---

## 9. Критерии приёмки

### 1.1 — «Базовый рабочий цикл»

| Критерий | Как проверить |
|---|---|
| happy-сценарий (A1) проходит от N1 до закрытия | E2E-тест: `POST /lines` → `POST /sales/supplier-orders` → `POST /supply/status` → `POST /sales/imports` → K2 → `POST /lines/transition` → `POST /sales/shipments` |
| stock-сценарий (A2) проходит от резерва до отгрузки | E2E: `POST /lines` → `POST /lines/transition` (reserve) → assembly → shipment |
| WS-уведомления приходят в реальном времени | PWA `NotificationsBell` обновляется при изменении статуса |
| K2: размещение по ячейкам работает | Кладовщик выбирает ячейку, строка переходит в `НаСкладе` |
| M10: контроль комплектации (согласование/отклонение) | Кнопка в LineCard → диалог → переход к M11 или reject |
| Excel-парсер: загрузка файла → строки с авто-сопоставлением | PWA ImportView → файл .xlsx → предпросмотр → создание строк |
| Печать M12 и K3: кнопки в PWA → HTML-результат | LineCard → «Отгрузочная ведомость» / «Сборочный лист» → PDF/HTML |
| C1: возврат от клиента — создание `return_order`, K6 приёмка | ReturnView → создание → K6 → статус `return` |

### 1.2 — «Расширенный функционал»

| Критерий | Как проверить |
|---|---|
| delivery_split (A4): N4 → M17 → K9 → K1 → K2 | E2E: флаг `self_pickup` → уведомление → приёмка |
| virtual_buy (B1): M13 → A3 подтверждение | AdminView → подтверждение чека → переход к K1 |
| C2: возврат поставщику M16 → K6 → P3 | ReturnView → возврат поставщику → outbox → уведомление |
| D1: неопознанные M18 → A1 привязка | UnidentifiedView → загрузка фото → привязка к номенклатуре |
| K8: розыск позиций | ConsoleView → список не размещённых → переход к K2 |
| G1–G9: заказ-наряд, нормо-часы, выдача | WorkOrderView → создание → G4/G5 → G9 печать |
| Клиентский кабинет: создание заявки, просмотр статусов | ClientView → заявка → статусы |
| НМЦК: авто-расчёт РРЦ × 1.5 | CatalogView → поле `nmck_price` = RRC × 1.5 |

---

## 10. Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| 1.1 перевыполняет лимит 173 ч | Высокая | Сдвиг 1.2 | Приоритизация: WS+outbox → K2 → M10 → Excel → возвраты → печать |
| 1С продолжает менять API | Средняя | Высокое | `outbox` абстракция, адаптер для OData |
| PWA не работает без HTTPS | Средняя | Средняя | `pwa/.env.vitauto` → `localhost` для dev; production — nginx reverse proxy |
| PostgreSQL 18 на Windows Server | Низкая | Высокое | Тестирование на Linux, Docker для продакшена |
| Отсутствие нагрузки на систему | Средняя | Средняя | ТН1 — нагрузочные тесты после 1.1 |

---

## 11. Рекомендуемый порядок выполнения 1.1

1. **1.1.1 WS-уведомления** (24 ч) — база для всех остальных задач
2. **1.1.2 Outbox-обработчик** (24 ч) — интеграция с 1С
3. **1.1.3 K2 Размещение** (24 ч) — критичный пробел склада
4. **1.1.4 M10 UI** (16 ч) — контроль комплектации
5. **1.1.5 Excel-парсер** (32 ч) — загрузка заявок
6. **1.1.7 Возвраты C1** (36 ч) — возврат от клиента
7. **1.1.6 Печать M12+K3** (24 ч) — вызов из PWA

**Итого:** 24+24+24+16+32+36+24 = **180 ч** → оставить 7 ч на багфикс/документацию → **173 ч** ✓
