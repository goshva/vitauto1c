-- ВИТРИНА: по строке на каждый этап каждого процесса + необходимые документы.
--
-- Сгенерировано scripts/gen-showcase-seed.ts из db/process-map.json.
-- Строк: 61 (уникальные пары «процесс × состояние» из 11 процессов,
-- 121 шагов).
--
-- Запуск ОТДЕЛЬНО: bun run db:seed --showcase
-- В --all не входит намеренно: 63 строки и десятки документов сделали бы
-- состояние e2e непредсказуемым.

-- Чистим только своё: префиксы d0/e0/f1..f4 — витринные.
delete from line_mark where id in (select id from line where internal_order_number like 'ВИТ-%');
delete from line_fact where id in (select id from line where internal_order_number like 'ВИТ-%');
delete from stock_move where line_id in (select id from line where internal_order_number like 'ВИТ-%');
delete from line where internal_order_number like 'ВИТ-%';
delete from shipment where number like 'ВИТ-%';
delete from receipt where number like 'ВИТ-%';
delete from supplier_order where number like 'ВИТ-%';
delete from return_order where number like 'ВИТ-%';
delete from customer_order where number like 'ВИТ-%';

-- happy/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000000000', 'ВИТ-HAPPY-01', current_date, 'sale', 'ВИТ-HAPPY-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000000000', 'ВИТ-HAPPY-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000000000', false, null)
on conflict (id) do update set marked = false;

-- happy/ordered (шаги 4, 5)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000010000', 'ВИТ-HAPPY-02', current_date, 'sale', 'ВИТ-HAPPY-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000010000', 'e0000000-0000-0000-0000-000000010000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000010000', 'ВИТ-HAPPY-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000010000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000010000', 'ВИТ-HAPPY-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- happy/paid (шаги 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000020000', 'ВИТ-HAPPY-03', current_date, 'sale', 'ВИТ-HAPPY-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000020000', 'e0000000-0000-0000-0000-000000020000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000020000', 'ВИТ-HAPPY-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000020000', 'ВИТ-HAPPY-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000020000', 'ВИТ-HAPPY-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- happy/in_transit (шаги 7)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000030000', 'ВИТ-HAPPY-04', current_date, 'sale', 'ВИТ-HAPPY-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000030000', 'e0000000-0000-0000-0000-000000030000', 'sale', 'in_transit', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000030000', 'ВИТ-HAPPY-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000030000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000030000', 'ВИТ-HAPPY-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000030000', 'ВИТ-HAPPY-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- happy/acceptance (шаги 8, 9, 10)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000040000', 'ВИТ-HAPPY-05', current_date, 'sale', 'ВИТ-HAPPY-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000040000', 'e0000000-0000-0000-0000-000000040000', 'sale', 'acceptance', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000040000', 'ВИТ-HAPPY-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000040000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777708', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', 'receipt', 5, 'd0000000-0000-0000-0000-000000040000', 'Витрина: happy/acceptance');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000040000', 'ВИТ-HAPPY-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000040000', 'ВИТ-HAPPY-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- happy/assembly (шаги 11, 12)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000050000', 'ВИТ-HAPPY-06', current_date, 'sale', 'ВИТ-HAPPY-06', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000050000', 'e0000000-0000-0000-0000-000000050000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-06');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000050000', 'ВИТ-HAPPY-06', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000050000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000000050000', 'Витрина: happy/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000000050000', 'Витрина: резерв happy/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000050000', 'ВИТ-HAPPY-06', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000050000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000050000', 'ВИТ-HAPPY-06', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- happy/ready_to_ship (шаги 13, 14)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000060000', 'ВИТ-HAPPY-07', current_date, 'sale', 'ВИТ-HAPPY-07', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000060000', 'e0000000-0000-0000-0000-000000060000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-07');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000060000', 'ВИТ-HAPPY-07', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000060000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000000060000', 'Витрина: happy/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000060000', 'ВИТ-HAPPY-07', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000060000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000060000', 'ВИТ-HAPPY-07', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- happy/shipped (шаги 15, 16)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000070000', 'ВИТ-HAPPY-08', current_date, 'sale', 'ВИТ-HAPPY-08', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000070000', 'e0000000-0000-0000-0000-000000070000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-08');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000070000', 'ВИТ-HAPPY-08', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000070000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000070000', 'ВИТ-HAPPY-08', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000070000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000070000', 'ВИТ-HAPPY-08', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000000070000', 'ВИТ-HAPPY-08', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000000070000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- happy/closed (шаги 17)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000000080000', 'ВИТ-HAPPY-09', current_date, 'sale', 'ВИТ-HAPPY-09', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000000080000', 'e0000000-0000-0000-0000-000000080000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-HAPPY-09');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000000080000', 'ВИТ-HAPPY-09', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000000080000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000000080000', 'ВИТ-HAPPY-09', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000000080000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000000080000', 'ВИТ-HAPPY-09', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000000080000', 'ВИТ-HAPPY-09', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000000080000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- stock/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001000000', 'ВИТ-STOCK-01', current_date, 'sale', 'ВИТ-STOCK-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001000000', 'e0000000-0000-0000-0000-000001000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001000000', 'ВИТ-STOCK-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001000000', false, null)
on conflict (id) do update set marked = false;

