import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ROLES as ROLE_SPECS } from '../../src/domain/roles.ts';
import { isAllowed } from '../../src/domain/access.ts';
import { isHidden } from '../../src/domain/columns.ts';

// СВЕРКА ПРАВ С ЭТАЛОНОМ `index.html`.
//
// Эталон — файл прототипа настройки прав «Роль × Статус × Колонка», лежащий в корне
// репозитория. В нём `ROLE_PROFILES`: на каждую роль по каждой ГРУППЕ КОЛОНОК пара
// «видно / правится». Это и есть исходные требования заказчика по ограничениям.
//
// ЗАЧЕМ ТАКАЯ СВЕРКА. Права в прототипе задавались дважды и в разных видах: в эталоне —
// группы колонок, в коде — действия и закрытые колонки. Разойдись они, никто бы не заметил:
// и там и там «выглядит разумно». Здесь эталон ЧИТАЕТСЯ, а расхождения НАЗЫВАЮТСЯ.
//
// РАСХОЖДЕНИЯ НЕ СКРЫВАЮТСЯ. Часть их — решения (закрыть кладовщику и цену продажи), часть
// — открытые вопросы. Тест перечисляет и то и другое, чтобы список был на виду.

interface Grant { visible: boolean; editable: string }
type Profiles = Map<string, Map<string, Grant>>;

/** Роли из эталона: `var ROLES = [{id:'manager', title:'Менеджер'}, …]`. */
function referenceRoles(): { id: string; title: string }[] {
  const html = readFileSync('../index.html', 'utf8');
  const block = /var ROLES = \[([\s\S]*?)\];/.exec(html);
  if (!block) throw new Error('в эталоне нет ROLES');
  return [...block[1]!.matchAll(/\{id:'([^']+)',\s*title:'([^']*)'\}/g)]
    .map((m) => ({ id: m[1]!, title: m[2]! }));
}

