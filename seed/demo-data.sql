-- Демо-данные для всех стадий всех сценариев (process.html).
-- Создаёт arm.line строки с правильными статусами, операциями и ссылками на документы.
-- Идемпотентен по onec_key.

-- Сначала соберём все ID через uuidv7() — они будут использоваться в ссылках.
-- Для идемпотентности onec_key уникален, а id генерируется каждый раз новый.

-- ============================================================
-- СЦЕНАРИЙ 1: happy — закупка → отгрузка
-- ============================================================

-- M1: Загрузка заявки в 1С (статус «Новый»)
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:happy:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777701', 2, 0, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', 'А123BC777', 'Заявка-001', 'Заявка от ИП Иванов', '2026-11-01 10:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:happy:1', 1),
  (uuidv7(), 'lk:happy:2', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777702', 1, 0, 400.00, 500.00, 1.0,
   'Фильтр масляный', 'FLT-OIL-001', '1', 'А123BC777', 'Заявка-001', 'Заявка от ИП Иванов', '2026-11-01 10:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:happy:2', 2)
on conflict (onec_key) do update set status = excluded.status, quantity = excluded.quantity, updated_at = now();

-- M2: Поиск + подбор — остатка нет → закупка
update arm.line set status = 'Новый' where onec_key in ('demo:happy:1', 'demo:happy:2');

-- M4: Заказ поставщику (статус «Заказано»)
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:happy:3', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777701', 2, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', null, 'Заявка-001', 'Заказ поставщику АвтооптТорг', '2026-11-01 12:00:00', '44444444-4444-4444-4444-444444444401', null, true,
   'demo:happy:3', 1),
  (uuidv7(), 'lk:happy:4', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777702', 1, 250.00, 400.00, 500.00, 1.0,
   'Фильтр масляный', 'FLT-OIL-001', '1', null, 'Заявка-001', 'Заказ поставщику АвтооптТорг', '2026-11-01 12:00:00', '44444444-4444-4444-4444-444444444401', null, true,
   'demo:happy:4', 2)
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- M7: Контроль оплаты → «Оплачено»
update arm.line set status = 'Оплачено' where onec_key in ('demo:happy:3', 'demo:happy:4');

-- P2: В пути → «ТоварВПути»
update arm.line set status = 'ТоварВПути' where onec_key in ('demo:happy:3', 'demo:happy:4');

-- K1: Приёмка по УПД → «Приходуется»
update arm.line set status = 'Приходуется', receipt_date = '2026-11-03 10:00:00', upd_date = '2026-11-03', upd_number = 'УПД-001'
where onec_key in ('demo:happy:3', 'demo:happy:4');

-- K2: Размещение → «НаСкладе»
update arm.line set status = 'НаСкладе', batch_id = 'dd000000-0000-0000-0000-000000000001', stock_qty = 2 where onec_key = 'demo:happy:3';
update arm.line set status = 'НаСкладе', batch_id = 'dd000000-0000-0000-0000-000000000002', stock_qty = 1 where onec_key = 'demo:happy:4';

-- M9: Задание на комплектацию → «Комплектуется»
update arm.line set status = 'Комплектуется' where onec_key in ('demo:happy:1', 'demo:happy:2');

-- K3: Сборка завершена → «Подготовлено»
update arm.line set status = 'Подготовлено' where onec_key in ('demo:happy:1', 'demo:happy:2');

-- M12: Отгрузочная ведомость

-- K5: Отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-04', shipment_number = 'РН-001'
where onec_key in ('demo:happy:1', 'demo:happy:2');

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key in ('demo:happy:1', 'demo:happy:2');

-- ============================================================
-- СЦЕНАРИЙ 2: stock — со склада (резерв)
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:stock:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777703', 1, 0, 1200.00, 1500.00, 1.0,
   'Колодки тормозные передние', 'BRK-FR-001', '1', 'E456OP777', 'Заявка-002', 'Заявка ООО АвтоЛюкс', '2026-11-02 09:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802', false,
   'demo:stock:1', 1),
  (uuidv7(), 'lk:stock:2', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777704', 2, 0, 900.00, 1100.00, 1.0,
   'Антифриз G12+ (5л)', 'ANT-G12-5L', '2', 'E456OP777', 'Заявка-002', 'Заявка ООО АвтоЛюкс', '2026-11-02 09:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888803', false,
   'demo:stock:2', 2)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M3: Резервирование → «Резервирование»
update arm.line set status = 'Резервирование', reserve_qty = 1 where onec_key = 'demo:stock:1';
update arm.line set status = 'Резервирование', reserve_qty = 2 where onec_key = 'demo:stock:2';

-- M9: Задание на комплектацию → «Комплектуется»
update arm.line set status = 'Комплектуется' where onec_key in ('demo:stock:1', 'demo:stock:2');

-- K3: Комплектация → «Подготовлено»
update arm.line set status = 'Подготовлено' where onec_key in ('demo:stock:1', 'demo:stock:2');

-- M12: Отгрузочная ведомость

-- K5: Отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-03', shipment_number = 'РН-002'
where onec_key in ('demo:stock:1', 'demo:stock:2');

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key in ('demo:stock:1', 'demo:stock:2');

