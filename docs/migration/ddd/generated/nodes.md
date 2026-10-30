<!-- Сгенерировано tools/migration/ddd-gen.mjs из domain-model.json, node-map.json. Не править вручную. -->

# Трассировка узлов процесса

Узел process.html → ограниченный контекст → агрегат → команда → API → события → уведомления → этап плана → тесты. Покрытие 1С — как на схеме (cov).

| Узел | Роль | Контекст | Агрегат | Команда | API | События | Уведомляет | 1С | Этап | Тесты |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 Заявка: Excel / фото | client | intake | ClientRequest | SubmitClientRequest | POST /imports (kind=customer_sheet); сейчас POST /sales/imports | ClientRequestReceived |  | частично | 8 | T-N1, S-happy |
| N2a Получение товара | client | shipping | Shipment | HandOverGoods | физическая выдача товара; в системе фиксируется отгрузкой K5 |  |  | частично | 4 | T-N2a, S-happy |
| N3 Возврат товара | client | returns | ReturnRequest | RequestCustomerReturn | POST /lines/transition {to: return} | ReturnRequested, LineStatusChanged | storekeeper | частично | 4 | T-N3, S-return, S-return_internal |
| N4 Самовывоз у внешнего поставщика | client | procurement | SupplierOrder | RecordSelfPickup | POST /lines/transition {to: shipped} | SelfPickupRecorded, LineStatusChanged | manager, storekeeper | нет | 4 | T-N4, S-delivery_split |
| M1 Загрузка заявки в 1С | manager | intake | CustomerOrder | ImportCustomerSheet | POST /sales/imports; POST /lines | CustomerOrderCreated, LinesCreated |  | частично | 4 | T-M1, S-happy |
| M2 Поиск + подбор номенклатуры | manager | catalog | Line | MatchNomenclature | GET /catalog/goods; PATCH /lines/{id} {field: Номенклатура} | NomenclatureMatched, LineChanged |  | частично | 4 | T-M2, S-happy |
| M2a Создание номенклатуры | manager | catalog | Nomenclature | DraftNomenclature | POST /catalog/goods (draft) | NomenclatureDrafted | admin | частично | 4 | T-M2a |
| M3 Резервирование на складе | manager | lines | Line | ReserveStock | POST /lines/transition {to: reserve} | StockReserved, LineStatusChanged |  | частично | 4 | T-M3, S-stock, S-mixed_order |
| M4 Заказ поставщику | manager | procurement | SupplierOrder | OrderFromSupplier | POST /sales/jobs; POST /sales/supplier-orders | LinesSplit, SupplierOrderPlaced, LineStatusChanged |  | есть | 4 | T-M4, S-happy |
| M7 Контроль оплаты | manager | procurement | SupplierOrder | ConfirmPayment | POST /supply/status {status: paid} | SupplierOrderPaid, LineStatusChanged |  | есть | 4 | T-M7, S-happy |
| M8 Уведомление о приходе | manager | notifications | Notice | NotifyArrival | policy: GoodsPlaced → Notice; GET /notifications | NoticeCreated | manager | частично | 4 | T-M8, S-happy |
| M9 Задание на комплектацию | manager | lines | Line | RequestAssembly | POST /lines/transition {to: assembly} | AssemblyRequested, LineStatusChanged | storekeeper | частично | 4 | T-M9, S-stock |
| M10 Контроль комплектации | manager | lines | Line | RejectAssembly | POST /lines/reject-assembly {reason} | AssemblyRejected, LineStatusChanged | storekeeper | частично | 4 | T-M10, S-defect |
| M11 Уведомление о готовности | manager | notifications | Notice | NotifyReady | policy: LineAssembled → Notice; GET /notifications | NoticeCreated | manager | нет | 4 | T-M11, S-happy |
| M12 Отгрузочная ведомость | manager | shipping | PrintForm | PrintShipmentSheet | POST /print {kind: shipment_sheet} | PrintFormRendered |  | нет | 4 | T-M12, S-happy |
| M13 Недостаточно прав, обратись к админу | manager | access | AccessRequest | RequestRights | POST /access-requests | RightsRequested | admin | частично | 4 | T-M13, S-virtual_buy |
| M15 Контроль документов | manager | shipping | Line | ControlDocuments | PATCH /lines/{id} {field: ДокументПодписанОригинал}; POST /lines/transition {to: closed} | DocumentsControlled, LineStatusChanged |  | частично | 4 | T-M15, S-happy |
| M16 Заявка на возврат поставщику | manager | returns | ReturnRequest | RequestSupplierReturn | POST /returns {direction: supplier} | SupplierReturnRequested | storekeeper | частично | 7 | T-M16, S-return_mgr, S-cancel_supplier |
| M17 Уведомление о самовывозе | manager | notifications | Notice | NotifySelfPickup | policy: SelfPickupRecorded → Notice | NoticeCreated | manager | нет | 4 | T-M17, S-delivery_split |
| M18 Неопознанная позиция | manager | notifications | Notice | NotifyUnidentified | policy: ItemUnidentified → Notice | NoticeCreated | manager, chief_mechanic | нет | 7 | T-M18 |
| M19 Отгрузочная ведомость (корректировка) | manager | shipping | PrintForm | PrintShipmentCorrection | POST /print {kind: shipment_correction} | PrintFormRendered |  | нет | 4 | T-M19, S-return |
| A1 Неопознанные + фото | admin | catalog | Nomenclature | RegisterUnidentified | POST /catalog/goods {folder: unidentified, photo} | ItemUnidentified | manager, chief_mechanic | нет | 7 | T-A1 |
| A2 Создание номенклатуры/подтверждение/изменение позиции | admin | catalog | Nomenclature | ApproveNomenclature | PATCH /catalog/goods/{id} {approved: true} | NomenclatureApproved | manager | частично | 4 | T-A2 |
| A3 Подтверждение чека админом | admin | procurement | VirtualPurchase | ConfirmVirtualPurchase | POST /access-requests/{id}/approve | RightsGranted, VirtualPurchaseConfirmed, LineStatusChanged | manager | нет | 4 | T-A3, S-virtual_buy |
| A5 Приход с разбора / ЗН | admin | warehouse | Receipt | ReceiveFromDisassembly | POST /receipts {source: disassembly} | GoodsReceived |  | нет | 12 | T-A5 |
| A0 НСИ: РРЦ / НМЦК / права | admin | access | MatrixPolicy | MaintainPricingAndRights | PATCH /catalog/goods/{id} {rrc}; PUT /admin/matrix | PricePolicyChanged, MatrixChanged | * | частично | 10 | T-A0 |
| P1 Обработка заказа | supplier | procurement | SupplierOrder | ConfirmSupplierOrder | POST /supplier/orders/{id}/confirm (портал поставщика) | SupplierOrderConfirmed | manager | нет | 12 | T-P1, S-happy |
| P2 Отгрузка → В пути | supplier | procurement | SupplierOrder | MarkInTransit | POST /supply/status {status: in_transit} | GoodsInTransit, LineStatusChanged |  | частично | 4 | T-P2, S-happy |
| P3 Приём возврата | supplier | returns | ReturnRequest | AcceptSupplierReturn | POST /returns/{id}/supplier-accepted | SupplierReturnAccepted | manager | нет | 7 | T-P3, S-return |
| K1 Приёмка (УПД) | storekeeper | warehouse | Receipt | AcceptByUPD | POST /lines/transition {to: acceptance}; PATCH /lines/{id} {ДатаУПД, НомерУПД} | GoodsReceived, LineStatusChanged |  | частично | 4 | T-K1, S-happy |
| K2 Размещение по складам | storekeeper | warehouse | StockMove | PlaceToCell | POST /stock/placements {warehouseId, cellId, lineIds} | GoodsPlaced, LineStatusChanged | manager | нет | 7 | T-K2, S-happy |
| K3 Комплектация + сборочный лист | storekeeper | warehouse | Line | CompleteAssembly | POST /lines/transition {to: ready_to_ship}; POST /print {kind: assembly_sheet} | LineAssembled, PrintFormRendered, LineStatusChanged | manager | частично | 4 | T-K3, S-stock |
| K5 Отгрузка клиенту / ТК | storekeeper | shipping | Shipment | ShipToCustomer | POST /sales/shipments {shipmentDate, shipmentNumber} | Shipped, LineStatusChanged |  | есть | 4 | T-K5, S-happy |
| K6 Приёмка / подготовка возврата | storekeeper | returns | ReturnRequest | AcceptReturnToWarehouse | POST /lines/transition {to: return} | ReturnAccepted, LineStatusChanged | manager | нет | 4 | T-K6, S-return |
| K7 Контроль документов | storekeeper | shipping | Line | ControlDocuments | PATCH /lines/{id} {field: ДокументПодписанОригинал}; POST /lines/transition {to: closed} | DocumentsControlled |  | частично | 4 | T-K7, S-happy |
| K8 Розыск позиции | storekeeper | warehouse | StockSearch | SearchItem | POST /stock/searches {lineId} | ItemFound, ItemUnidentified | manager, chief_mechanic | нет | 7 | T-K8, S-defect |
| K9 Уведомление о самовывозе | storekeeper | notifications | Notice | NotifySelfPickup | policy: SelfPickupRecorded → Notice | NoticeCreated | storekeeper | нет | 4 | T-K9, S-delivery_split |
| G1 Открытие заказ-наряда | chief_mechanic | workshop | WorkOrder | OpenWorkOrder | POST /work-orders | WorkOrderOpened |  | нет | 12 | T-G1, S-car_repair_in |
| G2 Заказ для ремонта | chief_mechanic | workshop | WorkOrder | OrderPartsForRepair | POST /lines {workOrderId} | LinesCreated |  | нет | 12 | T-G2 |
| G3 Выдача в ремонтную зону | chief_mechanic | workshop | WorkOrder | IssueToRepairZone | POST /lines/transition {to: assembly} | PartsIssuedToRepair, LineStatusChanged | storekeeper | нет | 4 | T-G3, S-car_repair_in |
| G4 Нормо-часы | chief_mechanic | workshop | LaborHours | CalculateLaborHours | PUT /work-orders/{id}/labor | LaborCalculated |  | нет | 12 | T-G4, S-car_repair_in |
| G5 Зарплатный фонд | chief_mechanic | workshop | LaborHours | BuildMechanicPayroll | GET /work-orders/payroll?period= |  |  | нет | 12 | T-G5, S-car_repair_in |
| G7 Контроль документов | chief_mechanic | shipping | Line | ControlDocuments | PATCH /lines/{id} {field: ДокументПодписанОригинал} | DocumentsControlled |  | нет | 12 | T-G7 |
| G8 Неопознанная позиция | chief_mechanic | notifications | Notice | NotifyUnidentified | policy: ItemUnidentified → Notice | NoticeCreated | chief_mechanic | нет | 7 | T-G8 |
| G9 Печать комплекта документов и выдача авто | chief_mechanic | workshop | WorkOrder | PrintWorkOrderAndRelease | POST /print {kind: work_order_set}; POST /lines/transition {to: closed} | CarReleased, PrintFormRendered, LineStatusChanged |  | нет | 12 | T-G9, S-car_repair_in |
