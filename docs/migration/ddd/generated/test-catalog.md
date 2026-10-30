<!-- Сгенерировано tools/migration/ddd-gen.mjs из domain-model.json, node-map.json. Не править вручную. -->

# Каталог тестов

Тесты пишутся до реализации (раздел «Порядок разработки», docs/migration/ddd/04-development-process.md). Идентификатор теста — в имени Go-теста или e2e-сценария.

## T — приёмочные тесты узлов

| Тест | Дано | Когда | Тогда |
|---|---|---|---|
| T-N1 | роль `client`, строка в статусе new | `POST /imports (kind=customer_sheet); сейчас POST /sales/imports` | события ClientRequestReceived; запрещено ролям без права (403 matrix_denied) |
| T-N2a | роль `client`, строка в статусе shipped | физическая выдача товара; в системе фиксируется отгрузкой K5 | запрещено ролям без права (403 matrix_denied) |
| T-N3 | роль `client`, строка в статусе return | `POST /lines/transition {to: return}` | события ReturnRequested, LineStatusChanged; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-N4 | роль `client`, строка в статусе shipped | `POST /lines/transition {to: shipped}` | события SelfPickupRecorded, LineStatusChanged; уведомление: manager, storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-M1 | роль `manager`, строка в статусе new | `POST /sales/imports; POST /lines` | события CustomerOrderCreated, LinesCreated; запрещено ролям без права (403 matrix_denied) |
| T-M2 | роль `manager`, строка в статусе new | `GET /catalog/goods; PATCH /lines/{id} {field: Номенклатура}` | события NomenclatureMatched, LineChanged; запрещено ролям без права (403 matrix_denied) |
| T-M2a | роль `manager`, строка в статусе new | `POST /catalog/goods (draft)` | события NomenclatureDrafted; уведомление: admin; запрещено ролям без права (403 matrix_denied) |
| T-M3 | роль `manager`, строка в статусе reserve | `POST /lines/transition {to: reserve}` | события StockReserved, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-M4 | роль `manager`, строка в статусе ordered | `POST /sales/jobs; POST /sales/supplier-orders` | события LinesSplit, SupplierOrderPlaced, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-M7 | роль `manager`, строка в статусе paid | `POST /supply/status {status: paid}` | события SupplierOrderPaid, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-M8 | роль `manager`, строка в статусе acceptance | `policy: GoodsPlaced → Notice; GET /notifications` | события NoticeCreated; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-M9 | роль `manager`, строка в статусе assembly | `POST /lines/transition {to: assembly}` | события AssemblyRequested, LineStatusChanged; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-M10 | роль `manager`, строка в статусе assembly / ready_to_ship | `POST /lines/reject-assembly {reason}` | события AssemblyRejected, LineStatusChanged; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-M11 | роль `manager`, строка в статусе ready_to_ship | `policy: LineAssembled → Notice; GET /notifications` | события NoticeCreated; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-M12 | роль `manager`, строка в статусе ready_to_ship | `POST /print {kind: shipment_sheet}` | события PrintFormRendered; запрещено ролям без права (403 matrix_denied) |
| T-M13 | роль `manager`, строка в статусе ordered / new / ready_to_ship | `POST /access-requests` | события RightsRequested; уведомление: admin; запрещено ролям без права (403 matrix_denied) |
| T-M15 | роль `manager`, строка в статусе closed / shipped / return | `PATCH /lines/{id} {field: ДокументПодписанОригинал}; POST /lines/transition {to: closed}` | события DocumentsControlled, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-M16 | роль `manager`, строка в статусе return | `POST /returns {direction: supplier}` | события SupplierReturnRequested; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-M17 | роль `manager`, строка в статусе shipped | `policy: SelfPickupRecorded → Notice` | события NoticeCreated; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-M18 | роль `manager`, строка в статусе new / acceptance | `policy: ItemUnidentified → Notice` | события NoticeCreated; уведомление: manager, chief_mechanic; запрещено ролям без права (403 matrix_denied) |
| T-M19 | роль `manager`, строка в статусе return | `POST /print {kind: shipment_correction}` | события PrintFormRendered; запрещено ролям без права (403 matrix_denied) |
| T-A1 | роль `admin`, строка в статусе new | `POST /catalog/goods {folder: unidentified, photo}` | события ItemUnidentified; уведомление: manager, chief_mechanic; запрещено ролям без права (403 matrix_denied) |
| T-A2 | роль `admin`, строка в статусе new | `PATCH /catalog/goods/{id} {approved: true}` | события NomenclatureApproved; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-A3 | роль `admin`, строка в статусе ordered / paid | `POST /access-requests/{id}/approve` | события RightsGranted, VirtualPurchaseConfirmed, LineStatusChanged; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-A5 | роль `admin`, строка в статусе — (вне строки) | `POST /receipts {source: disassembly}` | события GoodsReceived; запрещено ролям без права (403 matrix_denied) |
| T-A0 | роль `admin`, строка в статусе — (вне строки) | `PATCH /catalog/goods/{id} {rrc}; PUT /admin/matrix` | события PricePolicyChanged, MatrixChanged; уведомление: *; запрещено ролям без права (403 matrix_denied) |
| T-P1 | роль `supplier`, строка в статусе ordered | `POST /supplier/orders/{id}/confirm (портал поставщика)` | события SupplierOrderConfirmed; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-P2 | роль `supplier`, строка в статусе in_transit | `POST /supply/status {status: in_transit}` | события GoodsInTransit, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-P3 | роль `supplier`, строка в статусе return | `POST /returns/{id}/supplier-accepted` | события SupplierReturnAccepted; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-K1 | роль `storekeeper`, строка в статусе acceptance | `POST /lines/transition {to: acceptance}; PATCH /lines/{id} {ДатаУПД, НомерУПД}` | события GoodsReceived, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-K2 | роль `storekeeper`, строка в статусе acceptance / reserve | `POST /stock/placements {warehouseId, cellId, lineIds}` | события GoodsPlaced, LineStatusChanged; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-K3 | роль `storekeeper`, строка в статусе assembly | `POST /lines/transition {to: ready_to_ship}; POST /print {kind: assembly_sheet}` | события LineAssembled, PrintFormRendered, LineStatusChanged; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-K5 | роль `storekeeper`, строка в статусе shipped | `POST /sales/shipments {shipmentDate, shipmentNumber}` | события Shipped, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |
| T-K6 | роль `storekeeper`, строка в статусе return | `POST /lines/transition {to: return}` | события ReturnAccepted, LineStatusChanged; уведомление: manager; запрещено ролям без права (403 matrix_denied) |
| T-K7 | роль `storekeeper`, строка в статусе closed / shipped / return | `PATCH /lines/{id} {field: ДокументПодписанОригинал}; POST /lines/transition {to: closed}` | события DocumentsControlled; запрещено ролям без права (403 matrix_denied) |
| T-K8 | роль `storekeeper`, строка в статусе assembly / acceptance / new | `POST /stock/searches {lineId}` | события ItemFound, ItemUnidentified; уведомление: manager, chief_mechanic; запрещено ролям без права (403 matrix_denied) |
| T-K9 | роль `storekeeper`, строка в статусе shipped | `policy: SelfPickupRecorded → Notice` | события NoticeCreated; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-G1 | роль `chief_mechanic`, строка в статусе new | `POST /work-orders` | события WorkOrderOpened; запрещено ролям без права (403 matrix_denied) |
| T-G2 | роль `chief_mechanic`, строка в статусе ordered | `POST /lines {workOrderId}` | события LinesCreated; запрещено ролям без права (403 matrix_denied) |
| T-G3 | роль `chief_mechanic`, строка в статусе assembly | `POST /lines/transition {to: assembly}` | события PartsIssuedToRepair, LineStatusChanged; уведомление: storekeeper; запрещено ролям без права (403 matrix_denied) |
| T-G4 | роль `chief_mechanic`, строка в статусе — (вне строки) | `PUT /work-orders/{id}/labor` | события LaborCalculated; запрещено ролям без права (403 matrix_denied) |
| T-G5 | роль `chief_mechanic`, строка в статусе — (вне строки) | `GET /work-orders/payroll?period=` | запрещено ролям без права (403 matrix_denied) |
| T-G7 | роль `chief_mechanic`, строка в статусе closed / shipped | `PATCH /lines/{id} {field: ДокументПодписанОригинал}` | события DocumentsControlled; запрещено ролям без права (403 matrix_denied) |
| T-G8 | роль `chief_mechanic`, строка в статусе new / acceptance | `policy: ItemUnidentified → Notice` | события NoticeCreated; уведомление: chief_mechanic; запрещено ролям без права (403 matrix_denied) |
| T-G9 | роль `chief_mechanic`, строка в статусе closed / shipped | `POST /print {kind: work_order_set}; POST /lines/transition {to: closed}` | события CarReleased, PrintFormRendered, LineStatusChanged; запрещено ролям без права (403 matrix_denied) |