-- ============================================================
-- СЦЕНАРИЙ 3: mixed_order — смешанный заказ (склад + закупка)
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:mixed:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666603', null, '77777777-7777-7777-7777-777777777705', 4, 0, 600.00, 800.00, 1.0,
   'Свеча зажигания', 'SPK-IR-001', '4', 'K789MH750', 'Заявка-003', 'Заявка АвтоДеталь Сервис', '2026-11-02 14:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:mixed:1', 1),
  (uuidv7(), 'lk:mixed:2', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666603', null, '77777777-7777-7777-7777-777777777706', 1, 0, 700.00, 900.00, 1.0,
   'Фильтр воздушный', 'FLT-AIR-001', '1', 'K789MH750', 'Заявка-003', 'Заявка АвтоДеталь Сервис', '2026-11-02 14:00:00', '44444444-4444-4444-4444-444444444401', null, false,
   'demo:mixed:2', 2)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M3: Строка 1 — резерв
update arm.line set status = 'Резервирование', reserve_qty = 4 where onec_key = 'demo:mixed:1';

-- M4: Строка 2 — заказ поставщику → «Закупка» / «Заказано»
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:mixed:3', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666605', '77777777-7777-7777-7777-777777777706', 1, 400.00, 700.00, 900.00, 1.0,
   'Фильтр воздушный', 'FLT-AIR-001', '1', null, 'Заявка-003', 'Заказ ДеталиОпт', '2026-11-02 15:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:mixed:3', 1)
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- M7: Оплата закупки
update arm.line set status = 'Оплачено' where onec_key = 'demo:mixed:3';

-- P2: В пути
update arm.line set status = 'ТоварВПути' where onec_key = 'demo:mixed:3';

-- K1: Приёмка
update arm.line set status = 'Приходуется', receipt_date = '2026-11-04', upd_date = '2026-11-04', upd_number = 'УПД-003'
where onec_key = 'demo:mixed:3';

-- K2: Размещение
update arm.line set status = 'НаСкладе', batch_id = 'dd000000-0000-0000-0000-000000000002', stock_qty = 1
where onec_key = 'demo:mixed:3';

-- M9: Комплектация обоих
update arm.line set status = 'Комплектуется' where onec_key in ('demo:mixed:1', 'demo:mixed:2');

-- K3: Сборка → «Подготовлено»
update arm.line set status = 'Подготовлено' where onec_key in ('demo:mixed:1', 'demo:mixed:2');

-- K5: Отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-05', shipment_number = 'РН-003'
where onec_key in ('demo:mixed:1', 'demo:mixed:2');

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key in ('demo:mixed:1', 'demo:mixed:2');

-- ============================================================
-- СЦЕНАРИЙ 4: delivery_split — самовывоз у внешнего поставщика
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:split:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777707', 1, 0, 550.00, 700.00, 1.0,
   'Фильтр салонный', 'FLT-CAB-001', '1', 'M321PT799', 'Заявка-004', 'Самовывоз у поставщика', '2026-11-03 11:00:00', '44444444-4444-4444-4444-444444444401', false,
   'demo:split:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M4: Заказ поставщику
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:split:2', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777707', 1, 350.00, 550.00, 700.00, 1.0,
   'Фильтр салонный', 'FLT-CAB-001', '1', 'Заявка-004', 'Самовывоз от АвтооптТорг', '2026-11-03 12:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:split:2', 1)
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- M7: Оплата
update arm.line set status = 'Оплачено' where onec_key = 'demo:split:2';

-- N4: Самовывоз клиентом → «Отгружено» (у поставщика)
update arm.line set status = 'Отгружено', shipment_date = '2026-11-03', shipment_number = 'САМ-001'
where onec_key = 'demo:split:2';

-- K1: Приёмка по УПД
update arm.line set status = 'Приходуется', receipt_date = '2026-11-03', upd_date = '2026-11-03', upd_number = 'УПД-004'
where onec_key = 'demo:split:2';

-- K2: Размещение
update arm.line set status = 'НаСкладе', stock_qty = 1 where onec_key = 'demo:split:2';

-- M9: Комплектация → «Комплектуется»
update arm.line set status = 'Комплектуется' where onec_key = 'demo:split:1';

-- K3: Сборка → «Подготовлено»
update arm.line set status = 'Подготовлено' where onec_key = 'demo:split:1';

-- K5: Отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-04', shipment_number = 'РН-004'
where onec_key = 'demo:split:1';

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key = 'demo:split:1';

-- ============================================================
-- СЦЕНАРИЙ 5: virtual_buy — виртуальный закуп
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:virt:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777701', 1, 0, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '1', 'E456OP777', 'Заявка-005', 'Срочная заявка, без документов', '2026-11-04 09:00:00', '44444444-4444-4444-4444-444444444401', false,
   'demo:virt:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M13: Недостаточно прав → «Заказано»
update arm.line set status = 'Заказано', comment = 'Недостаточно прав, обратись к админу' where onec_key = 'demo:virt:1';

-- A3: Админ подтверждает чек → «Оплачено»
update arm.line set status = 'Оплачено', comment = 'Админ подтвердил чек' where onec_key = 'demo:virt:1';

-- ============================================================
-- СЦЕНАРИЙ 6: defect — контроль комплектации (отклонение)
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:defect:1', 'Продажа', 'Подготовлено',
   '66666666-6666-6666-6666-666666666603', null, '77777777-7777-7777-7777-777777777703', 2, 600.00, 1200.00, 1500.00, 1.0,
   'Колодки тормозные передние', 'BRK-FR-001', '2', 'K789MH750', 'Заявка-006', 'Комплектация с отклонением', '2026-11-04 10:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802', false,
   'demo:defect:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M10: Контроль комплектации — отклонение
update arm.line set status = 'Комплектуется', comment = 'Отклонение: нехватка 1 шт' where onec_key = 'demo:defect:1';

-- K3: Повторная комплектация → «Подготовлено»
update arm.line set status = 'Подготовлено', comment = 'Допоставлено' where onec_key = 'demo:defect:1';

