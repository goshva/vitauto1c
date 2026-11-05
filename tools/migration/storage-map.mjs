// Карта переноса таблиц 1С -> PostgreSQL vitauto_app (план tasks/migration-pg-go-vue.md, разделы 4 и 5.3).
// Вход: JSON lines из onec-storage-structure.js. Выход: docs/migration/storage-map.json (для мигратора и проверки этапа)
// и docs/migration/storage-map.md (для людей). Правило: всё, что не названо явно, переносится в столбец extra jsonb
// той же строки, а запись целиком — в legacy.object; поэтому неназванное поле не теряется.
//   node tools/migration/storage-map.mjs <storage.jsonl> [каталог вывода=docs/migration]
import fs from 'node:fs';
import path from 'node:path';

const [input, outDir = 'docs/migration'] = process.argv.slice(2);
if (!input) { console.error('usage: node storage-map.mjs <storage.jsonl> [outDir]'); process.exit(2); }

// --- общие поля ---------------------------------------------------------------------------------------------------
const SKIP_FIELDS = new Set(['_KeyField', 'ОбластьДанныхОсновныеДанные', '_NumberPrefix']); // служебные поля платформы
const COMMON = {
  Ссылка: 'id', ВерсияДанных: 'onec_version', ПометкаУдаления: 'deleted', ИмяПредопределенныхДанных: 'predefined',
  Код: 'code', Наименование: 'name', Родитель: 'parent_id', Владелец: 'owner_id', ЭтоГруппа: 'is_folder',
  Дата: 'date', Номер: 'number', Проведен: 'posted',
  Период: 'period', Регистратор: 'recorder', НомерСтроки: 'line_no', Активность: 'active', ВидДвижения: 'movement'
};
const DOC = {
  Организация: 'organization_id', Контрагент: 'counterparty_id', Договор: 'contract_id', СуммаДокумента: 'total',
  ВалютаДокумента: 'currency_id', Комментарий: 'comment', Ответственный: 'responsible_id', Автор: 'author_id',
  СтруктурнаяЕдиница: 'warehouse_id', СтруктурнаяЕдиницаРезерв: 'reserve_warehouse_id', ДокументОснование: 'base_doc',
  ВидОперации: 'operation', СостояниеЗаказа: 'order_state_id', СуммаВключаетНДС: 'amount_includes_vat'
};
const ITEM = {
  Ссылка: 'doc_id', Номенклатура: 'nomenclature_id', Характеристика: 'characteristic_id', Количество: 'qty',
  ЕдиницаИзмерения: 'unit', Цена: 'price', Сумма: 'amount', СтавкаНДС: 'vat_rate_id', СуммаНДС: 'vat_amount', Всего: 'total',
  Партия: 'batch_id', Содержание: 'content', СтруктурнаяЕдиница: 'warehouse_id', Ячейка: 'cell_id',
  ЗаказПокупателя: 'customer_order_id', Заказ: 'order_doc', Резерв: 'reserve_qty', ПроцентСкидкиНаценки: 'discount_pct',
  СуммаСкидкиНаценки: 'discount_amount', КлючСвязи: 'link_no', ИдентификаторСтроки: 'row_uid', Себестоимость: 'cost',
  ДатаОтгрузки: 'ship_date', ДатаПоступления: 'receipt_date', СтруктурнаяЕдиницаРезерв: 'reserve_warehouse_id',
  // реквизиты расширения АРМ в ЗаказПокупателя.Запасы
  НоменклатураКлиента: 'client_name', КоличествоКлиента: 'client_qty', КлючСвязиСтрок: 'arm_link_key', НомерКлиента: 'client_order_no',
  ДатаЗаказаКлиента: 'client_order_date', СрочностьКлиента: 'client_urgency', ГРЗКлиента: 'client_plate',
  ТерриторияКлиента: 'client_territory', АртикулКлиента: 'client_article', ЕдиницаИзмеренияКлиента: 'client_unit'
};
const TP_REF = { Ссылка: 'owner_id' }; // табличная часть справочника

