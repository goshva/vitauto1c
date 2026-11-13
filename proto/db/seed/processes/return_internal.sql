-- Процесс return_internal: Отказ клиента при получении товара
-- Начальное состояние: статус «ready_to_ship», строк 1, остаток 3.
-- товар собран и ждёт клиента (N2a), клиент отказывается при получении
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

delete from line_mark where id = 'b0000000-0000-0000-0000-00000000000a';
delete from line_fact where id = 'b0000000-0000-0000-0000-00000000000a';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-00000000000a';
delete from line where id = 'b0000000-0000-0000-0000-00000000000a';
delete from customer_order where id = 'a0000000-0000-0000-0000-00000000f00a';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('a0000000-0000-0000-0000-00000000f00a', 'TEST-RETURN_INTERNAL-001', '2026-11-13', 'sale', 'ЗК-RETURN_INTERNAL-1',
        '66666666-6666-6666-6666-666666666601',
        'ee000000-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555501',
        '2026-11-20', 1200);

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number,
                  warehouse_id, cell_id)
values ('b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000f00a', 'sale', 'ready_to_ship', 1,
        '77777777-7777-7777-7777-777777777703',
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-RETURN_INTERNAL-1',
        '44444444-4444-4444-4444-444444444401', '88888888-8888-8888-8888-888888888802');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-00000000000a', 'ЗК-RETURN_INTERNAL-1',
        'Колодки тормозные передние', '1', 'BRK-FR-001', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-00000000000a', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;

insert into stock_move (id, nomenclature_id, warehouse_id, cell_id, kind, quantity, line_id, comment)
values ('c0000000-0000-0000-0000-00000000000a',
        '77777777-7777-7777-7777-777777777703',
        '44444444-4444-4444-4444-444444444401',
        '88888888-8888-8888-8888-888888888802',
        'receipt', 3,
        'b0000000-0000-0000-0000-00000000000a',
        'Начальный остаток сида return_internal');