-- K5: Отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-05', shipment_number = 'РН-006'
where onec_key = 'demo:defect:1';

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key = 'demo:defect:1';

-- ============================================================
-- СЦЕНАРИЙ 7: cancel_supplier — отмена заказа у поставщика
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:cancel:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777704', 3, 0, 900.00, 1100.00, 1.0,
   'Антифриз G12+ (5л)', 'ANT-G12-5L', '3', 'A123BC777', 'Заявка-007', 'Отмена заказа', '2026-11-05 09:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888803', false,
   'demo:cancel:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M4: Заказ поставщику
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:cancel:2', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666605', '77777777-7777-7777-7777-777777777704', 3, 550.00, 900.00, 1100.00, 1.0,
   'Антифриз G12+ (5л)', 'ANT-G12-5L', '3', 'Заявка-007', 'Заказ отменён', '2026-11-05 10:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:cancel:2', 1)
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- M15/M16: Контроль документов перед возвратом → «Возврат»
update arm.line set status = 'Возврат', comment = 'Возврат-отказ до прихода' where onec_key in ('demo:cancel:1', 'demo:cancel:2');

-- ============================================================
-- СЦЕНАРИЙ 8: return — возврат от клиента
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, shipment_date, shipment_number, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:return:1', 'Продажа', 'Отгружено',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777702', 1, 250.00, 400.00, 500.00, 1.0,
   'Фильтр масляный', 'FLT-OIL-001', '1', 'A123BC777', 'Заявка-008', 'Возврат от клиента', '2026-11-01 10:00:00', '44444444-4444-4444-4444-444444444401', '2026-11-02', 'РН-008', false,
   'demo:return:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- N3: Возврат инициирован → «Возврат»
update arm.line set status = 'Возврат', comment = 'Возврат от клиента — не подошёл' where onec_key = 'demo:return:1';

-- M19: Отгрузочная ведомость (корректировка)

-- M16: Заявка на возврат поставщику
update arm.line set status = 'Возврат', comment = 'Возврат поставщику' where onec_key = 'demo:return:1';

-- ============================================================
-- СЦЕНАРИЙ 9: return_mgr — возврат поставщику от менеджера
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, client_order_number, comment, order_date, warehouse_id, shipment_date, shipment_number, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:return_mgr:1', 'Продажа', 'Отгружено',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777705', 2, 300.00, 600.00, 800.00, 1.0,
   'Свеча зажигания', 'SPK-IR-001', '2', 'Заявка-009', 'Возврат поставщику — брак', '2026-11-03 10:00:00', '44444444-4444-4444-4444-444444444401', '2026-11-03', 'РН-009', false,
   'demo:return_mgr:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M16: Заявка на возврат поставщику → «Возврат»
update arm.line set status = 'Возврат', comment = 'Возврат поставщику (менеджер)' where onec_key = 'demo:return_mgr:1';

-- M15/K7: Контроль документов
update arm.line set status = 'Выполнено', signed_original = true where onec_key = 'demo:return_mgr:1';

-- ============================================================
-- СЦЕНАРИЙ 10: return_internal — отказ клиента при получении
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, shipment_date, shipment_number, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:return_int:1', 'Продажа', 'Отгружено',
   '66666666-6666-6666-6666-666666666603', null, '77777777-7777-7777-7777-777777777701', 1, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '1', 'K789MH750', 'Заявка-010', 'Клиент отказался при получении', '2026-11-02 11:00:00', '44444444-4444-4444-4444-444444444401', '2026-11-03', 'РН-010', false,
   'demo:return_int:1', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- N3: Оформление возврата → «Возврат»
update arm.line set status = 'Возврат', comment = 'Отказ клиента при получении' where onec_key = 'demo:return_int:1';

-- K5: Повторная отгрузка → «Отгружено»
update arm.line set status = 'Отгружено', shipment_date = '2026-11-05', shipment_number = 'РН-010-2' where onec_key = 'demo:return_int:1';

-- M15/K7: Контроль документов → «Выполнено»
update arm.line set status = 'Выполнено', signed_original = true where onec_key = 'demo:return_int:1';

-- ============================================================
-- СЦЕНАРИЙ 11: car_repair_in — поступление машины в ремонт (E)
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order,
  plate, vin, model)
values
  (uuidv7(), 'lk:repair:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777701', 2, 0, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', 'А123BC777', 'Ремонт-001', 'Поступление VW Polo в ремонт', '2026-11-04 08:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:repair:1', 1,
   'A123BC777', 'XW8ZZZ61ZRG012345', 'Volkswagen Polo'),
  (uuidv7(), 'lk:repair:2', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777702', 1, 0, 400.00, 500.00, 1.0,
   'Фильтр масляный', 'FLT-OIL-001', '1', 'А123BC777', 'Ремонт-001', 'Поступление VW Polo в ремонт', '2026-11-04 08:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:repair:2', 2,
   'A123BC777', 'XW8ZZZ61ZRG012345', 'Volkswagen Polo'),
  (uuidv7(), 'lk:repair:3', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777703', 1, 0, 1200.00, 1500.00, 1.0,
   'Колодки тормозные передние', 'BRK-FR-001', '1', 'А123BC777', 'Ремонт-001', 'Поступление VW Polo в ремонт', '2026-11-04 08:00:00', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802', false,
   'demo:repair:3', 3,
   'A123BC777', 'XW8ZZZ61ZRG012345', 'Volkswagen Polo')
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

