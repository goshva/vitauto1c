<!-- Сгенерировано tools/migration/ddd-gen.mjs из domain-model.json, node-map.json, storage-map.json. Не править вручную. -->

# Единый язык (ubiquitous language)

Один термин — одно имя во всех слоях: схема процесса и матрица (process.html, index.html) → 1С → REST API → база vitauto_app.

## Роли

| id (API, матрица) | Роль | Значение 1С `Арм_РолиИнтерфейса` | Дорожка на схеме процесса |
|---|---|---|---|
| `manager` | Менеджер | Менеджер | M1, M2, M2a, M3, M4, M7, M8, M9, M10, M11, M12, M13, M15, M16, M17, M18, M19 |
| `storekeeper` | Кладовщик / Сборщик | Кладовщик | K1, K2, K3, K5, K6, K7, K8, K9 |
| `chief_mechanic` | Главный механик | ГлавныйМеханик | G1, G2, G3, G4, G5, G7, G8, G9 |
| `admin` | Администратор | Администратор | A1, A2, A3, A5, A0 |
| `supplier` | Поставщик | Поставщик | P1, P2, P3 |
| `client` | Клиент | Клиент | N1, N2a, N3, N4 |
| `supply` | Снабжение | Снабжение | нет (роль только матрицы PWA) |

## Статусы строки

| № | id | Статус | Значения 1С `Арм_СтатусыАРМ` | Ранний (до прихода) |
|---|---|---|---|---|
| 1 | `new` | Новый | Черновик | да |
| 2 | `in_work` | В работе | ВРаботе | да |
| 3 | `partially_ordered` | Частично заказано | ЧастичноЗаказано | да |
| 4 | `ordered` | Заказано у поставщика | Заказано | да |
| 5 | `paid` | Оплачено | Оплачено | да |
| 6 | `in_transit` | В пути | ТоварВПути | да |
| 7 | `awaiting_receipt` | Ожидаем поступление | ОжидаемПоступление | да |
| 8 | `acceptance` | Приемка | Приходуется |  |
| 9 | `to_stock` | На склад | НаСкладе |  |
| 10 | `reserve` | Резервирование | Резервирование |  |
| 11 | `assembly` | Комплектация | Комплектуется |  |
| 12 | `ready_to_ship` | Готово к отгрузке | Подготовлено, Собран |  |
| 13 | `shipped` | Отгружено | Отгружено |  |
| 14 | `return` | Возврат | Возврат |  |
| 15 | `closed` | Закрыт | Выполнено, Завершено |  |

## Колонки строки (атрибуты агрегата Line)

