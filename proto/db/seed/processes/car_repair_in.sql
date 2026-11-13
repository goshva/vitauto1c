-- Процесс car_repair_in: Поступление машины в ремонт
-- Начальное состояние: статус «new», строк 1, остаток 0.
-- вход в ремонт (G1): к заказу привязан автомобиль, заказ-наряд открывается первым шагом
--
-- Фиксированные UUID: тест ссылается на конкретную строку, а не ищет «что-нибудь».
-- Файл сгенерирован scripts/gen-process-seeds.ts — правки вносятся в таблицу процессов.

delete from line_mark where id = 'b0000000-0000-0000-0000-00000000000b';
delete from line_fact where id = 'b0000000-0000-0000-0000-00000000000b';
delete from stock_move where line_id = 'b0000000-0000-0000-0000-00000000000b';
delete from line where id = 'b0000000-0000-0000-0000-00000000000b';
delete from customer_order where id = 'a0000000-0000-0000-0000-00000000f00b';

insert into customer_order (id, number, date, operation, client_order_number,
                            counterparty_id, contract_id, organization_id, ship_date, total)
values ('a0000000-0000-0000-0000-00000000f00b', 'TEST-CAR_REPAIR_IN-001', '2026-11-13', 'sale', 'ЗК-CAR_REPAIR_IN-1',
        '66666666-6666-6666-6666-666666666601',
        'ee000000-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555501',
        '2026-11-20', 1200);

insert into line (id, customer_order_id, operation, status, quantity,
                  nomenclature_id, customer_id, contract_id, order_date,
                  internal_order_number)
values ('b0000000-0000-0000-0000-00000000000b',
        'a0000000-0000-0000-0000-00000000f00b', 'sale', 'new', 1,
        null,
        '66666666-6666-6666-6666-666666666601', 'ee000000-0000-0000-0000-000000000003',
        '2026-11-13',
        'ВТ-CAR_REPAIR_IN-1');

insert into line_fact (id, client_order_number, fact_name, fact_qty, fact_article, fact_unit, vehicle_plate)
values ('b0000000-0000-0000-0000-00000000000b', 'ЗК-CAR_REPAIR_IN-1',
        'Замена масла (работа)', '1', 'SRV-OIL-001', 'шт', 'А123ВС777');

insert into line_mark (id, marked, marked_by_id)
values ('b0000000-0000-0000-0000-00000000000b', false, null)
on conflict (id) do update set marked = false, marked_by_id = null;

-- Автомобиль: процесс начинается с открытия заказ-наряда (G1).
insert into work_order (number, date, car_id, counterparty_id, organization_id, service_type_id, total)
values ('ЗН-CAR_REPAIR_IN', '2026-11-13',
        'cccccccc-cccc-cccc-cccc-cccccccccc01', '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222201', 0)
on conflict do nothing;