-- M3: Резервирование → «Резервирование»
update arm.line set status = 'Резервирование', reserve_qty = 2 where onec_key = 'demo:repair:1';
update arm.line set status = 'Резервирование', reserve_qty = 1 where onec_key = 'demo:repair:2';
update arm.line set status = 'Резервирование', reserve_qty = 1 where onec_key = 'demo:repair:3';

-- M4: Запчасти в пути
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order,
  plate, vin)
values
  (uuidv7(), 'lk:repair:4', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777701', 2, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', 'А123BC777', 'Ремонт-001', 'Запчасти для ремонта', '2026-11-04 09:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:repair:4', 1,
   'A123BC777', 'XW8ZZZ61ZRG012345')
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- Оплата → в путь → приёмка → размещение
update arm.line set status = 'Оплачено' where onec_key = 'demo:repair:4';
update arm.line set status = 'ТоварВПути' where onec_key = 'demo:repair:4';
update arm.line set status = 'НаСкладе', batch_id = 'dd000000-0000-0000-0000-000000000001', stock_qty = 2, receipt_date = '2026-11-05', upd_date = '2026-11-05', upd_number = 'УПД-011'
where onec_key = 'demo:repair:4';

-- M9/K3: Комплектация → «Подготовлено»
update arm.line set status = 'Подготовлено' where onec_key in ('demo:repair:1', 'demo:repair:2', 'demo:repair:3');

-- G4: Нормо-часы
update arm.line set norm_hours = 1.5, cost_sum = 2250.00 where onec_key = 'demo:repair:1';
update arm.line set norm_hours = 1.0, cost_sum = 1500.00 where onec_key = 'demo:repair:2';

-- G9: Печать комплекта документов и выдача авто → «Завершено»
update arm.line set status = 'Завершено', comment = 'Авто выдано клиенту'
where onec_key in ('demo:repair:1', 'demo:repair:2', 'demo:repair:3');

-- ============================================================
-- УВЕДОМЛЕНИЯ (arm.notice) — ключевые узлы
-- ============================================================

insert into arm.notice (id, onec_record_id, created_at, node, kind, recipient_role, text, is_read, onec_key) values
  (uuidv7(), 'N-001', '2026-11-03 11:00:00', 'K2', 'приход', 'Менеджер',
   'Товар от АвтооптТорг прибыл на склад (Масло моторное 5W-30 × 2, Фильтр масляный × 1)', false,
   'demo:notice:1'),
  (uuidv7(), 'N-002', '2026-11-03 14:00:00', 'K3', 'готовность', 'Менеджер',
   'Заказ для ИП Иванов укомплектован и готов к отгрузке', false,
   'demo:notice:2'),
  (uuidv7(), 'N-003', '2026-11-02 15:00:00', 'K3', 'готовность', 'Менеджер',
   'Заказ для ООО АвтоЛюкс готов к отгрузке', false,
   'demo:notice:3'),
  (uuidv7(), 'N-004', '2026-11-04 10:30:00', 'K2', 'неопознана', 'ГлавныйМеханик',
   'Позиция не опознана: артикул не найден в справочнике', false,
   'demo:notice:4'),
  (uuidv7(), 'N-005', '2026-11-03 15:00:00', 'N4', 'самовывоз', 'Менеджер',
   'Клиент забрал товар у поставщика АвтооптТорг', false,
   'demo:notice:5'),
  (uuidv7(), 'N-006', '2026-11-03 15:00:00', 'N4', 'самовывоз', 'Кладовщик',
   'Клиент забрал товар у поставщика АвтооптТорг', false,
   'demo:notice:6'),
  (uuidv7(), 'N-007', '2026-11-04 11:00:00', 'K2', 'неопознана', 'Менеджер',
   'Позиция не опознана после розыска: нужно подтверждение админом', false,
   'demo:notice:7')
on conflict (onec_key) do update set is_read = excluded.is_read, updated_at = now();

-- ============================================================
-- ДОКУМЕНТЫ: customer_order, supplier_order, receipt, shipment
-- (1С-схема: id фиксированный, onec_key нет — используем on conflict (id))
-- ============================================================

