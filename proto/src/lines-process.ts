import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';
import { Problem, problemResponse } from './problem.ts';
import { uuid } from './domain/uuid.ts';
import { guard } from './auth.ts';
import { record } from './audit.ts';
import { PROCESSES, processById } from './domain/process-map.ts';
import { stepAt } from './domain/step-move.ts';

// НАЗНАЧЕНИЕ СТРОКЕ ПРОЦЕССА (сценария модели).
//
// ЗАЧЕМ ОТДЕЛЬНОЕ ДЕЙСТВИЕ. `process_id` и `process_step` до этого писали только сиды:
// строка, созданная через приложение, в процессе не числилась, и `/lines/step` отвечал
// ей `outside_process` — пошаговое движение по узлам работало лишь на демонстрационных
// данных (`docs/fix-plan.md` §4).
//
// ПОЧЕМУ НЕ ЧЕРЕЗ `PATCH /lines/{id}`. Тогда `process_id` попал бы в список правимых
// полей, и шаг можно было бы перескочить в обход `canMove` и проверки «все строки на
// одном шаге». Назначение процесса — отдельное право (`process.assign`).
//
// ПОЧЕМУ ТОЛЬКО В НАЧАЛО СЦЕНАРИЯ. Строка, ушедшая вперёд, стоит на конкретном шаге;
// «назначить» ей первый шаг значило бы соврать о её месте. Смена процесса у строки,
// которая уже в процессе, — отдельное решение, а не побочный эффект назначения.
//
// Отдельным файлом, а не в `lines-steps.ts`: тот держит движение по шагам, и вместе
// они перевалили за предел 200 строк из §12 задания.

export const lineProcess = createApi();

const AssignBody = z.object({
  processId: z.string().min(1).describe('Идентификатор процесса из карты'),
});

const assignRoute = createRoute({
  method: 'post',
  path: '/lines/{id}/process',
  tags: ['lines'],
  summary: 'Назначить строке процесс (сценарий модели)',
  request: {
    params: z.object({ id: uuid }),
    body: { content: { 'application/json': { schema: AssignBody } } },
  },
  responses: {
    200: { description: 'Процесс назначен', content: { 'application/json': { schema: z.object({
      id: uuid, processId: z.string(), step: z.number().int(), status: z.string(),
    }) } } },
    400: { description: 'Процесса нет в карте' },
    403: { description: 'Нет права назначать процесс' },
    404: { description: 'Строка не найдена' },
    409: { description: 'Строка уже в процессе или её состояние не равно первому шагу' },
  },
});

lineProcess.openapi(assignRoute, async (c) => {
  const noRight = guard(c, 'process.assign');
  if (noRight) return problemResponse(c, noRight);

  const { id } = c.req.valid('param');
  const { processId } = c.req.valid('json');

  if (!processById(processId)) {
    return problemResponse(c, new Problem(400, 'bad_request',
      `Процесса «${processId}» нет в карте. Есть: ${PROCESSES.map((p) => p.id).join(', ')}.`,
      'processId'));
  }

  const first = stepAt(processId, 1)!;
  const found = await pool.query<{ status: string; process_id: string | null }>(
    `select status, process_id from line where id = $1 and not deleted`, [id]);
  if (found.rowCount === 0) {
    return problemResponse(c, new Problem(404, 'not_found', `Строка ${id} не найдена`));
  }

  const line = found.rows[0]!;
  if (line.process_id) {
    return problemResponse(c, new Problem(409, 'already_in_process',
      `Строка уже в процессе «${line.process_id}». Смена процесса — отдельное решение.`));
  }
  if (line.status !== first.status) {
    return problemResponse(c, new Problem(409, 'status_mismatch',
      `Первый шаг процесса «${processId}» требует состояние «${first.status}», `
      + `а строка в «${line.status}». Процесс назначается строке в начале сценария.`,
      'processId'));
  }

  await pool.query(
    `update line set process_id = $2, process_step = 1, version = version + 1, updated_at = now()
      where id = $1`,
    [id, processId],
  );

  // Журнал: «кто поставил строку в процесс» — тот же вид действия, что сдвиг по шагу.
  await record(c, {
    entity: 'line', entityId: id, action: 'step', field: 'process_id',
    oldValue: null, newValue: processId, details: { step: 1, status: first.status },
  });

  return c.json({ id, processId, step: 1, status: first.status }, 200);
});
