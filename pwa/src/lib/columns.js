// Поле регистра (column.field из GET /matrix) -> свойство строки Line и способ редактирования.
// Совпадает с tools/gen-arm-api-matrix.js. kind: text | number | date | bool | ref | nomenclature.
// ref: dir — справочник /directories/{dir}, query(line) — доп. параметры отбора.
export const FIELDS = {
  ОтметкаСтроки: { prop: 'marked', kind: 'bool' },
  Порядок: { prop: 'order', kind: 'number' },
  ДокументПодписанОригинал: { prop: 'signedOriginal', kind: 'bool' },
  ДатаОтгрузки: { prop: 'shipmentDate', kind: 'date' },
  НомерОтгрузки: { prop: 'shipmentNumber', kind: 'text' },
  ДатаЗаказа: { prop: 'orderDate', kind: 'date' },
  НомерЗаказа: { prop: 'internalOrderNumber', kind: 'text' },
  НомерЗаказаКлиента: { prop: 'clientOrderNumber', kind: 'text' },
  Покупатель: { prop: 'customer', kind: 'ref', dir: 'counterparties' },
  Договор: { prop: 'contract', kind: 'ref', dir: 'contracts', query: l => ({ ownerId: l.customer && l.customer.id }) },
  ВидУслуги: { prop: 'serviceType', kind: 'ref', dir: 'service-types' },
  Марка: { prop: 'brand', kind: 'text' },
  Модель: { prop: 'model', kind: 'text' },
  Агрегат: { prop: 'aggregate', kind: 'text' },
  Госномер: { prop: 'plate', kind: 'text' },
  НомерШасси: { prop: 'chassis', kind: 'text' },
  VIN: { prop: 'vin', kind: 'text' },
  Двигатель: { prop: 'engine', kind: 'text' },
  СрочностьКлиента: { prop: 'urgency', kind: 'text' },
  ГРЗКлиента: { prop: 'vehiclePlate', kind: 'text' },
  ТерриторияКлиента: { prop: 'territory', kind: 'text' },
  НоменклатураКлиента: { prop: 'factName', kind: 'text' },
  АртикулКлиента: { prop: 'factArticle', kind: 'text' },
  КоличествоКлиента: { prop: 'factQty', kind: 'text' },
  ЕдиницаИзмеренияКлиента: { prop: 'factUnit', kind: 'text' },
  Номенклатура: { prop: 'nomenclature', kind: 'nomenclature', dir: 'nomenclature' },
  НоменклатураАртикул: { prop: 'nomenclature.article', kind: 'text' },
  НоменклатураАС_КодАвтоАльянс: { prop: 'nomenclature.code', kind: 'text' },
  НоменклатураЕдиницаИзмерения: { prop: 'nomenclature.unit', kind: 'text' },
  Количество: { prop: 'quantity', kind: 'number' },
  ОстатокДляСтроки: { prop: 'stockQty', kind: 'number' },
  КоличествоВРезерве: { prop: 'reserveQty', kind: 'number' },
  КоличествоВПути: { prop: 'inTransitQty', kind: 'number' },
  Партия: { prop: 'batch', kind: 'ref', dir: 'batches', query: l => ({ nomenclatureId: l.nomenclature && l.nomenclature.id, customerOrderId: l.customerOrder && l.customerOrder.id }) },
  СтатусСтроки: { prop: 'status', kind: 'text' },
  СебестоимостьЕдиницы: { prop: 'costPrice', kind: 'number' },
  Себестоимость: { prop: 'costSum', kind: 'number' },
  ФормаОплаты: { prop: 'paymentForm', kind: 'ref', dir: 'payment-forms' },
  РРЦ: { prop: 'rrc', kind: 'number' },
  Оплачено: { prop: 'paid', kind: 'bool' },
  КоличествоНормаЧас: { prop: 'normHours', kind: 'number' },
  Коэффициент: { prop: 'coefficient', kind: 'number' },
  Цена: { prop: 'salePrice', kind: 'number' },
  Сумма: { prop: 'saleSum', kind: 'number' },
  Поставщик: { prop: 'supplier', kind: 'ref', dir: 'counterparties' },
  ДатаПоступления: { prop: 'receiptDate', kind: 'date' },
  ДатаУПД: { prop: 'updDate', kind: 'date' },
  НомерУПД: { prop: 'updNumber', kind: 'text' },
  ТерриторияОтгрузкиПоставщиком: { prop: 'supplierShipTerritory', kind: 'text' },
  КомментарийКСтроке: { prop: 'comment', kind: 'text' }
};

export const STATUS_TITLES = {
  new: 'Новый', in_work: 'В работе', partially_ordered: 'Частично заказано', ordered: 'Заказано', paid: 'Оплачено',
  in_transit: 'В пути', awaiting_receipt: 'Ожидаем поступление', acceptance: 'Приёмка', to_stock: 'На склад',
  reserve: 'Резервирование', assembly: 'Комплектуется', ready_to_ship: 'Готово к отгрузке', shipped: 'Отгружено',
  return: 'Возврат', closed: 'Закрыт', locked_background: 'Заблокировано фоном'
};

export function fieldInfo(field) {
  return FIELDS[field] || { prop: null, kind: 'text' };
}

export function valueOf(line, field) {
  const { prop } = fieldInfo(field);
  if (!prop) return undefined;
  return prop.split('.').reduce((v, k) => (v == null ? v : v[k]), line);
}

const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

export function display(line, field) {
  const v = valueOf(line, field);
  if (v === undefined || v === null || v === '') return '';
  if (field === 'СтатусСтроки') return STATUS_TITLES[v] || v;
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (typeof v === 'number') return num.format(v);
  if (typeof v === 'object') return v.name || v.number || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('.');
  return String(v);
}