// Строка АРМ: имена колонок = snake_case имён контракта REST API PWA (pwa/src/odata/mapping.js, toLine)
const ARM_LINE = {
  ИдентификаторЗаписи: 'id', КлючСвязиСтрок: 'link_key', ВидОперации: 'operation', СтатусСтроки: 'status', Удаление: 'deleted',
  ОтметкаСтроки: 'marked', АвторСтроки: 'marked_by_id', Порядок: 'sort_order', РучнаяПравка: 'manual_edit',
  ДокументЗаказПокупателя: 'customer_order_id', ДокументЗаказПоставщика: 'supplier_order_id',
  ДокументПриходнаяНакладная: 'receipt_id', РасходнаяНакладная: 'shipment_doc_id',
  ДокументПодписанОригинал: 'signed_original', ДатаОтгрузки: 'shipment_date', НомерОтгрузки: 'shipment_number',
  ДатаЗаказа: 'order_date', НомерЗаказа: 'internal_order_number', НомерЗаказаКлиента: 'client_order_number',
  Покупатель: 'customer_id', Договор: 'contract_id', ВидУслуги: 'service_type_id',
  Марка: 'brand', Модель: 'model', Агрегат: 'aggregate', Госномер: 'plate', НомерШасси: 'chassis', VIN: 'vin', Двигатель: 'engine',
  СрочностьКлиента: 'urgency', ГРЗКлиента: 'vehicle_plate', ТерриторияКлиента: 'territory', НоменклатураКлиента: 'fact_name',
  АртикулКлиента: 'fact_article', КоличествоКлиента: 'fact_qty', ЕдиницаИзмеренияКлиента: 'fact_unit',
  Номенклатура: 'nomenclature_id', Количество: 'quantity', КоличествоНормаЧас: 'norm_hours', ОстатокДляСтроки: 'stock_qty',
  ОстатокТовара: 'stock_total_qty', КоличествоВРезерве: 'reserve_qty', КоличествоВПути: 'in_transit_qty', Партия: 'batch_id',
  ЯчейкаСклада: 'cell_legacy', СебестоимостьЕдиницы: 'cost_price', Себестоимость: 'cost_sum', ФормаОплаты: 'payment_form_id',
  РРЦ: 'rrc', Оплачено: 'paid', НомерСчета: 'invoice_number', ДатаСчета: 'invoice_date', Коэффициент: 'coefficient',
  ТипИзмененияЦены: 'price_change_type', Цена: 'sale_price', Поставщик: 'supplier_id', ДатаПоступления: 'receipt_date',
  ДатаУПД: 'upd_date', НомерУПД: 'upd_number', ТерриторияОтгрузкиПоставщиком: 'supplier_ship_territory',
  ДатаЗаказаПоставщику: 'supplier_order_date', СрокПоставки: 'delivery_term', ДатаОтправкиНаСборку: 'assembly_sent_date',
  РучнаяПравкаПартии: 'manual_batch', РучноеРазделениеСУчетомПартий: 'manual_split_by_batch',
  КомментарийКСтроке: 'comment', КомментарийКСтроке2: 'comment2'
};

