# Загрузка справочников из Excel в 1С через стандартный OData + команды АРМ_OData (СоздатьНоменклатуру, ЦенаНоменклатуры,
# ДанныеАвтомобиля).
# Повторный запуск не создаёт дублей: товары ищутся по артикулу, услуги — по наименованию, машины — по VIN,
# модели — по наименованию, группы машин — по наименованию группы.
#
#   python odata/import-catalogs.py --base http://127.0.0.1:8090/odata-main/odata/standard.odata --user Автосервис
#        [--password ...] [--goods "товар для 1 с.xlsx"] [--services Услуга.xlsx] [--cars "машины для 1 с.xlsx"] [--dry-run] [--fill-arm]
#
# Товары: артикул | Наименование | ед. изм | цена        -> Номенклатура (Запас), цена «Розничная цена»
# Услуги: Наименование | ед. изм | цена | | шасси        -> Номенклатура (Услуга) «<услуга>», цены авторабот по моделям шасси
# Машины: № п/п | Наименование (вид техники) | Марка, модель | Год | VIN | Госномер
#                                                        -> асАвтомобили в группе вида техники, модель асМодели, госномер
import argparse, base64, json, re, sys, time, uuid, urllib.request, urllib.parse
from pathlib import Path

import openpyxl

EMPTY = '00000000-0000-0000-0000-000000000000'
ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--user', required=True)
ap.add_argument('--password', default='')
root = Path(__file__).resolve().parent.parent
ap.add_argument('--goods', default=str(root / 'товар для 1 с.xlsx'))
ap.add_argument('--services', default=str(root / 'Услуга.xlsx'))
ap.add_argument('--cars', default=str(root / 'машины для 1 с.xlsx'))
ap.add_argument('--price-kind', default='Розничная цена')
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--fill-arm', action='store_true', help='после справочников: строки АРМ по заказам покупателей за последний год (команда ЗаполнитьАРМ)')
a = ap.parse_args()
B = a.base.rstrip('/') + '/'
AUTH = 'Basic ' + base64.b64encode(f'{a.user}:{a.password}'.encode()).decode()


def req(method, path, body=None, **q):
    url = B + urllib.parse.quote(path, safe="()'=,/$") + '?' + urllib.parse.urlencode({'$format': 'json', **q}, quote_via=urllib.parse.quote)
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    for attempt in range(3):   # файловая/серверная 1С иногда отвечает 500 из «испорченного» сеанса пула — чтение повторяем
        r = urllib.request.Request(url, data=data, method=method, headers={'Authorization': AUTH, 'Content-Type': 'application/json'})
        try:
            t = urllib.request.urlopen(r, timeout=900).read().decode()
            return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            if e.code == 500 and method == 'GET' and attempt < 2:
                time.sleep(1); continue
            raise RuntimeError(f'{method} {path}: HTTP {e.code} {text[:400]}')


def lit(s): return "'" + str(s).replace("'", "''") + "'"
def find(set_, flt, sel='Ref_Key'): return req('GET', set_, **{'$filter': flt, '$select': sel, '$top': '2'})['value']


def command(name, params):
    try:
        rec = req('POST', 'InformationRegister_АрмOData_КомандыPWA', {'Ид': 'cmd-' + uuid.uuid4().hex, 'Команда': name, 'Параметры': json.dumps(params, ensure_ascii=False)})
        return json.loads(rec['Результат'] or '{}')
    except RuntimeError as e:
        msg = str(e)
        i = msg.find('АРМODATA{')
        raise RuntimeError(json.loads(msg[i + 8:msg.index('}', i) + 1])['message'] if i >= 0 else msg)


