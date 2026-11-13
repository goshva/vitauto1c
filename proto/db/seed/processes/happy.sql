-- Процесс happy: Основной: закупка → отгрузка
-- Начальное состояние: статус «new», строк 1, остаток 0.
-- остатка нет намеренно — путь идёт через закупку у поставщика (M4)
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

delete from line_mark where id = 'b0000000-0000-0000-0000-000000000001';
delete from line_fact where id = 'b0000000-0000-0000-0000-000000000001';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-000000000001';
delete from line where id = 'b0000000-0000-0000-0000-000000000001';
delete from customer_order where id = 'a0000000-0000-0000-0000-00000000f001';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('a0000000-0000-0000-0000-00000000f001', 'TEST-HAPPY-001', '2026-11-13', 'sale', 'ЗК-HAPPY-1',
        '66666666-6666-6666-6666-666666666601',
        'ee000000-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555501',
        '2026-11-20', 1200);

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number)
values ('b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-00000000f001', 'sale', 'new', 1,
        null,
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-HAPPY-1');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-000000000001', 'ЗК-HAPPY-1',
        'Фильтр масляный', '1', 'FLT-OIL-001', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-000000000001', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;