// --- правила по таблицам: typed (типизированная таблица + legacy), legacy (только архив), skip (не переносится) --------
// Порядок загрузки (order) задаёт зависимости по внешним ключам.
const T = (target, order, fields = {}, note = '') => ({ rule: 'typed', target, order, fields, note });
const TABLES = {
  'Справочник.Организации': T('ref.organization', 10, { ИНН: 'inn', КПП: 'kpp', НаименованиеПолное: 'full_name', НаименованиеСокращенное: 'short_name', ОГРН: 'ogrn', Префикс: 'prefix' }),
  'Справочник.КлассификаторЕдиницИзмерения': T('ref.unit', 10, { НаименованиеПолное: 'full_name', МеждународноеСокращение: 'intl_code' }),
  'Справочник.ВидыЦен': T('ref.price_type', 10, { ЦенаВключаетНДС: 'includes_vat', ВалютаЦены: 'currency_id', ТипВидаЦен: 'kind', Недействителен: 'inactive', Комментарий: 'comment' }),
  'Справочник.Арм_ВидыУслуги': T('ref.service_kind', 10),
  'Справочник.Арм_ФормыОплаты': T('ref.payment_form', 10),
  'Справочник.асМодели': T('ref.car_model', 10, { НаименованиеПолное: 'full_name' }),
  'Справочник.Пользователи': T('auth.user', 10, { Недействителен: 'inactive', ИдентификаторПользователяИБ: 'onec_ib_user_id', Подразделение: 'department_id', ФизическоеЛицо: 'person_id', Служебный: 'service', Комментарий: 'comment' }, 'пароль не переносится (раздел 5.4)'),
  'Справочник.Контрагенты': T('ref.counterparty', 20, { НаименованиеПолное: 'full_name', ИНН: 'inn', КПП: 'kpp', Покупатель: 'is_customer', Поставщик: 'is_supplier', ЮридическоеФизическоеЛицо: 'legal_form', Комментарий: 'comment', Недействителен: 'inactive' }),
  'Справочник.СтруктурныеЕдиницы': T('ref.warehouse', 20, { ТипСтруктурнойЕдиницы: 'unit_type', Организация: 'organization_id', МОЛ: 'responsible_id', ОрдерныйСклад: 'order_based' }, 'склады: тип «Склад» -> активные, прочие типы -> is_warehouse = false'),
  'Справочник.Номенклатура': T('ref.nomenclature', 30, { Артикул: 'article', НаименованиеПолное: 'full_name', ЕдиницаИзмерения: 'unit_id', ТипНоменклатуры: 'kind', Комментарий: 'comment', АС_КодАвтоАльянс: 'ext_code' }),
  'Справочник.ДоговорыКонтрагентов': T('ref.contract', 30, { Владелец: 'counterparty_id', Организация: 'organization_id', НомерДоговора: 'contract_no', ДатаДоговора: 'contract_date', ВидДоговора: 'kind', ВидЦен: 'price_type_id', ВалютаРасчетов: 'currency_id', Недействителен: 'inactive', Комментарий: 'comment' }),
  'Справочник.асАвтомобили': T('ref.car', 30, { VIN: 'vin', Модель: 'model_id', НомерДвигателя: 'engine_no', НомерКузова: 'body_no', НомерШасси: 'chassis_no', ГодВыпуска: 'year', Цвет: 'color', Комментарий: 'comment' }),
  'Справочник.ПартииНоменклатуры': T('ref.batch', 40, { ВладелецПартии: 'supplier_id', Статус: 'status', Номер: 'batch_no', ГоденДо: 'expires_at', Недействителен: 'inactive' }),
  'Документ.ЗаказПокупателя': T('doc.customer_order', 50, { ДатаОтгрузки: 'ship_date', НомерЗаказаКлиента: 'client_order_number' }),
  'Документ.ЗаказПокупателя.Запасы': T('doc.customer_order_item', 51, ITEM),
  'Документ.ЗаказПокупателя.Работы': T('doc.customer_order_work', 51, { ...ITEM, ВидРабот: 'work_kind_id', Кратность: 'multiplicity', Коэффициент: 'coefficient' }),
  'Документ.ЗаказПокупателя.Материалы': T('doc.customer_order_material', 51, ITEM),
  'Документ.ЗаказПоставщику': T('doc.supplier_order', 52, { ЗаказПокупателя: 'customer_order_id', ДатаПоступления: 'receipt_date' }),
  'Документ.ЗаказПоставщику.Запасы': T('doc.supplier_order_item', 53, ITEM),
  'Документ.ПриходнаяНакладная': T('doc.receipt', 54, { Заказ: 'supplier_order', НомерВходящегоДокумента: 'incoming_no', ДатаВходящегоДокумента: 'incoming_date' }),
  'Документ.ПриходнаяНакладная.Запасы': T('doc.receipt_item', 55, ITEM),
  'Документ.ПриходнаяНакладная.Расходы': T('doc.receipt_expense', 55, ITEM),
  'Документ.РасходнаяНакладная': T('doc.shipment', 56, { Заказ: 'customer_order', Автомобиль: 'car_id' }),
  'Документ.РасходнаяНакладная.Запасы': T('doc.shipment_item', 57, ITEM),
  'РегистрСведений.ЦеныНоменклатуры': T('ref.price', 60, { ВидЦен: 'price_type_id', Номенклатура: 'nomenclature_id', Характеристика: 'characteristic_id', Цена: 'price', Актуальность: 'actual', ЕдиницаИзмерения: 'unit', ВалютаЦены: 'currency_id', Автор: 'author_id', ДокументУстановки: 'set_by_doc' }),
  'РегистрСведений.асАвтомобили': T('ref.car_attribute', 60, { Автомобиль: 'car_id', ВидЗначения: 'attr_kind', Значение: 'value' }),
  'РегистрСведений.асЦеныАвторабот': T('ref.labor_price', 60, { ВидЦен: 'price_type_id', Номенклатура: 'nomenclature_id', Модель: 'model_id', ВидРемонта: 'repair_kind_id', СтруктурнаяЕдиница: 'warehouse_id', Договор: 'contract_id', Нормочас: 'norm_hour', Валюта: 'currency_id', Цена: 'price' }),
  'РегистрНакопления.Запасы': T('stock.move', 70, { Организация: 'organization_id', СтруктурнаяЕдиница: 'warehouse_id', Номенклатура: 'nomenclature_id', Характеристика: 'characteristic_id', Партия: 'batch_id', ЗаказПокупателя: 'customer_order', СчетУчета: 'account_id', асЗаказНаряд: 'work_order_id', Количество: 'qty', Сумма: 'amount', СуммаБезНДС: 'amount_net', КоррСтруктурнаяЕдиница: 'corr_warehouse_id', КоррНоменклатура: 'corr_nomenclature_id', КоррПартия: 'corr_batch_id', Возврат: 'is_return', СодержаниеПроводки: 'content' }, 'знак qty/amount по movement: Приход +, Расход −; итоги не переносятся, а сверяются (R5)'),
  'РегистрСведений.Арм_ДанныеЗакупокИПродаж': T('arm.line', 80, ARM_LINE, 'добавляются warehouse_id и cell_id (раздел 8); ключ записи — все 8 измерений, id = ИдентификаторЗаписи'),
  'РегистрСведений.Арм_ПраваПользователей': T('arm.user_role', 80, { Пользователь: 'user_id', РольИнтерфейса: 'role' }),
  'РегистрСведений.Арм_Уведомления': T('arm.notice', 80, { Ид: 'id', Дата: 'created_at', Узел: 'node', Вид: 'kind', РольПолучателя: 'recipient_role', Текст: 'text', ДокументЗаказПокупателя: 'customer_order_id', Автор: 'author_id', Прочитано: 'is_read', Прочитал: 'read_by_id', ДатаПрочтения: 'read_at' })
};
const CONTACT = { rule: 'typed', target: 'ref.contact_info', order: 90, fields: { Ссылка: 'owner_id', Тип: 'type', Вид: 'kind', Представление: 'presentation', Значение: 'value', ЗначенияПолей: 'fields_xml' }, note: 'общая таблица контактов: owner_id + owner_kind' };
const PROPS = { rule: 'typed', target: 'ref.extra_property', order: 90, fields: { Ссылка: 'owner_id', Свойство: 'property_id', Значение: 'value', ТекстоваяСтрока: 'text' }, note: 'дополнительные реквизиты БСП' };

