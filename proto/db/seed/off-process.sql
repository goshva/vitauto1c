-- ВНЕПРОЦЕССНЫЕ УЗЛЫ: девять узлов модели, не входящих ни в один процесс.
--
-- Проверка покрытия показала: из 45 узлов модели в процессах задействовано 36.
-- Остальные девять — НСИ и опознание у администратора, создание номенклатуры
-- у менеджера, отдельные шаги ремонта — в сценарии не попали, и на карте процессов
-- их показать было нечем. Этот набор заводит по примеру на каждый.
--
-- Набор ОТДЕЛЬНЫЙ (`bun run db:seed --off`), а не часть `--all`: у этих узлов нет
-- цепочки переходов, и в состояниях строк они не выражаются. Смешивать их с
-- процессами значило бы сломать проверку «строк ровно по числу состояний».
--
-- Каждый пример помечен комментарием с кодом узла — по нему проверяется покрытие.

-- Чистим только своё: номера начинаются на `ВНЕ-`, идентификаторы — на a1…a4.
delete from line_mark where id in (select id from line where internal_order_number like 'ВНЕ-%');
delete from line_fact where id in (select id from line where internal_order_number like 'ВНЕ-%');
delete from line where internal_order_number like 'ВНЕ-%';
delete from work_order where number like 'ВНЕ-%';
delete from receipt where number like 'ВНЕ-%';
delete from nomenclature where comment like '%: внепроцессный узел%';

-- ── A2, M2a ── Создание номенклатуры: администратором и менеджером ────────────────────
-- Разные записи, потому что узлы разные: A2 — администратор подтверждает позицию,
-- M2a — менеджер заводит её при подборе. Одна запись на два узла не показала бы,
-- что работают РАЗНЫЕ роли.
insert into nomenclature (id, code, name, article, full_name, kind, comment) values
  ('a2000000-0000-0000-0000-000000000001', 'НФ-А2', 'Фильтр воздушный (заведён админом)',
   'AIR-ADM-001', 'Фильтр воздушный, артикул AIR-ADM-001', 'good', 'A2: внепроцессный узел'),
  ('a2000000-0000-0000-0000-000000000002', 'НФ-М2а', 'Патрубок радиатора (заведён менеджером)',
   'HOSE-MGR-001', 'Патрубок радиатора, артикул HOSE-MGR-001', 'good', 'M2a: внепроцессный узел'),
  -- A0 — НСИ: РРЦ (рекомендованная розничная цена) и цена закупки.
  ('a2000000-0000-0000-0000-000000000003', 'НФ-А0', 'Свеча зажигания (с РРЦ)',
   'SPARK-A0-001', 'Свеча зажигания, артикул SPARK-A0-001', 'good', 'A0: внепроцессный узел')
on conflict (id) do update set name = excluded.name, article = excluded.article,
  comment = excluded.comment;

-- РРЦ и цена закупки для A0: в строке РРЦ, в номенклатуре — цена.
update nomenclature set price = 850.00 where id = 'a2000000-0000-0000-0000-000000000003';

-- ── A1, M18, G8 ── Неопознанная позиция у трёх ролей ─────────────────────────────────
-- По строке на узел, а не одна на всех: узлы принадлежат РАЗНЫМ ролям и стоят в
-- разных местах сценария. Комментарий называет узел — по нему идёт проверка.
insert into line (id, operation, status, quantity, zone_id, comment, order_date,
                  internal_order_number, customer_id, warehouse_id) values
  ('a1000000-0000-0000-0000-000000000001', 'sale', 'new', 1,
   '99999999-9999-9999-9999-999999999904',
   'A1: внепроцессный узел — пришло не то, фото 3', current_date, 'ВНЕ-A1-1',
   '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401'),
  ('a1000000-0000-0000-0000-000000000002', 'sale', 'new', 1,
   '99999999-9999-9999-9999-999999999904',
   'M18: внепроцессный узел — неопознанная позиция у менеджера', current_date, 'ВНЕ-M18-1',
   '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401'),
  ('a1000000-0000-0000-0000-000000000003', 'sale', 'new', 1,
   '99999999-9999-9999-9999-999999999904',
   'G8: внепроцессный узел — неопознанная позиция у механика', current_date, 'ВНЕ-G8-1',
   '66666666-6666-6666-6666-666666666601', '44444444-4444-4444-4444-444444444401')
on conflict (id) do nothing;