## S — сквозные сценарии (e2e, две и более сессии)

| Тест | Сценарий | Шаги |
|---|---|---|
| S-happy | Основной: закупка → отгрузка | N1→new · M1→new · M2→new · M4→ordered · P1→ordered · M7→paid · P2→in_transit · K1→acceptance · K2→acceptance · M8→acceptance · M9→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · K5→shipped · N2a→shipped · M15∥K7→closed |
| S-stock | Со склада (резерв) | N1→new · M1→new · M2→new · M3→reserve · M9→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · K5→shipped · N2a→shipped · M15∥K7→closed |
| S-mixed_order | Смешанный заказ (склад + закупка) | N1→new · M1→new · M2→new · M3→reserve · M4→ordered · P1→ordered · M7→paid · P2→in_transit · K1→acceptance · K2→acceptance · M8→acceptance · M9→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · K5→shipped · N2a→shipped · M15∥K7→closed |
| S-delivery_split | Самовывоз у внешнего поставщика клиентом | N1→new · M1→new · M2→new · M4→ordered · P1→ordered · M7→paid · N4→shipped · M17∥K9→shipped · K1→acceptance · K2→acceptance · M8→acceptance · M9→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · M15∥K7→closed |
| S-virtual_buy | Виртуальный закуп (менеджер → админ) | N1→new · M1→new · M2→new · M13→ordered · A3→paid |
| S-defect | Контроль комплектации → снова задание (продолжение A) | K3→assembly · M10→assembly · M9∥K8→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · K5→shipped · N2a→shipped · M15∥K7→closed |
| S-cancel_supplier | Отмена заказа у поставщика | N1→new · M1→new · M2→new · M4→ordered · P1→ordered · M7→paid · M15→return · M16→return · P3→return |
| S-return | Возврат от клиента | N3→return · K6→return · M19→return · M16→return · K6→return · P3→return |
| S-return_mgr | Возврат поставщику (от менеджера) | M16→return · K6→return · P3→return · M15∥K7→closed |
| S-return_internal | Отказ клиента при получении товара | N2a→shipped · N3→return · K6→return · M10→assembly · M9→assembly · K3→assembly · M11→ready_to_ship · M12→ready_to_ship · M15∥K7→closed |
| S-car_repair_in | Поступление машины в ремонт | N1→new · G1→new · M2→new · M3→reserve · M4→ordered · P1→ordered · M7→paid · P2→in_transit · K1→acceptance · K2→acceptance · M8→acceptance · M9→assembly · K3→assembly · M11→ready_to_ship · G3→assembly · G4∥G5 · G9→closed |