def rows(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    return [r for r in list(ws.iter_rows(values_only=True))[1:] if any(v not in (None, '') for v in r)]


stat = {}
def count(k): stat[k] = stat.get(k, 0) + 1

# ---------------------------------------------------------------- единицы и шаблоны
UNITS = {u['Description'].split(' ')[0].rstrip('.'): u['Ref_Key'] for u in req('GET', 'Catalog_КлассификаторЕдиницИзмерения', **{'$select': 'Ref_Key,Description', '$filter': 'DeletionMark eq false'})['value']}
NEW_UNITS = {'компл': ('839', 'Комплект'), 'шт': ('796', 'Штука'), 'л': ('112', 'Литр'), 'н/ч': ('', 'Нормо-час')}


def unit(name):
    key = str(name or 'шт').strip().rstrip('.').lower()
    if key not in UNITS:
        code, full = NEW_UNITS.get(key, ('', key))
        if a.dry_run:
            UNITS[key] = EMPTY
        else:
            UNITS[key] = req('POST', 'Catalog_КлассификаторЕдиницИзмерения', {'Description': key, 'Code': code, 'НаименованиеПолное': full})['Ref_Key']
        count('единиц создано')
    return UNITS[key]


def upsert_nom(flt, body, kind, price):
    found = find('Catalog_Номенклатура', flt + ' and IsFolder eq false and DeletionMark eq false')
    if found:
        ref = found[0]['Ref_Key']
        if not a.dry_run:
            req('PATCH', f"Catalog_Номенклатура(guid'{ref}')", body)
        count(f'{kind}: обновлено')
    elif a.dry_run:
        ref = EMPTY
        count(f'{kind}: создано')
    else:
        # новый элемент — командой 1С: Заполнить() по типу (счета учёта, ставка НДС … как из формы), затем реквизиты
        ref = command('СоздатьНоменклатуру', {'type': kind, 'name': body['Description'], 'fullName': body['НаименованиеПолное'],
                                              'article': body.get('Артикул', ''), 'unitId': body['ЕдиницаИзмерения_Key'], 'comment': body.get('Комментарий', '')})['id']
        count(f'{kind}: создано')
    if price not in (None, '') and not a.dry_run:
        command('ЦенаНоменклатуры', {'id': ref, 'price': float(price), 'priceKind': a.price_kind})
        count('цен записано')
    return ref


# ---------------------------------------------------------------- товары
for art, name, uname, price in [r[:4] for r in rows(a.goods)]:
    art = str(art).strip()
    name = str(name).strip()
    upsert_nom(f'Артикул eq {lit(art)}', {'Description': name[:100], 'НаименованиеПолное': name, 'Артикул': art,
                                          'ЕдиницаИзмерения_Key': unit(uname)}, 'Запас', price)

# ---------------------------------------------------------------- машины
models, groups = {}, {}


def ref_by_name(set_, name, cache, body):
    if name not in cache:
        f = find(set_, f'Description eq {lit(name)} and DeletionMark eq false' + (' and IsFolder eq true' if body.get('IsFolder') else ''))
        if f:
            cache[name] = f[0]['Ref_Key']
        else:
            cache[name] = EMPTY if a.dry_run else req('POST', set_, {'Description': name, **body})['Ref_Key']
            count(f'{set_}: создано')
    return cache[name]


for r in rows(a.cars):
    no, kind, model, year, vin, plate = (list(r) + [None] * 6)[:6]
    if not vin:
        count('машин пропущено (нет VIN)')
        continue
    vin, model, kind = str(vin).strip(), str(model or '').strip(), str(kind or '').strip()
    model_ref = ref_by_name('Catalog_асМодели', model[:100], models, {'НаименованиеПолное': model}) if model else EMPTY
    group_ref = ref_by_name('Catalog_асАвтомобили', kind[:100], groups, {'IsFolder': True}) if kind else EMPTY
    body = {'Description': f'{model} VIN {vin}'[:100], 'VIN': vin, 'Модель_Key': model_ref, 'Parent_Key': group_ref,
            'ГодВыпуска': f'{int(year)}-01-01T00:00:00' if year else '0001-01-01T00:00:00', 'Комментарий': f'№ п/п {no}' if no else ''}
    found = find('Catalog_асАвтомобили', f'VIN eq {lit(vin)} and IsFolder eq false and DeletionMark eq false')
    if found:
        ref = found[0]['Ref_Key']
        if not a.dry_run:
            req('PATCH', f"Catalog_асАвтомобили(guid'{ref}')", body)
        count('машин обновлено')
    else:
        ref = EMPTY if a.dry_run else req('POST', 'Catalog_асАвтомобили', body)['Ref_Key']
        count('машин создано')
    if plate and not a.dry_run:
        command('ДанныеАвтомобиля', {'id': ref, 'plate': str(plate).strip()})
        count('госномеров записано')

# ---------------------------------------------------------------- услуги (после машин: нужны модели)
# Как услуга «ТО» в базе: одна позиция на вид работ («ТО», «Замена сцепления» …), тип Услуга, единица н/ч.
# Цена по шасси — штатный механизм «Автосервиса»: документ «Установка цен авторабот» (команда ЦеныАвторабот) на все
# модели этого шасси; базовая розничная цена — минимальная из цен по шасси (для моделей без своей цены).
CHASSIS_MODELS = {   # шасси из файла -> условие на наименование модели
    'ЭД244КМ': lambda m: bool(re.search(r'ЭД[\s-]?244', m)),
    'КАМАЗ': lambda m: 'КАМАЗ' in m and not re.search(r'ЭД[\s-]?244', m),
    'УНИМОГ': lambda m: 'UNIMOG' in m or 'УНИМОГ' in m,
    'БЕЛАРУС': lambda m: 'БЕЛАРУС' in m,
}
services = {}
for r in rows(a.services):
    name, uname, price, chassis = str(r[0]).strip(), r[1], r[2], str(r[4] or '').replace('Шасси:', '').strip().upper()
    s = services.setdefault(name, {'unit': uname, 'prices': {}})
    s['prices'][chassis] = float(price)

all_models = req('GET', 'Catalog_асМодели', **{'$filter': 'IsFolder eq false and DeletionMark eq false', '$select': 'Ref_Key,Description'})['value']
# действующие цены авторабот: (номенклатура, модель) -> цена последней записи
current = {}
for rec in req('GET', 'InformationRegister_асЦеныАвторабот')['value']:
    for x in rec.get('RecordSet', []):
        k = (x['Номенклатура_Key'], x['Модель_Key'])
        if x.get('Active', True) and (k not in current or x['Period'] >= current[k][1]):
            current[k] = (x['Цена'], x['Period'])
price_rows, unmatched = [], set()
for name, s in services.items():
    # прежняя загрузка заводила «<услуга> — <ШАССИ>»: первую такую переименовываем в «<услуга>», остальные — на удаление
    plain = find('Catalog_Номенклатура', f'Description eq {lit(name)} and IsFolder eq false and DeletionMark eq false and ТипНоменклатуры eq ' + "'Услуга'")
    for ch in s['prices']:
        old = find('Catalog_Номенклатура', f"Description eq {lit(f'{name} — {ch}')} and IsFolder eq false and DeletionMark eq false")
        if not old:
            continue
        if not plain:
            if not a.dry_run:
                req('PATCH', f"Catalog_Номенклатура(guid'{old[0]['Ref_Key']}')", {'Description': name, 'НаименованиеПолное': name, 'Комментарий': ''})
            plain = old
            count('услуг «… — ШАССИ» переименовано')
        else:
            if not a.dry_run:
                req('PATCH', f"Catalog_Номенклатура(guid'{old[0]['Ref_Key']}')", {'DeletionMark': True})
            count('услуг «… — ШАССИ» помечено на удаление')
    ref = upsert_nom(f"Description eq {lit(name)} and ТипНоменклатуры eq 'Услуга'", {'Description': name[:100], 'НаименованиеПолное': name,
                     'ЕдиницаИзмерения_Key': unit(s['unit']), 'Комментарий': ''}, 'Услуга', min(s['prices'].values()))
    for ch, price in s['prices'].items():
        rule = CHASSIS_MODELS.get(ch)
        models_ch = [m for m in all_models if rule and rule(m['Description'])]
        if not models_ch:
            unmatched.add(ch)
        for m in models_ch:
            if current.get((ref, m['Ref_Key']), (None,))[0] != price:
                price_rows.append({'id': ref, 'modelId': m['Ref_Key'], 'price': price})
if price_rows and not a.dry_run:
    doc = command('ЦеныАвторабот', {'rows': price_rows, 'priceKind': a.price_kind, 'comment': 'Загрузка «Услуга.xlsx»: цены по шасси'})
    stat['документ цен авторабот'] = doc['number']
stat['цен авторабот (услуга × модель)'] = len(price_rows)
if unmatched:
    stat['шасси без моделей'] = sorted(unmatched)

# ---------------------------------------------------------------- строки АРМ по заказам за последний год
if a.fill_arm and not a.dry_run:
    stat['АРМ: заполнено'] = command('ЗаполнитьАРМ', {})

print(json.dumps(stat, ensure_ascii=False, indent=1))
