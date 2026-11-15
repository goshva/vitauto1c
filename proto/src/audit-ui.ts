import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { problemResponse } from './problem.ts';
import { layout, esc } from './views/html.ts';
import { auditTable, type AuditView } from './views/audit.ts';
import { wantsHtml } from './lines-ui.ts';

// Экран журнала действий.
//
// Право отдельное (`audit.read`), и это не формальность: журнал показывает
// себестоимость и историю цен, то есть ровно те данные, которые кладовщику и механику
// закрыты (ФТ v2 п. 5). Открой мы его всем, кто может смотреть строки, — закрытие
// колонок обошлось бы через журнал.

export const auditUi = new Hono();

/** Отбор журнала. Значения приходят из строки запроса. */
interface AuditQuery {
  entity?: string;
  entityId?: string;
  login?: string;
  field?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function search(q: AuditQuery, limit = 200): Promise<AuditView[]> {
  const params: unknown[] = [];
  const parts: string[] = [];

  for (const [column, value] of [
    ['entity', q.entity], ['entity_id', q.entityId], ['login', q.login],
    ['field', q.field], ['action', q.action],
  ] as const) {
    if (value) { params.push(value); parts.push(`${column} = $${params.length}`); }
  }
  if (q.dateFrom) { params.push(q.dateFrom); parts.push(`at >= $${params.length}::date`); }
  if (q.dateTo) { params.push(q.dateTo); parts.push(`at < ($${params.length}::date + 1)`); }

  const where = parts.length > 0 ? `where ${parts.join(' and ')}` : '';
  params.push(limit);

  const r = await pool.query<{
    id: string; at: Date; login: string | null; role: string | null; action: string;
    field: string | null; oldValue: string | null; newValue: string | null;
    comment: string | null; entity: string; entityId: string;
  }>(
    `select id, at, login, role, action, field,
            old_value as "oldValue", new_value as "newValue", comment, entity,
            entity_id as "entityId"
       from audit_log ${where}
      order by at desc, id desc
      limit $${params.length}`,
    params,
  );

  return r.rows.map((x) => ({ ...x, at: x.at.toISOString() }));
}

/** Что предлагается в отборе: значения из самого журнала, а не выдуманный список. */
async function choices(): Promise<{ entities: string[]; fields: string[] }> {
  const e = await pool.query<{ entity: string }>(
    `select distinct entity from audit_log order by entity`);
  const f = await pool.query<{ field: string }>(
    `select distinct field from audit_log where field is not null order by field`);
  return { entities: e.rows.map((x) => x.entity), fields: f.rows.map((x) => x.field) };
}

// Панель истории ОДНОЙ строки — там, где вопрос и задают.
//
// Отдельного пункта меню у журнала нет намеренно: «кто изменил цену» спрашивают,
// глядя на строку, а не заходя в общий журнал. Двадцать одно место рисует макет, и
// протаскивать роль в каждое ради пункта меню дороже, чем дать ссылку от строки.
auditUi.get('/ui/lines/:id/history', async (c) => {
  const noRight = guard(c, 'audit.read');
  if (noRight) return problemResponse(c, noRight);

  const id = c.req.param('id');
  const items = await search({ entity: 'line', entityId: id }, 50);

  return c.html(`<div id="history-panel" data-testid="history-panel">
    <h3>История строки</h3>
    ${auditTable(items)}
    <p class="hint">Всего записей: ${items.length}. Общий журнал —
      <a href="/audit" data-testid="history-all">все действия</a>.</p>
  </div>`);
});

auditUi.get('/audit', async (c, next) => {
  // ОДИН АДРЕС, ДВА ПРЕДСТАВЛЕНИЯ — как у `/lines`. Браузер просит HTML и получает
  // страницу, агент просит JSON и получает данные от `auditApi`, зарегистрированного
  // следом. Без этой проверки браузер видел бы JSON, а отдельный адрес для экрана
  // разошёлся бы с API.
  if (!wantsHtml(c)) return next();

  const noRight = guard(c, 'audit.read');
  if (noRight) return problemResponse(c, noRight);

  const q = c.req.query();
  const [items, opts] = await Promise.all([search(q), choices()]);

  const options = (values: string[], current: string | undefined, empty: string): string =>
    [`<option value="">${empty}</option>`].concat(
      values.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`),
    ).join('');

  return c.html(layout({
    title: 'Журнал действий',
    testId: 'page-audit',
    active: 'audit',
    body: `<p class="hint" data-testid="audit-hint">
      Журнал отвечает на вопрос «кто изменил»: правки полей, смена состояний, создание
      и удаление документов. Записи, сделанные до включения журнала, в него не попали.
    </p>

    <form class="filters" data-testid="audit-filters" method="get" action="/audit">
      <div class="filters-row">
        <label class="f"><span>Запись</span>
          <select name="entity" data-testid="audit-entity">${
        options(opts.entities, q.entity, 'все')}</select></label>
        <label class="f"><span>Поле</span>
          <select name="field" data-testid="audit-field">${
        options(opts.fields, q.field, 'все')}</select></label>
        <label class="f"><span>Действие</span>
          <select name="action" data-testid="audit-action">
            <option value="">все</option>
            ${['create', 'update', 'delete', 'transition'].map((a) =>
        `<option value="${a}"${a === q.action ? ' selected' : ''}>${a}</option>`).join('\n            ')}
          </select></label>
        <label class="f"><span>Логин</span>
          <input name="login" data-testid="audit-login" value="${esc(q.login ?? '')}"></label>
        <label class="f"><span>С даты</span>
          <input type="date" name="dateFrom" data-testid="audit-date-from"
                 value="${esc(q.dateFrom ?? '')}"></label>
        <label class="f"><span>По</span>
          <input type="date" name="dateTo" data-testid="audit-date-to"
                 value="${esc(q.dateTo ?? '')}"></label>
      </div>
      <div class="filters-actions">
        <button type="submit" data-testid="audit-apply">Показать</button>
        <a href="/audit" data-testid="audit-reset">Сбросить</a>
        <span class="hint" data-testid="audit-count">Записей: ${items.length}</span>
      </div>
    </form>

    ${auditTable(items, { showEntity: true })}`,
  }));
});
