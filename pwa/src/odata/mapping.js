// Запись регистра Арм_ДанныеЗакупокИПродаж (OData) <-> строка Line контракта REST API АРМ, статусы, значения полей.
import MATRIX from './matrix.json';
import { EMPTY, EMPTY_DATE, guid, lit } from './client';

export const ARM = 'InformationRegister_Арм_ДанныеЗакупокИПродаж';
export const ARM_KEYS = ['ДокументЗаказПокупателя_Key', 'ДокументЗаказПоставщика_Key', 'ДокументПриходнаяНакладная_Key',
  'КлючСвязиСтрок', 'ВидОперации', 'ИдентификаторЗаписи', 'РучнаяПравка', 'НомерЗаказаКлиента'];

// статус матрицы <-> значение перечисления Арм_СтатусыАРМ (prepared/ready_to_ship — Подготовлено и Собран, closed — Выполнено и Завершено)
const STATUS_ENUM = MATRIX.statusEnum;
const ENUM_STATUS = {};
for (const [id, enums] of Object.entries(STATUS_ENUM)) for (const e of enums) ENUM_STATUS[e] = id;
ENUM_STATUS.ЗаблокированоФоном = 'locked_background';
export const statusOf = e => ENUM_STATUS[e] || e;
export const enumOf = id => (STATUS_ENUM[id] || [id])[0];
export const OPERATION = { sales: 'Продажа', purchases: 'Закупка', supply: 'Закупка' };

// ссылочные поля регистра: имя навигационного свойства = имя поля, справочник — для подбора
export const REF_FIELDS = ['Покупатель', 'Договор', 'ВидУслуги', 'Номенклатура', 'Партия', 'ФормаОплаты', 'Поставщик', 'АвторСтроки'];
const DOCS = { ДокументЗаказПокупателя: 'customer_order', ДокументЗаказПоставщика: 'supplier_order', ДокументПриходнаяНакладная: 'receipt', РасходнаяНакладная: 'shipment' };
const NAMED = ['Покупатель', 'Договор', 'ВидУслуги', 'Партия', 'ФормаОплаты', 'Поставщик', 'АвторСтроки'];

// $expand/$select для строк: имена ссылок и реквизиты документов одним запросом
export const LINE_QUERY = {
  $expand: [...Object.keys(DOCS), 'Номенклатура', ...NAMED].join(','),
  $select: ['*', ...NAMED.map(n => `${n}/Description`), ...Object.keys(DOCS).flatMap(d => ['Number', 'Date', 'Posted'].map(f => `${d}/${f}`)),
    'Номенклатура/Description', 'Номенклатура/Артикул', 'Номенклатура/АС_КодАвтоАльянс', 'Номенклатура/ЕдиницаИзмерения_Key'].join(',')
};

export const day = d => (!d || d.startsWith('0001-') ? null : d.slice(0, 10));
const named = (rec, f) => (rec[f + '_Key'] && rec[f + '_Key'] !== EMPTY ? { id: rec[f + '_Key'], name: (rec[f] && rec[f].Description) || '' } : null);
function docRef(rec, f) {
  const id = rec[f + '_Key'];
  if (!id || id === EMPTY) return null;
  const d = rec[f] || {};
  return { id, kind: DOCS[f], number: d.Number || '', date: day(d.Date), posted: !!d.Posted };
}

// Ключ записи независимого регистра — все измерения: ARM(ДокументЗаказПокупателя_Key=guid'…',…)
export function keyPath(rec) {
  return ARM + '(' + ARM_KEYS.map(k => {
    const v = rec[k];
    if (k.endsWith('_Key')) return `${k}=${guid(v)}`;
    if (typeof v === 'boolean') return `${k}=${v}`;
    return `${k}=${lit(v)}`;
  }).join(',') + ')';
}

