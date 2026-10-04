'use strict';
// Генерирует модуль 1С «Арм_APIМатрица» для HTTP-сервиса АРМ (контракт openapi/arm-pwa.openapi.yaml):
// колонки матрицы, поле регистра Арм_ДанныеЗакупокИПродаж, свойство JSON строки, код (А1…Т1), тип,
// признак записи и маска прав по 15 статусам уровня «Заказ» для каждой роли: + можно, c только автор, . нельзя.
// Источник прав — default-matrix.js (через api/lib/sources.js), тот же, что у index.html.
//
//   node tools/gen-arm-api-matrix.js <файл Module.bsl>
const fs = require('fs');
const { loadDefaultAccess } = require('../api/lib/sources');

// id колонки матрицы -> [поле регистра (или вычисляемое), свойство JSON строки, можно ли писать PATCH]
// Не записываются: вычисляемые, реквизиты номенклатуры, заглушки и служебные поля.
const MAP = {
  cell_select: ['ОтметкаСтроки', 'marked', false],
  row_number: ['Порядок', 'order', false],
  doc_signed_original: ['ДокументПодписанОригинал', 'signedOriginal', true],
  shipment_date: ['ДатаОтгрузки', 'shipmentDate', true],
  shipment_number: ['НомерОтгрузки', 'shipmentNumber', true],
  order_date: ['ДатаЗаказа', 'orderDate', true],
  order_internal_number: ['НомерЗаказа', 'internalOrderNumber', true],
  order_client_number: ['НомерЗаказаКлиента', 'clientOrderNumber', true],
  customer: ['Покупатель', 'customer', true],
  contract: ['Договор', 'contract', true],
  service_type: ['ВидУслуги', 'serviceType', true],
  brand_fact: ['Марка', 'brand', true],
  model_fact: ['Модель', 'model', true],
  aggregate_fact: ['Агрегат', 'aggregate', true],
  gosnomer_fact: ['Госномер', 'plate', true],
  grz_fact: ['НомерШасси', 'chassis', false],
  vin_fact: ['VIN', 'vin', true],
  engine_fact: ['Двигатель', 'engine', true],
  urgency_fact: ['СрочностьКлиента', 'urgency', true],
  vehicle_plate_fact: ['ГРЗКлиента', 'vehiclePlate', true],
  territory_fact: ['ТерриторияКлиента', 'territory', true],
  name_fact: ['НоменклатураКлиента', 'factName', true],
  article_fact: ['АртикулКлиента', 'factArticle', true],
  qty_fact: ['КоличествоКлиента', 'factQty', true],
  unit_fact: ['ЕдиницаИзмеренияКлиента', 'factUnit', true],
  name: ['Номенклатура', 'nomenclature', true],
  article: ['НоменклатураАртикул', 'nomenclature.article', false],
  code_aa: ['НоменклатураАС_КодАвтоАльянс', 'nomenclature.code', false],
  unit: ['НоменклатураЕдиницаИзмерения', 'nomenclature.unit', false],
  qty: ['Количество', 'quantity', true],
  stock_qty: ['ОстатокДляСтроки', 'stockQty', false],
  reserve_qty: ['КоличествоВРезерве', 'reserveQty', false],
  ordered_in_transit_qty: ['КоличествоВПути', 'inTransitQty', false],
  batch_fifo: ['Партия', 'batch', true],
  line_status: ['СтатусСтроки', 'status', false],
  price: ['СебестоимостьЕдиницы', 'costPrice', true],
  sum: ['Себестоимость', 'costSum', false],
  payment_form: ['ФормаОплаты', 'paymentForm', true],
  rrc: ['РРЦ', 'rrc', true],
  paid_status: ['Оплачено', 'paid', true],
  qty_norm_hours_client: ['КоличествоНормаЧас', 'normHours', true],
  coefficient: ['Коэффициент', 'coefficient', true],
  extra_field_1: ['Цена', 'salePrice', true],
  extra_field_2: ['Сумма', 'saleSum', false],
  supplier: ['Поставщик', 'supplier', true],
  receipt_date: ['ДатаПоступления', 'receiptDate', true],
  upd_date: ['ДатаУПД', 'updDate', false],
  upd_number: ['НомерУПД', 'updNumber', false],
  supplier_ship_territory: ['ТерриторияОтгрузкиПоставщиком', 'supplierShipTerritory', true],
  comment: ['КомментарийКСтроке', 'comment', true]
};
const ROLES = ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client'];
const DATA_TYPES = ['checkbox', 'number', 'date', 'text', 'select'];

function mask(access, role, colId) {
  return access.statuses.map(st => {
    const cell = access.matrix.order[role][st.id][colId];
    if (!cell) return '.';
    if (cell.editable === 'role') return cell.editableRoles.includes(role) ? '+' : '.';
    if (cell.editable === 'creator') return 'c';
    if (cell.editable === 'admin') return role === 'admin' ? '+' : '.';
    return '.';
  }).join('');
}

function main(out) {
  const access = loadDefaultAccess();
  const defaults = {};
  const dm = {};
  require('vm').runInNewContext(fs.readFileSync(require('path').join(__dirname, '..', 'default-matrix.js'), 'utf8'), { window: dm });
  const types = (dm.VITAUTO_DEFAULT_MATRIX && dm.VITAUTO_DEFAULT_MATRIX.columnTypes) || defaults;
  const missing = access.columns.filter(c => !MAP[c.id]).map(c => c.id);
  if (missing.length) throw new Error('Нет сопоставления колонок: ' + missing.join(', '));
  if (access.statuses.length !== 15) throw new Error('Ожидалось 15 статусов, в матрице ' + access.statuses.length);

  const lines = access.columns.map(c => {
    const [field, prop, writable] = MAP[c.id];
    const type = DATA_TYPES.includes(types[c.id]) ? types[c.id] : 'text';
    const title = c.title.replace(/"/g, '""').replace(/\|/g, '/');
    return [c.id, field, prop, c.code || '', title, type, writable ? '1' : '0', ...ROLES.map(r => mask(access, r, c.id))].join('|');
  });
  const bsl = [
    '// Сгенерировано tools/gen-arm-api-matrix.js из default-matrix.js и column-codes.js. Не править вручную:',
    '// после изменения матрицы запустить генератор заново.',
    '',
    '// Статусы уровня «Заказ» в порядке символов маски.',
    'Функция Статусы() Экспорт',
    '',
    '\tВозврат "' + access.statuses.map(s => s.id).join(',') + '";',
    '',
    'КонецФункции',
    '',
    '// Роли в порядке масок в строке колонки.',
    'Функция Роли() Экспорт',
    '',
    '\tВозврат "' + ROLES.join(',') + '";',
    '',
    'КонецФункции',
    '',
    '// Строка: id|поле|свойство JSON|код|заголовок|тип|запись (1/0)|маски ролей из Роли().',
    'Функция Колонки() Экспорт',
    '',
    '\tВозврат',
    '\t"' + lines.join('\r\n\t|') + '";',
    '',
    'КонецФункции',
    ''
  ].join('\r\n');
  fs.writeFileSync(out, '﻿' + bsl, 'utf8');
  console.log(`${out}: ${lines.length} колонок, ${access.statuses.length} статусов, ${ROLES.length} ролей`);
}

main(process.argv[2] || 'Module.bsl');