function ruleFor(r) {
  if (r.purpose === 'РегистрацияИзменений') return { rule: 'skip', note: 'регистрация изменений обмена 1С — служебная' };
  if (r.purpose === 'ИнициализированныеПредопределенныеДанныеСправочника') return { rule: 'skip', note: 'служебная таблица платформы' };
  if (r.purpose === 'Итоги') return { rule: 'skip', note: 'итоги пересчитываются в stock.balance и сверяются (R5)' };
  if (r.purpose === 'НастройкиХраненияИтоговРегистраНакопления') return { rule: 'skip', note: 'служебная таблица платформы' };
  if (r.table.startsWith('Перечисление.')) return { rule: 'enum', target: 'текстовый домен (имя значения)', note: 'порядок _EnumOrder -> имя значения по метаданным' };
  if (TABLES[r.table]) return TABLES[r.table];
  if (r.table.endsWith('.КонтактнаяИнформация')) return CONTACT;
  if (r.table.endsWith('.ДополнительныеРеквизиты')) return PROPS;
  return { rule: 'legacy', note: 'только legacy.object (в составе записи-владельца)' };
}

// --- сборка --------------------------------------------------------------------------------------------------------
const lines = fs.readFileSync(input, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s));
const errors = lines.filter(l => l.error || l.missing);
const sample = (lines.find(l => l.uuidSample) || {}).uuidSample || null;
const tables = [];
for (const r of lines.filter(l => l.meta)) {
  const rule = ruleFor(r);
  const isDoc = r.table.startsWith('Документ.') && r.purpose === 'Основная';
  const isItem = r.table.startsWith('Документ.') && r.purpose === 'ТабличнаяЧасть';
  const isRefTp = r.table.startsWith('Справочник.') && r.purpose === 'ТабличнаяЧасть';
  const explicit = { ...COMMON, ...(isDoc ? DOC : {}), ...(isRefTp ? TP_REF : {}), ...(rule.fields || {}) };
  if (isItem && !rule.fields) Object.assign(explicit, ITEM);
  // одно поле 1С может храниться в нескольких столбцах (составной тип: _TYPE, _RTRef, _RRRef, _N, _S ...)
  const byName = new Map();
  for (const [storage, name] of r.fields) {
    const key = name || storage;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(storage);
  }
  const fields = [];
  for (const [name, storages] of byName) {
    if (SKIP_FIELDS.has(name)) continue;
    const composite = storages.length > 1 && storages.some(s => /_TYPE$|_RTRef$/i.test(s));
    let column = rule.rule === 'typed' ? (explicit[name] ?? null) : null;
    if (column && composite) column = column.replace(/_id$/, '') + '_type + ' + column.replace(/_id$/, '') + '_id';
    fields.push({ onec: name, storage: storages.map(s => s.toLowerCase()), column, composite });
  }
  const mappedMissing = rule.rule === 'typed' ? Object.keys(rule.fields || {}).filter(n => !(n in ITEM) && !byName.has(n)) : []; // общий словарь ITEM не проверяется
  tables.push({ table: r.table || r.meta, storage: r.storage.toLowerCase(), purpose: r.purpose, rows: r.rows, ...rule, fields, mappedMissing });
}