## M — матрица прав (параметризованные)

Для каждой роли × колонки × статуса (7 × 57 × 15 = 5985 случаев): `PATCH /lines/{id}` разрешён ⇔ символ `+` (или `c` и пользователь — автор строки); иначе 403 `matrix_denied`. Данные — `domain-model.json` → `arm.matrix_column`.

| Тест | Роль | Колонок с правом хотя бы в одном статусе | Ячеек `+` | Ячеек `c` |
|---|---|---|---|---|
| M-manager | Менеджер | 39 | 265 | 0 |
| M-storekeeper | Кладовщик / Сборщик | 30 | 171 | 0 |
| M-chief_mechanic | Главный механик | 38 | 244 | 0 |
| M-admin | Администратор | 53 | 795 | 0 |
| M-supplier | Поставщик | 4 | 49 | 0 |
| M-client | Клиент | 4 | 47 | 0 |
| M-supply | Снабжение | 30 | 171 | 0 |

## F — автомат статусов

| Тест | Переход | Роли (разрешено) | Проверка |
|---|---|---|---|
| F-01 | new|in_work → reserve | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-02 | reserve|to_stock|acceptance → assembly | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-03 | ready_to_ship → assembly | manager, admin, chief_mechanic | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-04 | return → assembly | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-05 | assembly → ready_to_ship | storekeeper, manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-06 | paid|in_transit → shipped | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-07 | shipped → acceptance | storekeeper, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-08 | shipped|ordered|paid|in_transit|to_stock|closed → return | manager, storekeeper, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-09 | shipped|ready_to_ship|return → closed | manager, storekeeper, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-10 | assembly → closed | chief_mechanic, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-11 | new|in_work|reserve → ordered | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-12 | ordered → paid | manager, supply, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-13 | paid → in_transit | supply, admin, supplier | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-14 | in_transit|paid → acceptance | storekeeper, supply, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-15 | acceptance → to_stock | storekeeper, supply, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-16 | ready_to_ship → shipped | storekeeper, manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-17 | paid|in_transit → shipped | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-18 | shipped → return | manager, storekeeper, admin | разрешено этим ролям; остальным 403; из других статусов 409 |
| F-19 | new → in_work | manager, admin | разрешено этим ролям; остальным 403; из других статусов 409 |