| Код | id | Колонка | Группа | Поле 1С | API (`Line`) | Столбец `arm.line` | Тип | Пишется |
|---|---|---|---|---|---|---|---|---|
| А1 | `cell_select` | поле выбора ячеек | system | ОтметкаСтроки | `marked` | `marked` | checkbox | нет |
| А2 | `row_number` | № п/п | system | Порядок | `order` | `sort_order` | number | нет |
| А3 | `doc_signed_original` | Документ подписан оригинал | doc_flag | ДокументПодписанОригинал | `signedOriginal` | `signed_original` | checkbox | да |
| В1 | `shipment_date` | Дата отгрузки | auto | ДатаОтгрузки | `shipmentDate` | `shipment_date` | date | да |
| В2 | `shipment_number` | Номер отгрузки | auto | НомерОтгрузки | `shipmentNumber` | `shipment_number` | text | да |
| В3 | `order_date` | Дата заказа | auto | ДатаЗаказа | `orderDate` | `order_date` | date | да |
| В4 | `order_internal_number` | № заказ внутренний наш | auto | НомерЗаказа | `internalOrderNumber` | `internal_order_number` | text | да |
| В5 | `order_client_number` | № заказ клиент | order_header | НомерЗаказаКлиента | `clientOrderNumber` | `client_order_number` | text | да |
| В6 | `customer` | Заказчик | order_header | Покупатель | `customer` | `customer_id` | select | да |
| В7 | `contract` | Договор с заказчиком | order_header | Договор | `contract` | `contract_id` | select | да |
| В8 | `service_type` | Вид услуги | order_header | ВидУслуги | `serviceType` | `service_type_id` | select | да |
| В9 | `assembly_sent_date` | Дата отправки на сборку | auto | ДатаОтправкиНаСборку | `assemblySentDate` | `assembly_sent_date` | date | да |
| Е1 | `brand_fact` | Марка | fact | Марка | `brand` | `brand` | select | да |
| Е2 | `model_fact` | Модель | fact | Модель | `model` | `model` | select | да |
| Е3 | `aggregate_fact` | Агрегат | fact | Агрегат | `aggregate` | `aggregate` | select | да |
| Е4 | `gosnomer_fact` | Госномер | fact | Госномер | `plate` | `plate` | select | да |
| Е5 | `grz_fact` | № Шасси | fact | НомерШасси | `chassis` | `chassis` | select | да |
| Е6 | `vin_fact` | VIN (ХТС) | fact | VIN | `vin` | `vin` | select | да |
| Е7 | `engine_fact` | Двигатель | fact | Двигатель | `engine` | `engine` | select | да |
| К1 | `urgency_fact` | Срочность (ФАКТ) / комментарий заказчика | fact | СрочностьКлиента | `urgency` | `urgency` | text | да |
| К2 | `vehicle_plate_fact` | Машина ГРЗ (ФАКТ) | fact | ГРЗКлиента | `vehiclePlate` | `vehicle_plate` | text | да |
| К3 | `territory_fact` | Территория (ФАКТ) | fact | ТерриторияКлиента | `territory` | `territory` | text | да |
| К4 | `name_fact` | Наименование (ФАКТ) | fact_editable | НоменклатураКлиента | `factName` | `fact_name` | text | да |
| К5 | `article_fact` | Артикул (ФАКТ) | fact_editable | АртикулКлиента | `factArticle` | `fact_article` | text | да |
| К6 | `qty_fact` | Кол-во (ФАКТ) | fact | КоличествоКлиента | `factQty` | `fact_qty` | text | да |
| К7 | `unit_fact` | Ед. изм. (ФАКТ) | fact | ЕдиницаИзмеренияКлиента | `factUnit` | `fact_unit` | text | да |
| М1 | `name` | Наименование | nomenclature | Номенклатура | `nomenclature` | `nomenclature_id` | select | да |
| М2 | `article` | Артикул | nomenclature | НоменклатураАртикул | `nomenclature.article` | `nomenclature_id` → ref.nomenclature | select | нет |
| М3 | `code_aa` | Код А-А / код поставщика | nomenclature | НоменклатураАС_КодАвтоАльянс | `nomenclature.code` | `nomenclature_id` → ref.nomenclature | select | нет |
| М4 | `unit` | Ед. изм. | nomenclature | НоменклатураЕдиницаИзмерения | `nomenclature.unit` | `nomenclature_id` → ref.nomenclature | select | нет |
| Н0 | `qty` | Кол-во | nomenclature | Количество | `quantity` | `quantity` | number | да |
| Н1 | `stock_qty` | Кол-во в наличии на складе | stock | ОстатокДляСтроки | `stockQty` | `stock_qty` | number | нет |
| Н2 | `reserve_qty` | Кол-во в резерве | stock | КоличествоВРезерве | `reserveQty` | `reserve_qty` | number | нет |
| Н3 | `ordered_in_transit_qty` | Кол-во заказанного в пути / свободное | stock | КоличествоВПути | `inTransitQty` | `in_transit_qty` | number | нет |
| Н4 | `batch_fifo` | № партии ФИФО / выбор партии | stock | Партия | `batch` | `batch_id` | select | да |
| Н5 | `line_status` | Статус заявки | status | СтатусСтроки | `status` | `status` | select | нет |
| Н6 | `stock_cell` | Ячейка склада (на склад) | stock | ЯчейкаСклада | `stockCell` | `cell_legacy` | text | да |
| О1 | `price` | Цена (себес.) | pricing | СебестоимостьЕдиницы | `costPrice` | `cost_price` | number | да |
| О2 | `sum` | Сумма (себес.) | pricing | Себестоимость | `costSum` | `cost_sum` | number | нет |
| О3 | `payment_form` | Форма оплаты | payment | ФормаОплаты | `paymentForm` | `payment_form_id` | select | да |
| О4 | `rrc` | РРЦ | margin_locked | РРЦ | `rrc` | `rrc` | number | да |
| О5 | `paid_status` | Оплачено (счёт, оплата, постоплата) | payment | Оплачено | `paid` | `paid` | select | да |
| О6 | `invoice_number` | Счёт № | payment | НомерСчета | `invoiceNumber` | `invoice_number` | text | да |
| О7 | `invoice_date` | Дата счёта | payment | ДатаСчета | `invoiceDate` | `invoice_date` | date | да |
| Р0 | `qty_norm_hours_client` | Кол-во норма час товар для клиента | nomenclature | КоличествоНормаЧас | `normHours` | `norm_hours` | number | да |
| Р1 | `coefficient` | Коэфф | margin_open | Коэффициент | `coefficient` | `coefficient` | number | да |
| Р2 | `extra_field_1` | Цена продажи | pricing | Цена | `salePrice` | `sale_price` | number | да |
| Р3 | `extra_field_2` | Сумма продажи | pricing | Сумма | `saleSum` |  | number | нет |
| С1 | `supplier` | Поставщик | receipt | Поставщик | `supplier` | `supplier_id` | select | да |
| С2 | `receipt_date` | Дата получения | receipt | ДатаПоступления | `receiptDate` | `receipt_date` | date | да |
| С3 | `upd_date` | Дата УПД | receipt | ДатаУПД | `updDate` | `upd_date` | date | да |
| С4 | `upd_number` | № УПД | receipt | НомерУПД | `updNumber` | `upd_number` | text | да |
| С5 | `supplier_ship_territory` | Территория отгрузки поставщиком | receipt | ТерриторияОтгрузкиПоставщиком | `supplierShipTerritory` | `supplier_ship_territory` | text | да |
| С6 | `supplier_order_date` | Дата заказа поставщику | auto | ДатаЗаказаПоставщику | `supplierOrderDate` | `supplier_order_date` | date | да |
| С7 | `delivery_term` | Срок поставки | receipt | СрокПоставки | `deliveryTerm` | `delivery_term` | date | да |
| Т1 | `comment` | Комментарий | comment | КомментарийКСтроке | `comment` | `comment` | text | да |
| Т2 | `comment_2` | Комментарий 2 | comment | КомментарийКСтроке2 | `comment2` | `comment2` | text | да |