const result = {
  generated: new Date().toISOString(), source: path.basename(input), uuidSample: sample, errors,
  uuidRule: "uuid = hex[25..32]-hex[21..24]-hex[17..20]-hex[1..4]-hex[5..16], hex = encode(_IDRRef, 'hex')",
  tables: tables.map(({ fields, ...t }) => ({ ...t, fields }))
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'storage-map.json'), JSON.stringify(result, null, 1));

// --- Markdown ------------------------------------------------------------------------------------------------------
const md = [];
md.push('# Карта таблиц 1С → vitauto_app', '');
md.push(`Сгенерировано \`tools/migration/storage-map.mjs\` из \`${result.source}\` (${result.generated.slice(0, 10)}). Не править вручную: меняются правила в генераторе.`, '');
md.push('Правила: **typed** — типизированная таблица (неназванные поля → `extra jsonb`), запись целиком ещё и в `legacy.object`;',
  '**legacy** — только `legacy.object`; **enum** — текстовый домен; **skip** — служебная таблица платформы, не переносится.', '');
md.push(`GUID: \`${result.uuidRule}\`. Контроль: ${sample ? `${sample.object} «${sample.code}» = \`${sample.uuid}\`` : 'нет образца'}.`, '');
md.push('## Сводка', '', '| Таблица 1С | Таблица PostgreSQL 1С | Записей | Правило | Целевая таблица | Порядок |', '|---|---|---|---|---|---|');
for (const t of [...tables].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.table.localeCompare(b.table)))
  md.push(`| ${t.table} | \`${t.storage}\` | ${t.rows ?? ''} | ${t.rule} | ${t.target ? '`' + t.target + '`' : ''} | ${t.order ?? ''} |`);
md.push('');
for (const t of tables.filter(x => x.rule === 'typed')) {
  md.push(`## ${t.table} → \`${t.target}\``, '', `Источник: \`${t.storage}\` (${t.purpose}), записей: ${t.rows ?? '—'}, порядок загрузки: ${t.order}.${t.note ? ' ' + t.note + '.' : ''}`, '');
  if (t.mappedMissing.length) md.push(`> Нет в базе (проверить маппинг): ${t.mappedMissing.join(', ')}`, '');
  md.push('| Поле 1С | Столбцы хранения | Столбец vitauto_app |', '|---|---|---|');
  for (const f of t.fields) md.push(`| ${f.onec} | ${f.storage.map(s => '`' + s + '`').join(' ')} | ${f.column ? '`' + f.column + '`' : '`extra`'} |`);
  md.push('');
}
fs.writeFileSync(path.join(outDir, 'storage-map.md'), md.join('\n'));

const typed = tables.filter(t => t.rule === 'typed').length;
console.log(`tables ${tables.length}, typed ${typed}, errors ${errors.length}, uuidSample ${sample ? sample.uuid : 'none'}`);
for (const t of tables.filter(x => x.mappedMissing.length)) console.log(`  missing in ${t.table}: ${t.mappedMissing.join(', ')}`);
process.exit(errors.length ? 1 : 0);
