// КАРТА ПЕРЕНОСА: что из legacy куда ложится и что НЕ переносится вовсе.
//
// Основание — сверка составов И связей, а не догадка. Для каждой пары: общие колонки
// переносятся напрямую (имена совпадают), а legacy-специфичные получают решение.
//
// ПОЧЕМУ КАРТА ОТДЕЛЬНО ОТ КОДА. Её читает человек: перед прогоном надо ВИДЕТЬ, что
// произойдёт, а после — что произошло. Прогон без карты — «перенесли и надеемся».
//
// ПОРЯДОК СПРАВОЧНИКОВ — ПО ЗАВИСИМОСТЯМ, и это выяснилось на ОШИБКЕ: первая версия
// ставила `nomenclature` перед `unit`, и перенос упал на `nomenclature.unit_id` —
// ссылка на строку, которой ещё нет. Порядок не «по алфавиту» и не «как вспомнилось»:
// то, на что ссылаются, идёт первым.

export interface TableMap {
  /** Где лежит в legacy. */
  from: string;
  /** Куда ложится в прототипе. `null` — не копируется напрямую. */
  to: string | null;
  /** Колонки, переносимые напрямую: имена совпадают в обеих схемах. */
  columns: string[];
  /** Решения по колонкам, которых в прототипе нет. */
  rest: string;
}

/**
 * Справочники В ПОРЯДКЕ ЗАВИСИМОСТЕЙ.
 *
 * ДЕВЯТЬ ИМЁН НАСЛЕДИЯ (`onec_version`, `deleted`, `predefined`, `parent_id`, `is_folder`,
 * `extra`, `import_batch_id`, `onec_key`, `deleted_by_id`) НЕ ПЕРЕНОСЯТСЯ: их запрещает
 * проверка прототипа «нет ни одного столбца наследия 1С». Каждое либо дублирует то, что в
 * прототипе есть под своим именем (`deleted` → `deleted_at`), либо не нужно вовсе.
 */
export const REFERENCES: TableMap[] = [
  // --- Первый уровень: ни на кого не ссылаются ---
  {
    from: 'ref.unit', to: 'unit',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.brand', to: 'brand',
    columns: ['id', 'code', 'name', 'country', 'comment', 'version', 'created_at', 'updated_at', 'deleted_at'],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.warehouse', to: 'warehouse',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.warehouse_zone', to: 'warehouse_zone',
    columns: ['id', 'code', 'name', 'purpose', 'sort', 'created_at', 'updated_at', 'version', 'deleted_at'],
    rest: 'deleted, deleted_by_id дублируют deleted_at',
  },
  {
    from: 'ref.organization', to: 'organization',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.payment_form', to: 'payment_form',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.service_kind', to: 'service_kind',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },

  // --- Второй уровень: ссылаются на первый ---
  {
    from: 'ref.nomenclature', to: 'nomenclature',
    columns: ['id', 'code', 'name', 'unit_id', 'article', 'full_name', 'comment', 'kind',
      'ext_code', 'version', 'created_at', 'updated_at', 'brand_id', 'analog_id', 'deleted_at'],
    rest: 'parent_id, is_folder — иерархия справочника: в прототипе он плоский, группы не '
      + 'переносятся отдельными записями. search_status, ownership — признаки переноса в 1С',
  },
  {
    from: 'ref.counterparty', to: 'counterparty',
    columns: ['id', 'code', 'name', 'full_name', 'legal_form', 'comment', 'inn', 'kpp',
      'inactive', 'is_customer', 'is_supplier', 'version', 'created_at', 'updated_at', 'deleted_at'],
    rest: 'иерархия и имена наследия не переносятся',
  },
  {
    from: 'ref.storage_cell', to: 'storage_cell',
    columns: ['id', 'warehouse_id', 'code', 'capacity', 'blocked', 'version',
      'created_at', 'updated_at', 'zone_id', 'deleted_at'],
    rest: 'zone (старый текст) заменён ссылкой zone_id; extra, import_batch_id — наследие',
  },
  {
    from: 'ref.car', to: 'car',
    // `model_id` НЕ ПЕРЕНОСИТСЯ, и это осознанно: он ссылается на `ref.car_model`, которой
    // в прототипе НЕТ. Попытка перенести его упёрлась бы в отсутствующую таблицу. Модель в
    // прототипе хранится текстом в атрибутах машины (`car_attribute`, вид `model`).
    // `year` и `color` НЕ ПЕРЕНОСЯТСЯ: типы расходятся, и приведение соврало бы.
    //   · `year` в legacy — ДАТА, в прототипе ЦЕЛОЕ: надо решить, брать ли из неё год;
    //   · `color` в legacy — ССЫЛКА (uuid) на справочник цветов, в прототипе ТЕКСТ:
    //     справочника цветов в прототипе нет.
    columns: ['id', 'code', 'name', 'vin', 'comment', 'engine_no', 'body_no',
      'chassis_no', 'version', 'created_at', 'updated_at', 'deleted_at'],
    rest: 'model_id — ссылка на car_model, которой в прототипе нет: модель хранится '
      + 'атрибутом машины. Иерархия и имена наследия не переносятся',
  },
  {
    from: 'ref.car_attribute', to: 'car_attribute',
    // `value_value` НЕ ПЕРЕНОСИТСЯ: в legacy это `jsonb`, в прототипе текст. Значение
    // может быть не строкой (объект, число), и приведение «как есть» соврало бы.
    columns: ['id', 'car_id', 'attr_kind', 'version', 'created_at',
      'updated_at', 'deleted_at'],
    rest: 'value_value — тип jsonb против text: требует решения о приведении. '
      + 'ВНИМАНИЕ: дубли одного вида роняют line_view — перенос делать после проверки на дубли',
  },
  {
    from: 'ref.batch', to: 'batch',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'имена наследия не переносятся',
  },
  {
    from: 'ref.supplier_offer', to: 'supplier_offer',
    // Пусто: колонки вычисляются как ОБЩИЕ для обеих схем — так список не разойдётся
    // со схемой. Явный список нужен только там, где есть отбор.
    columns: [],
    rest: 'срок поставки (delivery_days) в legacy не хранится — остаётся пустым',
  },
];

