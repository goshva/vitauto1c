-- Шаблоны справочных данных. Версионируются вместе с миграциями
-- (prototype-spec.md §2.3: сид — часть продукта, а не инфраструктура тестов).
--
-- Правило: ФИКСИРОВАННЫЕ UUID. Тест ссылается на конкретную строку, а не ищет
-- «что-нибудь подходящее». Идемпотентность через ON CONFLICT DO UPDATE:
-- повторный запуск приводит базу к тому же состоянию.
--
-- Префиксы UUID (по образцу legacy, чтобы ручная сверка была возможна):
--   7777…0N — номенклатура, 7777…aN — единицы
--   6666…0N — контрагенты, 5555…  — организация, ee00… — договоры
--   4444…0N — склады,     9999…  — зоны,       8888…0N — ячейки
--   3333…20N — формы оплаты, 2222… — виды услуг
--   dd00… — партии, cccc… — авто, 1212… — атрибуты авто

-- Единицы измерения
insert into unit (id, code, name, full_name, intl_code) values
  ('77777777-7777-7777-7777-7777777777a1', 'шт',  'шт',  'штука',   'PCE'),
  ('77777777-7777-7777-7777-7777777777a2', 'л',   'л',   'литр',    'LTR')
on conflict (id) do update set code = excluded.code, name = excluded.name,
  full_name = excluded.full_name, intl_code = excluded.intl_code;

-- Организация (наша)
insert into organization (id, code, name, full_name, short_name, inn, kpp, ogrn, prefix) values
  ('55555555-5555-5555-5555-555555555501', 'ВИТ', 'ВИТАВТО', 'ООО «ВИТАВТО»', 'ВИТАВТО',
   '7701234567', '770101001', '1027700123456', 'ВТ')
on conflict (id) do update set code = excluded.code, name = excluded.name,
  full_name = excluded.full_name, short_name = excluded.short_name, inn = excluded.inn;

-- Номенклатура: 6 позиций. article — то, что пишет клиент в заявке.
insert into nomenclature (id, code, name, article, full_name, unit_id, kind, price, comment) values
  ('77777777-7777-7777-7777-777777777701', 'A-001',  'Масло моторное 5W-30 (5л)', 'MOT5W30-5L',  'Масло моторное 5W-30, 5 л',      '77777777-7777-7777-7777-7777777777a2', 'good', 1200, null),
  ('77777777-7777-7777-7777-777777777702', 'A-002',  'Фильтр масляный',           'FLT-OIL-001', 'Фильтр масляный, шт',            '77777777-7777-7777-7777-7777777777a1', 'good',  500, null),
  ('77777777-7777-7777-7777-777777777703', 'A-0033', 'Колодки тормозные передние','BRK-FR-001',  'Колодки тормозные передние',     '77777777-7777-7777-7777-7777777777a1', 'good', 2250, null),
  ('77777777-7777-7777-7777-777777777704', 'A-004',  'Антифриз G12+ (5л)',        'ANT-G12-5L',  'Антифриз G12+, 5 л',             '77777777-7777-7777-7777-7777777777a2', 'good', 1650, null),
  ('77777777-7777-7777-7777-777777777705', 'A-005',  'Свеча зажигания',           'SPK-IR-001',  'Свеча зажигания иридиевая',      '77777777-7777-7777-7777-7777777777a1', 'good', 1200, null),
  ('77777777-7777-7777-7777-777777777706', 'A-006',  'Фильтр воздушный',          'FLT-AIR-001', 'Фильтр воздушный, шт',           '77777777-7777-7777-7777-7777777777a1', 'good', 1350, null),
  ('77777777-7777-7777-7777-777777777707', 'A-007',  'Фильтр салонный',           'FLT-CAB-001', 'Фильтр салонный, шт',            '77777777-7777-7777-7777-7777777777a1', 'good', 1050, null),
  ('77777777-7777-7777-7777-777777777708', 'S-001',  'Замена масла (работа)',     'SRV-OIL-001', 'Замена масла, нормо-час',        '77777777-7777-7777-7777-7777777777a1', 'service', 1500, null)
