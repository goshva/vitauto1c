import { Hono } from 'hono';
import { processIds, resetTo, seedProcess, seedRefs } from '../db/seed.ts';

// Тестовые хуки. Монтируются ТОЛЬКО когда сервер запущен с PROTO_TEST_HOOKS=1 —
// это делает playwright-конфигурация для своего webServer.
//
// Зачем: e2e идут последовательно на одной базе, и предыдущий сценарий меняет
// состояние строк. Без подготовки каждый тест ловил бы состояние предыдущего —
// именно на это упали тесты экрана документов в прошлом раунде.
//
// Хук включён флагом, а не всегда: в обычном запуске сервера адресов, меняющих
// данные в обход API, быть не должно. Флаг виден в конфигурации e2e.

export const testHooks = new Hono();

/** Состав сидов: справочники и список процессов. */
testHooks.get('/__test__/seed', (c) => c.json({
  refs: true,
  processes: processIds(),
}));

/**
 * Подготовка состояния процесса.
 *
 * `reset: true` — полная очистка транзакций и засев одного процесса (изоляция).
 * Без него процесс добавляется к существующим данным.
 */
testHooks.post('/__test__/seed', async (c) => {
  const body = await c.req.json<{ process?: string; refs?: boolean; reset?: boolean }>();

  if (body.refs !== false) await seedRefs();

  if (body.process) {
    if (!processIds().includes(body.process)) {
      return c.json({
        code: 'not_found',
        message: `Процесса «${body.process}» нет. Есть: ${processIds().join(', ')}`,
      }, 404);
    }
    // resetTo очищает транзакции и засевает ОДИН процесс; seedProcess добавляет
    // процесс к существующим данным. Для e2e нужен первый: иначе тест ловит
    // состояние предыдущего сценария.
    if (body.reset) await resetTo(body.process);
    else await seedProcess(body.process);
  }

  return c.json({ ok: true, process: body.process ?? null });
});
