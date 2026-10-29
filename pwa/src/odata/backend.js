// Операции REST API АРМ (контракт openapi/arm-pwa*.openapi.yaml) поверх стандартного интерфейса OData 1С.
// Экраны PWA зовут те же пути (/lines, /matrix, /sales/…), а здесь они выполняются запросами OData.
// Логика команд перенесена из Арм_API (АРМ v2.9): матрица прав, переходы процессов, канбан снабжения, отметки, вычёркивание.
// Команды с серверной логикой АРМ («В работе», приход на «Собран», проведение, новый заказ с Заполнить()) — запись в регистр
// команд расширения АРМ_OData v1.1 (InformationRegister_АрмOData_КомандыPWA): 1С выполняет команду при записи
// и возвращает запись с Результат (JSON). См. odata/АрмOData_Команды.bsl.
import { createClient, EMPTY, guid, lit, TRANSIENT } from './client';
import { fail } from './errors';
import { ARM, LINE_QUERY, OPERATION, toLine, keyPath, fieldValue, enumOf, statusOf, matrixFor, MATRIX_ETAG } from './mapping';

const ROLE_BY_ENUM = { Менеджер: 'manager', Снабжение: 'supply', Кладовщик: 'storekeeper', ГлавныйМеханик: 'chief_mechanic',
  Администратор: 'admin', Поставщик: 'supplier', Клиент: 'client' };
const today = () => new Date().toISOString().slice(0, 10);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

// Переходы процессов (Арм_API.ПереходыПроцессов): цель, статус АРМ, из каких статусов, каким ролям
const TRANSITIONS = [
  ['reserve', 'Резервирование', 'new,in_work', 'manager,admin'],
  ['assembly', 'Комплектуется', 'reserve,to_stock,acceptance', 'manager,admin'],
  ['assembly', 'Комплектуется', 'ready_to_ship', 'manager,admin,chief_mechanic'],
  ['assembly', 'Комплектуется', 'return', 'manager,admin'],
  ['ready_to_ship', 'Собран', 'assembly', 'storekeeper,manager,admin'],
  ['shipped', 'Отгружено', 'paid,in_transit', 'manager,admin'],
  ['acceptance', 'Приходуется', 'shipped', 'storekeeper,admin'],
  ['return', 'Возврат', 'shipped,ordered,paid,in_transit,to_stock,closed', 'manager,storekeeper,admin'],
  ['closed', 'Выполнено', 'shipped,ready_to_ship,return', 'manager,storekeeper,admin'],
  ['closed', 'Выполнено', 'assembly', 'chief_mechanic,admin']
].map(([to, status, from, roles]) => ({ to, status, from: from.split(','), roles: roles.split(',') }));
const SUPPLY_STATUS = { paid: 'Оплачено', in_transit: 'ТоварВПути', acceptance: 'Приходуется', to_stock: 'НаСкладе', assembly: 'Комплектуется', assembled: 'Собран' };
const COMMANDS = 'InformationRegister_АрмOData_КомандыPWA';
const NOTICES = 'InformationRegister_Арм_Уведомления';
const ENUM_BY_ROLE = Object.fromEntries(Object.entries(ROLE_BY_ENUM).map(([e, r]) => [r, e]));
const DOC_SETS = { customer_order: 'Document_ЗаказПокупателя', supplier_order: 'Document_ЗаказПоставщику', receipt: 'Document_ПриходнаяНакладная', shipment: 'Document_РасходнаяНакладная' };

const JOBS = new Map();   // итоги «В работе» (need_split/failed в регистр не пишутся)

export const NOT_SUPPORTED = {
  'POST /sales/supplier-orders': 'команда «Заказать» — в АРМ заглушка (заказ поставщику создаёт «В работе»)'
};

// Почему ячейку нельзя менять (как useMatrixStore.denyReason) — или null
export function denyReason(column, line, userName, statuses) {
  if (!column.writable) return 'поле только для чтения';
  if (line.locked) return 'строка заблокирована фоном';
  const i = statuses.indexOf(line.status);
  const ch = i < 0 ? '.' : column.rights[i];
  if (ch === '+') return null;
  if (ch === 'c') return line.markedBy === userName ? null : 'меняет только автор строки';
  return `матрица: нельзя в статусе «${line.status}»`;
}