-- stock/reserve (шаги 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001010000', 'ВИТ-STOCK-02', current_date, 'sale', 'ВИТ-STOCK-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001010000', 'e0000000-0000-0000-0000-000001010000', 'sale', 'reserve', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001010000', 'ВИТ-STOCK-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001010000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000001010000', 'Витрина: stock/reserve');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000001010000', 'Витрина: резерв stock/reserve');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000001010000', 'ВИТ-STOCK-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000001010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000001010000', 'ВИТ-STOCK-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- stock/assembly (шаги 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001020000', 'ВИТ-STOCK-03', current_date, 'sale', 'ВИТ-STOCK-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001020000', 'e0000000-0000-0000-0000-000001020000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001020000', 'ВИТ-STOCK-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001020000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000001020000', 'Витрина: stock/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000001020000', 'Витрина: резерв stock/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000001020000', 'ВИТ-STOCK-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000001020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000001020000', 'ВИТ-STOCK-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- stock/ready_to_ship (шаги 7, 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001030000', 'ВИТ-STOCK-04', current_date, 'sale', 'ВИТ-STOCK-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001030000', 'e0000000-0000-0000-0000-000001030000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001030000', 'ВИТ-STOCK-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001030000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777707', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000001030000', 'Витрина: stock/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000001030000', 'ВИТ-STOCK-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000001030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000001030000', 'ВИТ-STOCK-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- stock/shipped (шаги 9, 10)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001040000', 'ВИТ-STOCK-05', current_date, 'sale', 'ВИТ-STOCK-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001040000', 'e0000000-0000-0000-0000-000001040000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001040000', 'ВИТ-STOCK-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001040000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000001040000', 'ВИТ-STOCK-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000001040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000001040000', 'ВИТ-STOCK-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000001040000', 'ВИТ-STOCK-05', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000001040000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- stock/closed (шаги 11)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000001050000', 'ВИТ-STOCK-06', current_date, 'sale', 'ВИТ-STOCK-06', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000001050000', 'e0000000-0000-0000-0000-000001050000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-STOCK-06');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000001050000', 'ВИТ-STOCK-06', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000001050000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000001050000', 'ВИТ-STOCK-06', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000001050000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000001050000', 'ВИТ-STOCK-06', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000001050000', 'ВИТ-STOCK-06', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000001050000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- mixed_order/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002000000', 'ВИТ-MIXED_OR-01', current_date, 'sale', 'ВИТ-MIXED_OR-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002000000', 'e0000000-0000-0000-0000-000002000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002000000', 'ВИТ-MIXED_OR-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002000000', false, null)
on conflict (id) do update set marked = false;

