-- Процесс delivery_split: Самовывоз у внешнего поставщика клиентом
-- Начальное состояние: статус «new», строк 1, остаток 0.
-- остатка нет; товар забирает клиент, поэтому ячейка склада не участвует
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

delete from line_mark where id = 'b0000000-0000-0000-0000-000000000004';
delete from line_fact where id = 'b0000000-0000-0000-0000-000000000004';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-000000000004';
delete from line where id = 'b0000000-0000-0000-0000-000000000004';
delete from customer_order where id = 'a0000000-0000-0000-0000-00000000f004';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('a0000000-0000-0000-0000-00000000f004', 'TEST-DELIVERY_SPLIT-001', '2026-11-13', 'sale', 'ЗК-DELIVERY_SPLIT-1',
        '66666666-6666-6666-6666-666666666601',
        'ee000000-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555501',
        '2026-11-20', 1200);

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number)
values ('b0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-00000000f004', 'sale', 'new', 1,
        null,
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-DELIVERY_SPLIT-1');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-000000000004', 'ЗК-DELIVERY_SPLIT-1',
        'Антифриз G12+ (5л)', '1', 'ANT-G12-5L', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-000000000004', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;