on conflict (id) do update set code = excluded.code, name = excluded.name,
  article = excluded.article, full_name = excluded.full_name, unit_id = excluded.unit_id,
  kind = excluded.kind, price = excluded.price;

-- Контрагенты: заказчик, поставщик и тот, кто сразу оба.
insert into counterparty (id, code, name, full_name, legal_form, inn, kpp, is_customer, is_supplier) values
  ('66666666-6666-6666-6666-666666666601', 'ИП1',  'ИП Иванов И.И.',        'Индивидуальный предприниматель Иванов И.И.', 'ИП',    '770111111111', null,         true,  false),
  ('66666666-6666-6666-6666-666666666602', 'ООО1', 'ООО АвтоЛюкс',          'Общество с ограниченной ответственностью «АвтоЛюкс»', 'ООО', '770222222222', '770201001', true, false),
  ('66666666-6666-6666-6666-666666666603', 'АДС',  'АвтоДеталь Сервис',     'ООО «АвтоДеталь Сервис»',                  'ООО',   '770333333333', '770301001', true,  true),
  ('66666666-6666-6666-6666-666666666604', 'АОТ',  'АвтооптТорг',           'ООО «АвтооптТорг»',                        'ООО',   '770444444444', '770401001', false, true),
  ('66666666-6666-6666-6666-666666666605', 'ДО',   'ДеталиОпт',             'ООО «ДеталиОпт»',                          'ООО',   '770555555555', '770501001', false, true)
on conflict (id) do update set code = excluded.code, name = excluded.name,
  full_name = excluded.full_name, inn = excluded.inn, is_customer = excluded.is_customer,
  is_supplier = excluded.is_supplier;

-- Договоры
insert into contract (id, code, name, contract_no, contract_date, counterparty_id, organization_id, kind) values
  ('ee000000-0000-0000-0000-000000000003', 'Д-003', 'Договор купли ИП Иванов',   'КП-2026/003', '2026-01-15', '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555501', 'customer'),
  ('ee000000-0000-0000-0000-000000000004', 'Д-004', 'Договор поставки Автоопт',  'ПС-2026/004', '2026-01-20', '66666666-6666-6666-6666-666666666604', '55555555-5555-5555-5555-555555555501', 'supplier')
on conflict (id) do update set code = excluded.code, name = excluded.name,
  contract_no = excluded.contract_no, counterparty_id = excluded.counterparty_id;

-- Склады
insert into warehouse (id, code, name, organization_id, is_warehouse, is_main) values
  ('44444444-4444-4444-4444-444444444401', 'ОСН', 'Основной склад', '55555555-5555-5555-5555-555555555501', true, true)
on conflict (id) do update set code = excluded.code, name = excluded.name, is_main = excluded.is_main;

