"""Собирает default-matrix.js (умолчания матрицы для всех пользователей) из экспорта JSON.

Использование:
    python tools/make_default_matrix.py "column-matrix (2).json"

Экспорт делается кнопкой «Экспорт JSON» в index.html или из опросника.
Каждая ячейка кодируется одним числом:
    биты 0..5  — роли-редакторы (порядок ROLES), editable='role'
    бит 6 (64) — required
    128        — editable='creator'
    256        — editable='admin'
    0 ролей и нет 128/256 — editable='none'
"""
import io
import json
import os
import sys

ROLES = ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client']
LEVELS = ['order', 'line']

# Новые колонки, которых нет в экспорте: id -> (вставить после, скопировать права с, тип)
NEW_COLUMNS = {
    'aggregate_fact': ('model_fact', 'gosnomer_fact', 'select'),
}

# Поля с правилом «обязательно одно из» (fieldRules.oneOfRequired в index.html):
# обязательность задаёт правило группы, поэтому флаг required у отдельных полей снимается.
ONE_OF_REQUIRED = ['gosnomer_fact', 'aggregate_fact', 'name', 'article', 'code_aa']


def encode(cell):
    ed = cell.get('editable', 'none')
    code = 64 if cell.get('required') else 0
    if ed == 'role':
        roles = cell.get('editableRoles') or ([cell['editableRole']] if cell.get('editableRole') else [])
        for i, r in enumerate(ROLES):
            if r in roles:
                code |= 1 << i
    elif ed == 'all':
        code |= 63
    elif ed == 'creator':
        code |= 128
    elif ed == 'admin':
        code |= 256
    return code


def main(src):
    data = json.load(io.open(src, encoding='utf-8'))
    statuses = [s['id'] for s in data['statuses']]
    columns = [c['id'] for c in data['columns']]
    types = dict(data.get('columnTypes') or {})
    copy_from = {}
    for cid, (after, like, typ) in NEW_COLUMNS.items():
        if cid in columns:
            continue
        columns.insert(columns.index(after) + 1, cid)
        copy_from[cid] = like
        types.setdefault(cid, typ)

    cells = {}
    for lvl in LEVELS:
        cells[lvl] = {}
        for r in ROLES:
            cells[lvl][r] = {}
            for s in statuses:
                src_cells = data['matrix'][lvl][r][s]
                row = []
                for c in columns:
                    code = encode(src_cells.get(copy_from.get(c, c)) or {'editable': 'none'})
                    if c in ONE_OF_REQUIRED:
                        code &= ~64
                    row.append(code)
                cells[lvl][r][s] = row

    out = {
        'id': data.get('updatedAt') or '',
        'source': os.path.basename(src),
        'roles': ROLES,
        'statuses': statuses,
        'columns': columns,
        'columnTypes': types,
        'cells': cells,
    }
    js = ('// Сгенерировано tools/make_default_matrix.py из «%s». Не редактировать вручную.\n'
          'window.VITAUTO_DEFAULT_MATRIX = %s;\n') % (
        os.path.basename(src), json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'default-matrix.js')
    io.open(dst, 'w', encoding='utf-8', newline='\n').write(js)
    print('default-matrix.js: %d bytes, %d columns' % (len(js.encode('utf-8')), len(columns)))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'column-matrix (2).json')
