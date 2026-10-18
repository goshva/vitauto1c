// v2.22 (BUG-1): НомерЗаказа в регистре АРМ был Строка(10) — номер заказа покупателя (11 символов) обрезался.
// После обновления расширения до 2.22 (длина 20) — перезаполнить номер из документа. Через OData, без 1С-кода.
//   node fix-order-numbers.mjs <url standard.odata> <пользователь> [пароль] [--apply]
// Без --apply — только отчёт (сколько записей и примеры). Перед --apply — резервная копия базы.
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [base, user, pwd = ''] = args.filter(a => a !== '--apply');
if (!base || !user) { console.error('node fix-order-numbers.mjs <url standard.odata> <пользователь> [пароль] [--apply]'); process.exit(2); }
const B = base.replace(/\/?$/, '/');
const auth = 'Basic ' + Buffer.from(`${user}:${pwd}`, 'utf8').toString('base64');
const Z = '00000000-0000-0000-0000-000000000000';
const ARM = 'InformationRegister_Арм_ДанныеЗакупокИПродаж';
const KEYS = ['ДокументЗаказПокупателя_Key', 'ДокументЗаказПоставщика_Key', 'ДокументПриходнаяНакладная_Key',
  'КлючСвязиСтрок', 'ВидОперации', 'ИдентификаторЗаписи', 'РучнаяПравка', 'НомерЗаказаКлиента'];
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const keyPath = r => ARM + '(' + KEYS.map(k => k.endsWith('_Key') ? `${k}=guid'${r[k]}'` : typeof r[k] === 'boolean' ? `${k}=${r[k]}` : `${k}=${lit(r[k])}`).join(',') + ')';

async function od(method, path, body) {
  const r = await fetch(B + encodeURI(path) + (path.includes('?') ? '&' : '?') + '$format=json', {
    method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${r.status} ${method} ${path} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

const recs = (await od('GET', `${ARM}?$select=${KEYS.join(',')},НомерЗаказа`)).value;
const numbers = {};
const todo = [];
for (const r of recs) {
  const k = r.ДокументЗаказПокупателя_Key;
  if (!k || k === Z) continue;
  if (numbers[k] === undefined) {
    try { numbers[k] = (await od('GET', `Document_ЗаказПокупателя(guid'${k}')?$select=Number`)).Number.trim(); } catch { numbers[k] = null; }
  }
  if (numbers[k] && (r.НомерЗаказа || '').trim() !== numbers[k]) todo.push([r, numbers[k]]);
}
console.log(`записей АРМ: ${recs.length}, номер заказа расходится: ${todo.length}`);
for (const [r, n] of todo.slice(0, 5)) console.log(`  «${r.НомерЗаказа}» -> «${n}»  (${r.ВидОперации} ${r.ИдентификаторЗаписи})`);
if (!apply) { console.log('без --apply ничего не изменено'); process.exit(0); }
let done = 0;
for (const [r, n] of todo) { await od('PATCH', keyPath(r), { НомерЗаказа: n }); done++; }
console.log(`исправлено: ${done}`);