-- mixed_order/reserve (шаги 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002010000', 'ВИТ-MIXED_OR-02', current_date, 'sale', 'ВИТ-MIXED_OR-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002010000', 'e0000000-0000-0000-0000-000002010000', 'sale', 'reserve', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002010000', 'ВИТ-MIXED_OR-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002010000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000002010000', 'Витрина: mixed_order/reserve');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000002010000', 'Витрина: резерв mixed_order/reserve');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002010000', 'ВИТ-MIXED_OR-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002010000', 'ВИТ-MIXED_OR-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- mixed_order/ordered (шаги 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002020000', 'ВИТ-MIXED_OR-03', current_date, 'sale', 'ВИТ-MIXED_OR-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002020000', 'e0000000-0000-0000-0000-000002020000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002020000', 'ВИТ-MIXED_OR-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002020000', 'ВИТ-MIXED_OR-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- mixed_order/paid (шаги 7)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002030000', 'ВИТ-MIXED_OR-04', current_date, 'sale', 'ВИТ-MIXED_OR-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002030000', 'e0000000-0000-0000-0000-000002030000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002030000', 'ВИТ-MIXED_OR-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002030000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002030000', 'ВИТ-MIXED_OR-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002030000', 'ВИТ-MIXED_OR-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- mixed_order/in_transit (шаги 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002040000', 'ВИТ-MIXED_OR-05', current_date, 'sale', 'ВИТ-MIXED_OR-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002040000', 'e0000000-0000-0000-0000-000002040000', 'sale', 'in_transit', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002040000', 'ВИТ-MIXED_OR-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002040000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002040000', 'ВИТ-MIXED_OR-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002040000', 'ВИТ-MIXED_OR-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- mixed_order/acceptance (шаги 9, 10, 11)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002050000', 'ВИТ-MIXED_OR-06', current_date, 'sale', 'ВИТ-MIXED_OR-06', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002050000', 'e0000000-0000-0000-0000-000002050000', 'sale', 'acceptance', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-06');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002050000', 'ВИТ-MIXED_OR-06', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002050000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', 'receipt', 5, 'd0000000-0000-0000-0000-000002050000', 'Витрина: mixed_order/acceptance');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002050000', 'ВИТ-MIXED_OR-06', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002050000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002050000', 'ВИТ-MIXED_OR-06', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- mixed_order/assembly (шаги 12, 13)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002060000', 'ВИТ-MIXED_OR-07', current_date, 'sale', 'ВИТ-MIXED_OR-07', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002060000', 'e0000000-0000-0000-0000-000002060000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-07');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002060000', 'ВИТ-MIXED_OR-07', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002060000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000002060000', 'Витрина: mixed_order/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000002060000', 'Витрина: резерв mixed_order/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002060000', 'ВИТ-MIXED_OR-07', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002060000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002060000', 'ВИТ-MIXED_OR-07', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- mixed_order/ready_to_ship (шаги 14, 15)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002070000', 'ВИТ-MIXED_OR-08', current_date, 'sale', 'ВИТ-MIXED_OR-08', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002070000', 'e0000000-0000-0000-0000-000002070000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-08');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002070000', 'ВИТ-MIXED_OR-08', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002070000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000002070000', 'Витрина: mixed_order/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002070000', 'ВИТ-MIXED_OR-08', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002070000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002070000', 'ВИТ-MIXED_OR-08', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- mixed_order/shipped (шаги 16, 17)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002080000', 'ВИТ-MIXED_OR-09', current_date, 'sale', 'ВИТ-MIXED_OR-09', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002080000', 'e0000000-0000-0000-0000-000002080000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-09');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002080000', 'ВИТ-MIXED_OR-09', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002080000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002080000', 'ВИТ-MIXED_OR-09', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002080000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002080000', 'ВИТ-MIXED_OR-09', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000002080000', 'ВИТ-MIXED_OR-09', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000002080000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- mixed_order/closed (шаги 18)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000002090000', 'ВИТ-MIXED_OR-10', current_date, 'sale', 'ВИТ-MIXED_OR-10', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000002090000', 'e0000000-0000-0000-0000-000002090000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-MIXED_OR-10');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000002090000', 'ВИТ-MIXED_OR-10', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000002090000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000002090000', 'ВИТ-MIXED_OR-10', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000002090000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000002090000', 'ВИТ-MIXED_OR-10', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000002090000', 'ВИТ-MIXED_OR-10', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000002090000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- delivery_split/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003000000', 'ВИТ-DELIVERY-01', current_date, 'sale', 'ВИТ-DELIVERY-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003000000', 'e0000000-0000-0000-0000-000003000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003000000', 'ВИТ-DELIVERY-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003000000', false, null)
on conflict (id) do update set marked = false;

