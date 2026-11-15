import { pool } from './db.ts';
import { buildFilter, type LineFilters } from './lines-filters.ts';
import type { Row } from './views/lines.ts';
import type { FilterValues } from './views/filters.ts';

// Запрос строк для ЭКРАНА списка.
//
// Отдельно от `lines-filters.ts`, потому что задачи разные: там — ЧТО отбирать
// (контракт, общий с API), здесь — КАКИЕ колонки рисовать (дело экрана). Вынесено
// ещё и по размеру: `lines-ui.ts` перешёл предел 200 строк из §12 задания.

export const LIST_SQL = `
  select v."id", v."order", v."status", v."marked", v."nomenclature", v."factName",
         v."nomenclatureArticle", v."clientOrderNumber",
         v."quantity", v."stockQty", v."reserveQty", v."customer", v."salePrice", v."saleSum",
         v."comment", v."urgency",
         -- Варианты поставки (ФТ v2 п. 12): поле выбора — В САМОЙ СТРОКЕ, как и
         -- требует ФТ, а не за кнопкой «показать варианты».
         --
         -- Связь идёт через таблицу line: в представлении нет nomenclature_id, а
         -- пересобирать его ради одного поля — дороже, чем один подзапрос.
         (select json_agg(json_build_object(
                   'id', o.id, 'supplier', cp.name, 'price', o.price::text,
                   'days', o.delivery_days)
                 order by o.delivery_days nulls last, o.price)
            from supplier_offer o
            join counterparty cp on cp.id = o.supplier_id and cp.deleted_at is null
           where o.deleted_at is null
             and o.nomenclature_id = (select nomenclature_id from line where id = v."id")) as offers,
         (select o.id from line l join supplier_offer o on o.id = l.supplier_offer_id
           where l.id = v."id") as "chosenOffer"
    from line_view v
   %WHERE%
   -- Порядок задаётся номером строки, а НЕ срочностью: срочность — только метка
   -- (ФТ v2 п. 9). Иначе «срочные» обгоняли бы уже оплаченные.
   order by v."order"
   limit %LIMIT%`;

/**
 * Строки списка с отбором по каждому полю (ФТ v2 п. 14).
 *
 * Условия собирает `buildFilter` — тот же, что и в API. Две копии правил отбора
 * разошлись бы, и экран показывал бы не то, что отдаёт API на том же адресе.
 *
 * `where` из `buildFilter` НИКОГДА не пуст: условие по операции там обязательное.
 * Поэтому подстановка простая — без ветки «а если отбора нет».
 */
export async function loadRows(
  operation: string,
  filters: FilterValues = {},
  limit = 100,
): Promise<Row[]> {
  const all = {
    ...filters,
    view: operation === 'purchase' ? 'purchases' : 'sales',
    limit,
    cursor: 0,
  } as LineFilters;

  const { where, params } = buildFilter(all);
  params.push(limit);
  const sql = LIST_SQL.replace('%WHERE%', where).replace('%LIMIT%', `$${params.length}`);

  const r = await pool.query<Row>(sql, params);
  return r.rows;
}
