-- +goose Up
-- Сгенерировано `vitauto-migrator gen` из docs/migration/storage-map.json, типов реквизитов 1С и типов столбцов источника.
-- Не править вручную: правила — в tools/migration/storage-map.mjs и backend/internal/migrate/gen.go.

create table auth."user" (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  name text,
  inactive boolean,
  department_id text,
  person_id uuid,
  comment text,
  service boolean,
  onec_ib_user_id bytea,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table auth."user" is '1С: Справочник.Пользователи (_reference462)';
comment on column auth."user".id is '1С: Справочник.Пользователи.Ссылка (_reference462._idrref); UUID = Ref_Key 1С';
comment on column auth."user".onec_version is '1С: Справочник.Пользователи.ВерсияДанных (_reference462._version)';
comment on column auth."user".deleted is '1С: Справочник.Пользователи.ПометкаУдаления (_reference462._marked)';
comment on column auth."user".predefined is '1С: Справочник.Пользователи.ИмяПредопределенныхДанных (_reference462._predefinedid)';
comment on column auth."user".name is '1С: Справочник.Пользователи.Наименование (_reference462._description)';
comment on column auth."user".inactive is '1С: Справочник.Пользователи.Недействителен (_reference462._fld11740)';
comment on column auth."user".department_id is '1С: Справочник.Пользователи.Подразделение (_reference462._fld11741)';
comment on column auth."user".person_id is '1С: Справочник.Пользователи.ФизическоеЛицо (_reference462._fld11742rref); ссылка Справочник.ФизическиеЛица (legacy.object)';
comment on column auth."user".comment is '1С: Справочник.Пользователи.Комментарий (_reference462._fld11743)';
comment on column auth."user".service is '1С: Справочник.Пользователи.Служебный (_reference462._fld11744)';
comment on column auth."user".onec_ib_user_id is '1С: Справочник.Пользователи.ИдентификаторПользователяИБ (_reference462._fld11746)';
comment on column auth."user".version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column auth."user".created_at is 'создание записи в vitauto_app';
comment on column auth."user".updated_at is 'последнее изменение записи в vitauto_app';
comment on column auth."user".extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column auth."user".import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.car_model (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  parent_id uuid,
  is_folder boolean,
  code text,
  name text,
  full_name text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.car_model is '1С: Справочник.асМодели (_reference756)';
comment on column ref.car_model.id is '1С: Справочник.асМодели.Ссылка (_reference756._idrref); UUID = Ref_Key 1С';
comment on column ref.car_model.onec_version is '1С: Справочник.асМодели.ВерсияДанных (_reference756._version)';
comment on column ref.car_model.deleted is '1С: Справочник.асМодели.ПометкаУдаления (_reference756._marked)';
comment on column ref.car_model.predefined is '1С: Справочник.асМодели.ИмяПредопределенныхДанных (_reference756._predefinedid)';
comment on column ref.car_model.parent_id is '1С: Справочник.асМодели.Родитель (_reference756._parentidrref)';
comment on column ref.car_model.is_folder is '1С: Справочник.асМодели.ЭтоГруппа (_reference756._folder)';
comment on column ref.car_model.code is '1С: Справочник.асМодели.Код (_reference756._code)';
comment on column ref.car_model.name is '1С: Справочник.асМодели.Наименование (_reference756._description)';
comment on column ref.car_model.full_name is '1С: Справочник.асМодели.НаименованиеПолное (_reference756._fld17333)';
comment on column ref.car_model.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.car_model.created_at is 'создание записи в vitauto_app';
comment on column ref.car_model.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.car_model.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.car_model.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.organization (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  code text,
  name text,
  inn text,
  kpp text,
  full_name text,
  short_name text,
  ogrn text,
  prefix text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.organization is '1С: Справочник.Организации (_reference388)';
comment on column ref.organization.id is '1С: Справочник.Организации.Ссылка (_reference388._idrref); UUID = Ref_Key 1С';
comment on column ref.organization.onec_version is '1С: Справочник.Организации.ВерсияДанных (_reference388._version)';
comment on column ref.organization.deleted is '1С: Справочник.Организации.ПометкаУдаления (_reference388._marked)';
comment on column ref.organization.predefined is '1С: Справочник.Организации.ИмяПредопределенныхДанных (_reference388._predefinedid)';
comment on column ref.organization.code is '1С: Справочник.Организации.Код (_reference388._code)';
comment on column ref.organization.name is '1С: Справочник.Организации.Наименование (_reference388._description)';
comment on column ref.organization.inn is '1С: Справочник.Организации.ИНН (_reference388._fld9821)';
comment on column ref.organization.kpp is '1С: Справочник.Организации.КПП (_reference388._fld9838)';
comment on column ref.organization.full_name is '1С: Справочник.Организации.НаименованиеПолное (_reference388._fld9841)';
comment on column ref.organization.short_name is '1С: Справочник.Организации.НаименованиеСокращенное (_reference388._fld9848)';
comment on column ref.organization.ogrn is '1С: Справочник.Организации.ОГРН (_reference388._fld9863)';
comment on column ref.organization.prefix is '1С: Справочник.Организации.Префикс (_reference388._fld9871)';
comment on column ref.organization.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.organization.created_at is 'создание записи в vitauto_app';
comment on column ref.organization.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.organization.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.organization.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.payment_form (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  code text,
  name text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.payment_form is '1С: Справочник.Арм_ФормыОплаты (_reference56795x1)';
comment on column ref.payment_form.id is '1С: Справочник.Арм_ФормыОплаты.Ссылка (_reference56795x1._idrref); UUID = Ref_Key 1С';
comment on column ref.payment_form.onec_version is '1С: Справочник.Арм_ФормыОплаты.ВерсияДанных (_reference56795x1._version)';
comment on column ref.payment_form.deleted is '1С: Справочник.Арм_ФормыОплаты.ПометкаУдаления (_reference56795x1._marked)';
comment on column ref.payment_form.predefined is '1С: Справочник.Арм_ФормыОплаты.ИмяПредопределенныхДанных (_reference56795x1._predefinedid)';
comment on column ref.payment_form.code is '1С: Справочник.Арм_ФормыОплаты.Код (_reference56795x1._code)';
comment on column ref.payment_form.name is '1С: Справочник.Арм_ФормыОплаты.Наименование (_reference56795x1._description)';
comment on column ref.payment_form.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.payment_form.created_at is 'создание записи в vitauto_app';
comment on column ref.payment_form.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.payment_form.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.payment_form.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.price_type (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  code text,
  name text,
  currency_id uuid,
  includes_vat boolean,
  comment text,
  kind text,
  inactive boolean,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.price_type is '1С: Справочник.ВидыЦен (_reference137)';
comment on column ref.price_type.id is '1С: Справочник.ВидыЦен.Ссылка (_reference137._idrref); UUID = Ref_Key 1С';
comment on column ref.price_type.onec_version is '1С: Справочник.ВидыЦен.ВерсияДанных (_reference137._version)';
comment on column ref.price_type.deleted is '1С: Справочник.ВидыЦен.ПометкаУдаления (_reference137._marked)';
comment on column ref.price_type.predefined is '1С: Справочник.ВидыЦен.ИмяПредопределенныхДанных (_reference137._predefinedid)';
comment on column ref.price_type.code is '1С: Справочник.ВидыЦен.Код (_reference137._code)';
comment on column ref.price_type.name is '1С: Справочник.ВидыЦен.Наименование (_reference137._description)';
comment on column ref.price_type.currency_id is '1С: Справочник.ВидыЦен.ВалютаЦены (_reference137._fld3301rref); ссылка Справочник.Валюты (legacy.object)';
comment on column ref.price_type.includes_vat is '1С: Справочник.ВидыЦен.ЦенаВключаетНДС (_reference137._fld3302)';
comment on column ref.price_type.comment is '1С: Справочник.ВидыЦен.Комментарий (_reference137._fld3308)';
comment on column ref.price_type.kind is '1С: Справочник.ВидыЦен.ТипВидаЦен (_reference137._fld3309rref); перечисление Перечисление.ТипыВидовЦен';
comment on column ref.price_type.inactive is '1С: Справочник.ВидыЦен.Недействителен (_reference137._fld3326)';
comment on column ref.price_type.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.price_type.created_at is 'создание записи в vitauto_app';
comment on column ref.price_type.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.price_type.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.price_type.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.service_kind (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  code text,
  name text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.service_kind is '1С: Справочник.Арм_ВидыУслуги (_reference56794x1)';
comment on column ref.service_kind.id is '1С: Справочник.Арм_ВидыУслуги.Ссылка (_reference56794x1._idrref); UUID = Ref_Key 1С';
comment on column ref.service_kind.onec_version is '1С: Справочник.Арм_ВидыУслуги.ВерсияДанных (_reference56794x1._version)';
comment on column ref.service_kind.deleted is '1С: Справочник.Арм_ВидыУслуги.ПометкаУдаления (_reference56794x1._marked)';
comment on column ref.service_kind.predefined is '1С: Справочник.Арм_ВидыУслуги.ИмяПредопределенныхДанных (_reference56794x1._predefinedid)';
comment on column ref.service_kind.code is '1С: Справочник.Арм_ВидыУслуги.Код (_reference56794x1._code)';
comment on column ref.service_kind.name is '1С: Справочник.Арм_ВидыУслуги.Наименование (_reference56794x1._description)';
comment on column ref.service_kind.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.service_kind.created_at is 'создание записи в vitauto_app';
comment on column ref.service_kind.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.service_kind.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.service_kind.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.unit (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  code text,
  name text,
  full_name text,
  intl_code text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.unit is '1С: Справочник.КлассификаторЕдиницИзмерения (_reference262)';
comment on column ref.unit.id is '1С: Справочник.КлассификаторЕдиницИзмерения.Ссылка (_reference262._idrref); UUID = Ref_Key 1С';
comment on column ref.unit.onec_version is '1С: Справочник.КлассификаторЕдиницИзмерения.ВерсияДанных (_reference262._version)';
comment on column ref.unit.deleted is '1С: Справочник.КлассификаторЕдиницИзмерения.ПометкаУдаления (_reference262._marked)';
comment on column ref.unit.predefined is '1С: Справочник.КлассификаторЕдиницИзмерения.ИмяПредопределенныхДанных (_reference262._predefinedid)';
comment on column ref.unit.code is '1С: Справочник.КлассификаторЕдиницИзмерения.Код (_reference262._code)';
comment on column ref.unit.name is '1С: Справочник.КлассификаторЕдиницИзмерения.Наименование (_reference262._description)';
comment on column ref.unit.full_name is '1С: Справочник.КлассификаторЕдиницИзмерения.НаименованиеПолное (_reference262._fld6398)';
comment on column ref.unit.intl_code is '1С: Справочник.КлассификаторЕдиницИзмерения.МеждународноеСокращение (_reference262._fld6399)';
comment on column ref.unit.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.unit.created_at is 'создание записи в vitauto_app';
comment on column ref.unit.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.unit.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.unit.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.counterparty (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  parent_id uuid,
  is_folder boolean,
  code text,
  name text,
  full_name text,
  legal_form text,
  comment text,
  inn text,
  kpp text,
  inactive boolean,
  is_customer boolean,
  is_supplier boolean,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.counterparty is '1С: Справочник.Контрагенты (_reference301)';
comment on column ref.counterparty.id is '1С: Справочник.Контрагенты.Ссылка (_reference301._idrref); UUID = Ref_Key 1С';
comment on column ref.counterparty.onec_version is '1С: Справочник.Контрагенты.ВерсияДанных (_reference301._version)';
comment on column ref.counterparty.deleted is '1С: Справочник.Контрагенты.ПометкаУдаления (_reference301._marked)';
comment on column ref.counterparty.predefined is '1С: Справочник.Контрагенты.ИмяПредопределенныхДанных (_reference301._predefinedid)';
comment on column ref.counterparty.parent_id is '1С: Справочник.Контрагенты.Родитель (_reference301._parentidrref)';
comment on column ref.counterparty.is_folder is '1С: Справочник.Контрагенты.ЭтоГруппа (_reference301._folder)';
comment on column ref.counterparty.code is '1С: Справочник.Контрагенты.Код (_reference301._code)';
comment on column ref.counterparty.name is '1С: Справочник.Контрагенты.Наименование (_reference301._description)';
comment on column ref.counterparty.full_name is '1С: Справочник.Контрагенты.НаименованиеПолное (_reference301._fld6956)';
comment on column ref.counterparty.legal_form is '1С: Справочник.Контрагенты.ЮридическоеФизическоеЛицо (_reference301._fld6974rref); перечисление Перечисление.ЮридическоеФизическоеЛицо';
comment on column ref.counterparty.comment is '1С: Справочник.Контрагенты.Комментарий (_reference301._fld6975)';
comment on column ref.counterparty.inn is '1С: Справочник.Контрагенты.ИНН (_reference301._fld6978)';
comment on column ref.counterparty.kpp is '1С: Справочник.Контрагенты.КПП (_reference301._fld6980)';
comment on column ref.counterparty.inactive is '1С: Справочник.Контрагенты.Недействителен (_reference301._fld6981)';
comment on column ref.counterparty.is_customer is '1С: Справочник.Контрагенты.Покупатель (_reference301._fld6985)';
comment on column ref.counterparty.is_supplier is '1С: Справочник.Контрагенты.Поставщик (_reference301._fld6987)';
comment on column ref.counterparty.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.counterparty.created_at is 'создание записи в vitauto_app';
comment on column ref.counterparty.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.counterparty.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.counterparty.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.warehouse (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  parent_id uuid,
  code text,
  name text,
  unit_type text,
  order_based boolean,
  organization_id uuid,
  responsible_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.warehouse is '1С: Справочник.СтруктурныеЕдиницы (_reference612)';
comment on column ref.warehouse.id is '1С: Справочник.СтруктурныеЕдиницы.Ссылка (_reference612._idrref); UUID = Ref_Key 1С';
comment on column ref.warehouse.onec_version is '1С: Справочник.СтруктурныеЕдиницы.ВерсияДанных (_reference612._version)';
comment on column ref.warehouse.deleted is '1С: Справочник.СтруктурныеЕдиницы.ПометкаУдаления (_reference612._marked)';
comment on column ref.warehouse.predefined is '1С: Справочник.СтруктурныеЕдиницы.ИмяПредопределенныхДанных (_reference612._predefinedid)';
comment on column ref.warehouse.parent_id is '1С: Справочник.СтруктурныеЕдиницы.Родитель (_reference612._parentidrref)';
comment on column ref.warehouse.code is '1С: Справочник.СтруктурныеЕдиницы.Код (_reference612._code)';
comment on column ref.warehouse.name is '1С: Справочник.СтруктурныеЕдиницы.Наименование (_reference612._description)';
comment on column ref.warehouse.unit_type is '1С: Справочник.СтруктурныеЕдиницы.ТипСтруктурнойЕдиницы (_reference612._fld14893rref); перечисление Перечисление.ТипыСтруктурныхЕдиниц';
comment on column ref.warehouse.order_based is '1С: Справочник.СтруктурныеЕдиницы.ОрдерныйСклад (_reference612._fld14894)';
comment on column ref.warehouse.organization_id is '1С: Справочник.СтруктурныеЕдиницы.Организация (_reference612._fld14895rref)';
comment on column ref.warehouse.responsible_id is '1С: Справочник.СтруктурныеЕдиницы.МОЛ (_reference612._fld14896rref); ссылка Справочник.ФизическиеЛица (legacy.object)';
comment on column ref.warehouse.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.warehouse.created_at is 'создание записи в vitauto_app';
comment on column ref.warehouse.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.warehouse.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.warehouse.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.car (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  parent_id uuid,
  is_folder boolean,
  code text,
  name text,
  vin text,
  year timestamp,
  comment text,
  model_id uuid,
  engine_no text,
  body_no text,
  chassis_no text,
  color uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.car is '1С: Справочник.асАвтомобили (_reference749)';
comment on column ref.car.id is '1С: Справочник.асАвтомобили.Ссылка (_reference749._idrref); UUID = Ref_Key 1С';
comment on column ref.car.onec_version is '1С: Справочник.асАвтомобили.ВерсияДанных (_reference749._version)';
comment on column ref.car.deleted is '1С: Справочник.асАвтомобили.ПометкаУдаления (_reference749._marked)';
comment on column ref.car.predefined is '1С: Справочник.асАвтомобили.ИмяПредопределенныхДанных (_reference749._predefinedid)';
comment on column ref.car.parent_id is '1С: Справочник.асАвтомобили.Родитель (_reference749._parentidrref)';
comment on column ref.car.is_folder is '1С: Справочник.асАвтомобили.ЭтоГруппа (_reference749._folder)';
comment on column ref.car.code is '1С: Справочник.асАвтомобили.Код (_reference749._code)';
comment on column ref.car.name is '1С: Справочник.асАвтомобили.Наименование (_reference749._description)';
comment on column ref.car.vin is '1С: Справочник.асАвтомобили.VIN (_reference749._fld17167)';
comment on column ref.car.year is '1С: Справочник.асАвтомобили.ГодВыпуска (_reference749._fld17169)';
comment on column ref.car.comment is '1С: Справочник.асАвтомобили.Комментарий (_reference749._fld17170)';
comment on column ref.car.model_id is '1С: Справочник.асАвтомобили.Модель (_reference749._fld17171rref)';
comment on column ref.car.engine_no is '1С: Справочник.асАвтомобили.НомерДвигателя (_reference749._fld17172)';
comment on column ref.car.body_no is '1С: Справочник.асАвтомобили.НомерКузова (_reference749._fld17173)';
comment on column ref.car.chassis_no is '1С: Справочник.асАвтомобили.НомерШасси (_reference749._fld17174)';
comment on column ref.car.color is '1С: Справочник.асАвтомобили.Цвет (_reference749._fld17176rref); ссылка Справочник.ас_Цвета (legacy.object)';
comment on column ref.car.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.car.created_at is 'создание записи в vitauto_app';
comment on column ref.car.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.car.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.car.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.contract (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  counterparty_type text,
  counterparty_id uuid,
  counterparty_value jsonb,
  parent_id uuid,
  code text,
  name text,
  comment text,
  currency_id uuid,
  price_type_id uuid,
  contract_date timestamp,
  organization_id uuid,
  inactive boolean,
  contract_no text,
  kind text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.contract is '1С: Справочник.ДоговорыКонтрагентов (_reference171)';
comment on column ref.contract.id is '1С: Справочник.ДоговорыКонтрагентов.Ссылка (_reference171._idrref); UUID = Ref_Key 1С';
comment on column ref.contract.onec_version is '1С: Справочник.ДоговорыКонтрагентов.ВерсияДанных (_reference171._version)';
comment on column ref.contract.deleted is '1С: Справочник.ДоговорыКонтрагентов.ПометкаУдаления (_reference171._marked)';
comment on column ref.contract.predefined is '1С: Справочник.ДоговорыКонтрагентов.ИмяПредопределенныхДанных (_reference171._predefinedid)';
comment on column ref.contract.counterparty_type is '1С: Справочник.ДоговорыКонтрагентов.Владелец (_reference171._ownerid_type, _ownerid_rtref, _ownerid_rrref); вид значения / тип ссылки';
comment on column ref.contract.counterparty_id is '1С: Справочник.ДоговорыКонтрагентов.Владелец (_reference171._ownerid_type, _ownerid_rtref, _ownerid_rrref); ссылка';
comment on column ref.contract.counterparty_value is '1С: Справочник.ДоговорыКонтрагентов.Владелец (_reference171._ownerid_type, _ownerid_rtref, _ownerid_rrref); примитивное значение';
comment on column ref.contract.parent_id is '1С: Справочник.ДоговорыКонтрагентов.Родитель (_reference171._parentidrref)';
comment on column ref.contract.code is '1С: Справочник.ДоговорыКонтрагентов.Код (_reference171._code)';
comment on column ref.contract.name is '1С: Справочник.ДоговорыКонтрагентов.Наименование (_reference171._description)';
comment on column ref.contract.comment is '1С: Справочник.ДоговорыКонтрагентов.Комментарий (_reference171._fld4107)';
comment on column ref.contract.currency_id is '1С: Справочник.ДоговорыКонтрагентов.ВалютаРасчетов (_reference171._fld4108rref); ссылка Справочник.Валюты (legacy.object)';
comment on column ref.contract.price_type_id is '1С: Справочник.ДоговорыКонтрагентов.ВидЦен (_reference171._fld4111rref)';
comment on column ref.contract.contract_date is '1С: Справочник.ДоговорыКонтрагентов.ДатаДоговора (_reference171._fld4113)';
comment on column ref.contract.organization_id is '1С: Справочник.ДоговорыКонтрагентов.Организация (_reference171._fld4124rref)';
comment on column ref.contract.inactive is '1С: Справочник.ДоговорыКонтрагентов.Недействителен (_reference171._fld4126)';
comment on column ref.contract.contract_no is '1С: Справочник.ДоговорыКонтрагентов.НомерДоговора (_reference171._fld4129)';
comment on column ref.contract.kind is '1С: Справочник.ДоговорыКонтрагентов.ВидДоговора (_reference171._fld4130rref); перечисление Перечисление.ВидыДоговоров';
comment on column ref.contract.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.contract.created_at is 'создание записи в vitauto_app';
comment on column ref.contract.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.contract.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.contract.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.nomenclature (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  parent_id uuid,
  is_folder boolean,
  code text,
  name text,
  unit_id uuid,
  article text,
  full_name text,
  comment text,
  kind text,
  ext_code text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.nomenclature is '1С: Справочник.Номенклатура (_reference368x1)';
comment on column ref.nomenclature.id is '1С: Справочник.Номенклатура.Ссылка (_reference368x1._idrref); UUID = Ref_Key 1С';
comment on column ref.nomenclature.onec_version is '1С: Справочник.Номенклатура.ВерсияДанных (_reference368x1._version)';
comment on column ref.nomenclature.deleted is '1С: Справочник.Номенклатура.ПометкаУдаления (_reference368x1._marked)';
comment on column ref.nomenclature.predefined is '1С: Справочник.Номенклатура.ИмяПредопределенныхДанных (_reference368x1._predefinedid)';
comment on column ref.nomenclature.parent_id is '1С: Справочник.Номенклатура.Родитель (_reference368x1._parentidrref)';
comment on column ref.nomenclature.is_folder is '1С: Справочник.Номенклатура.ЭтоГруппа (_reference368x1._folder)';
comment on column ref.nomenclature.code is '1С: Справочник.Номенклатура.Код (_reference368x1._code)';
comment on column ref.nomenclature.name is '1С: Справочник.Номенклатура.Наименование (_reference368x1._description)';
comment on column ref.nomenclature.unit_id is '1С: Справочник.Номенклатура.ЕдиницаИзмерения (_reference368x1._fld9229rref)';
comment on column ref.nomenclature.article is '1С: Справочник.Номенклатура.Артикул (_reference368x1._fld9223)';
comment on column ref.nomenclature.full_name is '1С: Справочник.Номенклатура.НаименованиеПолное (_reference368x1._fld9251)';
comment on column ref.nomenclature.comment is '1С: Справочник.Номенклатура.Комментарий (_reference368x1._fld9262)';
comment on column ref.nomenclature.kind is '1С: Справочник.Номенклатура.ТипНоменклатуры (_reference368x1._fld9303rref); перечисление Перечисление.ТипыНоменклатуры';
comment on column ref.nomenclature.ext_code is '1С: Справочник.Номенклатура.АС_КодАвтоАльянс (_reference368x1._fld56764)';
comment on column ref.nomenclature.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.nomenclature.created_at is 'создание записи в vitauto_app';
comment on column ref.nomenclature.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.nomenclature.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.nomenclature.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.batch (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  predefined uuid,
  owner_id uuid,
  code text,
  name text,
  status text,
  supplier_id uuid,
  inactive boolean,
  batch_no text,
  expires_at timestamp,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table ref.batch is '1С: Справочник.ПартииНоменклатуры (_reference427)';
comment on column ref.batch.id is '1С: Справочник.ПартииНоменклатуры.Ссылка (_reference427._idrref); UUID = Ref_Key 1С';
comment on column ref.batch.onec_version is '1С: Справочник.ПартииНоменклатуры.ВерсияДанных (_reference427._version)';
comment on column ref.batch.deleted is '1С: Справочник.ПартииНоменклатуры.ПометкаУдаления (_reference427._marked)';
comment on column ref.batch.predefined is '1С: Справочник.ПартииНоменклатуры.ИмяПредопределенныхДанных (_reference427._predefinedid)';
comment on column ref.batch.owner_id is '1С: Справочник.ПартииНоменклатуры.Владелец (_reference427._owneridrref)';
comment on column ref.batch.code is '1С: Справочник.ПартииНоменклатуры.Код (_reference427._code)';
comment on column ref.batch.name is '1С: Справочник.ПартииНоменклатуры.Наименование (_reference427._description)';
comment on column ref.batch.status is '1С: Справочник.ПартииНоменклатуры.Статус (_reference427._fld10712rref); перечисление Перечисление.СтатусыПартий';
comment on column ref.batch.supplier_id is '1С: Справочник.ПартииНоменклатуры.ВладелецПартии (_reference427._fld10713rref)';
comment on column ref.batch.inactive is '1С: Справочник.ПартииНоменклатуры.Недействителен (_reference427._fld10714)';
comment on column ref.batch.batch_no is '1С: Справочник.ПартииНоменклатуры.Номер (_reference427._fld10715)';
comment on column ref.batch.expires_at is '1С: Справочник.ПартииНоменклатуры.ГоденДо (_reference427._fld10719)';
comment on column ref.batch.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.batch.created_at is 'создание записи в vitauto_app';
comment on column ref.batch.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.batch.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.batch.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.customer_order (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  date timestamp,
  number text,
  posted boolean,
  author_id uuid,
  currency_id uuid,
  operation text,
  ship_date timestamp,
  contract_id uuid,
  base_doc_type text,
  base_doc_id uuid,
  base_doc_value jsonb,
  comment text,
  counterparty_id uuid,
  organization_id uuid,
  responsible_id uuid,
  order_state_type text,
  order_state_id uuid,
  order_state_value jsonb,
  reserve_warehouse_id uuid,
  amount_includes_vat boolean,
  total numeric(15,2),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.customer_order is '1С: Документ.ЗаказПокупателя (_document813x1)';
comment on column doc.customer_order.id is '1С: Документ.ЗаказПокупателя.Ссылка (_document813x1._idrref); UUID = Ref_Key 1С';
comment on column doc.customer_order.onec_version is '1С: Документ.ЗаказПокупателя.ВерсияДанных (_document813x1._version)';
comment on column doc.customer_order.deleted is '1С: Документ.ЗаказПокупателя.ПометкаУдаления (_document813x1._marked)';
comment on column doc.customer_order.date is '1С: Документ.ЗаказПокупателя.Дата (_document813x1._date_time)';
comment on column doc.customer_order.number is '1С: Документ.ЗаказПокупателя.Номер (_document813x1._number)';
comment on column doc.customer_order.posted is '1С: Документ.ЗаказПокупателя.Проведен (_document813x1._posted)';
comment on column doc.customer_order.author_id is '1С: Документ.ЗаказПокупателя.Автор (_document813x1._fld20452rref)';
comment on column doc.customer_order.currency_id is '1С: Документ.ЗаказПокупателя.ВалютаДокумента (_document813x1._fld20459rref); ссылка Справочник.Валюты (legacy.object)';
comment on column doc.customer_order.operation is '1С: Документ.ЗаказПокупателя.ВидОперации (_document813x1._fld20464rref); перечисление Перечисление.ВидыОперацийЗаказПокупателя';
comment on column doc.customer_order.ship_date is '1С: Документ.ЗаказПокупателя.ДатаОтгрузки (_document813x1._fld20476)';
comment on column doc.customer_order.contract_id is '1С: Документ.ЗаказПокупателя.Договор (_document813x1._fld20483rref)';
comment on column doc.customer_order.base_doc_type is '1С: Документ.ЗаказПокупателя.ДокументОснование (_document813x1._fld20484_type, _fld20484_rtref, _fld20484_rrref); вид значения / тип ссылки';
comment on column doc.customer_order.base_doc_id is '1С: Документ.ЗаказПокупателя.ДокументОснование (_document813x1._fld20484_type, _fld20484_rtref, _fld20484_rrref); ссылка';
comment on column doc.customer_order.base_doc_value is '1С: Документ.ЗаказПокупателя.ДокументОснование (_document813x1._fld20484_type, _fld20484_rtref, _fld20484_rrref); примитивное значение';
comment on column doc.customer_order.comment is '1С: Документ.ЗаказПокупателя.Комментарий (_document813x1._fld20501)';
comment on column doc.customer_order.counterparty_id is '1С: Документ.ЗаказПокупателя.Контрагент (_document813x1._fld20506rref)';
comment on column doc.customer_order.organization_id is '1С: Документ.ЗаказПокупателя.Организация (_document813x1._fld20520rref)';
comment on column doc.customer_order.responsible_id is '1С: Документ.ЗаказПокупателя.Ответственный (_document813x1._fld20524rref); ссылка Справочник.Сотрудники (legacy.object)';
comment on column doc.customer_order.order_state_type is '1С: Документ.ЗаказПокупателя.СостояниеЗаказа (_document813x1._fld20540_type, _fld20540_rtref, _fld20540_rrref); вид значения / тип ссылки';
comment on column doc.customer_order.order_state_id is '1С: Документ.ЗаказПокупателя.СостояниеЗаказа (_document813x1._fld20540_type, _fld20540_rtref, _fld20540_rrref); ссылка';
comment on column doc.customer_order.order_state_value is '1С: Документ.ЗаказПокупателя.СостояниеЗаказа (_document813x1._fld20540_type, _fld20540_rtref, _fld20540_rrref); примитивное значение';
comment on column doc.customer_order.reserve_warehouse_id is '1С: Документ.ЗаказПокупателя.СтруктурнаяЕдиницаРезерв (_document813x1._fld20552rref)';
comment on column doc.customer_order.amount_includes_vat is '1С: Документ.ЗаказПокупателя.СуммаВключаетНДС (_document813x1._fld20553)';
comment on column doc.customer_order.total is '1С: Документ.ЗаказПокупателя.СуммаДокумента (_document813x1._fld20554)';
comment on column doc.customer_order.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.customer_order.created_at is 'создание записи в vitauto_app';
comment on column doc.customer_order.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.customer_order.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.customer_order.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.customer_order_item (
  id uuid primary key,
  line_no numeric(5,0),
  nomenclature_type text,
  nomenclature_id uuid,
  nomenclature_value jsonb,
  characteristic_id uuid,
  reserve_qty numeric(15,3),
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  price numeric(15,2),
  discount_pct numeric(5,2),
  discount_amount numeric(15,2),
  amount numeric(15,2),
  vat_rate_id uuid,
  vat_amount numeric(15,2),
  total numeric(15,2),
  ship_date timestamp,
  content text,
  qty numeric(15,3),
  link_no numeric(5,0),
  batch_id uuid,
  reserve_warehouse_id uuid,
  cell_id uuid,
  row_uid text,
  client_name text,
  client_qty text,
  arm_link_key text,
  client_order_no text,
  client_order_date text,
  client_urgency text,
  client_plate text,
  client_territory text,
  client_article text,
  client_unit text,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.customer_order_item is '1С: Документ.ЗаказПокупателя.Запасы (_document813_vt20595x1)';
comment on column doc.customer_order_item.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.customer_order_item.line_no is '1С: Документ.ЗаказПокупателя.Запасы.НомерСтроки (_document813_vt20595x1._lineno20596)';
comment on column doc.customer_order_item.nomenclature_type is '1С: Документ.ЗаказПокупателя.Запасы.Номенклатура (_document813_vt20595x1._fld20598_type, _fld20598_s, _fld20598_rrref); вид значения / тип ссылки';
comment on column doc.customer_order_item.nomenclature_id is '1С: Документ.ЗаказПокупателя.Запасы.Номенклатура (_document813_vt20595x1._fld20598_type, _fld20598_s, _fld20598_rrref); ссылка';
comment on column doc.customer_order_item.nomenclature_value is '1С: Документ.ЗаказПокупателя.Запасы.Номенклатура (_document813_vt20595x1._fld20598_type, _fld20598_s, _fld20598_rrref); примитивное значение';
comment on column doc.customer_order_item.characteristic_id is '1С: Документ.ЗаказПокупателя.Запасы.Характеристика (_document813_vt20595x1._fld20599rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.customer_order_item.reserve_qty is '1С: Документ.ЗаказПокупателя.Запасы.Резерв (_document813_vt20595x1._fld20601)';
comment on column doc.customer_order_item.unit_type is '1С: Документ.ЗаказПокупателя.Запасы.ЕдиницаИзмерения (_document813_vt20595x1._fld20603_type, _fld20603_rtref, _fld20603_rrref); вид значения / тип ссылки';
comment on column doc.customer_order_item.unit_id is '1С: Документ.ЗаказПокупателя.Запасы.ЕдиницаИзмерения (_document813_vt20595x1._fld20603_type, _fld20603_rtref, _fld20603_rrref); ссылка';
comment on column doc.customer_order_item.unit_value is '1С: Документ.ЗаказПокупателя.Запасы.ЕдиницаИзмерения (_document813_vt20595x1._fld20603_type, _fld20603_rtref, _fld20603_rrref); примитивное значение';
comment on column doc.customer_order_item.price is '1С: Документ.ЗаказПокупателя.Запасы.Цена (_document813_vt20595x1._fld20604)';
comment on column doc.customer_order_item.discount_pct is '1С: Документ.ЗаказПокупателя.Запасы.ПроцентСкидкиНаценки (_document813_vt20595x1._fld20605)';
comment on column doc.customer_order_item.discount_amount is '1С: Документ.ЗаказПокупателя.Запасы.СуммаСкидкиНаценки (_document813_vt20595x1._fld20606)';
comment on column doc.customer_order_item.amount is '1С: Документ.ЗаказПокупателя.Запасы.Сумма (_document813_vt20595x1._fld20607)';
comment on column doc.customer_order_item.vat_rate_id is '1С: Документ.ЗаказПокупателя.Запасы.СтавкаНДС (_document813_vt20595x1._fld20608rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.customer_order_item.vat_amount is '1С: Документ.ЗаказПокупателя.Запасы.СуммаНДС (_document813_vt20595x1._fld20609)';
comment on column doc.customer_order_item.total is '1С: Документ.ЗаказПокупателя.Запасы.Всего (_document813_vt20595x1._fld20610)';
comment on column doc.customer_order_item.ship_date is '1С: Документ.ЗаказПокупателя.Запасы.ДатаОтгрузки (_document813_vt20595x1._fld20611)';
comment on column doc.customer_order_item.content is '1С: Документ.ЗаказПокупателя.Запасы.Содержание (_document813_vt20595x1._fld20613)';
comment on column doc.customer_order_item.qty is '1С: Документ.ЗаказПокупателя.Запасы.Количество (_document813_vt20595x1._fld20616)';
comment on column doc.customer_order_item.link_no is '1С: Документ.ЗаказПокупателя.Запасы.КлючСвязи (_document813_vt20595x1._fld20617)';
comment on column doc.customer_order_item.batch_id is '1С: Документ.ЗаказПокупателя.Запасы.Партия (_document813_vt20595x1._fld20620rref)';
comment on column doc.customer_order_item.reserve_warehouse_id is '1С: Документ.ЗаказПокупателя.Запасы.СтруктурнаяЕдиницаРезерв (_document813_vt20595x1._fld20628rref)';
comment on column doc.customer_order_item.cell_id is '1С: Документ.ЗаказПокупателя.Запасы.Ячейка (_document813_vt20595x1._fld20629rref); ссылка Справочник.Ячейки (legacy.object)';
comment on column doc.customer_order_item.row_uid is '1С: Документ.ЗаказПокупателя.Запасы.ИдентификаторСтроки (_document813_vt20595x1._fld20633)';
comment on column doc.customer_order_item.client_name is '1С: Документ.ЗаказПокупателя.Запасы.НоменклатураКлиента (_document813_vt20595x1._fld56893)';
comment on column doc.customer_order_item.client_qty is '1С: Документ.ЗаказПокупателя.Запасы.КоличествоКлиента (_document813_vt20595x1._fld56894)';
comment on column doc.customer_order_item.arm_link_key is '1С: Документ.ЗаказПокупателя.Запасы.КлючСвязиСтрок (_document813_vt20595x1._fld56895)';
comment on column doc.customer_order_item.client_order_no is '1С: Документ.ЗаказПокупателя.Запасы.НомерКлиента (_document813_vt20595x1._fld56896)';
comment on column doc.customer_order_item.client_order_date is '1С: Документ.ЗаказПокупателя.Запасы.ДатаЗаказаКлиента (_document813_vt20595x1._fld56897)';
comment on column doc.customer_order_item.client_urgency is '1С: Документ.ЗаказПокупателя.Запасы.СрочностьКлиента (_document813_vt20595x1._fld56898)';
comment on column doc.customer_order_item.client_plate is '1С: Документ.ЗаказПокупателя.Запасы.ГРЗКлиента (_document813_vt20595x1._fld56899)';
comment on column doc.customer_order_item.client_territory is '1С: Документ.ЗаказПокупателя.Запасы.ТерриторияКлиента (_document813_vt20595x1._fld56900)';
comment on column doc.customer_order_item.client_article is '1С: Документ.ЗаказПокупателя.Запасы.АртикулКлиента (_document813_vt20595x1._fld56901)';
comment on column doc.customer_order_item.client_unit is '1С: Документ.ЗаказПокупателя.Запасы.ЕдиницаИзмеренияКлиента (_document813_vt20595x1._fld56902)';
comment on column doc.customer_order_item.doc_id is '1С: Документ.ЗаказПокупателя.Запасы.Ссылка (_document813_vt20595x1._document813_idrref)';
comment on column doc.customer_order_item.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.customer_order_item.created_at is 'создание записи в vitauto_app';
comment on column doc.customer_order_item.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.customer_order_item.deleted is 'пометка удаления';
comment on column doc.customer_order_item.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.customer_order_item.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.customer_order_item.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.customer_order_material (
  id uuid primary key,
  line_no numeric(5,0),
  link_no numeric(5,0),
  nomenclature_id uuid,
  characteristic_id uuid,
  batch_id uuid,
  qty numeric(15,3),
  reserve_qty numeric(15,3),
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  reserve_warehouse_id uuid,
  cell_id uuid,
  row_uid text,
  content text,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.customer_order_material is '1С: Документ.ЗаказПокупателя.Материалы (_document813_vt20690x1)';
comment on column doc.customer_order_material.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.customer_order_material.line_no is '1С: Документ.ЗаказПокупателя.Материалы.НомерСтроки (_document813_vt20690x1._lineno20691)';
comment on column doc.customer_order_material.link_no is '1С: Документ.ЗаказПокупателя.Материалы.КлючСвязи (_document813_vt20690x1._fld20692)';
comment on column doc.customer_order_material.nomenclature_id is '1С: Документ.ЗаказПокупателя.Материалы.Номенклатура (_document813_vt20690x1._fld20693rref)';
comment on column doc.customer_order_material.characteristic_id is '1С: Документ.ЗаказПокупателя.Материалы.Характеристика (_document813_vt20690x1._fld20694rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.customer_order_material.batch_id is '1С: Документ.ЗаказПокупателя.Материалы.Партия (_document813_vt20690x1._fld20695rref)';
comment on column doc.customer_order_material.qty is '1С: Документ.ЗаказПокупателя.Материалы.Количество (_document813_vt20690x1._fld20697)';
comment on column doc.customer_order_material.reserve_qty is '1С: Документ.ЗаказПокупателя.Материалы.Резерв (_document813_vt20690x1._fld20698)';
comment on column doc.customer_order_material.unit_type is '1С: Документ.ЗаказПокупателя.Материалы.ЕдиницаИзмерения (_document813_vt20690x1._fld20700_type, _fld20700_rtref, _fld20700_rrref); вид значения / тип ссылки';
comment on column doc.customer_order_material.unit_id is '1С: Документ.ЗаказПокупателя.Материалы.ЕдиницаИзмерения (_document813_vt20690x1._fld20700_type, _fld20700_rtref, _fld20700_rrref); ссылка';
comment on column doc.customer_order_material.unit_value is '1С: Документ.ЗаказПокупателя.Материалы.ЕдиницаИзмерения (_document813_vt20690x1._fld20700_type, _fld20700_rtref, _fld20700_rrref); примитивное значение';
comment on column doc.customer_order_material.reserve_warehouse_id is '1С: Документ.ЗаказПокупателя.Материалы.СтруктурнаяЕдиницаРезерв (_document813_vt20690x1._fld20704rref)';
comment on column doc.customer_order_material.cell_id is '1С: Документ.ЗаказПокупателя.Материалы.Ячейка (_document813_vt20690x1._fld20705rref); ссылка Справочник.Ячейки (legacy.object)';
comment on column doc.customer_order_material.row_uid is '1С: Документ.ЗаказПокупателя.Материалы.ИдентификаторСтроки (_document813_vt20690x1._fld20709)';
comment on column doc.customer_order_material.content is '1С: Документ.ЗаказПокупателя.Материалы.Содержание (_document813_vt20690x1._fld56368)';
comment on column doc.customer_order_material.doc_id is '1С: Документ.ЗаказПокупателя.Материалы.Ссылка (_document813_vt20690x1._document813_idrref)';
comment on column doc.customer_order_material.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.customer_order_material.created_at is 'создание записи в vitauto_app';
comment on column doc.customer_order_material.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.customer_order_material.deleted is 'пометка удаления';
comment on column doc.customer_order_material.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.customer_order_material.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.customer_order_material.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.customer_order_work (
  id uuid primary key,
  line_no numeric(5,0),
  work_kind_id uuid,
  nomenclature_id uuid,
  characteristic_id uuid,
  qty numeric(15,3),
  price numeric(15,2),
  amount numeric(15,2),
  discount_pct numeric(5,2),
  discount_amount numeric(15,2),
  vat_rate_id uuid,
  vat_amount numeric(15,2),
  total numeric(15,2),
  content text,
  link_no numeric(5,0),
  multiplicity numeric(10,3),
  coefficient numeric(15,3),
  row_uid text,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.customer_order_work is '1С: Документ.ЗаказПокупателя.Работы (_document813_vt20653x1)';
comment on column doc.customer_order_work.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.customer_order_work.line_no is '1С: Документ.ЗаказПокупателя.Работы.НомерСтроки (_document813_vt20653x1._lineno20654)';
comment on column doc.customer_order_work.work_kind_id is '1С: Документ.ЗаказПокупателя.Работы.ВидРабот (_document813_vt20653x1._fld20655rref)';
comment on column doc.customer_order_work.nomenclature_id is '1С: Документ.ЗаказПокупателя.Работы.Номенклатура (_document813_vt20653x1._fld20656rref)';
comment on column doc.customer_order_work.characteristic_id is '1С: Документ.ЗаказПокупателя.Работы.Характеристика (_document813_vt20653x1._fld20658rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.customer_order_work.qty is '1С: Документ.ЗаказПокупателя.Работы.Количество (_document813_vt20653x1._fld20660)';
comment on column doc.customer_order_work.price is '1С: Документ.ЗаказПокупателя.Работы.Цена (_document813_vt20653x1._fld20661)';
comment on column doc.customer_order_work.amount is '1С: Документ.ЗаказПокупателя.Работы.Сумма (_document813_vt20653x1._fld20662)';
comment on column doc.customer_order_work.discount_pct is '1С: Документ.ЗаказПокупателя.Работы.ПроцентСкидкиНаценки (_document813_vt20653x1._fld20663)';
comment on column doc.customer_order_work.discount_amount is '1С: Документ.ЗаказПокупателя.Работы.СуммаСкидкиНаценки (_document813_vt20653x1._fld20664)';
comment on column doc.customer_order_work.vat_rate_id is '1С: Документ.ЗаказПокупателя.Работы.СтавкаНДС (_document813_vt20653x1._fld20665rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.customer_order_work.vat_amount is '1С: Документ.ЗаказПокупателя.Работы.СуммаНДС (_document813_vt20653x1._fld20666)';
comment on column doc.customer_order_work.total is '1С: Документ.ЗаказПокупателя.Работы.Всего (_document813_vt20653x1._fld20667)';
comment on column doc.customer_order_work.content is '1С: Документ.ЗаказПокупателя.Работы.Содержание (_document813_vt20653x1._fld20668)';
comment on column doc.customer_order_work.link_no is '1С: Документ.ЗаказПокупателя.Работы.КлючСвязи (_document813_vt20653x1._fld20669)';
comment on column doc.customer_order_work.multiplicity is '1С: Документ.ЗаказПокупателя.Работы.Кратность (_document813_vt20653x1._fld20670)';
comment on column doc.customer_order_work.coefficient is '1С: Документ.ЗаказПокупателя.Работы.Коэффициент (_document813_vt20653x1._fld20671)';
comment on column doc.customer_order_work.row_uid is '1С: Документ.ЗаказПокупателя.Работы.ИдентификаторСтроки (_document813_vt20653x1._fld20679)';
comment on column doc.customer_order_work.doc_id is '1С: Документ.ЗаказПокупателя.Работы.Ссылка (_document813_vt20653x1._document813_idrref)';
comment on column doc.customer_order_work.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.customer_order_work.created_at is 'создание записи в vitauto_app';
comment on column doc.customer_order_work.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.customer_order_work.deleted is 'пометка удаления';
comment on column doc.customer_order_work.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.customer_order_work.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.customer_order_work.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.supplier_order (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  date timestamp,
  number text,
  posted boolean,
  author_id uuid,
  currency_id uuid,
  operation text,
  receipt_date timestamp,
  contract_id uuid,
  customer_order_id uuid,
  comment text,
  counterparty_id uuid,
  organization_id uuid,
  responsible_id uuid,
  order_state_id uuid,
  warehouse_id uuid,
  reserve_warehouse_id uuid,
  amount_includes_vat boolean,
  total numeric(15,2),
  base_doc_type text,
  base_doc_id uuid,
  base_doc_value jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.supplier_order is '1С: Документ.ЗаказПоставщику (_document814)';
comment on column doc.supplier_order.id is '1С: Документ.ЗаказПоставщику.Ссылка (_document814._idrref); UUID = Ref_Key 1С';
comment on column doc.supplier_order.onec_version is '1С: Документ.ЗаказПоставщику.ВерсияДанных (_document814._version)';
comment on column doc.supplier_order.deleted is '1С: Документ.ЗаказПоставщику.ПометкаУдаления (_document814._marked)';
comment on column doc.supplier_order.date is '1С: Документ.ЗаказПоставщику.Дата (_document814._date_time)';
comment on column doc.supplier_order.number is '1С: Документ.ЗаказПоставщику.Номер (_document814._number)';
comment on column doc.supplier_order.posted is '1С: Документ.ЗаказПоставщику.Проведен (_document814._posted)';
comment on column doc.supplier_order.author_id is '1С: Документ.ЗаказПоставщику.Автор (_document814._fld20901rref)';
comment on column doc.supplier_order.currency_id is '1С: Документ.ЗаказПоставщику.ВалютаДокумента (_document814._fld20903rref); ссылка Справочник.Валюты (legacy.object)';
comment on column doc.supplier_order.operation is '1С: Документ.ЗаказПоставщику.ВидОперации (_document814._fld20905rref); перечисление Перечисление.ВидыОперацийЗаказПоставщику';
comment on column doc.supplier_order.receipt_date is '1С: Документ.ЗаказПоставщику.ДатаПоступления (_document814._fld20908)';
comment on column doc.supplier_order.contract_id is '1С: Документ.ЗаказПоставщику.Договор (_document814._fld20909rref)';
comment on column doc.supplier_order.customer_order_id is '1С: Документ.ЗаказПоставщику.ЗаказПокупателя (_document814._fld20911rref)';
comment on column doc.supplier_order.comment is '1С: Документ.ЗаказПоставщику.Комментарий (_document814._fld20915)';
comment on column doc.supplier_order.counterparty_id is '1С: Документ.ЗаказПоставщику.Контрагент (_document814._fld20916rref)';
comment on column doc.supplier_order.organization_id is '1С: Документ.ЗаказПоставщику.Организация (_document814._fld20922rref)';
comment on column doc.supplier_order.responsible_id is '1С: Документ.ЗаказПоставщику.Ответственный (_document814._fld20923rref); ссылка Справочник.Сотрудники (legacy.object)';
comment on column doc.supplier_order.order_state_id is '1С: Документ.ЗаказПоставщику.СостояниеЗаказа (_document814._fld20926rref); ссылка Справочник.СостоянияЗаказовПоставщикам (legacy.object)';
comment on column doc.supplier_order.warehouse_id is '1С: Документ.ЗаказПоставщику.СтруктурнаяЕдиница (_document814._fld20927rref)';
comment on column doc.supplier_order.reserve_warehouse_id is '1С: Документ.ЗаказПоставщику.СтруктурнаяЕдиницаРезерв (_document814._fld20928rref)';
comment on column doc.supplier_order.amount_includes_vat is '1С: Документ.ЗаказПоставщику.СуммаВключаетНДС (_document814._fld20929)';
comment on column doc.supplier_order.total is '1С: Документ.ЗаказПоставщику.СуммаДокумента (_document814._fld20930)';
comment on column doc.supplier_order.base_doc_type is '1С: Документ.ЗаказПоставщику.ДокументОснование (_document814._fld20936_type, _fld20936_rtref, _fld20936_rrref); вид значения / тип ссылки';
comment on column doc.supplier_order.base_doc_id is '1С: Документ.ЗаказПоставщику.ДокументОснование (_document814._fld20936_type, _fld20936_rtref, _fld20936_rrref); ссылка';
comment on column doc.supplier_order.base_doc_value is '1С: Документ.ЗаказПоставщику.ДокументОснование (_document814._fld20936_type, _fld20936_rtref, _fld20936_rrref); примитивное значение';
comment on column doc.supplier_order.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.supplier_order.created_at is 'создание записи в vitauto_app';
comment on column doc.supplier_order.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.supplier_order.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.supplier_order.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.supplier_order_item (
  id uuid primary key,
  line_no numeric(5,0),
  nomenclature_id uuid,
  characteristic_id uuid,
  qty numeric(15,3),
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  price numeric(15,2),
  discount_pct numeric(5,2),
  discount_amount numeric(15,2),
  amount numeric(15,2),
  vat_rate_id uuid,
  vat_amount numeric(15,2),
  receipt_date timestamp,
  total numeric(15,2),
  content text,
  customer_order_id uuid,
  reserve_warehouse_id uuid,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.supplier_order_item is '1С: Документ.ЗаказПоставщику.Запасы (_document814_vt20942)';
comment on column doc.supplier_order_item.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.supplier_order_item.line_no is '1С: Документ.ЗаказПоставщику.Запасы.НомерСтроки (_document814_vt20942._lineno20943)';
comment on column doc.supplier_order_item.nomenclature_id is '1С: Документ.ЗаказПоставщику.Запасы.Номенклатура (_document814_vt20942._fld20944rref)';
comment on column doc.supplier_order_item.characteristic_id is '1С: Документ.ЗаказПоставщику.Запасы.Характеристика (_document814_vt20942._fld20945rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.supplier_order_item.qty is '1С: Документ.ЗаказПоставщику.Запасы.Количество (_document814_vt20942._fld20946)';
comment on column doc.supplier_order_item.unit_type is '1С: Документ.ЗаказПоставщику.Запасы.ЕдиницаИзмерения (_document814_vt20942._fld20947_type, _fld20947_rtref, _fld20947_rrref); вид значения / тип ссылки';
comment on column doc.supplier_order_item.unit_id is '1С: Документ.ЗаказПоставщику.Запасы.ЕдиницаИзмерения (_document814_vt20942._fld20947_type, _fld20947_rtref, _fld20947_rrref); ссылка';
comment on column doc.supplier_order_item.unit_value is '1С: Документ.ЗаказПоставщику.Запасы.ЕдиницаИзмерения (_document814_vt20942._fld20947_type, _fld20947_rtref, _fld20947_rrref); примитивное значение';
comment on column doc.supplier_order_item.price is '1С: Документ.ЗаказПоставщику.Запасы.Цена (_document814_vt20942._fld20948)';
comment on column doc.supplier_order_item.discount_pct is '1С: Документ.ЗаказПоставщику.Запасы.ПроцентСкидкиНаценки (_document814_vt20942._fld20949)';
comment on column doc.supplier_order_item.discount_amount is '1С: Документ.ЗаказПоставщику.Запасы.СуммаСкидкиНаценки (_document814_vt20942._fld20950)';
comment on column doc.supplier_order_item.amount is '1С: Документ.ЗаказПоставщику.Запасы.Сумма (_document814_vt20942._fld20951)';
comment on column doc.supplier_order_item.vat_rate_id is '1С: Документ.ЗаказПоставщику.Запасы.СтавкаНДС (_document814_vt20942._fld20952rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.supplier_order_item.vat_amount is '1С: Документ.ЗаказПоставщику.Запасы.СуммаНДС (_document814_vt20942._fld20953)';
comment on column doc.supplier_order_item.receipt_date is '1С: Документ.ЗаказПоставщику.Запасы.ДатаПоступления (_document814_vt20942._fld20954)';
comment on column doc.supplier_order_item.total is '1С: Документ.ЗаказПоставщику.Запасы.Всего (_document814_vt20942._fld20955)';
comment on column doc.supplier_order_item.content is '1С: Документ.ЗаказПоставщику.Запасы.Содержание (_document814_vt20942._fld20956)';
comment on column doc.supplier_order_item.customer_order_id is '1С: Документ.ЗаказПоставщику.Запасы.ЗаказПокупателя (_document814_vt20942._fld20958rref)';
comment on column doc.supplier_order_item.reserve_warehouse_id is '1С: Документ.ЗаказПоставщику.Запасы.СтруктурнаяЕдиницаРезерв (_document814_vt20942._fld20959rref)';
comment on column doc.supplier_order_item.doc_id is '1С: Документ.ЗаказПоставщику.Запасы.Ссылка (_document814_vt20942._document814_idrref)';
comment on column doc.supplier_order_item.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.supplier_order_item.created_at is 'создание записи в vitauto_app';
comment on column doc.supplier_order_item.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.supplier_order_item.deleted is 'пометка удаления';
comment on column doc.supplier_order_item.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.supplier_order_item.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.supplier_order_item.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.receipt (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  date timestamp,
  number text,
  posted boolean,
  author_id uuid,
  currency_id uuid,
  operation text,
  incoming_date timestamp,
  contract_id uuid,
  base_doc_type text,
  base_doc_id uuid,
  base_doc_value jsonb,
  supplier_order_type text,
  supplier_order_id uuid,
  supplier_order_value jsonb,
  comment text,
  counterparty_id uuid,
  incoming_no text,
  organization_id uuid,
  responsible_id uuid,
  warehouse_id uuid,
  amount_includes_vat boolean,
  total numeric(15,2),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.receipt is '1С: Документ.ПриходнаяНакладная (_document954)';
comment on column doc.receipt.id is '1С: Документ.ПриходнаяНакладная.Ссылка (_document954._idrref); UUID = Ref_Key 1С';
comment on column doc.receipt.onec_version is '1С: Документ.ПриходнаяНакладная.ВерсияДанных (_document954._version)';
comment on column doc.receipt.deleted is '1С: Документ.ПриходнаяНакладная.ПометкаУдаления (_document954._marked)';
comment on column doc.receipt.date is '1С: Документ.ПриходнаяНакладная.Дата (_document954._date_time)';
comment on column doc.receipt.number is '1С: Документ.ПриходнаяНакладная.Номер (_document954._number)';
comment on column doc.receipt.posted is '1С: Документ.ПриходнаяНакладная.Проведен (_document954._posted)';
comment on column doc.receipt.author_id is '1С: Документ.ПриходнаяНакладная.Автор (_document954._fld28325rref)';
comment on column doc.receipt.currency_id is '1С: Документ.ПриходнаяНакладная.ВалютаДокумента (_document954._fld28329rref); ссылка Справочник.Валюты (legacy.object)';
comment on column doc.receipt.operation is '1С: Документ.ПриходнаяНакладная.ВидОперации (_document954._fld28330rref); перечисление Перечисление.ВидыОперацийПриходнаяНакладная';
comment on column doc.receipt.incoming_date is '1С: Документ.ПриходнаяНакладная.ДатаВходящегоДокумента (_document954._fld28333)';
comment on column doc.receipt.contract_id is '1С: Документ.ПриходнаяНакладная.Договор (_document954._fld28335rref)';
comment on column doc.receipt.base_doc_type is '1С: Документ.ПриходнаяНакладная.ДокументОснование (_document954._fld28336_type, _fld28336_rtref, _fld28336_rrref); вид значения / тип ссылки';
comment on column doc.receipt.base_doc_id is '1С: Документ.ПриходнаяНакладная.ДокументОснование (_document954._fld28336_type, _fld28336_rtref, _fld28336_rrref); ссылка';
comment on column doc.receipt.base_doc_value is '1С: Документ.ПриходнаяНакладная.ДокументОснование (_document954._fld28336_type, _fld28336_rtref, _fld28336_rrref); примитивное значение';
comment on column doc.receipt.supplier_order_type is '1С: Документ.ПриходнаяНакладная.Заказ (_document954._fld28339_type, _fld28339_rtref, _fld28339_rrref); вид значения / тип ссылки';
comment on column doc.receipt.supplier_order_id is '1С: Документ.ПриходнаяНакладная.Заказ (_document954._fld28339_type, _fld28339_rtref, _fld28339_rrref); ссылка';
comment on column doc.receipt.supplier_order_value is '1С: Документ.ПриходнаяНакладная.Заказ (_document954._fld28339_type, _fld28339_rtref, _fld28339_rrref); примитивное значение';
comment on column doc.receipt.comment is '1С: Документ.ПриходнаяНакладная.Комментарий (_document954._fld28341)';
comment on column doc.receipt.counterparty_id is '1С: Документ.ПриходнаяНакладная.Контрагент (_document954._fld28343rref)';
comment on column doc.receipt.incoming_no is '1С: Документ.ПриходнаяНакладная.НомерВходящегоДокумента (_document954._fld28348)';
comment on column doc.receipt.organization_id is '1С: Документ.ПриходнаяНакладная.Организация (_document954._fld28351rref)';
comment on column doc.receipt.responsible_id is '1С: Документ.ПриходнаяНакладная.Ответственный (_document954._fld28352rref); ссылка Справочник.Сотрудники (legacy.object)';
comment on column doc.receipt.warehouse_id is '1С: Документ.ПриходнаяНакладная.СтруктурнаяЕдиница (_document954._fld28368rref)';
comment on column doc.receipt.amount_includes_vat is '1С: Документ.ПриходнаяНакладная.СуммаВключаетНДС (_document954._fld28369)';
comment on column doc.receipt.total is '1С: Документ.ПриходнаяНакладная.СуммаДокумента (_document954._fld28370)';
comment on column doc.receipt.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.receipt.created_at is 'создание записи в vitauto_app';
comment on column doc.receipt.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.receipt.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.receipt.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.receipt_expense (
  id uuid primary key,
  line_no numeric(5,0),
  nomenclature_id uuid,
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  qty numeric(15,3),
  price numeric(15,2),
  discount_pct numeric(5,2),
  discount_amount numeric(15,2),
  amount numeric(15,2),
  vat_rate_id uuid,
  vat_amount numeric(15,2),
  total numeric(15,2),
  order_doc uuid,
  warehouse_id uuid,
  content text,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.receipt_expense is '1С: Документ.ПриходнаяНакладная.Расходы (_document954_vt28435)';
comment on column doc.receipt_expense.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.receipt_expense.line_no is '1С: Документ.ПриходнаяНакладная.Расходы.НомерСтроки (_document954_vt28435._lineno28436)';
comment on column doc.receipt_expense.nomenclature_id is '1С: Документ.ПриходнаяНакладная.Расходы.Номенклатура (_document954_vt28435._fld28437rref)';
comment on column doc.receipt_expense.unit_type is '1С: Документ.ПриходнаяНакладная.Расходы.ЕдиницаИзмерения (_document954_vt28435._fld28438_type, _fld28438_rtref, _fld28438_rrref); вид значения / тип ссылки';
comment on column doc.receipt_expense.unit_id is '1С: Документ.ПриходнаяНакладная.Расходы.ЕдиницаИзмерения (_document954_vt28435._fld28438_type, _fld28438_rtref, _fld28438_rrref); ссылка';
comment on column doc.receipt_expense.unit_value is '1С: Документ.ПриходнаяНакладная.Расходы.ЕдиницаИзмерения (_document954_vt28435._fld28438_type, _fld28438_rtref, _fld28438_rrref); примитивное значение';
comment on column doc.receipt_expense.qty is '1С: Документ.ПриходнаяНакладная.Расходы.Количество (_document954_vt28435._fld28439)';
comment on column doc.receipt_expense.price is '1С: Документ.ПриходнаяНакладная.Расходы.Цена (_document954_vt28435._fld28440)';
comment on column doc.receipt_expense.discount_pct is '1С: Документ.ПриходнаяНакладная.Расходы.ПроцентСкидкиНаценки (_document954_vt28435._fld28441)';
comment on column doc.receipt_expense.discount_amount is '1С: Документ.ПриходнаяНакладная.Расходы.СуммаСкидкиНаценки (_document954_vt28435._fld28442)';
comment on column doc.receipt_expense.amount is '1С: Документ.ПриходнаяНакладная.Расходы.Сумма (_document954_vt28435._fld28443)';
comment on column doc.receipt_expense.vat_rate_id is '1С: Документ.ПриходнаяНакладная.Расходы.СтавкаНДС (_document954_vt28435._fld28444rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.receipt_expense.vat_amount is '1С: Документ.ПриходнаяНакладная.Расходы.СуммаНДС (_document954_vt28435._fld28445)';
comment on column doc.receipt_expense.total is '1С: Документ.ПриходнаяНакладная.Расходы.Всего (_document954_vt28435._fld28447)';
comment on column doc.receipt_expense.order_doc is '1С: Документ.ПриходнаяНакладная.Расходы.Заказ (_document954_vt28435._fld28448rref)';
comment on column doc.receipt_expense.warehouse_id is '1С: Документ.ПриходнаяНакладная.Расходы.СтруктурнаяЕдиница (_document954_vt28435._fld28449rref)';
comment on column doc.receipt_expense.content is '1С: Документ.ПриходнаяНакладная.Расходы.Содержание (_document954_vt28435._fld28451)';
comment on column doc.receipt_expense.doc_id is '1С: Документ.ПриходнаяНакладная.Расходы.Ссылка (_document954_vt28435._document954_idrref)';
comment on column doc.receipt_expense.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.receipt_expense.created_at is 'создание записи в vitauto_app';
comment on column doc.receipt_expense.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.receipt_expense.deleted is 'пометка удаления';
comment on column doc.receipt_expense.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.receipt_expense.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.receipt_expense.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.receipt_item (
  id uuid primary key,
  line_no numeric(5,0),
  nomenclature_id uuid,
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  characteristic_id uuid,
  price numeric(15,2),
  discount_pct numeric(5,2),
  discount_amount numeric(15,2),
  amount numeric(15,2),
  vat_rate_id uuid,
  vat_amount numeric(15,2),
  order_doc_type text,
  order_doc_id uuid,
  order_doc_value jsonb,
  total numeric(15,2),
  cost numeric(15,2),
  content text,
  link_no numeric(5,0),
  row_uid text,
  batch_id uuid,
  qty numeric(15,3),
  warehouse_id uuid,
  cell_id uuid,
  customer_order_id uuid,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.receipt_item is '1С: Документ.ПриходнаяНакладная.Запасы (_document954_vt28386)';
comment on column doc.receipt_item.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.receipt_item.line_no is '1С: Документ.ПриходнаяНакладная.Запасы.НомерСтроки (_document954_vt28386._lineno28387)';
comment on column doc.receipt_item.nomenclature_id is '1С: Документ.ПриходнаяНакладная.Запасы.Номенклатура (_document954_vt28386._fld28388rref)';
comment on column doc.receipt_item.unit_type is '1С: Документ.ПриходнаяНакладная.Запасы.ЕдиницаИзмерения (_document954_vt28386._fld28389_type, _fld28389_rtref, _fld28389_rrref); вид значения / тип ссылки';
comment on column doc.receipt_item.unit_id is '1С: Документ.ПриходнаяНакладная.Запасы.ЕдиницаИзмерения (_document954_vt28386._fld28389_type, _fld28389_rtref, _fld28389_rrref); ссылка';
comment on column doc.receipt_item.unit_value is '1С: Документ.ПриходнаяНакладная.Запасы.ЕдиницаИзмерения (_document954_vt28386._fld28389_type, _fld28389_rtref, _fld28389_rrref); примитивное значение';
comment on column doc.receipt_item.characteristic_id is '1С: Документ.ПриходнаяНакладная.Запасы.Характеристика (_document954_vt28386._fld28390rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.receipt_item.price is '1С: Документ.ПриходнаяНакладная.Запасы.Цена (_document954_vt28386._fld28392)';
comment on column doc.receipt_item.discount_pct is '1С: Документ.ПриходнаяНакладная.Запасы.ПроцентСкидкиНаценки (_document954_vt28386._fld28393)';
comment on column doc.receipt_item.discount_amount is '1С: Документ.ПриходнаяНакладная.Запасы.СуммаСкидкиНаценки (_document954_vt28386._fld28394)';
comment on column doc.receipt_item.amount is '1С: Документ.ПриходнаяНакладная.Запасы.Сумма (_document954_vt28386._fld28395)';
comment on column doc.receipt_item.vat_rate_id is '1С: Документ.ПриходнаяНакладная.Запасы.СтавкаНДС (_document954_vt28386._fld28396rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.receipt_item.vat_amount is '1С: Документ.ПриходнаяНакладная.Запасы.СуммаНДС (_document954_vt28386._fld28397)';
comment on column doc.receipt_item.order_doc_type is '1С: Документ.ПриходнаяНакладная.Запасы.Заказ (_document954_vt28386._fld28398_type, _fld28398_rtref, _fld28398_rrref); вид значения / тип ссылки';
comment on column doc.receipt_item.order_doc_id is '1С: Документ.ПриходнаяНакладная.Запасы.Заказ (_document954_vt28386._fld28398_type, _fld28398_rtref, _fld28398_rrref); ссылка';
comment on column doc.receipt_item.order_doc_value is '1С: Документ.ПриходнаяНакладная.Запасы.Заказ (_document954_vt28386._fld28398_type, _fld28398_rtref, _fld28398_rrref); примитивное значение';
comment on column doc.receipt_item.total is '1С: Документ.ПриходнаяНакладная.Запасы.Всего (_document954_vt28386._fld28399)';
comment on column doc.receipt_item.cost is '1С: Документ.ПриходнаяНакладная.Запасы.Себестоимость (_document954_vt28386._fld28400)';
comment on column doc.receipt_item.content is '1С: Документ.ПриходнаяНакладная.Запасы.Содержание (_document954_vt28386._fld28402)';
comment on column doc.receipt_item.link_no is '1С: Документ.ПриходнаяНакладная.Запасы.КлючСвязи (_document954_vt28386._fld28403)';
comment on column doc.receipt_item.row_uid is '1С: Документ.ПриходнаяНакладная.Запасы.ИдентификаторСтроки (_document954_vt28386._fld28404)';
comment on column doc.receipt_item.batch_id is '1С: Документ.ПриходнаяНакладная.Запасы.Партия (_document954_vt28386._fld28406rref)';
comment on column doc.receipt_item.qty is '1С: Документ.ПриходнаяНакладная.Запасы.Количество (_document954_vt28386._fld28407)';
comment on column doc.receipt_item.warehouse_id is '1С: Документ.ПриходнаяНакладная.Запасы.СтруктурнаяЕдиница (_document954_vt28386._fld28411rref)';
comment on column doc.receipt_item.cell_id is '1С: Документ.ПриходнаяНакладная.Запасы.Ячейка (_document954_vt28386._fld28412rref); ссылка Справочник.Ячейки (legacy.object)';
comment on column doc.receipt_item.customer_order_id is '1С: Документ.ПриходнаяНакладная.Запасы.ЗаказПокупателя (_document954_vt28386._fld28418rref)';
comment on column doc.receipt_item.doc_id is '1С: Документ.ПриходнаяНакладная.Запасы.Ссылка (_document954_vt28386._document954_idrref)';
comment on column doc.receipt_item.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.receipt_item.created_at is 'создание записи в vitauto_app';
comment on column doc.receipt_item.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.receipt_item.deleted is 'пометка удаления';
comment on column doc.receipt_item.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.receipt_item.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.receipt_item.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.shipment (
  id uuid primary key,
  onec_version text,
  deleted boolean not null default false,
  date timestamp,
  number text,
  posted boolean,
  car_id uuid,
  author_id uuid,
  currency_id uuid,
  operation text,
  contract_id uuid,
  base_doc_type text,
  base_doc_id uuid,
  base_doc_value jsonb,
  customer_order_type text,
  customer_order_id uuid,
  customer_order_value jsonb,
  comment text,
  counterparty_id uuid,
  organization_id uuid,
  responsible_id uuid,
  warehouse_id uuid,
  amount_includes_vat boolean,
  total numeric(15,2),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.shipment is '1С: Документ.РасходнаяНакладная (_document966)';
comment on column doc.shipment.id is '1С: Документ.РасходнаяНакладная.Ссылка (_document966._idrref); UUID = Ref_Key 1С';
comment on column doc.shipment.onec_version is '1С: Документ.РасходнаяНакладная.ВерсияДанных (_document966._version)';
comment on column doc.shipment.deleted is '1С: Документ.РасходнаяНакладная.ПометкаУдаления (_document966._marked)';
comment on column doc.shipment.date is '1С: Документ.РасходнаяНакладная.Дата (_document966._date_time)';
comment on column doc.shipment.number is '1С: Документ.РасходнаяНакладная.Номер (_document966._number)';
comment on column doc.shipment.posted is '1С: Документ.РасходнаяНакладная.Проведен (_document966._posted)';
comment on column doc.shipment.car_id is '1С: Документ.РасходнаяНакладная.Автомобиль (_document966._fld29035rref); ссылка Справочник.ТранспортныеСредства (legacy.object)';
comment on column doc.shipment.author_id is '1С: Документ.РасходнаяНакладная.Автор (_document966._fld29036rref)';
comment on column doc.shipment.currency_id is '1С: Документ.РасходнаяНакладная.ВалютаДокумента (_document966._fld29044rref); ссылка Справочник.Валюты (legacy.object)';
comment on column doc.shipment.operation is '1С: Документ.РасходнаяНакладная.ВидОперации (_document966._fld29046rref); перечисление Перечисление.ВидыОперацийРасходнаяНакладная';
comment on column doc.shipment.contract_id is '1С: Документ.РасходнаяНакладная.Договор (_document966._fld29059rref)';
comment on column doc.shipment.base_doc_type is '1С: Документ.РасходнаяНакладная.ДокументОснование (_document966._fld29060_type, _fld29060_rtref, _fld29060_rrref); вид значения / тип ссылки';
comment on column doc.shipment.base_doc_id is '1С: Документ.РасходнаяНакладная.ДокументОснование (_document966._fld29060_type, _fld29060_rtref, _fld29060_rrref); ссылка';
comment on column doc.shipment.base_doc_value is '1С: Документ.РасходнаяНакладная.ДокументОснование (_document966._fld29060_type, _fld29060_rtref, _fld29060_rrref); примитивное значение';
comment on column doc.shipment.customer_order_type is '1С: Документ.РасходнаяНакладная.Заказ (_document966._fld29064_type, _fld29064_rtref, _fld29064_rrref); вид значения / тип ссылки';
comment on column doc.shipment.customer_order_id is '1С: Документ.РасходнаяНакладная.Заказ (_document966._fld29064_type, _fld29064_rtref, _fld29064_rrref); ссылка';
comment on column doc.shipment.customer_order_value is '1С: Документ.РасходнаяНакладная.Заказ (_document966._fld29064_type, _fld29064_rtref, _fld29064_rrref); примитивное значение';
comment on column doc.shipment.comment is '1С: Документ.РасходнаяНакладная.Комментарий (_document966._fld29067)';
comment on column doc.shipment.counterparty_id is '1С: Документ.РасходнаяНакладная.Контрагент (_document966._fld29069rref)';
comment on column doc.shipment.organization_id is '1С: Документ.РасходнаяНакладная.Организация (_document966._fld29080rref)';
comment on column doc.shipment.responsible_id is '1С: Документ.РасходнаяНакладная.Ответственный (_document966._fld29084rref); ссылка Справочник.Сотрудники (legacy.object)';
comment on column doc.shipment.warehouse_id is '1С: Документ.РасходнаяНакладная.СтруктурнаяЕдиница (_document966._fld29103rref)';
comment on column doc.shipment.amount_includes_vat is '1С: Документ.РасходнаяНакладная.СуммаВключаетНДС (_document966._fld29104)';
comment on column doc.shipment.total is '1С: Документ.РасходнаяНакладная.СуммаДокумента (_document966._fld29105)';
comment on column doc.shipment.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.shipment.created_at is 'создание записи в vitauto_app';
comment on column doc.shipment.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.shipment.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.shipment.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table doc.shipment_item (
  id uuid primary key,
  line_no numeric(5,0),
  total numeric(15,2),
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  order_doc_type text,
  order_doc_id uuid,
  order_doc_value jsonb,
  customer_order_id uuid,
  row_uid text,
  link_no numeric(5,0),
  qty numeric(15,3),
  nomenclature_id uuid,
  batch_id uuid,
  discount_pct numeric(5,2),
  reserve_qty numeric(15,3),
  content text,
  vat_rate_id uuid,
  warehouse_id uuid,
  amount numeric(15,2),
  vat_amount numeric(15,2),
  discount_amount numeric(15,2),
  characteristic_id uuid,
  price numeric(15,2),
  cell_id uuid,
  doc_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid
);
comment on table doc.shipment_item is '1С: Документ.РасходнаяНакладная.Запасы (_document966_vt29136)';
comment on column doc.shipment_item.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column doc.shipment_item.line_no is '1С: Документ.РасходнаяНакладная.Запасы.НомерСтроки (_document966_vt29136._lineno29137)';
comment on column doc.shipment_item.total is '1С: Документ.РасходнаяНакладная.Запасы.Всего (_document966_vt29136._fld29139)';
comment on column doc.shipment_item.unit_type is '1С: Документ.РасходнаяНакладная.Запасы.ЕдиницаИзмерения (_document966_vt29136._fld29141_type, _fld29141_rtref, _fld29141_rrref); вид значения / тип ссылки';
comment on column doc.shipment_item.unit_id is '1С: Документ.РасходнаяНакладная.Запасы.ЕдиницаИзмерения (_document966_vt29136._fld29141_type, _fld29141_rtref, _fld29141_rrref); ссылка';
comment on column doc.shipment_item.unit_value is '1С: Документ.РасходнаяНакладная.Запасы.ЕдиницаИзмерения (_document966_vt29136._fld29141_type, _fld29141_rtref, _fld29141_rrref); примитивное значение';
comment on column doc.shipment_item.order_doc_type is '1С: Документ.РасходнаяНакладная.Запасы.Заказ (_document966_vt29136._fld29142_type, _fld29142_rtref, _fld29142_rrref); вид значения / тип ссылки';
comment on column doc.shipment_item.order_doc_id is '1С: Документ.РасходнаяНакладная.Запасы.Заказ (_document966_vt29136._fld29142_type, _fld29142_rtref, _fld29142_rrref); ссылка';
comment on column doc.shipment_item.order_doc_value is '1С: Документ.РасходнаяНакладная.Запасы.Заказ (_document966_vt29136._fld29142_type, _fld29142_rtref, _fld29142_rrref); примитивное значение';
comment on column doc.shipment_item.customer_order_id is '1С: Документ.РасходнаяНакладная.Запасы.ЗаказПокупателя (_document966_vt29136._fld29143rref)';
comment on column doc.shipment_item.row_uid is '1С: Документ.РасходнаяНакладная.Запасы.ИдентификаторСтроки (_document966_vt29136._fld29144)';
comment on column doc.shipment_item.link_no is '1С: Документ.РасходнаяНакладная.Запасы.КлючСвязи (_document966_vt29136._fld29145)';
comment on column doc.shipment_item.qty is '1С: Документ.РасходнаяНакладная.Запасы.Количество (_document966_vt29136._fld29147)';
comment on column doc.shipment_item.nomenclature_id is '1С: Документ.РасходнаяНакладная.Запасы.Номенклатура (_document966_vt29136._fld29148rref)';
comment on column doc.shipment_item.batch_id is '1С: Документ.РасходнаяНакладная.Запасы.Партия (_document966_vt29136._fld29152rref)';
comment on column doc.shipment_item.discount_pct is '1С: Документ.РасходнаяНакладная.Запасы.ПроцентСкидкиНаценки (_document966_vt29136._fld29156)';
comment on column doc.shipment_item.reserve_qty is '1С: Документ.РасходнаяНакладная.Запасы.Резерв (_document966_vt29136._fld29157)';
comment on column doc.shipment_item.content is '1С: Документ.РасходнаяНакладная.Запасы.Содержание (_document966_vt29136._fld29159)';
comment on column doc.shipment_item.vat_rate_id is '1С: Документ.РасходнаяНакладная.Запасы.СтавкаНДС (_document966_vt29136._fld29160rref); ссылка Справочник.СтавкиНДС (legacy.object)';
comment on column doc.shipment_item.warehouse_id is '1С: Документ.РасходнаяНакладная.Запасы.СтруктурнаяЕдиница (_document966_vt29136._fld29162rref)';
comment on column doc.shipment_item.amount is '1С: Документ.РасходнаяНакладная.Запасы.Сумма (_document966_vt29136._fld29163)';
comment on column doc.shipment_item.vat_amount is '1С: Документ.РасходнаяНакладная.Запасы.СуммаНДС (_document966_vt29136._fld29165)';
comment on column doc.shipment_item.discount_amount is '1С: Документ.РасходнаяНакладная.Запасы.СуммаСкидкиНаценки (_document966_vt29136._fld29166)';
comment on column doc.shipment_item.characteristic_id is '1С: Документ.РасходнаяНакладная.Запасы.Характеристика (_document966_vt29136._fld29170rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column doc.shipment_item.price is '1С: Документ.РасходнаяНакладная.Запасы.Цена (_document966_vt29136._fld29172)';
comment on column doc.shipment_item.cell_id is '1С: Документ.РасходнаяНакладная.Запасы.Ячейка (_document966_vt29136._fld29173rref); ссылка Справочник.Ячейки (legacy.object)';
comment on column doc.shipment_item.doc_id is '1С: Документ.РасходнаяНакладная.Запасы.Ссылка (_document966_vt29136._document966_idrref)';
comment on column doc.shipment_item.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column doc.shipment_item.created_at is 'создание записи в vitauto_app';
comment on column doc.shipment_item.updated_at is 'последнее изменение записи в vitauto_app';
comment on column doc.shipment_item.deleted is 'пометка удаления';
comment on column doc.shipment_item.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column doc.shipment_item.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column doc.shipment_item.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';

create table ref.car_attribute (
  id uuid primary key,
  period timestamp,
  car_id uuid,
  attr_kind text,
  value_type text,
  value_id uuid,
  value_value jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table ref.car_attribute is '1С: РегистрСведений.асАвтомобили (_inforg48524)';
comment on column ref.car_attribute.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column ref.car_attribute.period is '1С: РегистрСведений.асАвтомобили.Период (_inforg48524._period)';
comment on column ref.car_attribute.car_id is '1С: РегистрСведений.асАвтомобили.Автомобиль (_inforg48524._fld48525rref)';
comment on column ref.car_attribute.attr_kind is '1С: РегистрСведений.асАвтомобили.ВидЗначения (_inforg48524._fld48526rref); перечисление Перечисление.асДополнительнаяИнформацияАвтомобилей';
comment on column ref.car_attribute.value_type is '1С: РегистрСведений.асАвтомобили.Значение (_inforg48524._fld48527_type, _fld48527_n, _fld48527_s, _fld48527_rrref); вид значения / тип ссылки';
comment on column ref.car_attribute.value_id is '1С: РегистрСведений.асАвтомобили.Значение (_inforg48524._fld48527_type, _fld48527_n, _fld48527_s, _fld48527_rrref); ссылка';
comment on column ref.car_attribute.value_value is '1С: РегистрСведений.асАвтомобили.Значение (_inforg48524._fld48527_type, _fld48527_n, _fld48527_s, _fld48527_rrref); примитивное значение';
comment on column ref.car_attribute.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.car_attribute.created_at is 'создание записи в vitauto_app';
comment on column ref.car_attribute.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.car_attribute.deleted is 'пометка удаления';
comment on column ref.car_attribute.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column ref.car_attribute.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.car_attribute.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column ref.car_attribute.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table ref.labor_price (
  id uuid primary key,
  period timestamp,
  recorder uuid,
  line_no numeric(9,0),
  active boolean,
  price_type_id uuid,
  nomenclature_id uuid,
  model_id uuid,
  repair_kind_id uuid,
  warehouse_id uuid,
  contract_id uuid,
  norm_hour uuid,
  currency_id uuid,
  price numeric(15,2),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table ref.labor_price is '1С: РегистрСведений.асЦеныАвторабот (_inforg48532)';
comment on column ref.labor_price.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column ref.labor_price.period is '1С: РегистрСведений.асЦеныАвторабот.Период (_inforg48532._period)';
comment on column ref.labor_price.recorder is '1С: РегистрСведений.асЦеныАвторабот.Регистратор (_inforg48532._recorderrref)';
comment on column ref.labor_price.line_no is '1С: РегистрСведений.асЦеныАвторабот.НомерСтроки (_inforg48532._lineno)';
comment on column ref.labor_price.active is '1С: РегистрСведений.асЦеныАвторабот.Активность (_inforg48532._active)';
comment on column ref.labor_price.price_type_id is '1С: РегистрСведений.асЦеныАвторабот.ВидЦен (_inforg48532._fld48533rref)';
comment on column ref.labor_price.nomenclature_id is '1С: РегистрСведений.асЦеныАвторабот.Номенклатура (_inforg48532._fld48534rref)';
comment on column ref.labor_price.model_id is '1С: РегистрСведений.асЦеныАвторабот.Модель (_inforg48532._fld48535rref)';
comment on column ref.labor_price.repair_kind_id is '1С: РегистрСведений.асЦеныАвторабот.ВидРемонта (_inforg48532._fld48536rref); ссылка Справочник.асВидыРемонта (legacy.object)';
comment on column ref.labor_price.warehouse_id is '1С: РегистрСведений.асЦеныАвторабот.СтруктурнаяЕдиница (_inforg48532._fld48537rref)';
comment on column ref.labor_price.contract_id is '1С: РегистрСведений.асЦеныАвторабот.Договор (_inforg48532._fld48538rref)';
comment on column ref.labor_price.norm_hour is '1С: РегистрСведений.асЦеныАвторабот.Нормочас (_inforg48532._fld48539rref); ссылка Справочник.асНормочасы (legacy.object)';
comment on column ref.labor_price.currency_id is '1С: РегистрСведений.асЦеныАвторабот.Валюта (_inforg48532._fld48540rref); ссылка Справочник.Валюты (legacy.object)';
comment on column ref.labor_price.price is '1С: РегистрСведений.асЦеныАвторабот.Цена (_inforg48532._fld48541)';
comment on column ref.labor_price.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.labor_price.created_at is 'создание записи в vitauto_app';
comment on column ref.labor_price.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.labor_price.deleted is 'пометка удаления';
comment on column ref.labor_price.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column ref.labor_price.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.labor_price.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column ref.labor_price.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table ref.price (
  id uuid primary key,
  period timestamp,
  price_type_id uuid,
  nomenclature_id uuid,
  characteristic_id uuid,
  price numeric(15,2),
  actual boolean,
  unit_type text,
  unit_id uuid,
  unit_value jsonb,
  currency_id uuid,
  author_id uuid,
  set_by_doc_type text,
  set_by_doc_id uuid,
  set_by_doc_value jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table ref.price is '1С: РегистрСведений.ЦеныНоменклатуры (_inforg48319)';
comment on column ref.price.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column ref.price.period is '1С: РегистрСведений.ЦеныНоменклатуры.Период (_inforg48319._period)';
comment on column ref.price.price_type_id is '1С: РегистрСведений.ЦеныНоменклатуры.ВидЦен (_inforg48319._fld48320rref)';
comment on column ref.price.nomenclature_id is '1С: РегистрСведений.ЦеныНоменклатуры.Номенклатура (_inforg48319._fld48321rref)';
comment on column ref.price.characteristic_id is '1С: РегистрСведений.ЦеныНоменклатуры.Характеристика (_inforg48319._fld48322rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column ref.price.price is '1С: РегистрСведений.ЦеныНоменклатуры.Цена (_inforg48319._fld48323)';
comment on column ref.price.actual is '1С: РегистрСведений.ЦеныНоменклатуры.Актуальность (_inforg48319._fld48324)';
comment on column ref.price.unit_type is '1С: РегистрСведений.ЦеныНоменклатуры.ЕдиницаИзмерения (_inforg48319._fld48325_type, _fld48325_rtref, _fld48325_rrref); вид значения / тип ссылки';
comment on column ref.price.unit_id is '1С: РегистрСведений.ЦеныНоменклатуры.ЕдиницаИзмерения (_inforg48319._fld48325_type, _fld48325_rtref, _fld48325_rrref); ссылка';
comment on column ref.price.unit_value is '1С: РегистрСведений.ЦеныНоменклатуры.ЕдиницаИзмерения (_inforg48319._fld48325_type, _fld48325_rtref, _fld48325_rrref); примитивное значение';
comment on column ref.price.currency_id is '1С: РегистрСведений.ЦеныНоменклатуры.ВалютаЦены (_inforg48319._fld48326rref); ссылка Справочник.Валюты (legacy.object)';
comment on column ref.price.author_id is '1С: РегистрСведений.ЦеныНоменклатуры.Автор (_inforg48319._fld48328rref)';
comment on column ref.price.set_by_doc_type is '1С: РегистрСведений.ЦеныНоменклатуры.ДокументУстановки (_inforg48319._fld48329_type, _fld48329_rtref, _fld48329_rrref); вид значения / тип ссылки';
comment on column ref.price.set_by_doc_id is '1С: РегистрСведений.ЦеныНоменклатуры.ДокументУстановки (_inforg48319._fld48329_type, _fld48329_rtref, _fld48329_rrref); ссылка';
comment on column ref.price.set_by_doc_value is '1С: РегистрСведений.ЦеныНоменклатуры.ДокументУстановки (_inforg48319._fld48329_type, _fld48329_rtref, _fld48329_rrref); примитивное значение';
comment on column ref.price.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.price.created_at is 'создание записи в vitauto_app';
comment on column ref.price.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.price.deleted is 'пометка удаления';
comment on column ref.price.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column ref.price.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.price.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column ref.price.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table stock.move (
  id uuid primary key,
  period timestamp,
  recorder_type text,
  recorder_id uuid,
  line_no numeric(9,0),
  active boolean,
  movement numeric(1,0),
  organization_id uuid,
  warehouse_type text,
  warehouse_id uuid,
  warehouse_value jsonb,
  nomenclature_id uuid,
  characteristic_id uuid,
  batch_id uuid,
  customer_order uuid,
  account_id uuid,
  work_order_id uuid,
  qty numeric(15,3),
  amount numeric(15,2),
  amount_net numeric(15,2),
  corr_warehouse_type text,
  corr_warehouse_id uuid,
  corr_warehouse_value jsonb,
  corr_nomenclature_id uuid,
  corr_batch_id uuid,
  is_return boolean,
  content text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table stock.move is '1С: РегистрНакопления.Запасы (_accumrg49073)';
comment on column stock.move.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column stock.move.period is '1С: РегистрНакопления.Запасы.Период (_accumrg49073._period)';
comment on column stock.move.recorder_type is '1С: РегистрНакопления.Запасы.Регистратор (_accumrg49073._recordertref, _recorderrref); тип ссылки';
comment on column stock.move.recorder_id is '1С: РегистрНакопления.Запасы.Регистратор (_accumrg49073._recordertref, _recorderrref); ссылка';
comment on column stock.move.line_no is '1С: РегистрНакопления.Запасы.НомерСтроки (_accumrg49073._lineno)';
comment on column stock.move.active is '1С: РегистрНакопления.Запасы.Активность (_accumrg49073._active)';
comment on column stock.move.movement is '1С: РегистрНакопления.Запасы.ВидДвижения (_accumrg49073._recordkind)';
comment on column stock.move.organization_id is '1С: РегистрНакопления.Запасы.Организация (_accumrg49073._fld49074rref)';
comment on column stock.move.warehouse_type is '1С: РегистрНакопления.Запасы.СтруктурнаяЕдиница (_accumrg49073._fld49075_type, _fld49075_rtref, _fld49075_rrref); вид значения / тип ссылки';
comment on column stock.move.warehouse_id is '1С: РегистрНакопления.Запасы.СтруктурнаяЕдиница (_accumrg49073._fld49075_type, _fld49075_rtref, _fld49075_rrref); ссылка';
comment on column stock.move.warehouse_value is '1С: РегистрНакопления.Запасы.СтруктурнаяЕдиница (_accumrg49073._fld49075_type, _fld49075_rtref, _fld49075_rrref); примитивное значение';
comment on column stock.move.nomenclature_id is '1С: РегистрНакопления.Запасы.Номенклатура (_accumrg49073._fld49076rref)';
comment on column stock.move.characteristic_id is '1С: РегистрНакопления.Запасы.Характеристика (_accumrg49073._fld49077rref); ссылка Справочник.ХарактеристикиНоменклатуры (legacy.object)';
comment on column stock.move.batch_id is '1С: РегистрНакопления.Запасы.Партия (_accumrg49073._fld49078rref)';
comment on column stock.move.customer_order is '1С: РегистрНакопления.Запасы.ЗаказПокупателя (_accumrg49073._fld49079rref)';
comment on column stock.move.account_id is '1С: РегистрНакопления.Запасы.СчетУчета (_accumrg49073._fld49080rref); ссылка ПланСчетов.Управленческий (legacy.object)';
comment on column stock.move.work_order_id is '1С: РегистрНакопления.Запасы.асЗаказНаряд (_accumrg49073._fld49082rref); ссылка Документ.асЗаказНаряд (legacy.object)';
comment on column stock.move.qty is '1С: РегистрНакопления.Запасы.Количество (_accumrg49073._fld49084)';
comment on column stock.move.amount is '1С: РегистрНакопления.Запасы.Сумма (_accumrg49073._fld49085)';
comment on column stock.move.amount_net is '1С: РегистрНакопления.Запасы.СуммаБезНДС (_accumrg49073._fld49088)';
comment on column stock.move.corr_warehouse_type is '1С: РегистрНакопления.Запасы.КоррСтруктурнаяЕдиница (_accumrg49073._fld49090_type, _fld49090_rtref, _fld49090_rrref); вид значения / тип ссылки';
comment on column stock.move.corr_warehouse_id is '1С: РегистрНакопления.Запасы.КоррСтруктурнаяЕдиница (_accumrg49073._fld49090_type, _fld49090_rtref, _fld49090_rrref); ссылка';
comment on column stock.move.corr_warehouse_value is '1С: РегистрНакопления.Запасы.КоррСтруктурнаяЕдиница (_accumrg49073._fld49090_type, _fld49090_rtref, _fld49090_rrref); примитивное значение';
comment on column stock.move.corr_nomenclature_id is '1С: РегистрНакопления.Запасы.КоррНоменклатура (_accumrg49073._fld49092rref)';
comment on column stock.move.corr_batch_id is '1С: РегистрНакопления.Запасы.КоррПартия (_accumrg49073._fld49094rref)';
comment on column stock.move.is_return is '1С: РегистрНакопления.Запасы.Возврат (_accumrg49073._fld49106)';
comment on column stock.move.content is '1С: РегистрНакопления.Запасы.СодержаниеПроводки (_accumrg49073._fld49107)';
comment on column stock.move.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column stock.move.created_at is 'создание записи в vitauto_app';
comment on column stock.move.updated_at is 'последнее изменение записи в vitauto_app';
comment on column stock.move.deleted is 'пометка удаления';
comment on column stock.move.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column stock.move.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column stock.move.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column stock.move.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table arm.line (
  id uuid primary key,
  customer_order_id uuid,
  supplier_order_id uuid,
  receipt_id uuid,
  link_key text,
  operation text,
  onec_record_id text,
  manual_edit boolean,
  client_order_number text,
  marked boolean,
  fact_name text,
  fact_qty text,
  vehicle_plate text,
  nomenclature_id uuid,
  quantity numeric(10,2),
  supplier_id uuid,
  batch_id uuid,
  marked_by_id uuid,
  sort_order numeric(31,4),
  stock_qty numeric(15,0),
  status text,
  deleted boolean not null default false,
  stock_total_qty numeric(15,0),
  sale_price numeric(15,1),
  manual_batch boolean,
  cost_sum numeric(15,2),
  manual_split_by_batch boolean,
  contract_id uuid,
  customer_id uuid,
  comment text,
  shipment_date timestamp,
  shipment_number text,
  shipment_doc_id uuid,
  receipt_date timestamp,
  order_date timestamp,
  internal_order_number text,
  service_type_id uuid,
  urgency text,
  territory text,
  fact_article text,
  fact_unit text,
  payment_form_id uuid,
  cost_price numeric(15,2),
  price_change_type numeric(10,0),
  coefficient numeric(10,3),
  signed_original boolean,
  brand text,
  model text,
  aggregate text,
  plate text,
  vin text,
  engine text,
  norm_hours numeric(15,3),
  rrc numeric(15,2),
  paid text,
  supplier_ship_territory text,
  chassis text,
  reserve_qty numeric(15,3),
  in_transit_qty numeric(15,3),
  upd_date timestamp,
  upd_number text,
  invoice_number text,
  invoice_date timestamp,
  comment2 text,
  supplier_order_date timestamp,
  delivery_term timestamp,
  cell_legacy text,
  assembly_sent_date timestamp,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table arm.line is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж (_inforg56838x1)';
comment on column arm.line.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column arm.line.customer_order_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДокументЗаказПокупателя (_inforg56838x1._fld56839rref)';
comment on column arm.line.supplier_order_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДокументЗаказПоставщика (_inforg56838x1._fld56840rref)';
comment on column arm.line.receipt_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДокументПриходнаяНакладная (_inforg56838x1._fld56841rref)';
comment on column arm.line.link_key is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КлючСвязиСтрок (_inforg56838x1._fld56842)';
comment on column arm.line.operation is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ВидОперации (_inforg56838x1._fld56843rref); перечисление Перечисление.Арм_ВидыОпераций';
comment on column arm.line.onec_record_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ИдентификаторЗаписи (_inforg56838x1._fld56844)';
comment on column arm.line.manual_edit is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.РучнаяПравка (_inforg56838x1._fld56845)';
comment on column arm.line.client_order_number is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерЗаказаКлиента (_inforg56838x1._fld56846)';
comment on column arm.line.marked is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ОтметкаСтроки (_inforg56838x1._fld56847)';
comment on column arm.line.fact_name is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НоменклатураКлиента (_inforg56838x1._fld56848)';
comment on column arm.line.fact_qty is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КоличествоКлиента (_inforg56838x1._fld56849)';
comment on column arm.line.vehicle_plate is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ГРЗКлиента (_inforg56838x1._fld56850)';
comment on column arm.line.nomenclature_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Номенклатура (_inforg56838x1._fld56851rref)';
comment on column arm.line.quantity is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Количество (_inforg56838x1._fld56852)';
comment on column arm.line.supplier_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Поставщик (_inforg56838x1._fld56853rref)';
comment on column arm.line.batch_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Партия (_inforg56838x1._fld56854rref)';
comment on column arm.line.marked_by_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.АвторСтроки (_inforg56838x1._fld56855rref)';
comment on column arm.line.sort_order is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Порядок (_inforg56838x1._fld56856)';
comment on column arm.line.stock_qty is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ОстатокДляСтроки (_inforg56838x1._fld56857)';
comment on column arm.line.status is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.СтатусСтроки (_inforg56838x1._fld56858rref); перечисление Перечисление.Арм_СтатусыАРМ';
comment on column arm.line.deleted is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Удаление (_inforg56838x1._fld56859)';
comment on column arm.line.stock_total_qty is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ОстатокТовара (_inforg56838x1._fld56860)';
comment on column arm.line.sale_price is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Цена (_inforg56838x1._fld56861)';
comment on column arm.line.manual_batch is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.РучнаяПравкаПартии (_inforg56838x1._fld56862)';
comment on column arm.line.cost_sum is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Себестоимость (_inforg56838x1._fld56863)';
comment on column arm.line.manual_split_by_batch is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.РучноеРазделениеСУчетомПартий (_inforg56838x1._fld56864)';
comment on column arm.line.contract_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Договор (_inforg56838x1._fld56865rref)';
comment on column arm.line.customer_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Покупатель (_inforg56838x1._fld56866rref)';
comment on column arm.line.comment is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КомментарийКСтроке (_inforg56838x1._fld56867)';
comment on column arm.line.shipment_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаОтгрузки (_inforg56838x1._fld56868)';
comment on column arm.line.shipment_number is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерОтгрузки (_inforg56838x1._fld56869)';
comment on column arm.line.shipment_doc_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.РасходнаяНакладная (_inforg56838x1._fld56870rref)';
comment on column arm.line.receipt_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаПоступления (_inforg56838x1._fld56871)';
comment on column arm.line.order_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаЗаказа (_inforg56838x1._fld56872)';
comment on column arm.line.internal_order_number is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерЗаказа (_inforg56838x1._fld56873)';
comment on column arm.line.service_type_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ВидУслуги (_inforg56838x1._fld56874rref)';
comment on column arm.line.urgency is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.СрочностьКлиента (_inforg56838x1._fld56875)';
comment on column arm.line.territory is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ТерриторияКлиента (_inforg56838x1._fld56876)';
comment on column arm.line.fact_article is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.АртикулКлиента (_inforg56838x1._fld56877)';
comment on column arm.line.fact_unit is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ЕдиницаИзмеренияКлиента (_inforg56838x1._fld56878)';
comment on column arm.line.payment_form_id is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ФормаОплаты (_inforg56838x1._fld56879rref)';
comment on column arm.line.cost_price is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.СебестоимостьЕдиницы (_inforg56838x1._fld56880)';
comment on column arm.line.price_change_type is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ТипИзмененияЦены (_inforg56838x1._fld56881)';
comment on column arm.line.coefficient is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Коэффициент (_inforg56838x1._fld56882)';
comment on column arm.line.signed_original is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДокументПодписанОригинал (_inforg56838x1._fld56904)';
comment on column arm.line.brand is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Марка (_inforg56838x1._fld56905)';
comment on column arm.line.model is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Модель (_inforg56838x1._fld56906)';
comment on column arm.line.aggregate is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Агрегат (_inforg56838x1._fld56907)';
comment on column arm.line.plate is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Госномер (_inforg56838x1._fld56908)';
comment on column arm.line.vin is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.VIN (_inforg56838x1._fld56909)';
comment on column arm.line.engine is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Двигатель (_inforg56838x1._fld56910)';
comment on column arm.line.norm_hours is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КоличествоНормаЧас (_inforg56838x1._fld56911)';
comment on column arm.line.rrc is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.РРЦ (_inforg56838x1._fld56912)';
comment on column arm.line.paid is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.Оплачено (_inforg56838x1._fld56913)';
comment on column arm.line.supplier_ship_territory is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ТерриторияОтгрузкиПоставщиком (_inforg56838x1._fld56914)';
comment on column arm.line.chassis is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерШасси (_inforg56838x1._fld56915)';
comment on column arm.line.reserve_qty is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КоличествоВРезерве (_inforg56838x1._fld56916)';
comment on column arm.line.in_transit_qty is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КоличествоВПути (_inforg56838x1._fld56917)';
comment on column arm.line.upd_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаУПД (_inforg56838x1._fld56918)';
comment on column arm.line.upd_number is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерУПД (_inforg56838x1._fld56919)';
comment on column arm.line.invoice_number is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.НомерСчета (_inforg56838x1._fld56920)';
comment on column arm.line.invoice_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаСчета (_inforg56838x1._fld56921)';
comment on column arm.line.comment2 is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.КомментарийКСтроке2 (_inforg56838x1._fld56922)';
comment on column arm.line.supplier_order_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаЗаказаПоставщику (_inforg56838x1._fld56923)';
comment on column arm.line.delivery_term is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.СрокПоставки (_inforg56838x1._fld56924)';
comment on column arm.line.cell_legacy is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ЯчейкаСклада (_inforg56838x1._fld56925)';
comment on column arm.line.assembly_sent_date is '1С: РегистрСведений.Арм_ДанныеЗакупокИПродаж.ДатаОтправкиНаСборку (_inforg56838x1._fld56926)';
comment on column arm.line.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column arm.line.created_at is 'создание записи в vitauto_app';
comment on column arm.line.updated_at is 'последнее изменение записи в vitauto_app';
comment on column arm.line.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column arm.line.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column arm.line.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column arm.line.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table arm.notice (
  id uuid primary key,
  onec_record_id text,
  created_at timestamp,
  node text,
  kind text,
  recipient_role text,
  text text,
  customer_order_id uuid,
  author_id uuid,
  is_read boolean,
  read_by_id uuid,
  read_at timestamp,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table arm.notice is '1С: РегистрСведений.Арм_Уведомления (_inforg56936x1)';
comment on column arm.notice.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column arm.notice.onec_record_id is '1С: РегистрСведений.Арм_Уведомления.Ид (_inforg56936x1._fld56937)';
comment on column arm.notice.created_at is '1С: РегистрСведений.Арм_Уведомления.Дата (_inforg56936x1._fld56938)';
comment on column arm.notice.node is '1С: РегистрСведений.Арм_Уведомления.Узел (_inforg56936x1._fld56939)';
comment on column arm.notice.kind is '1С: РегистрСведений.Арм_Уведомления.Вид (_inforg56936x1._fld56940)';
comment on column arm.notice.recipient_role is '1С: РегистрСведений.Арм_Уведомления.РольПолучателя (_inforg56936x1._fld56941rref); перечисление Перечисление.Арм_РолиИнтерфейса';
comment on column arm.notice.text is '1С: РегистрСведений.Арм_Уведомления.Текст (_inforg56936x1._fld56942)';
comment on column arm.notice.customer_order_id is '1С: РегистрСведений.Арм_Уведомления.ДокументЗаказПокупателя (_inforg56936x1._fld56943rref)';
comment on column arm.notice.author_id is '1С: РегистрСведений.Арм_Уведомления.Автор (_inforg56936x1._fld56944rref)';
comment on column arm.notice.is_read is '1С: РегистрСведений.Арм_Уведомления.Прочитано (_inforg56936x1._fld56945)';
comment on column arm.notice.read_by_id is '1С: РегистрСведений.Арм_Уведомления.Прочитал (_inforg56936x1._fld56946rref)';
comment on column arm.notice.read_at is '1С: РегистрСведений.Арм_Уведомления.ДатаПрочтения (_inforg56936x1._fld56947)';
comment on column arm.notice.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column arm.notice.updated_at is 'последнее изменение записи в vitauto_app';
comment on column arm.notice.deleted is 'пометка удаления';
comment on column arm.notice.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column arm.notice.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column arm.notice.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column arm.notice.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table arm.user_role (
  id uuid primary key,
  user_id uuid,
  role text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_key text not null unique
);
comment on table arm.user_role is '1С: РегистрСведений.Арм_ПраваПользователей (_inforg56890x1)';
comment on column arm.user_role.id is 'UUID v5 / ИдентификаторЗаписи, план 5.2';
comment on column arm.user_role.user_id is '1С: РегистрСведений.Арм_ПраваПользователей.Пользователь (_inforg56890x1._fld56891rref)';
comment on column arm.user_role.role is '1С: РегистрСведений.Арм_ПраваПользователей.РольИнтерфейса (_inforg56890x1._fld56892rref); перечисление Перечисление.Арм_РолиИнтерфейса';
comment on column arm.user_role.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column arm.user_role.created_at is 'создание записи в vitauto_app';
comment on column arm.user_role.updated_at is 'последнее изменение записи в vitauto_app';
comment on column arm.user_role.deleted is 'пометка удаления';
comment on column arm.user_role.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column arm.user_role.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column arm.user_role.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column arm.user_role.onec_key is 'ключ записи регистра 1С (регистратор:строка или md5 записи)';

create table ref.contact_info (
  id uuid primary key,
  line_no numeric(5,0),
  type text,
  kind uuid,
  presentation text,
  fields_xml text,
  value text,
  owner_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_table text not null
);
comment on table ref.contact_info is '1С: Справочник.Организации.КонтактнаяИнформация (_reference388_vt9891); Справочник.Контрагенты.КонтактнаяИнформация (_reference301_vt7012); Справочник.Пользователи.КонтактнаяИнформация (_reference462_vt11756); Справочник.СтруктурныеЕдиницы.КонтактнаяИнформация (_reference612_vt14939)';
comment on column ref.contact_info.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column ref.contact_info.line_no is '1С: Справочник.Организации.КонтактнаяИнформация.НомерСтроки (_reference388_vt9891._lineno9892)';
comment on column ref.contact_info.type is '1С: Справочник.Организации.КонтактнаяИнформация.Тип (_reference388_vt9891._fld9893rref); перечисление Перечисление.ТипыКонтактнойИнформации';
comment on column ref.contact_info.kind is '1С: Справочник.Организации.КонтактнаяИнформация.Вид (_reference388_vt9891._fld9894rref); ссылка Справочник.ВидыКонтактнойИнформации (legacy.object)';
comment on column ref.contact_info.presentation is '1С: Справочник.Организации.КонтактнаяИнформация.Представление (_reference388_vt9891._fld9895)';
comment on column ref.contact_info.fields_xml is '1С: Справочник.Организации.КонтактнаяИнформация.ЗначенияПолей (_reference388_vt9891._fld9896)';
comment on column ref.contact_info.value is '1С: Справочник.Организации.КонтактнаяИнформация.Значение (_reference388_vt9891._fld9904)';
comment on column ref.contact_info.owner_id is '1С: Справочник.Организации.КонтактнаяИнформация.Ссылка (_reference388_vt9891._reference388_idrref)';
comment on column ref.contact_info.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.contact_info.created_at is 'создание записи в vitauto_app';
comment on column ref.contact_info.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.contact_info.deleted is 'пометка удаления';
comment on column ref.contact_info.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column ref.contact_info.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.contact_info.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column ref.contact_info.onec_table is 'таблица 1С источника (общая таблица для нескольких объектов)';

create table ref.extra_property (
  id uuid primary key,
  line_no numeric(5,0),
  property_id uuid,
  value_type text,
  value_id uuid,
  value_value jsonb,
  text text,
  owner_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  onec_version text,
  extra jsonb not null default '{}',
  import_batch_id uuid,
  onec_table text not null
);
comment on table ref.extra_property is '1С: Справочник.Организации.ДополнительныеРеквизиты (_reference388_vt9907); Справочник.Контрагенты.ДополнительныеРеквизиты (_reference301_vt7007); Справочник.ДоговорыКонтрагентов.ДополнительныеРеквизиты (_reference171_vt4181); Справочник.Номенклатура.ДополнительныеРеквизиты (_reference368_vt9350x1); Справочник.ПартииНоменклатуры.ДополнительныеРеквизиты (_reference427_vt10722); Справочник.асАвтомобили.ДополнительныеРеквизиты (_reference749_vt17177); Справочник.асМодели.ДополнительныеРеквизиты (_reference756_vt17334); Справочник.Пользователи.ДополнительныеРеквизиты (_reference462_vt11751); Справочник.СтруктурныеЕдиницы.ДополнительныеРеквизиты (_reference612_vt14934); Документ.ЗаказПокупателя.ДополнительныеРеквизиты (_document813_vt20746x1); Документ.ЗаказПоставщику.ДополнительныеРеквизиты (_document814_vt20980); Документ.ПриходнаяНакладная.ДополнительныеРеквизиты (_document954_vt28464); Документ.РасходнаяНакладная.ДополнительныеРеквизиты (_document966_vt29200)';
comment on column ref.extra_property.id is 'UUID v5 (владелец:НомерСтроки), план 5.2';
comment on column ref.extra_property.line_no is '1С: Справочник.Организации.ДополнительныеРеквизиты.НомерСтроки (_reference388_vt9907._lineno9908)';
comment on column ref.extra_property.property_id is '1С: Справочник.Организации.ДополнительныеРеквизиты.Свойство (_reference388_vt9907._fld9909rref); ссылка ПланВидовХарактеристик.ДополнительныеРеквизитыИСведения (legacy.object)';
comment on column ref.extra_property.value_type is '1С: Справочник.Организации.ДополнительныеРеквизиты.Значение (_reference388_vt9907._fld9910_type, _fld9910_l, _fld9910_n, _fld9910_t, _fld9910_s, _fld9910_rtref, _fld9910_rrref); вид значения / тип ссылки';
comment on column ref.extra_property.value_id is '1С: Справочник.Организации.ДополнительныеРеквизиты.Значение (_reference388_vt9907._fld9910_type, _fld9910_l, _fld9910_n, _fld9910_t, _fld9910_s, _fld9910_rtref, _fld9910_rrref); ссылка';
comment on column ref.extra_property.value_value is '1С: Справочник.Организации.ДополнительныеРеквизиты.Значение (_reference388_vt9907._fld9910_type, _fld9910_l, _fld9910_n, _fld9910_t, _fld9910_s, _fld9910_rtref, _fld9910_rrref); примитивное значение';
comment on column ref.extra_property.text is '1С: Справочник.Организации.ДополнительныеРеквизиты.ТекстоваяСтрока (_reference388_vt9907._fld9911)';
comment on column ref.extra_property.owner_id is '1С: Справочник.Организации.ДополнительныеРеквизиты.Ссылка (_reference388_vt9907._reference388_idrref)';
comment on column ref.extra_property.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';
comment on column ref.extra_property.created_at is 'создание записи в vitauto_app';
comment on column ref.extra_property.updated_at is 'последнее изменение записи в vitauto_app';
comment on column ref.extra_property.deleted is 'пометка удаления';
comment on column ref.extra_property.onec_version is 'ВерсияДанных 1С на момент переноса';
comment on column ref.extra_property.extra is 'поля 1С, не названные в карте storage-map (имена 1С)';
comment on column ref.extra_property.import_batch_id is 'партия импорта, создавшая или изменившая запись (план, раздел 12)';
comment on column ref.extra_property.onec_table is 'таблица 1С источника (общая таблица для нескольких объектов)';

-- внешние ключи между перенесёнными объектами (проверка в конце транзакции загрузки)
alter table arm.line add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table arm.line add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table arm.line add foreign key (customer_id) references ref.counterparty (id) deferrable initially deferred;
alter table arm.line add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table arm.line add foreign key (marked_by_id) references auth."user" (id) deferrable initially deferred;
alter table arm.line add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table arm.line add foreign key (payment_form_id) references ref.payment_form (id) deferrable initially deferred;
alter table arm.line add foreign key (receipt_id) references doc.receipt (id) deferrable initially deferred;
alter table arm.line add foreign key (service_type_id) references ref.service_kind (id) deferrable initially deferred;
alter table arm.line add foreign key (shipment_doc_id) references doc.shipment (id) deferrable initially deferred;
alter table arm.line add foreign key (supplier_id) references ref.counterparty (id) deferrable initially deferred;
alter table arm.line add foreign key (supplier_order_id) references doc.supplier_order (id) deferrable initially deferred;
alter table arm.notice add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table arm.notice add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table arm.notice add foreign key (read_by_id) references auth."user" (id) deferrable initially deferred;
alter table arm.user_role add foreign key (user_id) references auth."user" (id) deferrable initially deferred;
alter table doc.customer_order add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table doc.customer_order add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table doc.customer_order add foreign key (counterparty_id) references ref.counterparty (id) deferrable initially deferred;
alter table doc.customer_order add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table doc.customer_order add foreign key (reserve_warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.customer_order_item add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table doc.customer_order_item add foreign key (doc_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.customer_order_item add foreign key (reserve_warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.customer_order_material add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table doc.customer_order_material add foreign key (doc_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.customer_order_material add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.customer_order_material add foreign key (reserve_warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.customer_order_work add foreign key (doc_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.customer_order_work add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.customer_order_work add foreign key (work_kind_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.receipt add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table doc.receipt add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table doc.receipt add foreign key (counterparty_id) references ref.counterparty (id) deferrable initially deferred;
alter table doc.receipt add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table doc.receipt add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.receipt_expense add foreign key (doc_id) references doc.receipt (id) deferrable initially deferred;
alter table doc.receipt_expense add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.receipt_expense add foreign key (order_doc) references doc.customer_order (id) deferrable initially deferred;
alter table doc.receipt_expense add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.receipt_item add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table doc.receipt_item add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.receipt_item add foreign key (doc_id) references doc.receipt (id) deferrable initially deferred;
alter table doc.receipt_item add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.receipt_item add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.shipment add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table doc.shipment add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table doc.shipment add foreign key (counterparty_id) references ref.counterparty (id) deferrable initially deferred;
alter table doc.shipment add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table doc.shipment add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.shipment_item add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table doc.shipment_item add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.shipment_item add foreign key (doc_id) references doc.shipment (id) deferrable initially deferred;
alter table doc.shipment_item add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.shipment_item add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (counterparty_id) references ref.counterparty (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (reserve_warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.supplier_order add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table doc.supplier_order_item add foreign key (customer_order_id) references doc.customer_order (id) deferrable initially deferred;
alter table doc.supplier_order_item add foreign key (doc_id) references doc.supplier_order (id) deferrable initially deferred;
alter table doc.supplier_order_item add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table doc.supplier_order_item add foreign key (reserve_warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table ref.batch add foreign key (owner_id) references ref.nomenclature (id) deferrable initially deferred;
alter table ref.batch add foreign key (supplier_id) references ref.counterparty (id) deferrable initially deferred;
alter table ref.car add foreign key (model_id) references ref.car_model (id) deferrable initially deferred;
alter table ref.car add foreign key (parent_id) references ref.car (id) deferrable initially deferred;
alter table ref.car_attribute add foreign key (car_id) references ref.car (id) deferrable initially deferred;
alter table ref.car_model add foreign key (parent_id) references ref.car_model (id) deferrable initially deferred;
alter table ref.contract add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table ref.contract add foreign key (parent_id) references ref.contract (id) deferrable initially deferred;
alter table ref.contract add foreign key (price_type_id) references ref.price_type (id) deferrable initially deferred;
alter table ref.counterparty add foreign key (parent_id) references ref.counterparty (id) deferrable initially deferred;
alter table ref.labor_price add foreign key (contract_id) references ref.contract (id) deferrable initially deferred;
alter table ref.labor_price add foreign key (model_id) references ref.car_model (id) deferrable initially deferred;
alter table ref.labor_price add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table ref.labor_price add foreign key (price_type_id) references ref.price_type (id) deferrable initially deferred;
alter table ref.labor_price add foreign key (warehouse_id) references ref.warehouse (id) deferrable initially deferred;
alter table ref.nomenclature add foreign key (parent_id) references ref.nomenclature (id) deferrable initially deferred;
alter table ref.nomenclature add foreign key (unit_id) references ref.unit (id) deferrable initially deferred;
alter table ref.price add foreign key (author_id) references auth."user" (id) deferrable initially deferred;
alter table ref.price add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table ref.price add foreign key (price_type_id) references ref.price_type (id) deferrable initially deferred;
alter table ref.warehouse add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;
alter table ref.warehouse add foreign key (parent_id) references ref.warehouse (id) deferrable initially deferred;
alter table stock.move add foreign key (batch_id) references ref.batch (id) deferrable initially deferred;
alter table stock.move add foreign key (corr_batch_id) references ref.batch (id) deferrable initially deferred;
alter table stock.move add foreign key (corr_nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table stock.move add foreign key (customer_order) references doc.customer_order (id) deferrable initially deferred;
alter table stock.move add foreign key (nomenclature_id) references ref.nomenclature (id) deferrable initially deferred;
alter table stock.move add foreign key (organization_id) references ref.organization (id) deferrable initially deferred;

-- +goose Down
drop table if exists ref.extra_property cascade;
drop table if exists ref.contact_info cascade;
drop table if exists arm.user_role cascade;
drop table if exists arm.notice cascade;
drop table if exists arm.line cascade;
drop table if exists stock.move cascade;
drop table if exists ref.price cascade;
drop table if exists ref.labor_price cascade;
drop table if exists ref.car_attribute cascade;
drop table if exists doc.shipment_item cascade;
drop table if exists doc.shipment cascade;
drop table if exists doc.receipt_item cascade;
drop table if exists doc.receipt_expense cascade;
drop table if exists doc.receipt cascade;
drop table if exists doc.supplier_order_item cascade;
drop table if exists doc.supplier_order cascade;
drop table if exists doc.customer_order_work cascade;
drop table if exists doc.customer_order_material cascade;
drop table if exists doc.customer_order_item cascade;
drop table if exists doc.customer_order cascade;
drop table if exists ref.batch cascade;
drop table if exists ref.nomenclature cascade;
drop table if exists ref.contract cascade;
drop table if exists ref.car cascade;
drop table if exists ref.warehouse cascade;
drop table if exists ref.counterparty cascade;
drop table if exists ref.unit cascade;
drop table if exists ref.service_kind cascade;
drop table if exists ref.price_type cascade;
drop table if exists ref.payment_form cascade;
drop table if exists ref.organization cascade;
drop table if exists ref.car_model cascade;
drop table if exists auth."user" cascade;