## R — правила полей (index.html FIELD_RULES)

| Тест | Тип | Правило |
|---|---|---|
| FR-1 | options | Вид услуги — выбор из списка: ремонт, услуга, инструмент, запчасть. |
| FR-2 | filter | Договор с заказчиком — только договоры выбранного контрагента (Заказчик). |
| FR-3 | autofill | Госномер — выбор из справочника машин; при выборе проставляются Марка, Модель, VIN, Двигатель, № Шасси. |
| FR-4 | oneOfRequired | Обязательно заполнить одно из: Госномер или Агрегат (выпадающий список). |
| FR-5 | autofill | Наименование / Артикул / Код А-А — поиск по любому из них; выбор одного подтягивает остальные три поля (включая Ед. изм.). |
| FR-6 | oneOfRequired | Обязательно заполнить одно из: Наименование, Артикул или Код А-А. |
| FR-7 | formula | Сумма (себес.) = Цена (себес.) × Кол-во. |
| FR-8 | formula | Цена продажи = РРЦ × Коэфф, если РРЦ заполнена; иначе Цена (себес.) × Коэфф. Пока Коэфф не заполнен, цена продажи вводится вручную. |
| FR-9 | formula | Сумма продажи = Кол-во (ФАКТ) × Цена продажи; если заполнено «Кол-во норма час товар для клиента» — Кол-во норма час × Цена продажи. |

## Прочие наборы (план, разделы 9, 11–15)

| Набор | Что проверяет |
|---|---|
| R1–R9 | сверка миграции |
| r01–r05 | WebSocket: обновление, конфликт, досылка, принудительная перестройка, права по складам |
| w01–w04 | склады и ячейки, перемещение, размещение при приёмке, доступ к складам |
| i01–i08 | импорт по видам |
| x01–x06 | интеграция с бухгалтерией |
| G0–G11 | гейты этапов (`tools/migration/gate.ps1`) |

Итого: T 45, S 11, M 5985 случаев в 7 наборах, F 19, FR 9.
