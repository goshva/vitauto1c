// Сверка данных АРМ ↔ документы ↔ остатки по номенклатуре E2E (алгоритмы tasks/checks-algorithms.md, DATA-* и BUG-*).
// Только чтение.   node check-data.mjs <url standard.odata> <пользователь> [пароль] [отчёт.md] [с даты YYYY-MM-DD]
const [base, user, pwd = '', report = '', since = '2026-10-18'] = process.argv.slice(2);
if (!base || !user) { console.error('node check-data.mjs <url standard.odata> <пользователь> [пароль] [отчёт.md] [с даты]'); process.exit(2); }
import { writeFileSync } from 'node:fs';
const B = base.replace(/\/?$/, '/');
const auth = 'Basic ' + Buffer.from(`${user}:${pwd}`, 'utf8').toString('base64');
const Z = '00000000-0000-0000-0000-000000000000';
async function od(path) {
  const r = await fetch(B + encodeURI(path), { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${path} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const res = { ok: [], fail: [], warn: [] };
const rule = (code, ok, text, warnOnly = false) => (ok ? res.ok : warnOnly ? res.warn : res.fail).push(`${code}: ${text}`);
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) <= 0.011;
const r2 = x => Math.round(x * 100) / 100;
const nk = z => z.Номенклатура_Key || z.Номенклатура;   // в ЗаказПокупателя.Запасы номенклатура составного типа: поле без _Key

const noms = Object.fromEntries((await od(`Catalog_Номенклатура?$format=json&$filter=startswith(Description,'E2E') and DeletionMark eq false&$select=Ref_Key,Description,ВидСтавкиНДС`)).value.map(n => [n.Ref_Key, n]));
const rates = Object.fromEntries((await od(`Catalog_СтавкиНДС?$format=json&$select=Ref_Key,Description,Ставка`)).value.map(r => [r.Ref_Key, r]));
const expectRate = vid => vid === 'БезНДС' ? 'Без НДС' : vid === 'Пониженная' ? 10 : 22;
const docsByKey = {};
// v2.22: заказ покупателя, ещё не отданный в работу (нет заказа поставщику и отгрузки), не проводится —
// с 2.22 в него пишется подобранная номенклатура (смена номенклатуры, вычёркивание), ставка и суммы — при «Заказать»
const armAll = (await od(`InformationRegister_Арм_ДанныеЗакупокИПродаж?$format=json&$select=ДокументЗаказПокупателя_Key,СтатусСтроки,Удаление`)).value;
// заказ проводится при «Заказать» (закупка) или «Провести заказ» (отгрузка); до этого строки со склада проходят
// резерв → комплектация → «Собран»/«Подготовлено» при непроведённом заказе
const POSTED_STAGE = ['Заказано', 'ЧастичноЗаказано', 'Оплачено', 'ТоварВПути', 'Приходуется', 'НаСкладе', 'Отгружено', 'Выполнено', 'Завершено'];
const inWork = new Set(armAll.filter(l => !l.Удаление && POSTED_STAGE.includes(l.СтатусСтроки)).map(l => l.ДокументЗаказПокупателя_Key));
for (const type of ['ЗаказПокупателя', 'ЗаказПоставщику', 'ПриходнаяНакладная', 'РасходнаяНакладная']) {
  const list = (await od(`Document_${type}?$format=json&$filter=Date ge datetime'${since}T00:00:00' and DeletionMark eq false`)).value;
  for (const d of list) {
    docsByKey[d.Ref_Key] = { type, d };
    const e2eRows = (d.Запасы || []).filter(z => noms[nk(z)]);
    if (!e2eRows.length || /E2E seed/.test(d.Комментарий || '')) continue;
    const name = `${type} ${d.Number}`;
    if (type === 'ЗаказПокупателя' && !d.Posted && !inWork.has(d.Ref_Key)) { rule('DATA-4', true, `${name}: черновик (строки АРМ не в работе) — не проверяется`); continue; }
    rule('DATA-4', d.Posted, `${name} проведён=${d.Posted}`);
    for (const z of e2eRows) {
      const n = noms[nk(z)], rt = rates[z.СтавкаНДС_Key] || {}, want = expectRate(n.ВидСтавкиНДС);
      const row = `${name} · ${n.Description}`;
      rule('DATA-1', near(z.Сумма, r2(z.Количество * z.Цена)), `${row}: ${z.Количество}×${z.Цена}=${z.Сумма}`);
      const rateOk = want === 'Без НДС' ? /Без НДС/.test(rt.Description || '') : (+rt.Ставка === want && !/\//.test(rt.Description || ''));
      rule('DATA-2', rateOk, `${row}: ставка «${rt.Description}», ожидается ${want}${want === 'Без НДС' ? '' : '%'}`);
      const p = +rt.Ставка || 0, vat = d.СуммаВключаетНДС ? r2(z.Сумма * p / (100 + p)) : r2(z.Сумма * p / 100);
      rule('DATA-3', near(z.СуммаНДС, vat), `${row}: НДС ${z.СуммаНДС}, расчёт ${vat}`);
    }
  }
}

// Регистр АРМ
const arm = (await od(`InformationRegister_Арм_ДанныеЗакупокИПродаж?$format=json`)).value.filter(l => !l.Удаление);
const after = ['Заказано', 'Оплачено', 'ТоварВПути', 'Приходуется', 'НаСкладе', 'Комплектуется', 'Собран'];
const stock = {};
for (const k of Object.keys(noms)) {
  const b = (await od(`AccumulationRegister_ЗапасыНаСкладах/Balance(Condition='Номенклатура_Key eq guid''${k}''')?$format=json`)).value;
  stock[k] = b.reduce((s, x) => s + (+x.КоличествоBalance || 0), 0);
  rule('DATA-7', stock[k] >= 0, `остаток ${noms[k].Description} = ${stock[k]}`);
}
const orderNum = {};
async function orderNumber(k) {
  if (!k || k === Z) return '';
  if (orderNum[k] === undefined) { try { orderNum[k] = (await od(`Document_ЗаказПокупателя(guid'${k}')?$format=json&$select=Number,Date,Posted`)); } catch { orderNum[k] = {}; } }
  return orderNum[k];
}
for (const l of arm) {
  rule('DATA-8', l.СтатусСтроки !== 'ЗаблокированоФоном', `строка ${l.ИдентификаторЗаписи} статус ${l.СтатусСтроки}`);
  const doc = await orderNumber(l.ДокументЗаказПокупателя_Key);
  if (doc && doc.Number) rule('BUG-1', (l.НомерЗаказа || '').trim() === doc.Number.trim(), `номер в АРМ «${l.НомерЗаказа}», в документе «${doc.Number}»`, true);
  if (l.ОтметкаСтроки) {
    const old = doc && doc.Date && (Date.now() - Date.parse(doc.Date)) > 30 * 864e5;
    rule('BUG-2', !old, `отмеченная строка заказа ${doc && doc.Number} от ${doc && doc.Date} (скрыта фильтром периода)`, true);
  }
  if (!noms[l.Номенклатура_Key]) continue;
  const n = noms[l.Номенклатура_Key].Description, id = `${l.ВидОперации} ${n} [${l.СтатусСтроки}]`;
  if (l.ВидОперации === 'Продажа' && l.Количество > 0) {
    // v2.22 (BUG-5): сумма себестоимости строки = Окр(кол-во × округлённая себестоимость единицы) — строго
    if (+l.СебестоимостьЕдиницы) rule('DATA-5', near(l.Себестоимость, r2(l.Количество * l.СебестоимостьЕдиницы)), `${id}: себестоимость ${l.Себестоимость} = ${l.Количество}×${l.СебестоимостьЕдиницы}`);
    if (+l.Коэффициент && +l.СебестоимостьЕдиницы) {
      const okPrice = near(l.Цена, r2(l.СебестоимостьЕдиницы * l.Коэффициент));
      // цена фиксируется при подборе; пересчёт остатков (FIFO) потом перезаписывает себестоимость единицы средней по остатку
      // (при пустой партии — средней по всем приходам, см. BUG-3), цену не трогает
      // v2.22: не ошибка — цена продажи фиксируется при подборе, себестоимость склада уточняется пересчётом ФИФО
      if (!okPrice) rule('INFO-5', false, `${id}: цена ${l.Цена} (подбор), себестоимость перезаписана на ${l.СебестоимостьЕдиницы} → ×${l.Коэффициент} = ${r2(l.СебестоимостьЕдиницы * l.Коэффициент)}`, true);
      else rule('DATA-5', true, `${id}: цена ${l.Цена} = ${l.СебестоимостьЕдиницы}×${l.Коэффициент}`);
    }
    // v2.22: закрытые продажи в распределении склада не участвуют (BUG-7) — их ОстатокДляСтроки не обновляется, не проверяем
    if (!['Отгружено', 'Выполнено', 'Завершено'].includes(l.СтатусСтроки))
      rule('BUG-3', !(+l.ОстатокДляСтроки > stock[l.Номенклатура_Key]), `${id}: ОстатокДляСтроки ${l.ОстатокДляСтроки} при остатке ${stock[l.Номенклатура_Key]}`, true);
  }
  if (l.ВидОперации === 'Закупка' && after.includes(l.СтатусСтроки)) rule('DATA-6', l.ДокументЗаказПоставщика_Key !== Z, `${id}: заказ поставщику ${l.ДокументЗаказПоставщика_Key !== Z ? 'есть' : 'НЕТ'}`);
  if (l.ВидОперации === 'Продажа' && l.СтатусСтроки === 'Отгружено') {
    const rn = l.РасходнаяНакладная_Key && l.РасходнаяНакладная_Key !== Z ? docsByKey[l.РасходнаяНакладная_Key] : null;
    rule('DATA-6', !!(rn && rn.d.Posted), `${id}: расходная ${rn ? rn.d.Number + ' проведена=' + rn.d.Posted : 'НЕТ'}`);
  }
}
for (const [k, d] of Object.entries(orderNum)) {
  if (!d.Number || d.Posted) continue;
  const bad = arm.some(l => l.ДокументЗаказПокупателя_Key === k && l.ВидОперации === 'Продажа' && (!l.Номенклатура_Key || l.Номенклатура_Key === Z));
  // v2.22: BUG-4 исправлен — такой заказ при сплите записывается без проведения; оставляем как наблюдение
  if (bad) rule('INFO-4', false, `заказ ${d.Number} не проведён, в нём строки АРМ без номенклатуры (ждёт подбора)`, true);
}
const uniq = a => [...new Set(a)];
const md = [`# Сверка данных АРМ — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '', `${base}, документы с ${since}, номенклатура E2E: ${Object.keys(noms).length}.`, '',
  `**Итог:** проверок OK ${res.ok.length}, ошибок ${res.fail.length}, предупреждений (известные ошибки) ${uniq(res.warn).length}.`, '',
  '## Ошибки', '', ...(res.fail.length ? uniq(res.fail).map(x => '- ' + x) : ['нет']), '',
  '## Известные ошибки и наблюдения (BUG-*, INFO-*)', '', ...(res.warn.length ? uniq(res.warn).map(x => '- ' + x) : ['нет']), '',
  '## Пройдено', '', ...Object.entries(res.ok.reduce((a, x) => { const c = x.split(':')[0]; a[c] = (a[c] || 0) + 1; return a; }, {})).map(([c, n]) => `- ${c}: ${n}`)];
if (report) writeFileSync(report, md.join('\n'));
console.log(md.join('\n'));
process.exit(res.fail.length ? 1 : 0);