-- Зоны склада. ШЕСТЬ предопределённых — по утверждённой схеме (ФТ v2 п. 7),
-- названия ДОСЛОВНО из `db/migrations/0014_warehouse_zones.sql` (legacy):
-- приёмки, малый, большой, «неопознанные и возвраты», ремонтная, укомплектованных.
--
-- «Неопознанные» и «Возвраты» — ОДНА зона, а не две: по схеме это Z5, и лежат там
-- вместе брак, возврат и неопознанное, потому что разбирает их один человек в одном
-- месте. Раньше они были разведены, и справочник не совпадал со схемой.
--
-- Ниже — служебные зоны процесса (Z6, Z8, Z10, Z12): нужны работающим операциям,
-- но в утверждённую шестёрку не входят. Признак `predefined` это различает.
insert into warehouse_zone (id, code, name, purpose, sort, predefined) values
  ('99999999-9999-9999-9999-999999999901', 'REC',  'Зона приёмки',            'Приёмка по УПД, факт прихода', 1, true),
  ('99999999-9999-9999-9999-999999999902', 'SM',   'Малый склад',             'Мелкие детали',                2, true),
  ('99999999-9999-9999-9999-999999999903', 'BG',   'Большой склад',           'Крупногабарит, жидкости',      3, true),
  ('99999999-9999-9999-9999-999999999904', 'UNK',  'Неопознанные и возвраты', 'Брак, возврат, неопознание',   4, true),
  ('99999999-9999-9999-9999-999999999906', 'REP',  'Ремонтная зона',          'Заказ-наряды, механик',        5, true),
  ('99999999-9999-9999-9999-999999999907', 'PACK', 'Зона укомплектованных',   'Готово к отгрузке',            6, true),
  -- Z8: сборка под заказ. Отдельно от «укомплектованных»: там товар уже собран,
  -- здесь ещё собирается.
  ('99999999-9999-9999-9999-999999999908', 'ASM',  'Резерв / Комплектация', 'assembly',    10, false),
  -- Z10: товар ждёт перевозчика или клиента.
  ('99999999-9999-9999-9999-999999999909', 'SHP',  'Отгрузка клиенту / ТК', 'shipping',    11, false),
  -- Z6: зона администратора для опознания позиции (A1).
  ('99999999-9999-9999-9999-999999999910', 'ADM',  'Админ: опознание',     'identification', 12, false),
  -- Z14: брак и ошибки заказа — товар возвращают поставщику.
  ('99999999-9999-9999-9999-999999999911', 'SUP',  'Возврат поставщику',   'to_supplier', 13, false),
  -- Z12: списание по заказ-наряду — запчасть израсходована в ремонте.
  ('99999999-9999-9999-9999-999999999912', 'WO',   'Списание по ЗН',       'write_off',   14, false)
on conflict (id) do update set code = excluded.code, name = excluded.name,
  purpose = excluded.purpose, sort = excluded.sort, predefined = excluded.predefined;

