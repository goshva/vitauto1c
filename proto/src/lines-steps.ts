import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { notifyStatus } from './notices.ts';
import { record } from './audit.ts';
import { canMove, neighbours } from './domain/step-move.ts';

// ШАГ ПО ПРОЦЕССУ: строка идёт ТОЛЬКО на соседний шаг — вперёд или назад.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ ПЕРЕХОДОВ ПО СОСТОЯНИЯМ. Граф переходов отвечает на вопрос «допустим ли
// переход между состояниями», но у одного состояния бывает НЕСКОЛЬКО шагов: «Новый» стоит
// на шагах 1, 2 и 3 почти каждого процесса. По графу строка могла бы «перейти из нового в
// новый», перескочив шаг, — и учёт показал бы, что работа идёт, хотя её не делали.
//
// ГРАНИЦЫ: НА ПЕРВОМ ШАГЕ НАЗАД НЕЛЬЗЯ, НА ПОСЛЕДНЕМ ВПЕРЁД НЕЛЬЗЯ. Процесс на этом
// останавливается. Это отказ, а не молчаливый пропуск: оператор должен понять, почему
// кнопки нет.
//
// ОТДЕЛЬНЫМ МОДУЛЕМ, А НЕ В `lines-transitions.ts`: тот держит переходы по состояниям, у
// них другой источник правил (граф) против этого (карта процессов).

export const lineSteps = createApi();

const StepBody = z.object({
  dir: z.enum(['next', 'prev']).describe('next — на следующий шаг, prev — на предыдущий'),
});

/** Отмеченная строка вместе с её местом в процессе. */
interface MarkedStep {
  id: string;
  status: string;
  process_id: string | null;
  process_step: number | null;
  name: string;
}

const stepRoute = createRoute({
  method: 'post',
  path: '/lines/step',
  tags: ['lines'],
  summary: 'Сдвинуть отмеченные строки на соседний шаг их процесса',
  request: { body: { content: { 'application/json': { schema: StepBody } } } },
  responses: {
    200: { description: 'Итог сдвига', content: { 'application/json': { schema: z.object({
      processed: z.number(), total: z.number(), step: z.number(), status: z.string(),
    }) } } },
    409: { description: 'Сдвинуть нельзя: нет отметок, разные шаги или граница процесса' },
  },
});

lineSteps.openapi(stepRoute, async (c) => {
  const { dir } = c.req.valid('json');

  const marked = await pool.query<MarkedStep>(
    `select l.id, l.status, l.process_id, l.process_step,
            coalesce(f.fact_name, l.id::text) as name
       from line l
       join line_mark m on m.id = l.id and m.marked
       left join line_fact f on f.id = l.id
      where not l.deleted
      order by l.order_date, l.id
      for update of l`,
  );

  if (marked.rowCount === 0) {
    return problemResponse(c, new Problem(409, 'nothing_marked',
      'Нет отмеченных строк. Отметьте строки в списке и повторите.'));
  }

  const rows = marked.rows;

  // СТРОКИ ВНЕ ПРОЦЕССА СДВИГАТЬ НЕЛЬЗЯ: «следующий шаг» для них не определён, и выдумать
  // его значило бы поставить состояние, которого процесс не предусматривает.
  const outside = rows.filter((r) => !r.process_id || r.process_step === null);
  if (outside.length > 0) {
    return problemResponse(c, new Problem(409, 'outside_process',
      `Строки вне процесса сдвигать по шагам нельзя: ${outside.map((r) => r.name).join(', ')}. `
      + 'Для них работают переходы по состояниям.'));
  }

  // ВМЕСТЕ ДВИГАЮТСЯ ТОЛЬКО СТРОКИ НА ОДНОМ ШАГЕ. Иначе «вперёд» для них значило бы разное:
  // одна ушла бы на шаг вперёд, другая на два.
  const first = rows[0]!;
  const samePoint = rows.every((r) => r.process_id === first.process_id
    && r.process_step === first.process_step);
  if (!samePoint) {
    return problemResponse(c, new Problem(409, 'different_steps',
      'Отмеченные строки стоят на разных шагах или в разных процессах. '
      + 'Сдвинуть их вместе нельзя: «вперёд» для них означало бы разное.'));
  }

  const target = canMove(first.process_id, first.process_step, dir);
  if (!target) {
    const nb = neighbours(first.process_id, first.process_step);
    const why = dir === 'next'
      ? `Процесс завершён: шаг ${nb.at} из ${nb.total} — последний. Дальше движения нет.`
      : `Начало процесса: шаг ${nb.at} — первый. Назад движения нет.`;
    return problemResponse(c, new Problem(409, 'at_boundary', why, 'dir'));
  }

  for (const line of rows) {
    await pool.query(
      `update line set status = $2, process_step = $3, version = version + 1,
              updated_at = now()
        where id = $1`,
      [line.id, target.status, target.n],
    );
    // Журнал: смена шага — не правка поля, поэтому отдельный вид действия. По нему потом
    // и видно, кто и когда двигал строку по процессу.
    await record(c, {
      entity: 'line', entityId: line.id, action: 'step',
      field: 'process_step', oldValue: String(line.process_step), newValue: String(target.n),
    });
    await pool.query(`update line_mark set marked = false where id = $1`, [line.id]);
    await notifyStatus(line.id, target.status, null);
  }

  return c.json({
    processed: rows.length,
    total: marked.rowCount!,
    step: target.n,
    status: target.status,
  }, 200);
});