-- delivery_split/ordered (шаги 4, 5)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003010000', 'ВИТ-DELIVERY-02', current_date, 'sale', 'ВИТ-DELIVERY-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003010000', 'e0000000-0000-0000-0000-000003010000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003010000', 'ВИТ-DELIVERY-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003010000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003010000', 'ВИТ-DELIVERY-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- delivery_split/paid (шаги 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003020000', 'ВИТ-DELIVERY-03', current_date, 'sale', 'ВИТ-DELIVERY-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003020000', 'e0000000-0000-0000-0000-000003020000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003020000', 'ВИТ-DELIVERY-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003020000', 'ВИТ-DELIVERY-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003020000', 'ВИТ-DELIVERY-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- delivery_split/shipped (шаги 7, 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003030000', 'ВИТ-DELIVERY-04', current_date, 'sale', 'ВИТ-DELIVERY-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003030000', 'e0000000-0000-0000-0000-000003030000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003030000', 'ВИТ-DELIVERY-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003030000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003030000', 'ВИТ-DELIVERY-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003030000', 'ВИТ-DELIVERY-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000003030000', 'ВИТ-DELIVERY-04', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000003030000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- delivery_split/acceptance (шаги 9, 10, 11)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003040000', 'ВИТ-DELIVERY-05', current_date, 'sale', 'ВИТ-DELIVERY-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003040000', 'e0000000-0000-0000-0000-000003040000', 'sale', 'acceptance', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003040000', 'ВИТ-DELIVERY-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003040000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777708', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', 'receipt', 5, 'd0000000-0000-0000-0000-000003040000', 'Витрина: delivery_split/acceptance');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003040000', 'ВИТ-DELIVERY-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003040000', 'ВИТ-DELIVERY-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- delivery_split/assembly (шаги 12, 13)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003050000', 'ВИТ-DELIVERY-06', current_date, 'sale', 'ВИТ-DELIVERY-06', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003050000', 'e0000000-0000-0000-0000-000003050000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-06');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003050000', 'ВИТ-DELIVERY-06', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003050000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000003050000', 'Витрина: delivery_split/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000003050000', 'Витрина: резерв delivery_split/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003050000', 'ВИТ-DELIVERY-06', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003050000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003050000', 'ВИТ-DELIVERY-06', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- delivery_split/ready_to_ship (шаги 14, 15)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003060000', 'ВИТ-DELIVERY-07', current_date, 'sale', 'ВИТ-DELIVERY-07', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003060000', 'e0000000-0000-0000-0000-000003060000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-07');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003060000', 'ВИТ-DELIVERY-07', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003060000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000003060000', 'Витрина: delivery_split/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003060000', 'ВИТ-DELIVERY-07', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003060000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003060000', 'ВИТ-DELIVERY-07', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- delivery_split/closed (шаги 16)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000003070000', 'ВИТ-DELIVERY-08', current_date, 'sale', 'ВИТ-DELIVERY-08', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000003070000', 'e0000000-0000-0000-0000-000003070000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DELIVERY-08');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000003070000', 'ВИТ-DELIVERY-08', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000003070000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000003070000', 'ВИТ-DELIVERY-08', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000003070000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000003070000', 'ВИТ-DELIVERY-08', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000003070000', 'ВИТ-DELIVERY-08', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000003070000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- virtual_buy/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000004000000', 'ВИТ-VIRTUAL_-01', current_date, 'sale', 'ВИТ-VIRTUAL_-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000004000000', 'e0000000-0000-0000-0000-000004000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-VIRTUAL_-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000004000000', 'ВИТ-VIRTUAL_-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000004000000', false, null)
on conflict (id) do update set marked = false;