-- Ячейки: по одной в каждой зоне, чтобы K2 («Разместить в ячейку») было куда размещать.
insert into storage_cell (id, warehouse_id, zone_id, code, capacity, blocked) values
  ('88888888-8888-8888-8888-888888888801', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999901', 'P-01', 100, false),
  ('88888888-8888-8888-8888-888888888802', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999902', 'A-01', 100, false),
  ('88888888-8888-8888-8888-888888888803', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999903', 'A-02', 100, false),
  ('88888888-8888-8888-8888-888888888804', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999904', 'B-01', 100, false),
  -- R-01 стоит в «Неопознанных и возвратах»: отдельной зоны возвратов больше нет —
  -- по утверждённой схеме это одна зона (Z5).
  ('88888888-8888-8888-8888-888888888806', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999904', 'R-01', 100, false),
  ('88888888-8888-8888-8888-888888888807', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999906', 'M-01', 100, false),
  ('88888888-8888-8888-8888-888888888808', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999907', 'S-01', 100, false),
  ('88888888-8888-8888-8888-888888888809', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999908', 'K-01', 100, false),
  ('88888888-8888-8888-8888-888888888810', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999909', 'O-01', 100, false),
  ('88888888-8888-8888-8888-888888888811', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999910', 'D-01', 100, false),
  ('88888888-8888-8888-8888-888888888812', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999911', 'V-01', 100, false),
  ('88888888-8888-8888-8888-888888888813', '44444444-4444-4444-4444-444444444401', '99999999-9999-9999-9999-999999999912', 'W-01', 100, false)
on conflict (id) do update set code = excluded.code, zone_id = excluded.zone_id, blocked = excluded.blocked;

-- Формы оплаты
insert into payment_form (id, code, name) values
  ('33333333-3333-3333-3333-333333333201', 'НАЛ', 'Наличный расчёт'),
  ('33333333-3333-3333-3333-333333333203', 'БЕЗ', 'Безналичный расчёт')
on conflict (id) do update set code = excluded.code, name = excluded.name;

-- Виды услуг (ремонт, G1–G9)
insert into service_kind (id, code, name) values
  ('22222222-2222-2222-2222-222222222201', 'ТО',   'Техническое обслуживание'),
  ('22222222-2222-2222-2222-222222222202', 'РЕМ',  'Ремонт')
on conflict (id) do update set code = excluded.code, name = excluded.name;

-- Партия (ФИФО)
insert into batch (id, code, name, batch_no, supplier_id, status) values
  ('dd000000-0000-0000-0000-000000000001', 'П-01', 'Партия АвтооптТорг 01.2026', '01.2026', '66666666-6666-6666-6666-666666666604', 'active'),
  ('dd000000-0000-0000-0000-000000000002', 'П-02', 'Партия ДеталиОпт 02.2026',   '02.2026', '66666666-6666-6666-6666-666666666605', 'active')
on conflict (id) do update set code = excluded.code, name = excluded.name, batch_no = excluded.batch_no;

-- Подразделения муниципалитета: за ними закреплены ТС и сотрудники (Q2).
insert into department (id, code, name) values
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', 'ТЦ',  'Транспортный цех'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02', 'ХОЗ', 'Хозяйственный отдел'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd03', 'СЭ',  'Служба эксплуатации')
on conflict (id) do update set code = excluded.code, name = excluded.name;

-- Сотрудники: пять ролей (Q7). Логин живёт отдельно (auth), здесь — кадровые
-- данные и подпись. `can_sign` — признак «может подписывать акт».
insert into employee (id, full_name, role, department_id, position, phone, email, can_sign) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'Смирнов А. В.',  'admin',        'dddddddd-dddd-dddd-dddd-dddddddddd03', 'Администратор',  '+7 900 000-00-01', 'admin@vitauto.local',    false),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'Козлов Д. И.',   'municipality', 'dddddddd-dddd-dddd-dddd-dddddddddd02', 'Специалист',     '+7 900 000-00-02', 'zakaz@vitauto.local',    true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'Иванов И. И.',   'manager',      'dddddddd-dddd-dddd-dddd-dddddddddd03', 'Менеджер',       '+7 900 000-00-03', 'manager@vitauto.local',  true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'Петров П. С.',   'mechanic',     'dddddddd-dddd-dddd-dddd-dddddddddd01', 'Механик',        '+7 900 000-00-04', 'mechanic@vitauto.local', true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05', 'Сидоров Н. П.',  'storekeeper',  'dddddddd-dddd-dddd-dddd-dddddddddd01', 'Кладовщик',      '+7 900 000-00-05', 'store@vitauto.local',    true)
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
  department_id = excluded.department_id, position = excluded.position, can_sign = excluded.can_sign;

-- Правила регламентного ТО (Q2). Интервал по пробегу — главный триггер.
insert into maintenance_rule (id, code, name, car_model_id, mileage_interval, day_interval, norm_hours) values
  ('ab000000-0000-0000-0000-000000000001', 'ТО-10', 'ТО каждые 10 000 км или год', null, 10000, 365, 2.5),
  ('ab000000-0000-0000-0000-000000000002', 'ТО-15', 'ТО каждые 15 000 км',         null, 15000, null, 3.0),
  -- Правило-заглушка: без интервалов никого не поднимает. Нужна, чтобы проверять
  -- именно это поведение, а не только срабатывание.
  ('ab000000-0000-0000-0000-000000000003', 'БЕЗ',   'Без регламента',             null, null,  null, null)
on conflict (id) do update set name = excluded.name, mileage_interval = excluded.mileage_interval,
  day_interval = excluded.day_interval, norm_hours = excluded.norm_hours;

-- Автопарк: четыре ТС в разных состояниях, чтобы список ТО был непустым и
-- показывал все три причины («по пробегу», «по сроку», «ТО не делали»).
--
-- В legacy семь значений (марка, модель, агрегат, госномер, шасси, VIN, двигатель)
-- лежали прямо в строке заказа — здесь они в `car` и `car_attribute`.
insert into car (id, code, name, vin, year, engine_no, chassis_no, color,
                 mileage, mileage_at_service, last_service_at, status, department_id) values
  -- Просрочено по КАЛЕНДАРЮ: пробег дошёл только до 100 000, а год с ТО истёк.
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', 'АВТ-001', 'LADA Vesta, А123ВС777', 'XTC210530M0123456', 2021, 'ENG-123456', 'CHS-654321', 'Белый',
   100000, 95000, '2025-01-01', 'on_line', 'dddddddd-dddd-dddd-dddd-dddddddddd01'),
  -- Не требует ТО: до пробега 5 000 км, до срока 350 дней.
  ('cccccccc-cccc-cccc-cccc-cccccccccc02', 'АВТ-002', 'ГАЗель Next, В456ЕК777', 'X96386410M0987654', 2022, 'ENG-777001', 'CHS-777002', 'Синий',
   45000, 40000, '2026-11-01', 'on_line', 'dddddddd-dddd-dddd-dddd-dddddddddd02'),
  -- ПРОСРОЧЕНО ПО ПРОБЕГУ: 12 000 км сверх интервала. В ремонте.
  ('cccccccc-cccc-cccc-cccc-cccccccccc03', 'АВТ-003', 'УАЗ Profi, С789МН777', 'XTT374195M0556677', 2020, 'ENG-555001', 'CHS-555002', 'Серый',
   131000, 119000, '2026-11-01', 'in_repair', 'dddddddd-dddd-dddd-dddd-dddddddddd01'),
  -- ТО НЕ ДЕЛАЛИ НИ РАЗУ: попадает в список сразу, хотя пробег детский.
  ('cccccccc-cccc-cccc-cccc-cccccccccc04', 'АВТ-004', 'LADA Granta, Е321ОР777', 'XTC219060N0778899', 2023, 'ENG-333001', 'CHS-333002', 'Красный',
   500, null, null, 'on_line', 'dddddddd-dddd-dddd-dddd-dddddddddd03')
on conflict (id) do update set code = excluded.code, name = excluded.name, vin = excluded.vin,
  mileage = excluded.mileage, mileage_at_service = excluded.mileage_at_service,
  last_service_at = excluded.last_service_at, status = excluded.status,
  department_id = excluded.department_id;

insert into car_attribute (id, car_id, attr_kind, value_type, value_value) values
  ('12121212-1212-1212-1212-121212121201', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'brand',     'string', 'LADA'),
  ('12121212-1212-1212-1212-121212121202', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'model',     'string', 'Vesta'),
  ('12121212-1212-1212-1212-121212121203', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'aggregate', 'string', 'ДВС 21129'),
  ('12121212-1212-1212-1212-121212121204', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'plate',     'string', 'А123ВС777'),
  ('12121212-1212-1212-1212-121212121205', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'chassis',   'string', 'CHS-654321'),
  ('12121212-1212-1212-1212-121212121206', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'vin',       'string', 'XTC210530M0123456'),
  ('12121212-1212-1212-1212-121212121207', 'cccccccc-cccc-cccc-cccc-cccccccccc01', 'engine',    'string', 'ENG-123456'),
  ('12121212-1212-1212-1212-121212121208', 'cccccccc-cccc-cccc-cccc-cccccccccc02', 'brand',     'string', 'ГАЗ'),
  ('12121212-1212-1212-1212-121212121209', 'cccccccc-cccc-cccc-cccc-cccccccccc02', 'plate',     'string', 'В456ЕК777'),
  ('12121212-1212-1212-1212-121212121210', 'cccccccc-cccc-cccc-cccc-cccccccccc03', 'brand',     'string', 'УАЗ'),
  ('12121212-1212-1212-1212-121212121211', 'cccccccc-cccc-cccc-cccc-cccccccccc03', 'plate',     'string', 'С789МН777'),
  ('12121212-1212-1212-1212-121212121212', 'cccccccc-cccc-cccc-cccc-cccccccccc04', 'brand',     'string', 'LADA'),
  ('12121212-1212-1212-1212-121212121213', 'cccccccc-cccc-cccc-cccc-cccccccccc04', 'plate',     'string', 'Е321ОР777')
on conflict (id) do update set value_value = excluded.value_value, attr_kind = excluded.attr_kind;
