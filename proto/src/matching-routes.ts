import { Hono } from 'hono';
import { pool } from './db.ts';
import { guard } from './auth.ts';
import { problemResponse, Problem } from './problem.ts';
import { record } from './audit.ts';
import { bandCounts, matchesForUnidentified, matchingContext } from './matching-lines.ts';
import { matchesPanel } from './views/matching.ts';
import { MATCH_BANDS } from './domain/matching.ts';

// Маршруты сопоставления: подсказки и пакетный разбор (п. 2).
//
// ПАКЕТНЫЙ РАЗБОР БЕЗ ПОДТВЕРЖДЕНИЯ НЕ МЕНЯЕТ НИЧЕГО. Он сначала показывает, ЧТО именно
// будет привязано и с какой оценкой, и только потом применяет. Причина простая: пакетная
// ошибка проставляет неверное сопоставление СРАЗУ У МНОГИХ строк, а искать её потом
// придётся на складе. Отдельный шаг подтверждения стоит одного лишнего клика.
//
// ПОРОГИ ЖИВУТ В `domain/matching.ts` И НЕ ДУБЛИРУЮТСЯ ЗДЕСЬ: подставить можно ровно то,
// что счётчик назвал `auto`. Понизь мы порог в этом файле — он разошёлся бы с подсказками
// на экране.

export const matchingRoutes = new Hono();

/** Позиции, ждущие опознания, с предложениями. */
async function unidentifiedMatches() {
  const lines = await pool.query<{
    id: string; factName: string | null; factArticle: string | null;
  }>(
    `select l.id, f.fact_name as "factName", f.fact_article as "factArticle"
       from line l left join line_fact f on f.id = l.id
      where not l.deleted and l.nomenclature_id is null
      order by l.order_date, l.id`,
  );
  const ctx = await matchingContext();
  return { items: await matchesForUnidentified(lines.rows, ctx), ctx };
}

/**
 * Панель сопоставления: сводка и предложения по каждой неопознанной строке.
 *
 * Экспортируется, потому что нужна и ЭКРАНУ (`unidentified-ui.ts`), и обработчикам
 * пакетного разбора здесь же. Держать две копии значило бы однажды показать на экране
 * не то, что подставляет пакет.
 */
export async function matchingPanelBody(message?: string): Promise<string> {
  const { items } = await unidentifiedMatches();
  const counts = bandCounts(items);
  return (message ? message : '') + matchesPanel(items, counts, { canAuto: true });
}