/** Профили из эталона: роль → группа колонок → права. */
function referenceProfiles(): Profiles {
  const html = readFileSync('../index.html', 'utf8');
  const block = /var ROLE_PROFILES = \{([\s\S]*?)\n    \};/.exec(html);
  if (!block) throw new Error('в эталоне нет ROLE_PROFILES');

  const out: Profiles = new Map();
  let role: string | null = null;
  for (const raw of block[1]!.split(/\r?\n/)) {
    const line = raw.trim();
    const open = /^(\w+):\s*\{$/.exec(line);
    if (open) { role = open[1]!; out.set(role, new Map()); continue; }
    if (!role) continue;
    for (const m of line.matchAll(/(\w+):\s*\{\s*visible:\s*(true|false)\s*,\s*editable:\s*'([^']+)'/g)) {
      out.get(role)!.set(m[1]!, { visible: m[2] === 'true', editable: m[3]! });
    }
  }
  return out;
}

describe('эталон index.html читается', () => {
  test('в нём семь ролей', () => {
    expect(referenceRoles().length, 'эталон не разобран').toBe(7);
  });

  test('профили разобраны по группам колонок', () => {
    const p = referenceProfiles();
    expect(p.size, 'профилей меньше, чем ролей').toBeGreaterThanOrEqual(6);
    const manager = p.get('manager');
    expect(manager, 'нет профиля менеджера').toBeTruthy();
    // У менеджера 16 групп — проверяем, что разбор не потерял строки.
    expect(manager!.size, 'у менеджера разобрано меньше групп').toBeGreaterThanOrEqual(15);
  });
});

describe('РОЛИ: эталон и прототип', () => {
  test('расхождение названо, а не спрятано', () => {
    const ref = referenceRoles().map((r) => r.id).sort();
    // Приведение типа: список ролей эталона шире, чем роли прототипа, — в этом и суть
    // проверки. Сравниваем как строки, а не как типы.
    // СПИСОК РОЛЕЙ БЕРЁТСЯ ИЗ `roles.ts`. Это нашлось при написании теста: роли были
    // объявлены ДВАЖДЫ — объектом с подписями там и массивом в `access.ts`. Две копии
    // одного списка расходятся молча; сверяем ту, что несёт подписи и используется экранами.
    const now: string[] = Object.keys(ROLE_SPECS).sort();

    const missing = ref.filter((r) => !now.includes(r));
    const extra = now.filter((r) => !ref.includes(r));

    // ЭТО НЕ ПРОВЕРКА «ВСЁ СОВПАЛО» — СОВПАДЕНИЯ ЗДЕСЬ НЕТ, и это надо видеть.
    // В эталоне семь ролей, в прототипе пять: нет поставщика, клиента и снабжения. А
    // «главный механик» эталона называется в прототипе иначе — `mechanic`, — и по
    // названию это РАСХОЖДЕНИЕ, хотя по смыслу роль та же. Плюс «муниципалитет», которого
    // в эталоне нет вовсе.
    expect(missing, 'роли эталона, которых нет в прототипе').toEqual(
      ['chief_mechanic', 'client', 'supplier', 'supply'],
    );
    expect(extra, 'роли прототипа, которых нет в эталоне').toEqual(['mechanic', 'municipality']);

    // Пересечение — три роли с одинаковыми названиями.
    const common = ref.filter((r) => now.includes(r));
    expect(common, 'общих ролей не три').toEqual(['admin', 'manager', 'storekeeper']);
  });
});

describe('ЗАКРЫТЫЕ КОЛОНКИ: эталон и прототип', () => {
  test('кладовщику эталон закрывает платёжные и маржинальные группы', () => {
    const p = referenceProfiles().get('storekeeper')!;
    const hidden = [...p.entries()].filter(([, g]) => !g.visible).map(([k]) => k).sort();

    expect(hidden, 'эталон закрывает кладовщику не то').toEqual(
      ['extra', 'margin_locked', 'margin_open', 'payment'],
    );
  });

  test('ЦЕНА ПРОДАЖИ НЕ ЗАКРЫТА — и это записано как решение, а не как недосмотр', () => {
    // ЭТАЛОН ПРЯЧЕТ платёжные и маржинальные группы. Прототип закрывает кладовщику
    // СЕБЕСТОИМОСТЬ — но НЕ цену продажи.
    expect(isHidden('storekeeper', 'costPrice'), 'себестоимость открыта кладовщику').toBe(true);
    expect(isHidden('storekeeper', 'costSum')).toBe(true);
    // Обе формы написания закрыты: в ответе списка поля идут camelCase, в правке — snake_case.
    expect(isHidden('storekeeper', 'cost_price')).toBe(true);

    // А ЦЕНА ПРОДАЖИ ОТКРЫТА, И ЭТО ОСОЗНАННО. ФТ v2 п. 5 запрещает кладовщику «цены
    // закупки и себестоимость», а не любые цены. Кладовщик выписывает отгрузочные
    // документы, и цена продажи в них есть. Расширять запрет шире написанного нельзя:
    // если заказчик захочет закрыть и её — это отдельное решение, и его надо получить явно.
    expect(isHidden('storekeeper', 'salePrice'),
      'цена продажи закрыта — а это расширение запрета шире ФТ v2 п. 5').toBe(false);
  });

  test('механик закрыт так же, как кладовщик', () => {
    for (const field of ['costPrice', 'costSum', 'cost_price']) {
      expect(isHidden('mechanic', field), `механику открыто поле ${field}`).toBe(true);
    }
    // Цена продажи — по тому же решению, что у кладовщика.
    expect(isHidden('mechanic', 'salePrice')).toBe(false);
  });

  test('менеджеру и администратору не закрыто ничего', () => {
    for (const role of ['manager', 'admin']) {
      for (const field of ['costPrice', 'salePrice', 'price', 'total']) {
        expect(isHidden(role, field), `${role}: закрыто поле ${field}`).toBe(false);
      }
    }
  });
});

describe('ПРАВА ПО ДЕЙСТВИЯМ: эталон и прототип', () => {
  test('кладовщик в эталоне правит склад, приёмку и номенклатуру', () => {
    const p = referenceProfiles().get('storekeeper')!;
    const editable = [...p.entries()].filter(([, g]) => g.editable !== 'none').map(([k]) => k);

    expect(editable, 'эталон даёт кладовщику другие права').toContain('stock');
    expect(editable).toContain('receipt');
    expect(editable).toContain('nomenclature');
  });

  test('в прототипе кладовщик выдаёт со склада и оформляет возврат', () => {
    // Соответствие прямых прав: склад эталона → `stock.issue`, приёмка → `return.create`.
    expect(isAllowed('storekeeper', 'stock.issue'), 'кладовщик не может выдать со склада').toBe(true);
    expect(isAllowed('storekeeper', 'return.create')).toBe(true);
  });

  test('ЦЕНЫ И ПРИБЫЛЬ: ни один отчёт не открыт кладовщику и механику', () => {
    // Право `report.cost` введено отдельно, и это не формальность: в отчёте спрятать
    // колонку бесполезно — ИТОГ по ней всё равно покажет себестоимость и прибыль.
    for (const role of ['storekeeper', 'mechanic']) {
      expect(isAllowed(role, 'report.cost'), `${role} видит отчёт с себестоимостью`).toBe(false);
    }
    for (const role of ['manager', 'admin']) {
      expect(isAllowed(role, 'report.cost'), `${role} не видит отчёт с себестоимостью`).toBe(true);
    }
  });

  test('КЛИЕНТ И ПОСТАВЩИК: в эталоне есть, в прототипе нет — и это открытый вопрос', () => {
    // Клиент в эталоне видит заказ и НЕ правит ничего; поставщик правит только комментарий.
    // В прототипе этих ролей нет: доступ внешних лиц — отдельное решение заказчика.
    const client = referenceProfiles().get('client');
    expect(client, 'в эталоне нет профиля клиента').toBeTruthy();
    expect([...client!.values()].every((g) => g.editable === 'none'),
      'клиент в эталоне что-то правит').toBe(true);

    expect(Object.keys(ROLE_SPECS), 'роль клиента появилась в прототипе без решения')
      .not.toContain('client');
  });

  test('журнал действий доступен только администратору', () => {
    expect(isAllowed('admin', 'audit.read')).toBe(true);
    for (const role of ['manager', 'storekeeper', 'mechanic', 'municipality']) {
      expect(isAllowed(role, 'audit.read'), `${role} читает журнал`).toBe(false);
    }
  });
});