-- virtual_buy/ordered (шаги 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000004010000', 'ВИТ-VIRTUAL_-02', current_date, 'sale', 'ВИТ-VIRTUAL_-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000004010000', 'e0000000-0000-0000-0000-000004010000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-VIRTUAL_-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000004010000', 'ВИТ-VIRTUAL_-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000004010000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000004010000', 'ВИТ-VIRTUAL_-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000004010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- virtual_buy/paid (шаги 5)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000004020000', 'ВИТ-VIRTUAL_-03', current_date, 'sale', 'ВИТ-VIRTUAL_-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000004020000', 'e0000000-0000-0000-0000-000004020000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-VIRTUAL_-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000004020000', 'ВИТ-VIRTUAL_-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000004020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000004020000', 'ВИТ-VIRTUAL_-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000004020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000004020000', 'ВИТ-VIRTUAL_-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- defect/assembly (шаги 1, 2, 3, 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000005000000', 'ВИТ-DEFECT-01', current_date, 'sale', 'ВИТ-DEFECT-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000005000000', 'e0000000-0000-0000-0000-000005000000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DEFECT-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000005000000', 'ВИТ-DEFECT-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000005000000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000005000000', 'Витрина: defect/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000005000000', 'Витрина: резерв defect/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000005000000', 'ВИТ-DEFECT-01', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000005000000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000005000000', 'ВИТ-DEFECT-01', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- defect/ready_to_ship (шаги 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000005010000', 'ВИТ-DEFECT-02', current_date, 'sale', 'ВИТ-DEFECT-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000005010000', 'e0000000-0000-0000-0000-000005010000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DEFECT-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000005010000', 'ВИТ-DEFECT-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000005010000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000005010000', 'Витрина: defect/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000005010000', 'ВИТ-DEFECT-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000005010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000005010000', 'ВИТ-DEFECT-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- defect/shipped (шаги 7, 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000005020000', 'ВИТ-DEFECT-03', current_date, 'sale', 'ВИТ-DEFECT-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000005020000', 'e0000000-0000-0000-0000-000005020000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DEFECT-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000005020000', 'ВИТ-DEFECT-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000005020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000005020000', 'ВИТ-DEFECT-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000005020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000005020000', 'ВИТ-DEFECT-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000005020000', 'ВИТ-DEFECT-03', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000005020000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- defect/closed (шаги 9)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000005030000', 'ВИТ-DEFECT-04', current_date, 'sale', 'ВИТ-DEFECT-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000005030000', 'e0000000-0000-0000-0000-000005030000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-DEFECT-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000005030000', 'ВИТ-DEFECT-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000005030000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000005030000', 'ВИТ-DEFECT-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000005030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000005030000', 'ВИТ-DEFECT-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000005030000', 'ВИТ-DEFECT-04', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000005030000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- cancel_supplier/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000006000000', 'ВИТ-CANCEL_S-01', current_date, 'sale', 'ВИТ-CANCEL_S-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000006000000', 'e0000000-0000-0000-0000-000006000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CANCEL_S-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000006000000', 'ВИТ-CANCEL_S-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000006000000', false, null)
on conflict (id) do update set marked = false;

-- cancel_supplier/ordered (шаги 4, 5)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000006010000', 'ВИТ-CANCEL_S-02', current_date, 'sale', 'ВИТ-CANCEL_S-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000006010000', 'e0000000-0000-0000-0000-000006010000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CANCEL_S-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000006010000', 'ВИТ-CANCEL_S-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000006010000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000006010000', 'ВИТ-CANCEL_S-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000006010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- cancel_supplier/paid (шаги 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000006020000', 'ВИТ-CANCEL_S-03', current_date, 'sale', 'ВИТ-CANCEL_S-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000006020000', 'e0000000-0000-0000-0000-000006020000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CANCEL_S-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000006020000', 'ВИТ-CANCEL_S-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000006020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000006020000', 'ВИТ-CANCEL_S-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000006020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000006020000', 'ВИТ-CANCEL_S-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- cancel_supplier/return (шаги 7, 8, 9)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000006030000', 'ВИТ-CANCEL_S-04', current_date, 'sale', 'ВИТ-CANCEL_S-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000006030000', 'e0000000-0000-0000-0000-000006030000', 'sale', 'return', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', '99999999-9999-9999-9999-999999999905', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CANCEL_S-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000006030000', 'ВИТ-CANCEL_S-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000006030000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777707', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', 'receipt', 5, 'd0000000-0000-0000-0000-000006030000', 'Витрина: cancel_supplier/return');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000006030000', 'ВИТ-CANCEL_S-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000006030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000006030000', 'ВИТ-CANCEL_S-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into return_order (id, number, date, kind, status, operation, counterparty_id, warehouse_id)
values ('f4000000-0000-0000-0000-000006030000', 'ВИТ-CANCEL_S-04', current_date, 'client', 'new', 'sale', '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401');

-- return/return (шаги 1, 2, 3, 4, 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000007000000', 'ВИТ-RETURN-01', current_date, 'sale', 'ВИТ-RETURN-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000007000000', 'e0000000-0000-0000-0000-000007000000', 'sale', 'return', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', '99999999-9999-9999-9999-999999999905', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000007000000', 'ВИТ-RETURN-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000007000000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', 'receipt', 5, 'd0000000-0000-0000-0000-000007000000', 'Витрина: return/return');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000007000000', 'ВИТ-RETURN-01', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000007000000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000007000000', 'ВИТ-RETURN-01', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into return_order (id, number, date, kind, status, operation, counterparty_id, warehouse_id)
values ('f4000000-0000-0000-0000-000007000000', 'ВИТ-RETURN-01', current_date, 'client', 'new', 'sale', '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401');

-- return_mgr/return (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000008000000', 'ВИТ-RETURN_M-01', current_date, 'sale', 'ВИТ-RETURN_M-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000008000000', 'e0000000-0000-0000-0000-000008000000', 'sale', 'return', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', '99999999-9999-9999-9999-999999999905', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_M-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000008000000', 'ВИТ-RETURN_M-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000008000000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', 'receipt', 5, 'd0000000-0000-0000-0000-000008000000', 'Витрина: return_mgr/return');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000008000000', 'ВИТ-RETURN_M-01', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000008000000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000008000000', 'ВИТ-RETURN_M-01', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into return_order (id, number, date, kind, status, operation, counterparty_id, warehouse_id)
values ('f4000000-0000-0000-0000-000008000000', 'ВИТ-RETURN_M-01', current_date, 'client', 'new', 'sale', '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401');

-- return_mgr/closed (шаги 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000008010000', 'ВИТ-RETURN_M-02', current_date, 'sale', 'ВИТ-RETURN_M-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000008010000', 'e0000000-0000-0000-0000-000008010000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_M-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000008010000', 'ВИТ-RETURN_M-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000008010000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000008010000', 'ВИТ-RETURN_M-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000008010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000008010000', 'ВИТ-RETURN_M-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000008010000', 'ВИТ-RETURN_M-02', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000008010000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- return_internal/shipped (шаги 1)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000009000000', 'ВИТ-RETURN_I-01', current_date, 'sale', 'ВИТ-RETURN_I-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000009000000', 'e0000000-0000-0000-0000-000009000000', 'sale', 'shipped', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_I-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000009000000', 'ВИТ-RETURN_I-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000009000000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000009000000', 'ВИТ-RETURN_I-01', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000009000000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000009000000', 'ВИТ-RETURN_I-01', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000009000000', 'ВИТ-RETURN_I-01', current_date, 'shipped', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000009000000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- return_internal/return (шаги 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000009010000', 'ВИТ-RETURN_I-02', current_date, 'sale', 'ВИТ-RETURN_I-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000009010000', 'e0000000-0000-0000-0000-000009010000', 'sale', 'return', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', '99999999-9999-9999-9999-999999999905', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_I-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000009010000', 'ВИТ-RETURN_I-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000009010000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888806', 'receipt', 5, 'd0000000-0000-0000-0000-000009010000', 'Витрина: return_internal/return');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000009010000', 'ВИТ-RETURN_I-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000009010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000009010000', 'ВИТ-RETURN_I-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into return_order (id, number, date, kind, status, operation, counterparty_id, warehouse_id)
values ('f4000000-0000-0000-0000-000009010000', 'ВИТ-RETURN_I-02', current_date, 'client', 'new', 'sale', '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401');

-- return_internal/assembly (шаги 4, 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000009020000', 'ВИТ-RETURN_I-03', current_date, 'sale', 'ВИТ-RETURN_I-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000009020000', 'e0000000-0000-0000-0000-000009020000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_I-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000009020000', 'ВИТ-RETURN_I-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000009020000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-000009020000', 'Витрина: return_internal/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-000009020000', 'Витрина: резерв return_internal/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000009020000', 'ВИТ-RETURN_I-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000009020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000009020000', 'ВИТ-RETURN_I-03', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- return_internal/ready_to_ship (шаги 7, 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000009030000', 'ВИТ-RETURN_I-04', current_date, 'sale', 'ВИТ-RETURN_I-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000009030000', 'e0000000-0000-0000-0000-000009030000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_I-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000009030000', 'ВИТ-RETURN_I-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000009030000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777707', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-000009030000', 'Витрина: return_internal/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000009030000', 'ВИТ-RETURN_I-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000009030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000009030000', 'ВИТ-RETURN_I-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- return_internal/closed (шаги 9)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-000009040000', 'ВИТ-RETURN_I-05', current_date, 'sale', 'ВИТ-RETURN_I-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-000009040000', 'e0000000-0000-0000-0000-000009040000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-RETURN_I-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-000009040000', 'ВИТ-RETURN_I-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-000009040000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-000009040000', 'ВИТ-RETURN_I-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-000009040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-000009040000', 'ВИТ-RETURN_I-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-000009040000', 'ВИТ-RETURN_I-05', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-000009040000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

-- car_repair_in/new (шаги 1, 2, 3)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A000000', 'ВИТ-CAR_REPA-01', current_date, 'sale', 'ВИТ-CAR_REPA-01', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A000000', 'e0000000-0000-0000-0000-00000A000000', 'sale', 'new', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-01');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A000000', 'ВИТ-CAR_REPA-01', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A000000', false, null)
on conflict (id) do update set marked = false;

-- car_repair_in/reserve (шаги 4)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A010000', 'ВИТ-CAR_REPA-02', current_date, 'sale', 'ВИТ-CAR_REPA-02', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A010000', 'e0000000-0000-0000-0000-00000A010000', 'sale', 'reserve', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-02');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A010000', 'ВИТ-CAR_REPA-02', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A010000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-00000A010000', 'Витрина: car_repair_in/reserve');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-00000A010000', 'Витрина: резерв car_repair_in/reserve');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A010000', 'ВИТ-CAR_REPA-02', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A010000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A010000', 'ВИТ-CAR_REPA-02', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- car_repair_in/ordered (шаги 5, 6)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A020000', 'ВИТ-CAR_REPA-03', current_date, 'sale', 'ВИТ-CAR_REPA-03', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A020000', 'e0000000-0000-0000-0000-00000A020000', 'sale', 'ordered', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-03');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A020000', 'ВИТ-CAR_REPA-03', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A020000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A020000', 'ВИТ-CAR_REPA-03', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A020000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);

-- car_repair_in/paid (шаги 7)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A030000', 'ВИТ-CAR_REPA-04', current_date, 'sale', 'ВИТ-CAR_REPA-04', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A030000', 'e0000000-0000-0000-0000-00000A030000', 'sale', 'paid', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-04');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A030000', 'ВИТ-CAR_REPA-04', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A030000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A030000', 'ВИТ-CAR_REPA-04', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A030000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A030000', 'ВИТ-CAR_REPA-04', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- car_repair_in/in_transit (шаги 8)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A040000', 'ВИТ-CAR_REPA-05', current_date, 'sale', 'ВИТ-CAR_REPA-05', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A040000', 'e0000000-0000-0000-0000-00000A040000', 'sale', 'in_transit', 1, '77777777-7777-7777-7777-777777777708', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-05');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A040000', 'ВИТ-CAR_REPA-05', 'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A040000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A040000', 'ВИТ-CAR_REPA-05', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A040000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A040000', 'ВИТ-CAR_REPA-05', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- car_repair_in/acceptance (шаги 9, 10, 11)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A050000', 'ВИТ-CAR_REPA-06', current_date, 'sale', 'ВИТ-CAR_REPA-06', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A050000', 'e0000000-0000-0000-0000-00000A050000', 'sale', 'acceptance', 1, '77777777-7777-7777-7777-777777777701', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-06');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A050000', 'ВИТ-CAR_REPA-06', 'Масло моторное 5W-30 (5л)', '1', 'MOT5W30-5L', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A050000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888801', 'receipt', 5, 'd0000000-0000-0000-0000-00000A050000', 'Витрина: car_repair_in/acceptance');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A050000', 'ВИТ-CAR_REPA-06', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A050000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A050000', 'ВИТ-CAR_REPA-06', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', false);

-- car_repair_in/assembly (шаги 12, 13, 15)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A060000', 'ВИТ-CAR_REPA-07', current_date, 'sale', 'ВИТ-CAR_REPA-07', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A060000', 'e0000000-0000-0000-0000-00000A060000', 'sale', 'assembly', 1, '77777777-7777-7777-7777-777777777702', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', '99999999-9999-9999-9999-999999999908', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-07');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A060000', 'ВИТ-CAR_REPA-07', 'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A060000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'receipt', 5, 'd0000000-0000-0000-0000-00000A060000', 'Витрина: car_repair_in/assembly');
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777702', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888809', 'reserve', 1, 'd0000000-0000-0000-0000-00000A060000', 'Витрина: резерв car_repair_in/assembly');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A060000', 'ВИТ-CAR_REPA-07', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A060000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A060000', 'ВИТ-CAR_REPA-07', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- car_repair_in/ready_to_ship (шаги 14)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A070000', 'ВИТ-CAR_REPA-08', current_date, 'sale', 'ВИТ-CAR_REPA-08', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A070000', 'e0000000-0000-0000-0000-00000A070000', 'sale', 'ready_to_ship', 1, '77777777-7777-7777-7777-777777777703', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', '99999999-9999-9999-9999-999999999907', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-08');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A070000', 'ВИТ-CAR_REPA-08', 'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A070000', false, null)
on conflict (id) do update set marked = false;
insert into stock_move (nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('77777777-7777-7777-7777-777777777703', '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888808', 'receipt', 5, 'd0000000-0000-0000-0000-00000A070000', 'Витрина: car_repair_in/ready_to_ship');
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A070000', 'ВИТ-CAR_REPA-08', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A070000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A070000', 'ВИТ-CAR_REPA-08', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);

