# 2. Тактическое проектирование

Полный перечень агрегатов, инвариантов и событий хранится в `node-map.json → aggregates, events`. Здесь описаны правила, по которым из него пишется код. Термины — в [generated/glossary.md](generated/glossary.md).

## 2.1 Агрегат `Line` (ядро)

```
Line (arm.line)                       — корень агрегата, id = UUID (план, раздел 5.2)
├─ status: LineStatus                 — VO: id API + значение 1С (Подготовлено/Собран → ready_to_ship)
├─ operation: sale | purchase         — Арм_ВидыОпераций
├─ linkKey: LinkKey                   — VO: связь продажи и её закупок (КлючСвязиСтрок)
├─ clientFact: ClientFact             — VO: факт заявки клиента (Е, К: наименование, артикул, кол-во, ГРЗ, срочность)
├─ vehicle: VehicleFact               — VO: марка, модель, агрегат, госномер, шасси, VIN, двигатель
├─ nomenclature, batch, supplier      — ссылки на агрегаты других контекстов (только id)
├─ quantity, normHours: Quantity      — VO: число + единица
├─ pricing: Pricing                   — VO: себестоимость, РРЦ, коэффициент, цена и сумма продажи (формулы FR-7..9)
├─ stock: StockFigures                — VO: остаток, резерв, в пути (вычисляются складом, в строке — снимок)
├─ placement: warehouseId, cellId     — новое (раздел 13 плана)
├─ docs: customerOrder, supplierOrder, receipt, shipment — ссылки на документы
├─ marking: marked, markedBy          — отметка строки и автор
└─ version: int                       — оптимистическая блокировка, события WS
```

**Команды** (методы агрегата, одна транзакция):
- `ChangeField`
- `Transition`
- `Mark`
- `Strike`
- `RejectAssembly`
- `ControlDocuments`

Каждая команда начинается с одной и той же проверки:

```go
func (l *Line) authorize(actor Actor, fields []Column, target *Status) error {
    // 1. версия: actor.IfMatch == l.Version, иначе ErrConflict (409)
    // 2. фоновая блокировка: l.Status == LockedBackground → ErrLocked (409)
    // 3. закрытая строка: l.Status == Closed && actor.Role != Admin && any(field != DocSignedOriginal) → ErrMatrixDenied (403)
    // 4. матрица: для каждого поля policy.Right(actor.Role, field, l.Status) ∈ {'+', 'c' && l.MarkedBy == actor.User}
    // 5. переход: target != nil → fsm.Allowed(l.Status, *target, actor.Role) (generated/fsm.md), иначе ErrTransition (409)
}
```

Инварианты с номерами — в `node-map.json`. У каждого инварианта есть тест в `internal/arm/line_test.go`. Таблица случаев матрицы генерируется из `domain-model.json`: это набор M, 5 985 случаев.

## 2.2 Остальные агрегаты

| Агрегат | Контекст | Корень хранит | Главное правило |
|---|---|---|---|
| `CustomerOrder` | lines | `doc.customer_order` | шапка едина для строк; договор принадлежит заказчику |
| `SupplierOrder` | procurement | `doc.supplier_order` | порядок M4 → P1 → M7 → P2; статусы канбана снабжения |
| `Nomenclature` | catalog | `ref.nomenclature` | черновик (M2a) → подтверждение (A2); неопознанные (A1) |
| `PricePolicy` | catalog | `ref.price` | НМЦК = РРЦ × 1,5; цена продажи по формуле |
| `Receipt` | warehouse | `doc.receipt` | приёмка K1 всегда продолжается размещением K2 |
| `StockMove` | warehouse | `stock.move` | остаток по ключу не уходит в минус; движения только из документов |
| `Transfer` | warehouse | `doc.transfer` | склад или ячейка отправителя ≠ получателя |
| `Shipment` | shipping | `doc.shipment` | дата и номер обязательны |
| `ReturnRequest` | returns | `doc.return` | возврат клиента — после отгрузки; поставщику — через K6 или P3 |
| `Notice` | notifications | `arm.notice` | одно непрочитанное на узел + роль + заказ за день |
| `MatrixPolicy` | access | `arm.matrix_column` | маска на 15 статусов; изменение → `MatrixChanged` → принудительная перестройка интерфейса |
| `AccessRequest` | access | `auth.access_request` | M13 → A3: администратор одобряет, и команда выполняется от его имени |
| `OutboxMessage` | accounting | `integration.outbox` | в транзакции с изменением; идемпотентная отправка |

## 2.3 Объекты-значения

| VO | Поля | Правило |
|---|---|---|
| `Money` | `numeric(15,2)` | без float; округление банковское только при печати |
| `Quantity` | число + `unitId` | дробное только у весовых и мерных единиц |
| `LineStatus` | `id`, `onecName` | хранится имя 1С, API отдаёт `id` (план, 5.3) |
| `LinkKey` | строка | общая для продажи и её закупок |
| `ClientFact`, `VehicleFact` | см. колонки групп Е, К | одно из: госномер / агрегат; одно из: наименование / артикул / код |
| `Period` | `from`, `to` | для цен и закрытия периода |
| `Actor` | `userId`, `role`, `sessionId`, `warehouses[]`, `ifMatch` | из сессии; передаётся в каждую команду |

## 2.4 События и политики

Событие пишется в `sys.change_log` (для WebSocket) и при необходимости в `integration.outbox` в той же транзакции, что и изменение.

**Политики** — реакции на события. Они идемпотентны, ключ — `seq` события.

| Событие | Политика | Узел |
|---|---|---|
| `GoodsPlaced` | уведомить менеджера заказа «приход» | M8 |
| `AssemblyRequested` | уведомить кладовщика | M9 |
| `AssemblyRejected` | уведомить кладовщика с причиной; строку на розыск | M10 → K8 |
| `LineAssembled` | уведомить менеджера «готово» | M11 |
| `SelfPickupRecorded` | уведомить менеджера и кладовщика одновременно | M17 ∥ K9 |
| `ItemUnidentified` | уведомить менеджера и главного механика | M18 ∥ G8 |
| `RightsRequested` | уведомить администратора | M13 → A3 |
| `Shipped`, `GoodsReceived`, `ReturnAccepted`, `StockMoved` | outbox → бухгалтерия | раздел 14 плана |
| `PaymentReceived` (из 1С) | строки заказа → `paid` | M7 |
| `MatrixChanged`, `RoleChanged` | WS: принудительная перезагрузка матрицы у затронутых | A0 |

## 2.5 Репозитории и транзакции

- Один репозиторий на агрегат (`LineRepo`, `SupplierOrderRepo` …), SQL написан в `db/queries` (sqlc).
- Команда работает в одной транзакции: агрегат, `sys.change_log`, outbox, уведомления. Фиксация происходит до ответа клиенту.
- Пакетные команды выполняются как фоновое задание `arm.job`: «В работе», разделение строк, автозакупки. Затронутые строки на время задания получают `locked_background`, а в конце одно событие со списком id.