// --- GET /lines/{id}/matches — предложения по одной строке ---------------------------
matchingRoutes.get('/lines/:id/matches', async (c) => {
  const id = c.req.param('id');

  const row = await pool.query<{ factName: string | null; factArticle: string | null }>(
    `select f.fact_name as "factName", f.fact_article as "factArticle"
       from line l left join line_fact f on f.id = l.id
      where l.id = $1 and not l.deleted`,
    [id],
  );
  if (row.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const ctx = await matchingContext();
  const [result] = await matchesForUnidentified([{ id, ...row.rows[0]! }], ctx);

  return c.json({
    lineId: id,
    written: result!.written,
    band: result!.band,
    thresholds: MATCH_BANDS,
    suggestions: result!.suggestions,
  }, 200);
});

// --- GET /lines/matches/summary — сводка по всем неопознанным -------------------------
matchingRoutes.get('/lines/matches/summary', async (c) => {
  const { items } = await unidentifiedMatches();
  return c.json({
    total: items.length,
    ...bandCounts(items),
    thresholds: MATCH_BANDS,
    /**
     * Что будет привязано пакетом: строка и позиция с оценкой.
     *
     * ПОЛЕ НАЗЫВАЕТСЯ `willBind`, А НЕ `auto`. Сначала оно называлось `auto` — как и
     * счётчик полосы, — и СПИСОК ЗАТИРАЛ ЧИСЛО: в ответе оставался массив там, где
     * клиент ждал количество. Поймал тест; для читателя же это была ловушка в одном
     * имени на два разных смысла.
     */
    willBind: items.filter((m) => m.band === 'auto').map((m) => ({
      lineId: m.lineId,
      written: m.written,
      nomenclatureId: m.suggestions[0]!.id,
      nomenclature: m.suggestions[0]!.name,
      score: m.suggestions[0]!.score,
    })),
  }, 200);
});

// --- POST /ui/unidentified/matches — обновить подсказки ------------------------------
matchingRoutes.get('/ui/unidentified/matches', async (c) => c.html(await matchingPanelBody()));

/**
 * ПРОГОН-ПРИМЕРКА: показать, что изменится, и НЕ менять ничего.
 */
matchingRoutes.post('/ui/unidentified/auto-match', async (c) => {
  const noRight = guard(c, 'request.create');
  if (noRight) return problemResponse(c, noRight);

  const { items } = await unidentifiedMatches();
  const ready = items.filter((m) => m.band === 'auto');

  if (ready.length === 0) {
    return c.html(await matchingPanelBody(
      `<p class="hint" data-testid="auto-match-nothing">
         Подставлять нечего: ни одна позиция не набрала ${MATCH_BANDS.auto} и выше.
         Остальные нужно разобрать вручную — так и задумано, порог выбран по данным.
       </p>`));
  }

  const rows = ready.map((m) => {
    const s = m.suggestions[0]!;
    return `<li data-testid="auto-row-${m.lineId}">
      «${s.common.length > 0 ? m.written : m.written}» → <b>${s.name}</b>
      <span class="hint">оценка ${s.score.toFixed(2)}</span>
    </li>`;
  }).join('');

  return c.html(`<div id="unidentified-panel" data-testid="unidentified-panel">
    <p class="hint" data-testid="auto-match-preview">
      Будет привязано позиций: <b>${ready.length}</b> из ${items.length}.
      Ничего ещё не изменено — проверьте список и подтвердите.
    </p>
    <ul class="match-list" data-testid="auto-match-list">${rows}</ul>
    <form hx-post="/ui/unidentified/auto-match-apply" hx-target="#unidentified-panel"
          hx-swap="outerHTML" data-testid="auto-match-confirm-form">
      <button type="submit" data-testid="auto-match-confirm">Подтвердить и привязать</button>
      <a href="/unidentified" data-testid="auto-match-cancel">Отменить</a>
    </form>
  </div>`);
});

/**
 * ПРИМЕНЕНИЕ пакета. Каждая привязка идёт через журнал действий: пакетная правка обязана
 * быть разбираемой потом — иначе ошибку не отличить от намерения.
 */
matchingRoutes.post('/ui/unidentified/auto-match-apply', async (c) => {
  const noRight = guard(c, 'request.create');
  if (noRight) return problemResponse(c, noRight);

  const { items } = await unidentifiedMatches();
  const ready = items.filter((m) => m.band === 'auto');
  let bound = 0;

  for (const m of ready) {
    const s = m.suggestions[0]!;
    const done = await pool.query(
      `update line set nomenclature_id = $2, version = version + 1, updated_at = now()
        where id = $1 and nomenclature_id is null`,
      [m.lineId, s.id],
    );
    if (done.rowCount === 0) continue;

    await record(c, {
      entity: 'line', entityId: m.lineId, action: 'update',
      field: 'nomenclature_id', newValue: s.name,
      comment: `сопоставление пакетом, оценка ${s.score.toFixed(2)}`,
      details: { matchedFrom: m.written, score: s.score, mode: 'auto-batch' },
    });
    bound++;
  }

  return c.html(await matchingPanelBody(
    `<p class="hint" data-testid="auto-match-done">
       Привязано автоматически: <b>${bound}</b>.
         Остальные нужно разобрать вручную — так и задумано, порог выбран по данным.
     </p>`));
});