export function createBackend({ baseUrl, session, log }) {
  const od = createClient({ baseUrl, token: session.token, log });
  const units = {};
  const me = () => (session.user && session.user.userRef) || null;
  const role = () => (session.user && session.user.role) || 'manager';
  const userName = () => (session.user && session.user.userName) || '';

  // ---------------------------------------------------------------- команды АРМ (регистр команд АРМ_OData)
  // POST записи выполняет команду в 1С (ПередЗаписью, сеанс пользователя PWA) и возвращает запись с Результат (JSON);
  // отказ — ошибка OData с текстом «АРМODATA{status, code, message}» (для «В работе» — и need_split/failed: {state, message}).
  async function command(name, params = {}, attempt = 0) {
    const id = 'cmd-' + uuid().replace(/-/g, '');   // не вида guid: такую строку 1С в $filter разбирает как ссылку
    try {
      const rec = await od.post(COMMANDS, { Ид: id, Команда: name, Параметры: JSON.stringify(params) });
      return { id, ...JSON.parse(rec.Результат || '{}') };
    } catch (e) {
      // сбой сеанса файловой 1С (TRANSIENT): транзакция команды откатилась — повторяем один раз
      if (attempt === 0 && TRANSIENT.test(e.message || '')) return command(name, params, 1);
      const m = /АРМODATA(\{.*\})/s.exec(e.message || '');
      if (!m) throw e;
      const res = JSON.parse(m[1]);
      if (res.state) return { id, ...res };
      return fail(res.status || 409, res.code || 'command_failed', res.message || 'Команда ' + name + ' не выполнена');
    }
  }
  // «В работе» — задание, как в Арм_API (202 и GET /jobs/{id}); выполняется сразу, итог хранится для опроса
  async function startJob({ allowSplit }) {
    requireUser();
    const r = await command('ВРаботе', { allowSplit: !!allowSplit });
    const j = { id: r.id, state: r.state || 'failed', message: r.message || '', processed: r.processed };
    JOBS.set(j.id, j);
    return j;
  }
  async function job(id) {
    if (JOBS.has(id)) return JOBS.get(id);
    const recs = await od.list(COMMANDS, { $filter: `Ид eq ${lit(id)}` });
    if (!recs.length) fail(404, 'not_found', 'Задание не найдено');
    const r = JSON.parse(recs[0].Результат || '{}');
    return { id, state: r.state || 'failed', message: r.message || '', processed: r.processed };
  }

  async function unitNames(recs) {
    const need = [...new Set(recs.map(r => r.Номенклатура && r.Номенклатура.ЕдиницаИзмерения_Key).filter(k => k && k !== EMPTY && !(k in units)))];
    if (!need.length) return;
    const rows = await od.list('Catalog_КлассификаторЕдиницИзмерения', { $filter: need.map(k => `Ref_Key eq ${guid(k)}`).join(' or '), $select: 'Ref_Key,Description' });
    for (const k of need) units[k] = '';
    for (const r of rows) units[r.Ref_Key] = r.Description;
  }
  async function records(filter, extra = {}) {
    const recs = await od.list(ARM, { ...LINE_QUERY, $filter: filter, ...extra });
    await unitNames(recs);
    return recs;
  }
  async function record(id) {
    const recs = await records(`ИдентификаторЗаписи eq ${lit(id)}`, { $top: 1 });
    if (!recs.length) fail(404, 'not_found', `Строка ${id} не найдена`);
    return recs[0];
  }
  const line = async id => toLine(await record(id), units);
  const myMarked = view => `ОтметкаСтроки eq true and АвторСтроки_Key eq ${guid(me() || EMPTY)} and ВидОперации eq ${lit(OPERATION[view] || 'Продажа')} and Удаление eq false`;
  const unmark = { ОтметкаСтроки: false, АвторСтроки_Key: EMPTY };
  const requireUser = () => { if (!me()) fail(409, 'not_author', `Пользователь «${userName()}» не найден в справочнике «Пользователи» — отметки и команды недоступны`); };
  // статус + В9 «Дата отправки на сборку» при переводе в «Комплектуется», если пустая (v2.14)
  const statusPatch = (rec, statusEnum) => ({ СтатусСтроки: statusEnum,
    ...(statusEnum === 'Комплектуется' && (!rec.ДатаОтправкиНаСборку || rec.ДатаОтправкиНаСборку.startsWith('0001')) ? { ДатаОтправкиНаСборку: today() + 'T00:00:00' } : {}) });

  // ---------------------------------------------------------------- сессия
  async function login({ login: user, password }) {
    if (!user) fail(400, 'bad_request', 'login: имя пользователя ИБ', 'login');
    const users = await od.list('Catalog_Пользователи', { $filter: `Description eq ${lit(user)}`, $select: 'Ref_Key,Description', $top: 1 });
    const ref = users.length ? users[0].Ref_Key : null;
    let r = null;
    if (ref) {
      const rows = await od.list('InformationRegister_Арм_ПраваПользователей', { $filter: `Пользователь_Key eq ${guid(ref)}`, $select: 'РольИнтерфейса' });
      r = rows.length ? ROLE_BY_ENUM[rows[0].РольИнтерфейса] : null;
    }
    if (!r) fail(403, 'matrix_denied', `У пользователя «${user}» нет роли АРМ (регистр Арм_ПраваПользователей)`);
    return { userName: users[0].Description, login: user, role: r, screen: r === 'supply' ? 'supply' : 'sales', userRef: ref };
  }

  // ---------------------------------------------------------------- строки
  async function listLines(q) {
    const view = q.view || 'sales';
    const f = [`ВидОперации eq ${lit(OPERATION[view] || 'Продажа')}`];
    if (q.hideDeleted !== 'false' && q.hideDeleted !== false) f.push('Удаление eq false');
    if (q.hideShipped === 'true' || q.hideShipped === true) f.push(`СтатусСтроки ne 'Отгружено' and СтатусСтроки ne 'Выполнено' and СтатусСтроки ne 'Завершено'`);
    if (q.periodFrom) f.push(`ДатаЗаказа ge datetime'${q.periodFrom}T00:00:00'`);
    if (q.periodTo) f.push(`ДатаЗаказа le datetime'${q.periodTo}T23:59:59'`);
    if (q.customerOrderId) f.push(`ДокументЗаказПокупателя_Key eq ${guid(q.customerOrderId)}`);
    const limit = Number(q.limit) || 100;
    const skip = Number(q.cursor) || 0;
    const group = !(q.groupByCustomerOrder === 'false' || q.groupByCustomerOrder === false);
    let recs = await records(f.join(' and '), { $top: limit + 1, $skip: skip,
      $orderby: group ? 'ДатаЗаказа desc,ДокументЗаказПокупателя_Key,Порядок' : 'ДатаЗаказа desc,Порядок' });
    const more = recs.length > limit;
    recs = recs.slice(0, limit);
    if ((q.onlyWithPurchases === 'true' || q.onlyWithPurchases === true) && view === 'sales') {
      const keys = new Set((await od.list(ARM, { $filter: `ВидОперации eq 'Закупка' and Удаление eq false`, $select: 'КлючСвязиСтрок' })).map(r => r.КлючСвязиСтрок));
      recs = recs.filter(r => keys.has(r.КлючСвязиСтрок));
    }
    return { items: recs.map(r => toLine(r, units)), nextCursor: more ? String(skip + limit) : null };
  }

  async function patchLine(id, { field, value }) {
    if (!field) fail(400, 'bad_request', 'field: имя поля регистра', 'field');
    const rec = await record(id);
    const ln = toLine(rec, units);
    const m = matrixFor(role());
    const col = m.columns.find(c => c.field === field);
    if (!col) fail(400, 'field_readonly', `Поле «${field}» нельзя изменить`, field);
    const why = denyReason(col, ln, userName(), m.statuses);
    if (why) fail(403, why.startsWith('матрица') ? 'matrix_denied' : why.includes('автор') ? 'not_author' : 'field_readonly', why, field);
    let body;
    try { body = fieldValue(field, value); } catch (e) { fail(400, 'bad_request', e.message, field); }
    if (field === 'Договор' && body.Договор_Key !== EMPTY) {
      const c = await od.get(`Catalog_ДоговорыКонтрагентов(${guid(body.Договор_Key)})`, { $select: 'Owner' });
      if (c.Owner !== rec.Покупатель_Key) fail(409, 'contract_owner', `Договор не принадлежит заказчику «${ln.customer ? ln.customer.name : ''}»`, field);
    }
    if (field === 'Покупатель' && rec.Договор_Key !== EMPTY) body.Договор_Key = EMPTY;   // договор другого владельца сбрасывается
    if (field === 'Количество' || field === 'СебестоимостьЕдиницы') {
      const qty = field === 'Количество' ? body.Количество : rec.Количество;
      const price = field === 'СебестоимостьЕдиницы' ? body.СебестоимостьЕдиницы : rec.СебестоимостьЕдиницы;
      body.Себестоимость = Math.round(qty * price * 100) / 100;
    }
    // формулы матрицы (Арм_API.ПересчитатьЦеныСтроки): цена продажи = (РРЦ, если есть, иначе цена себес.) × Коэфф;
    // ручная цена продажи пересчитывает Коэфф; пока Коэфф не заполнен, цена не пересчитывается
    if (rec.ВидОперации === 'Продажа') {
      const v = { ...rec, ...body };
      const base = v.РРЦ || v.СебестоимостьЕдиницы;
      if (base && field === 'Цена') Object.assign(body, { Коэффициент: v.Цена / base, ТипИзмененияЦены: '1' });
      else if (base && ['Коэффициент', 'РРЦ', 'СебестоимостьЕдиницы'].includes(field) && v.Коэффициент) {
        body.Цена = Math.round(base * v.Коэффициент * 100) / 100;
        if (field === 'Коэффициент') body.ТипИзмененияЦены = '2';   // в регистре — строка
      }
    }
    if (field === 'ДокументПодписанОригинал' && body.ДокументПодписанОригинал) Object.assign(body, unmark);
    if (field === 'Номенклатура' && rec.ВидОперации === 'Продажа') {
      // v2.22 (F-2): смена номенклатуры продажи — командой АРМ, как в форме: новый ключ связи, незаказанные закупки
      // старой номенклатуры удаляются, строка заказа покупателя и остатки пересчитываются
      const nomId = body.Номенклатура_Key === EMPTY ? '' : body.Номенклатура_Key;
      const r = await command('СменитьНоменклатуру', { id, nomenclatureId: nomId });
      const ln = await lineAfterRecalc(id, rec, nomId ? `Номенклатура_Key eq ${guid(nomId)}` : null);
      return r.warning ? { ...ln, warning: r.warning } : ln;
    }
    // пересчёт — после количества продажи или ручной закупки (её количество вычитается из потребности, авто-закупка
    // уменьшается/удаляется); авто-закупку пересчёт пересоздал бы — её количество не пересчитываем
    const recalc = field === 'Количество' && rec.Номенклатура_Key && rec.Номенклатура_Key !== EMPTY
      && (rec.ВидОперации === 'Продажа' || rec.РучнаяПравка === true);
    await od.patch(keyPath(rec), body);
    if (recalc) {
      // v2.22 (F-4): как форма АРМ — деление по партиям и авто-закупка при нехватке остатка
      await command('ПересчитатьСтроку', { id });
      return lineAfterRecalc(id, rec, `КлючСвязиСтрок eq ${lit(rec.КлючСвязиСтрок)}`);
    }
    return line(id);
  }

  // После пересчёта АРМ строка могла слиться с другой записью того же ключа (Арм_ОбщегоНазначенияАРМ.
  // СхлопнутьСтрокиПродажПартии оставляет запись с наибольшим Ид) — тогда ищем продажу заказа по условию.
  async function lineAfterRecalc(id, rec, cond) {
    const same = await records(`ИдентификаторЗаписи eq ${lit(id)}`, { $top: 1 });
    if (same.length) return toLine(same[0], units);
    const alt = cond ? await records(`ДокументЗаказПокупателя_Key eq ${guid(rec.ДокументЗаказПокупателя_Key)} and ВидОперации eq 'Продажа' and Удаление eq false and ${cond}`, { $top: 1 }) : [];
    if (!alt.length) fail(404, 'not_found', `Строка ${id} не найдена после пересчёта`);
    return toLine(alt[0], units);
  }

  async function toggleMark(id) {
    requireUser();
    const rec = await record(id);
    const ln = toLine(rec, units);
    if (ln.marked && ln.markedById !== me()) fail(409, 'not_author', 'Строку отметил другой пользователь: ' + ln.markedBy);
    await od.patch(keyPath(rec), ln.marked ? unmark : { ОтметкаСтроки: true, АвторСтроки_Key: me() });
    return line(id);
  }

  async function selectionTotals(view) {
    const recs = me() ? await od.list(ARM, { $filter: myMarked(view), $select: 'Количество,КоличествоНормаЧас,Цена,Себестоимость' }) : [];
    return recs.reduce((t, r) => ({ count: t.count + 1, quantity: t.quantity + r.Количество,
      saleSum: t.saleSum + (r.КоличествоНормаЧас > 0 ? r.КоличествоНормаЧас : r.Количество) * r.Цена, costSum: t.costSum + r.Себестоимость }),
    { count: 0, quantity: 0, saleSum: 0, costSum: 0 });
  }

  async function markOrder({ view, customerOrderId, marked }) {
    requireUser();
    if (typeof marked !== 'boolean') fail(400, 'bad_request', 'marked: true или false', 'marked');
    const recs = await od.list(ARM, { $filter: `ДокументЗаказПокупателя_Key eq ${guid(customerOrderId)} and ВидОперации eq ${lit(OPERATION[view] || 'Продажа')} and Удаление eq false` });
    let n = 0;
    for (const r of recs) {
      const free = r.АвторСтроки_Key === EMPTY || r.АвторСтроки_Key === me();
      if (!free || !!r.ОтметкаСтроки === marked) continue;
      await od.patch(keyPath(r), marked ? { ОтметкаСтроки: true, АвторСтроки_Key: me() } : unmark);
      n++;
    }
    return { processed: n, total: recs.length };
  }

  async function strikeLine(id) {
    const rec = await record(id);
    const ln = toLine(rec, units);
    if (!['new', 'in_work'].includes(ln.status)) fail(409, 'row_locked', 'Вычеркнуть можно только строку в статусе «Черновик» или «В работе»');
    if (ln.markedById && ln.markedById !== me()) fail(409, 'not_author', 'Строку отметил другой пользователь: ' + ln.markedBy);
    // v2.22 (F-1): командой АРМ — продажа и незаказанные закупки ключа вычеркиваются, строка уходит из заказа покупателя
    await command('Вычеркнуть', { id });
    return null;
  }

  async function addLines({ view, customerOrderId, sourceLineId, nomenclatureIds }) {
    if (!Array.isArray(nomenclatureIds) || !nomenclatureIds.length) fail(400, 'bad_request', 'nomenclatureIds: непустой массив', 'nomenclatureIds');
    const col = matrixFor(role()).columns.find(c => c.field === 'Номенклатура');
    if (!col || col.rights[0] !== '+') fail(403, 'matrix_denied', `Матрица не разрешает роли ${role()} подбирать номенклатуру в статусе «Новый»`, 'Номенклатура');
    let tpl;
    if (view === 'purchases') {
      const src = await record(sourceLineId);
      tpl = { ДокументЗаказПокупателя_Key: src.ДокументЗаказПокупателя_Key, КлючСвязиСтрок: src.КлючСвязиСтрок, Покупатель_Key: src.Покупатель_Key,
        Договор_Key: src.Договор_Key, НомерЗаказаКлиента: src.НомерЗаказаКлиента, ДатаЗаказа: src.ДатаЗаказа, НомерЗаказа: src.НомерЗаказа,
        НоменклатураКлиента: src.НоменклатураКлиента, КоличествоКлиента: src.КоличествоКлиента };
    } else {
      const d = await od.get(`Document_ЗаказПокупателя(${guid(customerOrderId)})`, { $select: 'Ref_Key,Number,Date,Контрагент_Key,Договор_Key,НомерЗаказаКлиента' });
      tpl = { ДокументЗаказПокупателя_Key: d.Ref_Key, Покупатель_Key: d.Контрагент_Key || EMPTY, Договор_Key: d.Договор_Key || EMPTY,
        НомерЗаказаКлиента: d.НомерЗаказаКлиента || '', ДатаЗаказа: d.Date, НомерЗаказа: d.Number };
    }
    const top = await od.list(ARM, { $orderby: 'Порядок desc', $top: 1, $select: 'Порядок' });
    let order = top.length ? top[0].Порядок : 0;
    const out = [];
    for (const nid of nomenclatureIds) {
      const id = uuid();
      await od.post(ARM, { ...tpl, ...(view === 'purchases' ? {} : { КлючСвязиСтрок: uuid() }), ИдентификаторЗаписи: id,
        ВидОперации: view === 'purchases' ? 'Закупка' : 'Продажа', РучнаяПравка: view === 'purchases', Номенклатура_Key: nid,
        ДокументЗаказПоставщика_Key: EMPTY, ДокументПриходнаяНакладная_Key: EMPTY, СтатусСтроки: 'Черновик', Порядок: ++order });
      out.push(await line(id));
    }
    return out;
  }

  async function transition({ view, to }) {
    if (view !== 'sales' && view !== 'purchases') fail(400, 'bad_request', 'view: sales или purchases', 'view');
    requireUser();
    const all = TRANSITIONS.filter(t => t.to === to);
    if (!all.length) fail(400, 'bad_request', 'to: ' + [...new Set(TRANSITIONS.map(t => t.to))].join(', '), 'to');
    const mine = all.filter(t => t.roles.includes(role()));
    if (!mine.length) fail(403, 'matrix_denied', `Переход «${to}» недоступен роли ${role()}`);
    const marked = await od.list(ARM, { $filter: myMarked(view) });
    if (!marked.length) fail(409, 'nothing_marked', 'Нет отмеченных строк');
    const from = s => mine.find(t => t.from.includes(s));
    const skipped = [];
    let done = 0;
    for (const r of marked) {
      const s = statusOf(r.СтатусСтроки);
      const t = from(s);
      const name = r.НоменклатураКлиента || r.ИдентификаторЗаписи;
      if (!t) { skipped.push(`${name}: из «${s}» нельзя`); continue; }
      if (to === 'closed' && s === 'shipped' && !r.ДокументПодписанОригинал) { skipped.push(`${name}: не отмечено «Документ подписан оригинал»`); continue; }
      await od.patch(keyPath(r), { ...statusPatch(r, t.status), ...unmark });
      done++;
      if (view === 'purchases') {   // закупка ведёт за собой связанную продажу в том же статусе
        for (const sale of await od.list(ARM, { $filter: `КлючСвязиСтрок eq ${lit(r.КлючСвязиСтрок)} and ВидОперации eq 'Продажа' and Удаление eq false` })) {
          if (statusOf(sale.СтатусСтроки) === s) await od.patch(keyPath(sale), statusPatch(sale, t.status));
        }
      }
    }
    if (!done) fail(409, 'transition_denied', `Переход «${to}» не применён: ${skipped.join('; ')}. Допустимо из: ${[...new Set(mine.flatMap(t => t.from))].join(', ')}`);
    return { processed: done, total: marked.length, message: skipped.length ? 'Пропущены: ' + skipped.join('; ') : undefined };
  }

  async function supplyStatus({ status, partialReceipt, receiptDate }) {
    if (role() !== 'supply' && role() !== 'admin') fail(403, 'matrix_denied', 'Статусы канбана меняет роль supply');
    const target = SUPPLY_STATUS[status];
    if (!target) fail(400, 'bad_request', 'status: ' + Object.keys(SUPPLY_STATUS).join(', '), 'status');
    requireUser();
    // ИзменитьСтатусыВРегистреСнабжения АРМ: закупка ведёт связанную продажу, на «Собран» — приходная накладная;
    // частичный приход по заказу поставщику — 409 need_split (повтор с partialReceipt и receiptDate)
    const { processed, total } = await command('СтатусСнабжения', { status, partialReceipt: !!partialReceipt, receiptDate: receiptDate || '' });
    return { processed, total };
  }

  async function prepared() {
    requireUser();
    const marked = await od.list(ARM, { $filter: `${myMarked('sales')} and СтатусСтроки eq 'ВРаботе'` });
    if (!marked.length) fail(409, 'nothing_marked', 'Нет отмеченных строк продажи в статусе «В работе»');
    const open = new Set((await od.list(ARM, { $filter: `ВидОперации eq 'Закупка' and СтатусСтроки ne 'НаСкладе' and Удаление eq false`, $select: 'КлючСвязиСтрок' })).map(r => r.КлючСвязиСтрок));
    const ready = marked.filter(r => r.Номенклатура_Key !== EMPTY && r.Поставщик_Key !== EMPTY && r.Количество && r.Цена && !open.has(r.КлючСвязиСтрок));
    if (!ready.length) fail(409, 'unfinished_purchase', 'В строках есть незавершённые закупки или не заполнены номенклатура, поставщик, количество, цена');
    for (const r of ready) await od.patch(keyPath(r), { СтатусСтроки: 'Подготовлено', ...unmark });
    return { processed: ready.length, total: marked.length };
  }

  async function shipments({ customerOrderId, shipmentDate, shipmentNumber }) {
    if (!shipmentDate || !shipmentNumber) fail(400, 'bad_request', 'Нужны shipmentDate и shipmentNumber');
    const recs = await od.list(ARM, { $filter: `ДокументЗаказПокупателя_Key eq ${guid(customerOrderId)} and ВидОперации eq 'Продажа' and Удаление eq false` });
    let n = 0;
    for (const r of recs) {
      const free = r.АвторСтроки_Key === EMPTY || r.АвторСтроки_Key === me();
      const inWork = r.Партия_Key !== EMPTY && ['ВРаботе', 'Черновик'].includes(r.СтатусСтроки);
      const ready = ['Собран', 'Подготовлено', 'Возврат'].includes(r.СтатусСтроки);
      if (free && (inWork || ready)) { await od.patch(keyPath(r), { ДатаОтгрузки: shipmentDate + 'T00:00:00', НомерОтгрузки: shipmentNumber }); n++; }
    }
    return { processed: n, total: recs.length };
  }

  // ---------------------------------------------------------------- документы
  // Новый заказ — команда СоздатьЗаказ: Заполнить() 1С (организация, склад, валюта …), строки АРМ — обработчиком АРМ
  async function createOrder({ customerId, contractId, clientOrderNumber, date }, rows) {
    if (!customerId) fail(400, 'bad_request', 'Заказчик не указан', 'customerId');
    const { id, kind, number, date: d, posted } = await command('СоздатьЗаказ',
      { customerId, contractId: contractId || '', clientOrderNumber: clientOrderNumber || '', date: date || today(), ...(rows ? { rows } : {}) });
    return { id, kind, number, date: d, posted };
  }

  async function importSheet({ customerId, contractId, rows }) {
    if (!Array.isArray(rows) || !rows.length) fail(400, 'bad_request', 'rows: непустой массив', 'rows');
    return createOrder({ customerId, contractId, clientOrderNumber: rows[0].clientNumber || '' }, rows);
  }

  // Проведение (M15) — команда ПровестиЗаказ: отмеченные строки «Подготовлено» -> «Запасы», проведение, строки -> «Завершено»
  async function postOrder(id) {
    requireUser();
    const { processed, total } = await command('ПровестиЗаказ', { id });
    return { processed, total };
  }

  async function deleteOrder(id) {
    const supplierOrders = await od.list('Document_ЗаказПоставщику', { $filter: `ЗаказПокупателя_Key eq ${guid(id)} and DeletionMark eq false`, $top: 1, $select: 'Ref_Key' })
      .catch(() => []);
    if (supplierOrders.length) fail(409, 'unfinished_purchase', 'По заказу есть заказ поставщику — удалить нельзя');
    const recs = await od.list(ARM, { $filter: `ДокументЗаказПокупателя_Key eq ${guid(id)}` });
    if (recs.some(r => !r.Удаление && !['Черновик', 'ВРаботе'].includes(r.СтатусСтроки))) fail(409, 'row_locked', 'В заказе есть строки дальше статуса «В работе» — удалить нельзя');
    await od.patch(`Document_ЗаказПокупателя(${guid(id)})`, { DeletionMark: true });
    for (const r of recs) await od.del(keyPath(r));
    return null;
  }

  async function documentCard(kind, id) {
    const set = DOC_SETS[kind];
    if (!set) fail(404, 'not_found', 'Вид документа: ' + Object.keys(DOC_SETS).join(', '));
    // $expand у одиночной сущности 1С не поддерживает (501) — коллекция с отбором по ссылке
    const found = await od.list(set, { $filter: `Ref_Key eq ${guid(id)}`, $expand: 'Контрагент,Договор',
      $select: 'Ref_Key,Number,Date,Posted,Комментарий,Контрагент_Key,Договор_Key,Контрагент/Description,Договор/Description' });
    if (!found.length) fail(404, 'not_found', 'Документ не найден');
    const d = found[0];
    const ref = (k, n) => (d[k + '_Key'] && d[k + '_Key'] !== EMPTY ? { id: d[k + '_Key'], name: (d[n] && d[n].Description) || '' } : null);
    return { id: d.Ref_Key, kind, number: d.Number, date: (d.Date || '').slice(0, 10), posted: !!d.Posted,
      counterparty: ref('Контрагент', 'Контрагент'), contract: ref('Договор', 'Договор'), comment: d.Комментарий || '' };
  }

  // ---------------------------------------------------------------- справочники
  const like = q => `substringof(${lit(q)}, Description)`;
  async function directory(name, q) {
    const named = r => ({ id: r.Ref_Key, name: r.Description });
    const notDeleted = 'DeletionMark eq false';
    switch (name) {
      case 'counterparties':
        return (await od.list('Catalog_Контрагенты', { $filter: [notDeleted, 'IsFolder eq false', q.q ? like(q.q) : ''].filter(Boolean).join(' and '),
          $select: 'Ref_Key,Description', $orderby: 'Description', $top: 50 })).map(named);
      case 'contracts':
        if (!q.ownerId) return [];
        return (await od.list('Catalog_ДоговорыКонтрагентов', { $filter: `${notDeleted} and Owner eq cast(${guid(q.ownerId)}, 'Catalog_Контрагенты')`,
          $select: 'Ref_Key,Description', $orderby: 'Description' })).map(named);
      case 'nomenclature': {
        const f = [notDeleted, 'IsFolder eq false'];
        if (q.q) f.push(`(${like(q.q)} or substringof(${lit(q.q)}, Артикул))`);
        const recs = await od.list('Catalog_Номенклатура', { $filter: f.join(' and '), $select: 'Ref_Key,Description,Артикул,АС_КодАвтоАльянс,ЕдиницаИзмерения_Key',
          $orderby: 'Description', $top: 50 });
        await unitNames(recs.map(r => ({ Номенклатура: { ЕдиницаИзмерения_Key: r.ЕдиницаИзмерения_Key } })));
        return recs.map(r => ({ ...named(r), article: r.Артикул, code: r.АС_КодАвтоАльянс, unit: units[r.ЕдиницаИзмерения_Key] || '' }));
      }
      case 'batches': {
        const f = [notDeleted];
        if (q.nomenclatureId) f.push(`Owner_Key eq ${guid(q.nomenclatureId)}`);   // владелец партий — один тип: Owner_Key
        return (await od.list('Catalog_ПартииНоменклатуры', { $filter: f.join(' and '), $select: 'Ref_Key,Description', $top: 100 })).map(named);
      }
      case 'service-types':
        return (await od.list('Catalog_Арм_ВидыУслуги', { $filter: notDeleted, $select: 'Ref_Key,Description', $orderby: 'Description' })).map(named);
      case 'payment-forms':
        return (await od.list('Catalog_Арм_ФормыОплаты', { $filter: notDeleted, $select: 'Ref_Key,Description', $orderby: 'Description' })).map(named);
      case 'units':
        return Object.values(await unitsAll()).map(u => ({ id: u.id, name: u.name }));
      case 'car-models':
        return (await od.list('Catalog_асМодели', { $filter: [notDeleted, 'IsFolder eq false', q.q ? like(q.q) : ''].filter(Boolean).join(' and '),
          $select: 'Ref_Key,Description', $orderby: 'Description', $top: 100 })).map(named);
      case 'car-groups':
        return (await od.list('Catalog_асАвтомобили', { $filter: `${notDeleted} and IsFolder eq true`, $select: 'Ref_Key,Description', $orderby: 'Description' })).map(named);
      default:
        return fail(404, 'not_found', 'Справочник: counterparties, contracts, nomenclature, batches, service-types, payment-forms, units, car-models, car-groups');
    }
  }

  // ---------------------------------------------------------------- разделы «Товары», «Услуги», «Машины»
  // Номенклатура (тип Запас / Услуга) и асАвтомобили — через OData; цена (регистр ЦеныНоменклатуры) и госномер
  // (периодический регистр асАвтомобили) пишутся командами АРМ_OData ЦенаНоменклатуры и ДанныеАвтомобиля.
  const CATALOG_EDIT = { goods: ['admin', 'manager', 'storekeeper'], services: ['admin', 'manager', 'chief_mechanic'], cars: ['admin', 'manager', 'chief_mechanic'] };
  const NOM_KIND = { goods: 'Запас', services: 'Услуга' };
  const PRICE_KIND = 'Розничная цена';
  const canEdit = kind => (CATALOG_EDIT[kind] || []).includes(role());
  const requireEdit = kind => { if (!canEdit(kind)) fail(403, 'matrix_denied', `Роль «${role()}» не может менять этот справочник`); };
  let unitsCache, priceKindRef, modelsCache;
  async function unitsAll() {
    if (!unitsCache) {
      const rows = await od.list('Catalog_КлассификаторЕдиницИзмерения', { $filter: 'DeletionMark eq false', $select: 'Ref_Key,Description', $orderby: 'Description' });
      unitsCache = Object.fromEntries(rows.map(r => [r.Ref_Key, { id: r.Ref_Key, name: r.Description }]));
    }
    return unitsCache;
  }
  async function priceKind() {
    if (priceKindRef === undefined) {
      const v = await od.list('Catalog_ВидыЦен', { $filter: `Description eq ${lit(PRICE_KIND)}`, $select: 'Ref_Key', $top: 1 });
      priceKindRef = v.length ? v[0].Ref_Key : null;
    }
    return priceKindRef;
  }
  // последняя цена вида «Розничная цена» по каждой номенклатуре
  async function pricesOf(ids) {
    const out = {};
    const kind = await priceKind();
    if (!kind || !ids.length) return out;
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40).map(id => `Номенклатура_Key eq ${guid(id)}`).join(' or ');
      for (const r of await od.list('InformationRegister_ЦеныНоменклатуры', { $filter: `ВидЦен_Key eq ${guid(kind)} and (${part})`, $select: 'Номенклатура_Key,Цена,Period' })) {
        const p = out[r.Номенклатура_Key];
        if (!p || r.Period > p.date) out[r.Номенклатура_Key] = { price: r.Цена, date: r.Period };
      }
    }
    return out;
  }
  // последний госномер по каждому автомобилю
  async function platesOf(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40).map(id => `Автомобиль_Key eq ${guid(id)}`).join(' or ');
      for (const r of await od.list('InformationRegister_асАвтомобили', { $filter: `ВидЗначения eq 'ГосНомер' and (${part})`, $select: 'Автомобиль_Key,Значение,Period' })) {
        const p = out[r.Автомобиль_Key];
        if (!p || r.Period > p.date) out[r.Автомобиль_Key] = { plate: String(r.Значение || ''), date: r.Period };
      }
    }
    return out;
  }
  async function models() {
    if (!modelsCache) modelsCache = Object.fromEntries((await od.list('Catalog_асМодели', { $select: 'Ref_Key,Description' })).map(r => [r.Ref_Key, r.Description]));
    return modelsCache;
  }
  const NOM_SELECT = 'Ref_Key,Description,НаименованиеПолное,Артикул,ЕдиницаИзмерения_Key,Комментарий,DeletionMark,ТипНоменклатуры,Code';
  async function nomItems(recs) {
    const [units, prices] = await Promise.all([unitsAll(), pricesOf(recs.map(r => r.Ref_Key))]);
    return recs.map(r => ({ id: r.Ref_Key, code: r.Code, name: r.Description, fullName: r.НаименованиеПолное || r.Description, article: r.Артикул || '',
      unit: units[r.ЕдиницаИзмерения_Key] || null, comment: r.Комментарий || '', deleted: !!r.DeletionMark, type: r.ТипНоменклатуры,
      price: prices[r.Ref_Key] ? prices[r.Ref_Key].price : null, priceDate: prices[r.Ref_Key] ? prices[r.Ref_Key].date.slice(0, 10) : null }));
  }
  const CAR_SELECT = 'Ref_Key,Code,Description,VIN,ГодВыпуска,Модель_Key,Parent_Key,Комментарий,DeletionMark,НомерШасси,НомерДвигателя';
  async function carItems(recs) {
    const [mods, plates, groups] = await Promise.all([models(), platesOf(recs.map(r => r.Ref_Key)), directory('car-groups', {})]);
    const g = Object.fromEntries(groups.map(x => [x.id, x.name]));
    return recs.map(r => ({ id: r.Ref_Key, code: r.Code, name: r.Description, vin: r.VIN || '', year: r.ГодВыпуска && !r.ГодВыпуска.startsWith('0001') ? Number(r.ГодВыпуска.slice(0, 4)) : null,
      model: r.Модель_Key !== EMPTY ? { id: r.Модель_Key, name: mods[r.Модель_Key] || '' } : null,
      group: r.Parent_Key !== EMPTY ? { id: r.Parent_Key, name: g[r.Parent_Key] || '' } : null,
      plate: plates[r.Ref_Key] ? plates[r.Ref_Key].plate : '', chassis: r.НомерШасси || '', engine: r.НомерДвигателя || '',
      comment: r.Комментарий || '', deleted: !!r.DeletionMark }));
  }

  async function catalogList(kind, q) {
    const top = Math.min(Number(q.limit) || 50, 200);
    const skip = Number(q.skip) || 0;
    const s = String(q.q || '').trim();
    const f = ['IsFolder eq false'];
    if (q.deleted !== 'true') f.push('DeletionMark eq false');
    let recs;
    if (kind === 'cars') {
      if (q.groupId) f.push(`Parent_Key eq ${guid(q.groupId)}`);
      if (s) f.push(`(${like(s)} or substringof(${lit(s)}, VIN))`);
      recs = await od.list('Catalog_асАвтомобили', { $filter: f.join(' and '), $select: CAR_SELECT, $orderby: 'Description', $top: top + 1, $skip: skip });
    } else {
      f.push(`ТипНоменклатуры eq ${lit(NOM_KIND[kind])}`);
      if (s) f.push(`(${like(s)} or substringof(${lit(s)}, Артикул))`);
      recs = await od.list('Catalog_Номенклатура', { $filter: f.join(' and '), $select: NOM_SELECT, $orderby: 'Description', $top: top + 1, $skip: skip });
    }
    const more = recs.length > top;
    const page = recs.slice(0, top);
    return { items: kind === 'cars' ? await carItems(page) : await nomItems(page), nextSkip: more ? skip + top : null, canEdit: canEdit(kind) };
  }
  async function catalogItem(kind, id) {
    const set = kind === 'cars' ? 'Catalog_асАвтомобили' : 'Catalog_Номенклатура';
    const recs = await od.list(set, { $filter: `Ref_Key eq ${guid(id)}`, $select: kind === 'cars' ? CAR_SELECT : NOM_SELECT });
    if (!recs.length) fail(404, 'not_found', 'Элемент не найден');
    const item = (kind === 'cars' ? await carItems(recs) : await nomItems(recs))[0];
    if (kind === 'services') item.modelPrices = await autoworkPrices(id);
    return item;
  }
  // цены авторабот (регистр асЦеныАвторабот, подчинён документу «Установка цен авторабот»): по моделям, последняя цена
  async function autoworkPrices(nomId) {
    const last = {};
    for (const rec of await od.list('InformationRegister_асЦеныАвторабот')) {
      for (const x of rec.RecordSet || []) {
        if (x.Номенклатура_Key !== nomId || x.Active === false) continue;
        const p = last[x.Модель_Key];
        if (!p || x.Period >= p.date) last[x.Модель_Key] = { price: x.Цена, date: x.Period };
      }
    }
    const mods = await models();
    return Object.entries(last).map(([m, p]) => ({ model: m === EMPTY ? null : { id: m, name: mods[m] || '' }, price: p.price, date: p.date.slice(0, 10) }))
      .sort((a, b) => a.price - b.price || String(a.model && a.model.name).localeCompare(String(b.model && b.model.name)));
  }
  function nomBody(b) {
    const body = {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) fail(400, 'bad_request', 'Наименование не заполнено', 'name');
      Object.assign(body, { Description: name.slice(0, 100), НаименованиеПолное: String(b.fullName || name) });
    }
    if (b.article !== undefined) body.Артикул = String(b.article || '').trim();
    if (b.unitId !== undefined) body.ЕдиницаИзмерения_Key = b.unitId || EMPTY;
    if (b.comment !== undefined) body.Комментарий = String(b.comment || '');
    return body;
  }
  function carBody(b) {
    const body = {};
    if (b.vin !== undefined) body.VIN = String(b.vin || '').trim();
    if (b.modelId !== undefined) body.Модель_Key = b.modelId || EMPTY;
    if (b.groupId !== undefined) body.Parent_Key = b.groupId || EMPTY;
    if (b.year !== undefined) body.ГодВыпуска = b.year ? `${Number(b.year)}-01-01T00:00:00` : '0001-01-01T00:00:00';
    if (b.chassis !== undefined) body.НомерШасси = String(b.chassis || '');
    if (b.engine !== undefined) body.НомерДвигателя = String(b.engine || '');
    if (b.comment !== undefined) body.Комментарий = String(b.comment || '');
    if (b.name !== undefined && String(b.name).trim()) body.Description = String(b.name).trim().slice(0, 100);
    return body;
  }
  async function catalogSave(kind, id, b) {
    requireEdit(kind);
    let ref = id;
    if (kind === 'cars') {
      const body = carBody(b);
      if (!id) {
        if (!body.VIN) fail(400, 'bad_request', 'VIN не заполнен', 'vin');
        const dup = await od.list('Catalog_асАвтомобили', { $filter: `VIN eq ${lit(body.VIN)} and IsFolder eq false and DeletionMark eq false`, $select: 'Ref_Key', $top: 1 });
        if (dup.length) fail(409, 'duplicate', `Машина с VIN ${body.VIN} уже есть`, 'vin');
        if (!body.Description) body.Description = `${b.modelId ? (await models())[b.modelId] || '' : ''} VIN ${body.VIN}`.trim().slice(0, 100);
        ref = (await od.post('Catalog_асАвтомобили', body)).Ref_Key;
      } else if (Object.keys(body).length) await od.patch(`Catalog_асАвтомобили(${guid(id)})`, body);
      if (b.plate !== undefined) await command('ДанныеАвтомобиля', { id: ref, plate: String(b.plate || '') });
    } else {
      const body = nomBody(b);
      if (!id) {
        if (!body.Description) fail(400, 'bad_request', 'Наименование не заполнено', 'name');
        // новый элемент — командой 1С: Заполнить() по типу (счета учёта, ставка НДС, метод оценки … как из формы)
        ref = (await command('СоздатьНоменклатуру', { type: NOM_KIND[kind], name: body.Description, fullName: body.НаименованиеПолное,
          article: body.Артикул || '', unitId: body.ЕдиницаИзмерения_Key && body.ЕдиницаИзмерения_Key !== EMPTY ? body.ЕдиницаИзмерения_Key : '',
          comment: body.Комментарий || '' })).id;
      } else if (Object.keys(body).length) await od.patch(`Catalog_Номенклатура(${guid(id)})`, body);
      if (b.price !== undefined && b.price !== null && b.price !== '') {
        const price = Number(String(b.price).replace(',', '.'));
        if (Number.isNaN(price) || price < 0) fail(400, 'bad_request', 'Цена — неотрицательное число', 'price');
        await command('ЦенаНоменклатуры', { id: ref, price, priceKind: PRICE_KIND });
      }
    }
    return catalogItem(kind, ref);
  }
  async function catalogDelete(kind, id, restore) {
    requireEdit(kind);
    await od.patch(`${kind === 'cars' ? 'Catalog_асАвтомобили' : 'Catalog_Номенклатура'}(${guid(id)})`, { DeletionMark: !restore });
    return catalogItem(kind, id);
  }

  // ---------------------------------------------------------------- уведомления (АРМ v2.23, блок 2)
  // Регистр Арм_Уведомления: адресат — роль АРМ, создаёт 1С при смене статуса строки (M8 приход, M11 готовность,
  // K9/M17 самовывоз). «Снабжение» и «Кладовщик» видят уведомления друг друга (D1d), администратор — все.
  // Прочитано — общее для роли: кто отметил, тот и взял в работу.
  async function notifications() {
    requireUser();
    const r = role();
    const roles = r === 'supply' || r === 'storekeeper' ? ['Снабжение', 'Кладовщик'] : [ENUM_BY_ROLE[r]];
    const f = ['Прочитано eq false'];
    if (r !== 'admin') f.push('(' + roles.map(x => `РольПолучателя eq ${lit(x)}`).join(' or ') + ')');
    const recs = await od.list(NOTICES, { $filter: f.join(' and '), $orderby: 'Дата desc', $top: 50 });
    return {
      items: recs.map(n => ({ id: n.Ид, date: n.Дата, node: n.Узел, kind: n.Вид, text: n.Текст,
        customerOrderId: n.ДокументЗаказПокупателя_Key && n.ДокументЗаказПокупателя_Key !== EMPTY ? n.ДокументЗаказПокупателя_Key : null }))
    };
  }
  async function readNotifications({ ids }) {
    requireUser();
    if (!Array.isArray(ids) || !ids.length) fail(400, 'bad_request', 'ids: идентификаторы уведомлений', 'ids');
    const d = new Date(), p = x => String(x).padStart(2, '0');
    const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    for (const id of ids) await od.patch(`${NOTICES}(Ид=${lit(id)})`, { Прочитано: true, Прочитал_Key: me() || EMPTY, ДатаПрочтения: now });
    return { read: ids.length };
  }

  // ---------------------------------------------------------------- маршрутизация
  const ok = (data, status = 200, headers = {}) => ({ status, data, headers: new Headers(headers) });
  return async function handle(method, path, { query = {}, body } = {}) {
    const seg = path.replace(/^\/+|\/+$/g, '').split('/');
    const key = `${method} /${seg[0]}`;
    if (method === 'GET' && path === '/matrix') {
      return ok(matrixFor(role()), 200, { ETag: MATRIX_ETAG });
    }
    if (seg[0] === 'lines') {
      if (method === 'GET' && seg.length === 1) return ok(await listLines(query));
      if (method === 'POST' && seg.length === 1) return ok(await addLines(body || {}), 201);
      if (method === 'POST' && seg[1] === 'transition') return ok(await transition(body || {}));
      if (method === 'GET' && seg.length === 2) return ok(await line(decodeURIComponent(seg[1])));
      if (method === 'PATCH' && seg.length === 2) return ok(await patchLine(decodeURIComponent(seg[1]), body || {}));
      if (method === 'DELETE' && seg.length === 2) return ok(await strikeLine(decodeURIComponent(seg[1])), 204);
      if (method === 'POST' && seg[2] === 'mark') return ok(await toggleMark(decodeURIComponent(seg[1])));
    }
    if (seg[0] === 'selection') {
      if (method === 'GET') return ok(await selectionTotals(query.view || 'sales'));
      if (method === 'POST') return ok(await markOrder(body || {}));
    }
    if (seg[0] === 'sales') {
      const op = `${method} /sales/${seg[1]}`;
      if (NOT_SUPPORTED[op]) fail(501, 'not_supported', NOT_SUPPORTED[op]);
      if (op === 'POST /sales/jobs') return ok(await startJob(body || {}), 202);
      if (op === 'POST /sales/prepared') return ok(await prepared());
      if (op === 'POST /sales/shipments') return ok(await shipments(body || {}));
      if (op === 'POST /sales/imports') return ok(await importSheet(body || {}), 201);
      if (seg[1] === 'customer-orders') {
        if (method === 'POST' && seg.length === 2) return ok(await createOrder(body || {}), 201);
        if (method === 'POST' && seg[3] === 'post') return ok(await postOrder(seg[2]));
        if (method === 'DELETE' && seg.length === 3) return ok(await deleteOrder(seg[2]), 204);
      }
    }
    if (method === 'POST' && path === '/supply/status') return ok(await supplyStatus(body || {}));
    if (method === 'GET' && path === '/notifications') return ok(await notifications());
    if (method === 'POST' && path === '/notifications/read') return ok(await readNotifications(body || {}));
    if (method === 'GET' && seg[0] === 'jobs' && seg.length === 2) return ok(await job(decodeURIComponent(seg[1])));
    if (method === 'GET' && seg[0] === 'documents' && seg.length === 3) return ok(await documentCard(seg[1], seg[2]));
    if (method === 'GET' && seg[0] === 'directories' && seg.length === 2) return ok(await directory(seg[1], query));
    if (seg[0] === 'catalog' && ['goods', 'services', 'cars'].includes(seg[1])) {
      const id = seg[2] ? decodeURIComponent(seg[2]) : null;
      if (method === 'GET' && !id) return ok(await catalogList(seg[1], query));
      if (method === 'GET' && id) return ok(await catalogItem(seg[1], id));
      if (method === 'POST' && !id) return ok(await catalogSave(seg[1], null, body || {}), 201);
      if (method === 'PATCH' && id) return ok(await catalogSave(seg[1], id, body || {}));
      if (method === 'DELETE' && id) return ok(await catalogDelete(seg[1], id, false));
      if (method === 'POST' && id && seg[3] === 'restore') return ok(await catalogDelete(seg[1], id, true));
    }
    if (key === 'POST /session') return ok(await login(body || {}));
    return fail(404, 'not_found', `Нет операции ${method} ${path}`);
  };
}