/**
 * Документы и строки.
 *
 * ГЛАВНОЕ — СВЕДЕНИЕ ДВУХ ТАБЛИЦ В ОДНУ. В legacy строка ДОКУМЕНТА
 * (`doc.customer_order_item`) и рабочая строка АРМ (`arm.line`) — разные таблицы, а в
 * прототипе одна `line`.
 */
export const DOCUMENTS: TableMap[] = [
  {
    from: 'doc.customer_order', to: 'customer_order',
    columns: ['id', 'date', 'number', 'author_id', 'operation', 'ship_date', 'contract_id',
      'counterparty_id', 'organization_id', 'total', 'client_order_number', 'version',
      'created_at', 'updated_at', 'deleted_at'],
    rest: 'posted — проведение в прототипе выражено состоянием строк; order_state_* и '
      + 'base_doc_* — механика 1С; responsible_id дублирует author_id; currency_id — рубль',
  },
  {
    from: 'arm.line', to: 'line',
    columns: ['id', 'customer_order_id', 'supplier_order_id', 'receipt_id', 'operation',
      'nomenclature_id', 'quantity', 'supplier_id', 'batch_id', 'status', 'customer_id',
      'contract_id', 'warehouse_id', 'cell_id', 'zone_id', 'order_date', 'signed_original',
      'service_type_id', 'cost_price', 'sale_price', 'version',
      'created_at', 'updated_at', 'deleted_at'],
    rest: 'fact_name, fact_qty, fact_article, fact_unit, vehicle_plate, client_order_number — '
      + 'УХОДЯТ В `line_fact`: в прототипе «как написал клиент» отделено от документа. '
      + 'stock_qty, reserve_qty, in_transit_qty — НЕ ПЕРЕНОСЯТСЯ: считаются из движени '
      + '`stock_move`, и перенос остатков создал бы вторую правду',
  },
  {
    // НЕ КОПИРУЕТСЯ НАПРЯМУЮ: это СВЕДЕНИЕ, а не перенос. Копирование дало бы ДУБЛИ
    // строк, поэтому `to: null`, а сведение делается отдельным шагом.
    from: 'doc.customer_order_item', to: null,
    columns: [],
    rest: 'СВОДИТСЯ с arm.line по (doc_id, link_no). client_* уходят в line_fact, как и в '
      + 'arm.line. row_uid, characteristic_id, vat_* — механика 1С. Колонок для прямого '
      + 'копирования нет: имена не совпадают ни с одной колонкой приёмника',
  },
];

/** Сколько строк ждём перенести: НЕУДАЛЁННЫХ, а не всех. */
export const EXPECTED: Record<string, number> = {
  'ref.unit': 4,
  'ref.brand': 5,
  'ref.warehouse': 2,
  'ref.warehouse_zone': 6,
  'ref.organization': 1,
  'ref.payment_form': 4,
  'ref.service_kind': 5,
  'ref.nomenclature': 16,
  'ref.counterparty': 6,
  'ref.storage_cell': 9,
  'ref.car': 5,
};