## Зоны склада (process.html)

| id | Зона | Описание | Роль | В новой модели |
|---|---|---|---|---|
| Z0 | Поставщик (Авто-Альянс) | Внешний источник поставки | supplier | внешний контрагент-поставщик |
| Z1 | Зона приёмки | Кладовщик, УПД, факт прихода | storekeeper | зона ячеек `ref.storage_cell.zone` |
| Z2 | Позиция опознана? | Ветвление на склады / неопознанные | storekeeper | зона ячеек `ref.storage_cell.zone` |
| Z3 | Малый склад | Мелкие детали | storekeeper | склад `ref.warehouse` (малый / большой) |
| Z4 | Большой склад | Крупногабарит, жидкости | storekeeper | склад `ref.warehouse` (малый / большой) |
| Z8 | Резерв / Комплектация | Сборка под заказ | storekeeper | зона ячеек `ref.storage_cell.zone` |
| Z9 | Зона укомплектованных | Готово к отгрузке | storekeeper | зона ячеек `ref.storage_cell.zone` |
| Z10 | Отгрузка клиенту / ТК | Физический выход товара | manager | зона ячеек `ref.storage_cell.zone` |
| Z5 | Неопознанные и возвраты | Брак, возврат, неопознание | storekeeper | зона ячеек `ref.storage_cell.zone` |
| Z6 | Админ: опознание | Фото, артикул, кросс | admin | зона ячеек `ref.storage_cell.zone` |
| Z14 | Возврат поставщику | Брак / ошибка заказа | supplier | внешний контрагент-поставщик |
| Z7 | Ремонтная зона | Заказ-наряды, механик | chief_mechanic | зона ячеек `ref.storage_cell.zone` |
| Z12 | Списание по ЗН | Расход в ремонт | chief_mechanic | зона ячеек `ref.storage_cell.zone` |

## Ограниченные контексты

| id | Контекст | Тип | Агрегаты | Описание |
|---|---|---|---|---|
| `intake` | Приём заявок | core | ClientRequest, ImportBatch | Заявка клиента (Excel, фото, лист покупателя), импорт табличных данных, создание заказа покупателя и строк АРМ. |
| `catalog` | НСИ (номенклатура, контрагенты, цены) | supporting | Nomenclature, Counterparty, Contract, Car, PricePolicy | Поиск и подбор номенклатуры, создание и подтверждение карточек, неопознанные позиции, РРЦ и коэффициенты. |
| `lines` | Строки АРМ (ядро) | core | Line, CustomerOrder | Агрегат строки заказа: статусы, автомат переходов, матрица прав по колонкам, разделение строк, связь продажи и закупки (КлючСвязиСтрок), формулы цены. |
| `procurement` | Закупка | core | SupplierOrder, VirtualPurchase | Заказ поставщику, оплата, «в пути», самовывоз у поставщика, виртуальный закуп с подтверждением админом. |
| `warehouse` | Склад | core | Warehouse, StorageCell, Receipt, StockMove, StockBalance, Transfer, StockSearch | Приёмка по УПД, размещение по складам и ячейкам (зоны process.html), резерв и остатки, комплектация и сборочный лист, розыск, перемещения. |
| `shipping` | Отгрузка и документы | core | Shipment, PrintForm | Отгрузочная ведомость и корректировка, отгрузка клиенту / ТК, контроль документов (подпись, оригинал), печатные формы. |
| `returns` | Возвраты | core | ReturnRequest | Возврат от клиента, возврат поставщику, отказ при получении. |
| `workshop` | Ремонтная зона (заказ-наряды) | supporting | WorkOrder, LaborHours | Заказ-наряд главного механика, выдача в ремонтную зону, нормо-часы, выдача авто. В 1С не реализовано; после переключения (этап 12). |
| `notifications` | Уведомления | generic | Notice | Политики «событие → уведомление роли» (M8, M11, M17/K9, M18/G8, M9, M10, запрос прав); доставка по WebSocket. |
| `access` | Доступ: роли и матрица | generic | User, Role, MatrixPolicy, AccessRequest | Пользователи, роли, матрица прав колонок по статусам, доступ к складам, запрос прав у администратора (M13 → A3). |
| `accounting` | Интеграция с бухгалтерией | generic | OutboxMessage, ObjectMap, PeriodLock | Outbox → 1С (вариант A): отгрузки, приёмки, возвраты, перемещения; обратно оплаты, УПД, дата запрета изменений. Anti-corruption layer к 1С. |