-- Название позиции кладём в `fact_name`: отдельного поля «комментарий» у факта нет,
-- а код узла уже стоит в комментарии строки.
insert into line_fact (id, fact_name, fact_qty) values
  ('a1000000-0000-0000-0000-000000000001', 'Похоже на фильтр, фото 3', '1'),
  ('a1000000-0000-0000-0000-000000000002', 'Позиция без артикула', '1'),
  ('a1000000-0000-0000-0000-000000000003', 'Деталь из разбора, артикул стёрт', '1')
on conflict (id) do update set fact_name = excluded.fact_name;

insert into line_mark (id, marked, marked_by_id) values
  ('a1000000-0000-0000-0000-000000000001', false, null),
  ('a1000000-0000-0000-0000-000000000002', false, null),
  ('a1000000-0000-0000-0000-000000000003', false, null)
on conflict (id) do update set marked = false;

-- ── A5 ── Приход с разбора / заказ-наряда ────────────────────────────────────────────
-- Приёмка, у которой источник — разбор, а не поставщик: `posted = true`, потому что
-- товар уже оприходован.
insert into receipt (id, number, date, operation, counterparty_id, warehouse_id, posted, total) values
  ('a3000000-0000-0000-0000-000000000001', 'ВНЕ-A5-1', current_date, 'purchase',
   '66666666-6666-6666-6666-666666666604', '44444444-4444-4444-4444-444444444401', true, 0)
on conflict (id) do update set number = excluded.number, posted = excluded.posted;

insert into line (id, operation, status, quantity, nomenclature_id, receipt_id, comment,
                  order_date, internal_order_number, warehouse_id, zone_id) values
  ('a1000000-0000-0000-0000-000000000004', 'sale', 'to_stock', 1,
   'a2000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001',
   'A5: внепроцессный узел — приход с разбора', current_date, 'ВНЕ-A5-1',
   '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999902')
on conflict (id) do nothing;

insert into line_fact (id, fact_name, fact_qty) values
  ('a1000000-0000-0000-0000-000000000004', 'Свеча зажигания (с РРЦ)', '1')
on conflict (id) do update set fact_name = excluded.fact_name;

insert into line_mark (id, marked, marked_by_id) values
  ('a1000000-0000-0000-0000-000000000004', false, null)
on conflict (id) do update set marked = false;

-- ── G2, G7 ── Заказ для ремонта и контроль его документов ────────────────────────────
-- G2 — наряд открыт и в работе; G7 — наряд закрыт, документы проверены.
insert into work_order (id, number, date, status, car_id, counterparty_id, organization_id,
                        service_type_id, total) values
  ('a4000000-0000-0000-0000-000000000001', 'ВНЕ-G2-1', current_date, 'in_work',
   'cccccccc-cccc-cccc-cccc-cccccccccc03', '66666666-6666-6666-6666-666666666601',
   '55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222202', 1800),
  ('a4000000-0000-0000-0000-000000000002', 'ВНЕ-G7-1', current_date, 'closed',
   'cccccccc-cccc-cccc-cccc-cccccccccc03', '66666666-6666-6666-6666-666666666601',
   '55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222202', 2400)
on conflict (id) do update set status = excluded.status, total = excluded.total;

-- Работа в наряде G2: она и показывает «заказ для ремонта».
insert into line (id, work_order_id, operation, status, quantity, nomenclature_id,
                  service_type_id, norm_hours, sale_price, executor_id, order_date, comment) values
  ('a1000000-0000-0000-0000-000000000005', 'a4000000-0000-0000-0000-000000000001',
   'sale', 'new', 1, null, '22222222-2222-2222-2222-222222222202', 1.2, 1500,
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', current_date, 'G2: внепроцессный узел — заказ для ремонта'),
  ('a1000000-0000-0000-0000-000000000006', 'a4000000-0000-0000-0000-000000000002',
   'sale', 'closed', 1, 'a2000000-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222202', null, 600,
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', current_date, 'G7: внепроцессный узел — контроль документов')
on conflict (id) do nothing;

insert into line_fact (id, fact_name, fact_qty) values
  ('a1000000-0000-0000-0000-000000000005', 'Диагностика ходовой', '1.2'),
  ('a1000000-0000-0000-0000-000000000006', 'Свеча зажигания (с РРЦ)', '1')
on conflict (id) do update set fact_name = excluded.fact_name;

insert into line_mark (id, marked, marked_by_id) values
  ('a1000000-0000-0000-0000-000000000005', false, null),
  ('a1000000-0000-0000-0000-000000000006', false, null)
on conflict (id) do update set marked = false;
