// Номенклатура seed E2E через OData (команда АРМ_OData «СоздатьНоменклатуру» + PATCH вида ставки НДС).
// Нужна, где запись справочника через COM не проходит: «Автосервис» 3.0.11 падает в ПередЗаписью
// («Попытка передачи с клиента на сервер мутабельного значения» во внешнем соединении).
//   node seed-nomenclature-odata.mjs <url standard.odata> <пользователь> [пароль]
const [base, user, pwd = ''] = process.argv.slice(2);
if (!base || !user) { console.error('node seed-nomenclature-odata.mjs <url standard.odata> <пользователь> [пароль]'); process.exit(2); }
const B = base.replace(/\/?$/, '/');
const auth = 'Basic ' + Buffer.from(`${user}:${pwd}`, 'utf8').toString('base64');
const NOMS = [['E2E Колодки тормозные (НДС общая)', 'Общая', 'E2E-1'],
              ['E2E Фильтр масляный (без НДС)', 'БезНДС', 'E2E-2'],
              ['E2E Книга по ТО (НДС 10%)', 'Пониженная', 'E2E-3'],
              ['E2E Диск тормозной (под закупку, НДС общая)', 'Общая', 'E2E-4']];   // без остатка: закупку АРМ создаёт сам
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
async function od(method, path, body) {
  const r = await fetch(B + path, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}
const q = (ent, filter, select) => od('GET', `${encodeURIComponent(ent)}?$format=json&$filter=${encodeURIComponent(filter)}${select ? '&$select=' + select : ''}`).then(j => j.value);
const unit = (await q('Catalog_КлассификаторЕдиницИзмерения', "Description eq 'шт' and DeletionMark eq false", 'Ref_Key'))[0];
let errors = 0;
for (const [name, vat, article] of NOMS) {
  try {
    let rec = (await q('Catalog_Номенклатура', `Description eq ${lit(name)} and DeletionMark eq false`, 'Ref_Key,ВидСтавкиНДС'))[0];
    let made = false;
    if (!rec) {
      const id = 'cmd-' + crypto.randomUUID().replace(/-/g, '');
      const params = { type: 'Запас', name, fullName: name, article, unitId: unit ? unit.Ref_Key : '', comment: 'E2E seed' };
      const r = await od('POST', encodeURIComponent('InformationRegister_АрмOData_КомандыPWA') + '?$format=json', { Ид: id, Команда: 'СоздатьНоменклатуру', Параметры: JSON.stringify(params) });
      const res = JSON.parse(r.Результат || '{}');
      rec = { Ref_Key: res.id, ВидСтавкиНДС: 'Общая' };
      made = true;
    }
    if (rec.ВидСтавкиНДС !== vat) {
      await od('PATCH', `${encodeURIComponent('Catalog_Номенклатура')}(guid'${rec.Ref_Key}')?$format=json`, { ВидСтавкиНДС: vat });
    }
    console.log(`OK    номенклатура ${name}: ${made ? 'создана' : 'есть'}, ВидСтавкиНДС=${vat}, id ${rec.Ref_Key}`);
  } catch (e) { errors++; console.log(`ERROR номенклатура ${name}: ${e.message}`); }
}
process.exit(errors ? 1 : 0);