insert into doc.customer_order (id, date, number, operation, posted, author_id, ship_date,
  counterparty_id, organization_id, responsible_id, amount_includes_vat, total, client_order_number) values
  ('a0000000-0000-0000-0000-000000000001', '2026-11-01 10:00:00', 'ЗК-001', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-04',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 4200.00, 'Заявка-001'),
  ('a0000000-0000-0000-0000-000000000002', '2026-11-02 09:00:00', 'ЗК-002', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-03',
   '66666666-6666-6666-6666-666666666602', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 3000.00, 'Заявка-002'),
  ('a0000000-0000-0000-0000-000000000003', '2026-11-04 08:00:00', 'ЗК-003', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-05',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 5850.00, 'Ремонт-001'),
  ('a0000000-0000-0000-0000-000000000004', '2026-11-02 14:00:00', 'ЗК-004', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-05',
   '66666666-6666-6666-6666-666666666603', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 3100.00, 'Заявка-003'),
  ('a0000000-0000-0000-0000-000000000005', '2026-11-03 11:00:00', 'ЗК-005', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-04',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 550.00, 'Заявка-004')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into doc.supplier_order (id, date, number, operation, posted, author_id, receipt_date,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total) values
  ('b0000000-0000-0000-0000-000000000001', '2026-11-01 12:00:00', 'ЗП-001', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-03',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 2650.00),
  ('b0000000-0000-0000-0000-000000000002', '2026-11-02 15:00:00', 'ЗП-002', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-04',
   '66666666-6666-6666-6666-666666666605', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 400.00),
  ('b0000000-0000-0000-0000-000000000003', '2026-11-03 12:00:00', 'ЗП-003', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-03',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 350.00),
  ('b0000000-0000-0000-0000-000000000004', '2026-11-04 09:00:00', 'ЗП-004', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-05',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 2400.00)
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into doc.receipt (id, date, number, operation, posted, author_id, incoming_no, incoming_date,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, supplier_order_id) values
  ('c1000000-0000-0000-0000-000000000001', '2026-11-03 10:00:00', 'ПН-001', 'Закупка', true,
   '00000000-0000-0000-0000-000000000004', 'УПД-001', '2026-11-03',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 2650.00, 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', '2026-11-04 10:00:00', 'ПН-002', 'Закупка', true,
   '00000000-0000-0000-0000-000000000004', 'УПД-003', '2026-11-04',
   '66666666-6666-6666-6666-666666666605', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 400.00, 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003', '2026-11-05 10:00:00', 'ПН-003', 'Закупка', true,
   '00000000-0000-0000-0000-000000000004', 'УПД-011', '2026-11-05',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 2400.00, 'b0000000-0000-0000-0000-000000000004')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into doc.shipment (id, date, number, operation, posted, author_id,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, customer_order_id) values
  ('d1000000-0000-0000-0000-000000000001', '2026-11-04 09:00:00', 'РН-001', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 4200.00, 'a0000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000002', '2026-11-03 10:00:00', 'РН-002', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666602', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 3000.00, 'a0000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000003', '2026-11-05 12:00:00', 'РН-003', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666603', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 3100.00, 'a0000000-0000-0000-0000-000000000004'),
  ('d1000000-0000-0000-0000-000000000004', '2026-11-04 15:00:00', 'РН-004', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 550.00, 'a0000000-0000-0000-0000-000000000005'),
  ('d1000000-0000-0000-0000-000000000005', '2026-11-05 16:00:00', 'РН-011', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 5850.00, 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

-- Привязка строк АРМ к документам
update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000001' where onec_key in ('demo:happy:1', 'demo:happy:2');
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000001', receipt_id = 'c1000000-0000-0000-0000-000000000001' where onec_key in ('demo:happy:3', 'demo:happy:4');
update arm.line set shipment_doc_id = 'd1000000-0000-0000-0000-000000000001' where onec_key in ('demo:happy:1', 'demo:happy:2');

update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000002' where onec_key in ('demo:stock:1', 'demo:stock:2');
update arm.line set shipment_doc_id = 'd1000000-0000-0000-0000-000000000002' where onec_key in ('demo:stock:1', 'demo:stock:2');

update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000004' where onec_key in ('demo:mixed:1', 'demo:mixed:2');
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000002', receipt_id = 'c1000000-0000-0000-0000-000000000002' where onec_key = 'demo:mixed:3';
update arm.line set shipment_doc_id = 'd1000000-0000-0000-0000-000000000003' where onec_key in ('demo:mixed:1', 'demo:mixed:2');

update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000005' where onec_key = 'demo:split:1';
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000003' where onec_key = 'demo:split:2';
update arm.line set shipment_doc_id = 'd1000000-0000-0000-0000-000000000004' where onec_key = 'demo:split:1';

update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000003' where onec_key in ('demo:repair:1', 'demo:repair:2', 'demo:repair:3');
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000004', receipt_id = 'c1000000-0000-0000-0000-000000000003' where onec_key = 'demo:repair:4';
update arm.line set shipment_doc_id = 'd1000000-0000-0000-0000-000000000005' where onec_key in ('demo:repair:1', 'demo:repair:2', 'demo:repair:3');

update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000001' where operation = 'Закупка' and supplier_id = '66666666-6666-6666-6666-666666666604';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000002' where operation = 'Закупка' and supplier_id = '66666666-6666-6666-6666-666666666605';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000003' where operation = 'Продажа' and customer_id = '66666666-6666-6666-6666-666666666601';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000004' where operation = 'Продажа' and customer_id = '66666666-6666-6666-6666-666666666602';
update arm.line set payment_form_id = '33333333-3333-3333-3333-333333333203' where status in ('Оплачено', 'ТоварВПути', 'Приходуется', 'НаСкладе', 'Резервирование', 'Комплектуется', 'Подготовлено', 'Отгружено', 'Выполнено', 'Завершено');

-- ============================================================
-- ЗАКАЗ-НАРЯД (doc.work_order) для repair
-- ============================================================

insert into doc.work_order (id, number, date, posted, car_id, customer_id, customer_order_id, warehouse_id,
  responsible_id, author_id, total_norm_hours, labor_sum, parts_sum, status, comment, onec_key)
values
  (uuidv7(), 'ЗН-001', '2026-11-04 08:00:00', true,
   'bb000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666601',
   'a0000000-0000-0000-0000-000000000003',
   '44444444-4444-4444-4444-444444444401',
   '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005',
   2.5, 3750.00, 5850.00, 'released', 'VW Polo: замена масла + фильтр + колодки',
   'demo:wo:repair')
on conflict (onec_key) do update set labor_sum = excluded.labor_sum, parts_sum = excluded.parts_sum, updated_at = now();

-- work_order_line
insert into doc.work_order_line (work_order_id, line_id, nomenclature_id, quantity, norm_hours, comment, onec_key) values
  ((select id from doc.work_order where onec_key = 'demo:wo:repair'),
   (select id from arm.line where onec_key = 'demo:repair:1'),
   '77777777-7777-7777-7777-777777777701', 2, 1.0, 'Замена масла моторного', 'demo:wol:1'),
  ((select id from doc.work_order where onec_key = 'demo:wo:repair'),
   (select id from arm.line where onec_key = 'demo:repair:2'),
   '77777777-7777-7777-7777-777777777702', 1, 0.5, 'Замена фильтра масляного', 'demo:wol:2'),
  ((select id from doc.work_order where onec_key = 'demo:wo:repair'),
   (select id from arm.line where onec_key = 'demo:repair:3'),
   '77777777-7777-7777-7777-777777777703', 1, 1.0, 'Замена колодок передних', 'demo:wol:3')
on conflict (onec_key) do update set updated_at = now();

-- work_order_labor
insert into doc.work_order_labor (id, work_order_id, service_kind_id, model_id, quantity, hour_price, amount, comment, onec_key) values
  (uuidv7(),
   (select id from doc.work_order where onec_key = 'demo:wo:repair'),
   '22222222-2222-2222-2222-222222222201', 'aa000000-0000-0000-0000-000000000001', 2.5, 1500.00, 3750.00, 'Нормо-часы: ремонт легковой', 'demo:wal:1')
on conflict (onec_key) do update set amount = excluded.amount, updated_at = now();

-- ============================================================
-- ВОЗВРАТ (doc.return_order) для return сценария
-- onec_key NOT NULL без UNIQUE → сначала DELETE, потом INSERT
-- ============================================================

delete from doc.return_line where onec_key like 'demo:rel:%';
delete from doc.return_order where onec_key like 'demo:ret:%';

insert into doc.return_order (id, number, date, operation, customer_order_id, warehouse_id, total_sum, total_qty, comment, posted, onec_key)
values
  (uuidv7(), 'ВР-001', '2026-11-04 10:00:00', 'Продажа',
   'a0000000-0000-0000-0000-000000000001',
   '44444444-4444-4444-4444-444444444401', 400.00, 1, 'Возврат от ИП Иванов: Фильтр масляный', true,
   'demo:ret:happy');

insert into doc.return_line (id, return_order_id, sort_order, nomenclature_id, quantity, cost_price, cost_sum, reason, onec_key) values
  (uuidv7(),
   (select id from doc.return_order where onec_key = 'demo:ret:happy'), 1,
   '77777777-7777-7777-7777-777777777702', 1, 250.00, 250.00, 'Не подошёл', 'demo:rel:happy');

-- ============================================================
-- СЦЕНАРИИ 12–13: sale_purchase — продажа клиенту с закупкой под заказ
-- sp:1 — закупка приходована и отгружена клиенту (полный цикл);
-- sp:2 — закупка в пути, продажа ждёт поступления товара.
-- ============================================================

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:sp:1', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777701', 2, 0, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', 'M111AA777', 'Заявка-011', 'Продажа под закупку у АвтооптТорг', '2026-11-03 09:00:00', '44444444-4444-4444-4444-444444444401', false,
   'demo:sp:1', 1),
  (uuidv7(), 'lk:sp:2', 'Продажа', 'Черновик',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777705', 1, 0, 600.00, 800.00, 1.0,
   'Свеча зажигания', 'SPK-IR-001', '1', 'M222BB777', 'Заявка-012', 'Продажа под закупку у поставщика ЗапчастьОпт', '2026-11-04 10:00:00', '44444444-4444-4444-4444-444444444401', false,
   'demo:sp:2', 1)
on conflict (onec_key) do update set status = excluded.status, updated_at = now();

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:sp:3', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777701', 2, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '2', 'Заявка-011', 'Закупка под заказ клиента ЗК-006', '2026-11-03 11:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:sp:3', 1),
  (uuidv7(), 'lk:sp:4', 'Закупка', 'Заказано',
   null, '66666666-6666-6666-6666-666666666605', '77777777-7777-7777-7777-777777777705', 1, 300.00, 600.00, 800.00, 1.0,
   'Свеча зажигания', 'SPK-IR-001', '1', 'Заявка-012', 'Закупка под заказ клиента ЗК-007', '2026-11-04 11:00:00', '44444444-4444-4444-4444-444444444401', true,
   'demo:sp:4', 1)
on conflict (onec_key) do update set status = excluded.status, cost_price = excluded.cost_price, updated_at = now();

-- Продажа 1: заказ клиента → закупка оплачена → в пути → приёмка на склад → отгрузка клиенту
update arm.line set status = 'Заказано', comment = 'Заказ клиента ЗК-006 подтверждён' where onec_key = 'demo:sp:1';
update arm.line set status = 'Оплачено' where onec_key = 'demo:sp:3';
update arm.line set status = 'ТоварВПути' where onec_key = 'demo:sp:3';
update arm.line set status = 'НаСкладе', batch_id = 'dd000000-0000-0000-0000-000000000001', stock_qty = 2, receipt_date = '2026-11-04', upd_date = '2026-11-04', upd_number = 'УПД-012'
where onec_key = 'demo:sp:3';
update arm.line set status = 'Отгружено', shipment_date = '2026-11-05', shipment_number = 'РН-012' where onec_key = 'demo:sp:1';
update arm.line set status = 'Выполнено', signed_original = true where onec_key = 'demo:sp:1';

-- Продажа 2: заказ клиента ждёт закупку, закупка в пути
update arm.line set status = 'Заказано', comment = 'Ожидание поступления от поставщика' where onec_key = 'demo:sp:2';
update arm.line set status = 'Оплачено' where onec_key = 'demo:sp:4';
update arm.line set status = 'ТоварВПути' where onec_key = 'demo:sp:4';

insert into doc.customer_order (id, date, number, operation, posted, author_id, ship_date,
  counterparty_id, organization_id, responsible_id, amount_includes_vat, total, client_order_number) values
  ('a0000000-0000-0000-0000-000000000006', '2026-11-03 09:00:00', 'ЗК-006', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-05',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 3600.00, 'Заявка-011'),
  ('a0000000-0000-0000-0000-000000000007', '2026-11-04 10:00:00', 'ЗК-007', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-07',
   '66666666-6666-6666-6666-666666666602', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 600.00, 'Заявка-012')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into doc.supplier_order (id, date, number, operation, posted, author_id, receipt_date,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, customer_order_id) values
  ('b0000000-0000-0000-0000-000000000005', '2026-11-03 11:00:00', 'ЗП-005', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-04',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 2400.00,
   'a0000000-0000-0000-0000-000000000006'),
  ('b0000000-0000-0000-0000-000000000006', '2026-11-04 11:00:00', 'ЗП-006', 'Закупка', true,
   '00000000-0000-0000-0000-000000000003', '2026-11-06',
   '66666666-6666-6666-6666-666666666605', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444401', true, 300.00,
   'a0000000-0000-0000-0000-000000000007')
on conflict (id) do update set total = excluded.total, number = excluded.number, customer_order_id = excluded.customer_order_id, deleted = false, updated_at = now();

insert into doc.receipt (id, date, number, operation, posted, author_id, incoming_no, incoming_date,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, supplier_order_id) values
  ('c1000000-0000-0000-0000-000000000004', '2026-11-04 12:00:00', 'ПН-004', 'Закупка', true,
   '00000000-0000-0000-0000-000000000004', 'УПД-012', '2026-11-04',
   '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 2400.00, 'b0000000-0000-0000-0000-000000000005')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into doc.shipment (id, date, number, operation, posted, author_id,
  counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, customer_order_id) values
  ('d1000000-0000-0000-0000-000000000006', '2026-11-05 14:00:00', 'РН-012', 'Продажа', true,
   '00000000-0000-0000-0000-000000000004',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444401', true, 3600.00, 'a0000000-0000-0000-0000-000000000006')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

-- Привязка строк АРМ к документам сценариев sale_purchase
update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000006', shipment_doc_id = 'd1000000-0000-0000-0000-000000000006' where onec_key = 'demo:sp:1';
update arm.line set customer_order_id = 'a0000000-0000-0000-0000-000000000007' where onec_key = 'demo:sp:2';
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000005', receipt_id = 'c1000000-0000-0000-0000-000000000004' where onec_key = 'demo:sp:3';
update arm.line set supplier_order_id = 'b0000000-0000-0000-0000-000000000006' where onec_key = 'demo:sp:4';

-- Договоры и форма оплаты (по образцу общих правил выше)
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000001' where onec_key = 'demo:sp:3';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000002' where onec_key = 'demo:sp:4';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000003' where onec_key = 'demo:sp:1';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000004' where onec_key = 'demo:sp:2';
update arm.line set payment_form_id = '33333333-3333-3333-3333-333333333203' where onec_key in ('demo:sp:1', 'demo:sp:3');

-- Связь существующих закупок с заказами клиентов (раньше customer_order_id у supplier_order не проставлялся)
update doc.supplier_order set customer_order_id = 'a0000000-0000-0000-0000-000000000001' where id = 'b0000000-0000-0000-0000-000000000001';
update doc.supplier_order set customer_order_id = 'a0000000-0000-0000-0000-000000000004' where id = 'b0000000-0000-0000-0000-000000000002';
update doc.supplier_order set customer_order_id = 'a0000000-0000-0000-0000-000000000005' where id = 'b0000000-0000-0000-0000-000000000003';
update doc.supplier_order set customer_order_id = 'a0000000-0000-0000-0000-000000000003' where id = 'b0000000-0000-0000-0000-000000000004';

-- ============================================================
-- ФИЗИЧЕСКИЙ КОНТУР (process.html, стр. 2 «Складские зоны»): строки в зонах Z5/Z7.
-- Остальные стадии раскладываются по зонам в seed/demo-stages.sql (генератор seed/gen-stages.js).
-- ============================================================

-- Z5 «Неопознанные и возвраты» — возвраты клиента и поставщику
update arm.line set cell_id = '88888888-8888-8888-8888-888888888806'
 where onec_key in ('demo:return:1', 'demo:return_mgr:1', 'demo:return_int:1');

-- Z7 «Ремонтная зона» — запчасти по заказ-наряду ЗН-001
update arm.line set cell_id = '88888888-8888-8888-8888-888888888807'
 where onec_key in ('demo:repair:1', 'demo:repair:2', 'demo:repair:3');

-- ============================================================
-- СЦЕНАРИЙ 14: partial_order — частичное покрытие закупками («ЧастичноЗаказано»)
-- Продажа 4 шт: закупка 1 шт уже «Заказано», остальные 3 шт — черновик.
-- Статус продаже выставляет триггер arm.line_partial_ordered (миграция 0015): покрытие неполное →
-- «ЧастичноЗаказано», после заказа всех 4 шт → «Заказано».
-- ============================================================

insert into doc.customer_order (id, date, number, operation, posted, author_id, ship_date,
  counterparty_id, organization_id, responsible_id, amount_includes_vat, total, client_order_number) values
  ('a0000000-0000-0000-0000-000000000008', '2026-11-05 09:00:00', 'ЗК-008', 'Продажа', true,
   '00000000-0000-0000-0000-000000000002', '2026-11-07',
   '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000002', true, 8000.00, 'Заявка-013')
on conflict (id) do update set total = excluded.total, number = excluded.number, deleted = false, updated_at = now();

insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order, customer_order_id)
values
  (uuidv7(), 'lk:partial:1', 'Продажа', 'ВРаботе',
   '66666666-6666-6666-6666-666666666601', null, '77777777-7777-7777-7777-777777777701', 4, 0, 2000.00, 2400.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '4', 'А777АА777', 'Заявка-013', 'Частичное покрытие: заказана 1 шт из 4', '2026-11-05 09:00:00',
   '44444444-4444-4444-4444-444444444401', false, 'demo:partial:1', 1, 'a0000000-0000-0000-0000-000000000008')
on conflict (onec_key) do update set status = excluded.status, quantity = excluded.quantity,
  customer_order_id = excluded.customer_order_id, comment = excluded.comment, updated_at = now();

insert into arm.line (id, link_key, operation, status, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, client_order_number, comment, order_date, warehouse_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:partial:1', 'Закупка', 'Заказано',
   '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777701', 1, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '1', 'Заявка-013', 'Заказано 1 шт из 4 — продажа «Частично заказано»', '2026-11-05 10:00:00',
   '44444444-4444-4444-4444-444444444401', true, 'demo:partial:2', 2),
  (uuidv7(), 'lk:partial:1', 'Закупка', 'Черновик',
   '66666666-6666-6666-6666-666666666604', '77777777-7777-7777-7777-777777777701', 3, 1200.00, 1800.00, 2000.00, 1.0,
   'Масло моторное 5W-30 (5л)', 'MOT5W30-5L', '3', 'Заявка-013', 'Остаток 3 шт ещё не заказан', '2026-11-05 10:00:00',
   '44444444-4444-4444-4444-444444444401', false, 'demo:partial:3', 3)
on conflict (onec_key) do update set status = excluded.status, quantity = excluded.quantity, updated_at = now();

-- Договоры: продажа — договор покупателя, закупки — договор поставщика АвтооптТорг
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000003' where onec_key = 'demo:partial:1';
update arm.line set contract_id = 'ee000000-0000-0000-0000-000000000001' where onec_key in ('demo:partial:2', 'demo:partial:3');

-- ============================================================
-- ДОПОЛНИТЕЛЬНЫЕ СТАТУСЫ МАТРИЦЫ (15 статусов, решение 09.11.2026)
-- ВРаботе — строка без закупок (триггер partial_ordered_sync не переключит)
-- ОжидаемПоступление — статус из 1С (триггер его не затрагивает)
-- ============================================================

-- in_work: «ВРаботе» — менеджер начал обработку, закупок ещё нет
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:inwork:1', 'Продажа', 'ВРаботе',
   '66666666-6666-6666-6666-666666666603', null, '77777777-7777-7777-7777-777777777706', 2, 0, 900.00, 1350.00, 1.0,
   'Фильтр воздушный', 'FLT-AIR-001', '2', 'K789MH750', 'Заявка-014', 'Менеджер начал обработку, закупки не создавал', '2026-11-06 09:00:00',
   '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', false,
   'demo:inwork:1', 1)
on conflict (onec_key) do update set status = excluded.status, quantity = excluded.quantity,
  customer_order_id = excluded.customer_order_id, comment = excluded.comment, updated_at = now();

-- awaiting_receipt: «ОжидаемПоступление» — только из данных 1С, приложение не выставляет
-- Создаём строку напрямую (без триггеров — нет связанных закупок, link_key не совпадает)
insert into arm.line (id, link_key, operation, status, customer_id, supplier_id, nomenclature_id, quantity, cost_price, sale_price, rrc, coefficient,
  fact_name, fact_article, fact_qty, vehicle_plate, client_order_number, comment, order_date, warehouse_id, cell_id, manual_edit, onec_key, sort_order)
values
  (uuidv7(), 'lk:awaiting:1', 'Продажа', 'ОжидаемПоступление',
   '66666666-6666-6666-6666-666666666602', null, '77777777-7777-7777-7777-777777777707', 3, 0, 700.00, 1050.00, 1.0,
   'Фильтр салонный', 'FLT-CAB-001', '3', 'E456OP777', 'Заявка-015', 'Ожидается поступление от поставщика (данные 1С)', '2026-11-06 10:00:00',
   '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888803', false,
   'demo:awaiting:1', 1)
on conflict (onec_key) do update set status = excluded.status, quantity = excluded.quantity,
  customer_order_id = excluded.customer_order_id, comment = excluded.comment, updated_at = now();

-- Свободный остаток для FIFO-резерва (ТЗ п. 11 «Частичный резерв и дозаказ»):
-- приходные движения по партиям, которые уже проставлены в строках «НаСкладе».
-- Без них availableStock (stock.move) пуст и «Резервировать доступное» всегда уходит в дозаказ.
insert into stock.move (id, period, recorder_type, recorder_id, line_no, active, movement, warehouse_id,
    nomenclature_id, batch_id, qty, amount, content, onec_key)
select uuidv7(), date_trunc('day', now()) - interval '5 days', 'seed_stock', l.id, 0, true, 0,
       '44444444-4444-4444-4444-444444444401', l.nomenclature_id, l.batch_id,
       l.quantity, coalesce(l.cost_sum, 0), 'Демо-остаток для резерва (п. 11)', 'demo:stock:' || l.id
from arm.line l
where l.batch_id is not null and l.status = 'НаСкладе' and not coalesce(l.deleted, false)
on conflict (onec_key) do update set qty = excluded.qty, amount = excluded.amount, active = true, deleted = false;