## Доменные события

| Событие | Смысл | Кто порождает (узлы) |
|---|---|---|
| `LinesCreated` | строки АРМ созданы (заявка, импорт) | M1, G2 |
| `LineChanged` | изменены поля строки | M2 |
| `LineStatusChanged` | статус строки изменён | N3, N4, M3, M4, M7, M9, M10, M15, A3, P2, K1, K2, K3, K5, K6, G3, G9 |
| `LinesSplit` | строка разделена по остаткам и партиям («В работе») | M4 |
| `LineStruck` | строка вычеркнута | — |
| `StockReserved` | товар зарезервирован | M3 |
| `AssemblyRequested` | задание на комплектацию | M9 |
| `AssemblyRejected` | комплектация отклонена с причиной | M10 |
| `LineAssembled` | строка собрана (Собран / Подготовлено) | K3 |
| `DocumentsControlled` | контроль документов выполнен, оригинал получен | M15, K7, G7 |
| `CustomerOrderCreated` | создан заказ покупателя | M1 |
| `CustomerOrderPosted` | заказ покупателя проведён | — |
| `ClientRequestReceived` | получена заявка клиента | N1 |
| `ImportCommitted` | партия импорта записана | — |
| `ImportRolledBack` | партия импорта отменена | — |
| `NomenclatureDrafted` | менеджер создал черновик номенклатуры | M2a |
| `NomenclatureApproved` | админ подтвердил позицию | A2 |
| `ItemUnidentified` | позиция не опознана | A1, K8 |
| `NomenclatureMatched` | номенклатура подобрана к строке | M2 |
| `CounterpartyChanged` | изменён контрагент | — |
| `PricePolicyChanged` | изменены РРЦ / коэффициенты | A0 |
| `SupplierOrderPlaced` | заказ поставщику оформлен | M4 |
| `SupplierOrderConfirmed` | поставщик подтвердил заказ | P1 |
| `SupplierOrderPaid` | заказ поставщику оплачен | M7 |
| `GoodsInTransit` | товар в пути | P2 |
| `SelfPickupRecorded` | клиент забрал товар у поставщика | N4 |
| `VirtualPurchaseConfirmed` | админ подтвердил чек виртуального закупа | A3 |
| `WarehouseChanged` | изменён склад | — |
| `GoodsReceived` | товар принят по УПД | A5, K1 |
| `GoodsPlaced` | товар размещён на склад / в ячейку | K2 |
| `StockMoved` | перемещение между складами / ячейками | — |
| `ItemFound` | позиция найдена при розыске | K8 |
| `Shipped` | отгружено клиенту / ТК | K5 |
| `PrintFormRendered` | сформирована печатная форма | M12, M19, K3, G9 |
| `ReturnRequested` | возврат от клиента | N3 |
| `ReturnAccepted` | возврат принят на склад | K6 |
| `SupplierReturnRequested` | заявка на возврат поставщику | M16 |
| `SupplierReturnAccepted` | поставщик принял возврат | P3 |
| `WorkOrderOpened` | открыт заказ-наряд | G1 |
| `PartsIssuedToRepair` | запчасти выданы в ремонтную зону | G3 |
| `LaborCalculated` | нормо-часы рассчитаны | G4 |
| `CarReleased` | автомобиль выдан | G9 |
| `NoticeCreated` | создано уведомление | M8, M11, M17, M18, K9, G8 |
| `NoticeRead` | уведомление прочитано | — |
| `UserChanged` | изменён пользователь | — |
| `RoleChanged` | изменена роль | — |
| `MatrixChanged` | изменена матрица прав | A0 |
| `RightsRequested` | запрошены права у администратора | M13 |
| `RightsGranted` | права выданы (команда выполнена) | A3 |
| `RightsDenied` | в правах отказано | — |
| `SentToAccounting` | документ передан в бухгалтерию | — |
| `AccountingFailed` | ошибка обмена с бухгалтерией | — |
| `PeriodLocked` | период закрыт в бухгалтерии | — |
| `PaymentReceived` | оплата из бухгалтерии | — |
