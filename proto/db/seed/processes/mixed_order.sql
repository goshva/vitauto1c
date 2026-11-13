-- Процесс mixed_order: Смешанный заказ (склад + закупка)
-- Начальное состояние: статус «new», строк 2, остаток 10.
-- две строки: первая закрывается со склада (M3), вторая уходит в закупку (M4)
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

delete from line_mark where id = 'b0000000-0000-0000-0000-000000000301';
delete from line_fact where id = 'b0000000-0000-0000-0000-000000000301';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-000000000301';
delete from line where id = 'b0000000-0000-0000-0000-000000000301';
delete from line_mark where id = 'b0000000-0000-0000-0000-000000000302';
delete from line_fact where id = 'b0000000-0000-0000-0000-000000000302';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-000000000302';
delete from line where id = 'b0000000-0000-0000-0000-000000000302';
delete from customer_order where id = 'a0000000-0000-0000-0000-00000000f003';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('a0000000-0000-0000-0000-00000000f003', 'TEST-MIXED_ORDER-001', '2026-11-13', 'sale', 'ЗК-MIXED_ORDER-1',
        '66666666-6666-6666-6666-666666666601',
        'ee000000-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555501',
        '2026-11-20', 2400);

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number,
                  warehouse_id, cell_id)
values ('b0000000-0000-0000-0000-000000000301',
        'a0000000-0000-0000-0000-00000000f003', 'sale', 'new', 1,
        '77777777-7777-7777-7777-777777777703',
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-MIXED_ORDER-1',
        '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-000000000301', 'ЗК-MIXED_ORDER-1',
        'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-000000000301', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;

insert into stock_move (id, nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('c0000000-0000-0000-0000-000000000301',
        '77777777-7777-7777-7777-777777777703',
        '44444444-4444-4444-4444-444444444401',
        '88888888-8888-8888-8888-888888888802',
        'receipt', 10,
        'b0000000-0000-0000-0000-000000000301',
        'Начальный остаток сида mixed_order');

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number)
values ('b0000000-0000-0000-0000-000000000302',
        'a0000000-0000-0000-0000-00000000f003', 'sale', 'new', 2,
        null,
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-MIXED_ORDER-2');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-000000000302', 'ЗК-MIXED_ORDER-2',
        'Колодки тормозные передние', '2', 'BRK-FR-001', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-000000000302', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;
