# -*- coding: utf-8 -*-
"""Матрица прав для PWA в режиме OData: pwa/src/odata/matrix.json.

В REST API АРМ (Арм_API, v2.9) матрицу отдавал сервер (GET /matrix). Через OData её не получить — это код модуля
Арм_МатрицаПрав, а не данные. Поэтому PWA берёт тот же источник, из которого собирается модуль 1С:
tools/generate_arm_matrix_rights.py (default-matrix.js, вкладка manager, уровень order; админ — D1e′ все поля
регистра в любом статусе), коды колонок — column-codes.js, заголовки — index.html.

    python tools/gen_pwa_matrix.py

Формат как у GET /matrix: на роль — statuses (15) и columns [{id, field, code, title, dataType, writable, rights}],
rights — символ на статус: «+» можно, «.» нельзя.
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import generate_arm_matrix_rights as G  # noqa: E402

OUT = os.path.join(ROOT, 'pwa', 'src', 'odata', 'matrix.json')

# поля, которые PATCH из PWA не пишет: вычисляемые, реквизиты номенклатуры, отметка (своя команда), статус (переходы)
NOT_WRITABLE = {'ОтметкаСтроки', 'Порядок', 'СтатусСтроки', 'Себестоимость', 'Сумма', 'ОстатокДляСтроки',
                'КоличествоВРезерве', 'КоличествоВПути', 'НоменклатураАртикул', 'НоменклатураАС_КодАвтоАльянс',
                'НоменклатураЕдиницаИзмерения',
                # измерение (часть ключа записи) регистра АРМ: через OData PATCH ключ не меняется («Запись не верна»)
                'НомерЗаказаКлиента'}
# роли PWA -> роль матрицы. «Снабжение» в PWA не используется (решение 19.10.2026)
PWA_ROLES = {'manager': 'manager', 'storekeeper': 'storekeeper', 'chief_mechanic': 'chief_mechanic', 'admin': 'admin',
             'supplier': 'supplier', 'client': 'client'}


def read(p):
    return io.open(p, encoding='utf-8-sig').read()


def main():
    model = G.build_model()
    matrix = G.load_matrix()
    columns = matrix['columns']
    types = matrix.get('columnTypes', {})
    field_by_id = dict(G.FIELD_MAP)
    titles = dict(re.findall(r"\{id:'([a-z0-9_]+)', title:'([^']*)'", read(os.path.join(ROOT, 'index.html'))))
    codes = {}
    # группы VITAUTO_COLUMN_GROUPS: код = буква группы + номер с 1 (или со start)
    for m in re.finditer(r"\{code:'[^']*', letter:'([^']*)'([^\[]*)columns:\[([^\]]*)\]", read(os.path.join(ROOT, 'column-codes.js'))):
        start = re.search(r'start:(\d+)', m.group(2))
        for i, cid in enumerate(re.findall(r"'([a-z0-9_]+)'", m.group(3))):
            codes[cid] = '%s%d' % (m.group(1), (int(start.group(1)) if start else 1) + i)
    statuses = [s for s, _ in G.STATUS_MAP]
    admin_fields = set(G.admin_fields())
    out = {'source': 'tools/gen_pwa_matrix.py <- ' + matrix.get('source', ''), 'statuses': statuses,
           'statusEnum': {s: enums for s, enums in G.STATUS_MAP}, 'roles': {}}
    for pwa_role, mrole in PWA_ROLES.items():
        bit = G.ROLE_BITS[mrole]
        cols = []
        for cid in columns:
            field = field_by_id.get(cid)
            if not field:
                continue
            if mrole == 'admin':
                rights = ''.join('+' if field in admin_fields else '.' for _ in statuses)
            else:
                rights = ''.join('+' if model['masks'][s].get(cid, 0) & bit else '.' for s in statuses)
            cols.append({'id': cid, 'field': field, 'code': codes.get(cid, ''), 'title': titles.get(cid, cid),
                         'dataType': {'decimal': 'number', 'checkbox': 'checkbox', 'date': 'date', 'select': 'select'}.get(types.get(cid, 'text'), types.get(cid, 'text')),
                         'writable': field not in NOT_WRITABLE, 'rights': rights})
        out['roles'][pwa_role] = cols
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print('%s: ролей %d, колонок %d, статусов %d' % (OUT, len(out['roles']), len(out['roles']['manager']), len(statuses)))


if __name__ == '__main__':
    main()