export function toLine(rec, units = {}) {
  const status = statusOf(rec.СтатусСтроки);
  const nom = rec.Номенклатура_Key && rec.Номенклатура_Key !== EMPTY
    ? { id: rec.Номенклатура_Key, name: (rec.Номенклатура && rec.Номенклатура.Description) || '', article: (rec.Номенклатура && rec.Номенклатура.Артикул) || '',
        code: (rec.Номенклатура && rec.Номенклатура.АС_КодАвтоАльянс) || '', unit: units[rec.Номенклатура && rec.Номенклатура.ЕдиницаИзмерения_Key] || '' }
    : null;
  const author = named(rec, 'АвторСтроки');
  return {
    id: rec.ИдентификаторЗаписи, linkKey: rec.КлючСвязиСтрок, operation: rec.ВидОперации === 'Закупка' ? 'purchase' : 'sale',
    status, locked: status === 'locked_background', deleted: !!rec.Удаление, marked: !!rec.ОтметкаСтроки,
    markedBy: author ? author.name : null, markedById: author ? author.id : null, order: rec.Порядок, hasDeficit: false,
    customerOrder: docRef(rec, 'ДокументЗаказПокупателя'), supplierOrder: docRef(rec, 'ДокументЗаказПоставщика'),
    receipt: docRef(rec, 'ДокументПриходнаяНакладная'), shipmentDoc: docRef(rec, 'РасходнаяНакладная'),
    signedOriginal: !!rec.ДокументПодписанОригинал, shipmentDate: day(rec.ДатаОтгрузки), shipmentNumber: rec.НомерОтгрузки,
    orderDate: day(rec.ДатаЗаказа), internalOrderNumber: rec.НомерЗаказа, clientOrderNumber: rec.НомерЗаказаКлиента,
    customer: named(rec, 'Покупатель'), contract: named(rec, 'Договор'), serviceType: named(rec, 'ВидУслуги'),
    brand: rec.Марка, model: rec.Модель, aggregate: rec.Агрегат, plate: rec.Госномер, chassis: rec.НомерШасси, vin: rec.VIN, engine: rec.Двигатель,
    urgency: rec.СрочностьКлиента, vehiclePlate: rec.ГРЗКлиента, territory: rec.ТерриторияКлиента, factName: rec.НоменклатураКлиента,
    factArticle: rec.АртикулКлиента, factQty: rec.КоличествоКлиента, factUnit: rec.ЕдиницаИзмеренияКлиента,
    nomenclature: nom, quantity: rec.Количество, normHours: rec.КоличествоНормаЧас, stockQty: rec.ОстатокДляСтроки,
    reserveQty: rec.КоличествоВРезерве, inTransitQty: rec.КоличествоВПути, batch: named(rec, 'Партия'), stockCell: rec.ЯчейкаСклада,
    costPrice: rec.СебестоимостьЕдиницы, costSum: rec.Себестоимость, paymentForm: named(rec, 'ФормаОплаты'), rrc: rec.РРЦ, paid: rec.Оплачено,
    invoiceNumber: rec.НомерСчета, invoiceDate: day(rec.ДатаСчета), coefficient: rec.Коэффициент, salePrice: rec.Цена,
    saleSum: (rec.КоличествоНормаЧас > 0 ? rec.КоличествоНормаЧас : rec.Количество) * rec.Цена,
    supplier: named(rec, 'Поставщик'), receiptDate: day(rec.ДатаПоступления), updDate: day(rec.ДатаУПД), updNumber: rec.НомерУПД,
    supplierShipTerritory: rec.ТерриторияОтгрузкиПоставщиком, supplierOrderDate: day(rec.ДатаЗаказаПоставщику),
    deliveryTerm: day(rec.СрокПоставки), assemblySentDate: day(rec.ДатаОтправкиНаСборку),
    comment: rec.КомментарийКСтроке, comment2: rec.КомментарийКСтроке2
  };
}

// Значение PATCH { field, value } -> свойства записи OData (ссылка — <поле>_Key, дата — ISO, пустое — пустое значение типа)
const DATE_FIELDS = new Set(['ДатаОтгрузки', 'ДатаЗаказа', 'ДатаПоступления', 'ДатаУПД', 'ДатаСчета', 'ДатаЗаказаПоставщику', 'СрокПоставки', 'ДатаОтправкиНаСборку']);
const NUMBER_FIELDS = new Set(['Количество', 'КоличествоНормаЧас', 'СебестоимостьЕдиницы', 'РРЦ', 'Коэффициент', 'Цена', 'Порядок']);
const BOOL_FIELDS = new Set(['ДокументПодписанОригинал', 'ОтметкаСтроки']);
export function fieldValue(field, value) {
  if (REF_FIELDS.includes(field)) {
    const id = value && typeof value === 'object' ? value.id : value;
    return { [field + '_Key']: id || EMPTY };
  }
  if (DATE_FIELDS.has(field)) return { [field]: value ? String(value).slice(0, 10) + 'T00:00:00' : EMPTY_DATE };
  if (NUMBER_FIELDS.has(field)) {
    const n = Number(String(value ?? 0).replace(',', '.'));
    if (Number.isNaN(n)) throw new TypeError(`${field}: не число «${value}»`);
    return { [field]: n };
  }
  if (BOOL_FIELDS.has(field)) return { [field]: value === true || value === 'true' };
  return { [field]: value == null ? '' : String(value) };
}

export function matrixFor(role) {
  // роль без записи в матрице — без прав (D1b, fail-closed)
  return { role, statuses: MATRIX.statuses, columns: MATRIX.roles[role] || [] };
}
export const MATRIX_ETAG = '"' + MATRIX.source.length + '-' + MATRIX.roles.manager.length + '-' + MATRIX.statuses.length + '"';
