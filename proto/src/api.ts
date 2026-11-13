import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { Problem, problemResponse } from './problem.ts';
import type { AppEnv } from './env.ts';

// Единая точка создания под-приложений.
//
// ЗАЧЕМ: по умолчанию `@hono/zod-openapi` отвечает на ошибку валидации своим
// форматом — `{"success":false,"error":{"name":"ZodError",…}}`. Это ломает гейт
// «один тип ошибки на всё API» (задание §7): клиент получает то `problem+json`,
// то структуру Zod, и не может разобрать ответ единообразно.
//
// Проверено: запрос с мягким UUID из сидов отвечал `{"success":false,…}` — то есть
// до появления этого файла гейт не выполнялся, хотя выглядел выполненным.
//
// `defaultHook` перехватывает ЛЮБУЮ ошибку валидации (query, param, body, header)
// и превращает её в `Problem` с кодом `validation_failed` и именем поля.

/** Первая проблема валидации — самая полезная для человека, читающего ответ. */
function describe(error: { issues: { path: (string | number)[]; message: string }[] }): {
  message: string;
  field?: string;
} {
  const issue = error.issues[0];
  if (!issue) return { message: 'Некорректный запрос' };

  const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
  return {
    message: field ? `${field}: ${issue.message}` : issue.message,
    field,
  };
}

export function createApi(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono({
    defaultHook: (result, c: Context<AppEnv>) => {
      if (result.success) return;
      const { message, field } = describe(result.error as never);
      return problemResponse(c, new Problem(400, 'validation_failed', message, field));
    },
  });
}