-- car_repair_in/closed (шаги 17)
insert into customer_order (id, number, date, operation, client_order_number, counterparty_id, contract_id, organization_id, ship_date, total)
values ('e0000000-0000-0000-0000-00000A080000', 'ВИТ-CAR_REPA-09', current_date, 'sale', 'ВИТ-CAR_REPA-09', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555501', current_date + 7, 1200);

insert into line (id, customer_order_id, operation, status, quantity, nomenclature_id, customer_id, contract_id,
                  order_date, warehouse_id, cell_id, zone_id, supplier_id, batch_id, internal_order_number)
values ('d0000000-0000-0000-0000-00000A080000', 'e0000000-0000-0000-0000-00000A080000', 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777707', '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        current_date, '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888810', '99999999-9999-9999-9999-999999999909', '66666666-6666-6666-6666-666666666604', 'dd000000-0000-0000-0000-000000000001', 'ВИТ-CAR_REPA-09');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('d0000000-0000-0000-0000-00000A080000', 'ВИТ-CAR_REPA-09', 'Фильтр салонный', '1', 'FLT-CAB-001', 'шт', 'А123ВС777');
insert into line_mark (id, marked, marked_by_id) values ('d0000000-0000-0000-0000-00000A080000', false, null)
on conflict (id) do update set marked = false;
insert into supplier_order (id, number, date, status, operation, counterparty_id, customer_order_id, organization_id, receipt_date, total)
values ('f3000000-0000-0000-0000-00000A080000', 'ВИТ-CAR_REPA-09', current_date, 'confirmed', 'purchase', '66666666-6666-6666-6666-666666666604', 'e0000000-0000-0000-0000-00000A080000', '55555555-5555-5555-5555-555555555501', current_date + 3, 900);
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted)
values ('f1000000-0000-0000-0000-00000A080000', 'ВИТ-CAR_REPA-09', current_date, 'purchase', '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true);
insert into shipment (id, number, date, status, operation, counterparty_id, customer_order_id, warehouse_id, zone_id, car_id)
values ('f2000000-0000-0000-0000-00000A080000', 'ВИТ-CAR_REPA-09', current_date, 'closed', 'sale', '66666666-6666-6666-6666-666666666601', 'e0000000-0000-0000-0000-00000A080000', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'cccccccc-cccc-cccc-cccc-cccccccccc01');

