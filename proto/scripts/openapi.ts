import { app } from '../src/server.ts';

// Генерация OpenAPI из Zod-схем (prototype-spec.md §3: схема → тип → валидация → OpenAPI).
// Детерминированность — часть гейта: повторный запуск не должен менять файл.
const doc = app.getOpenAPIDocument({
  openapi: '3.0.3',
  info: {
    title: 'vitauto-proto',
    version: '0.1.0',
    description:
      'Прототип АРМ ВИТАВТО. 1С вне контура, один администратор, роли — после прототипа.',
  },
});

const out = `${import.meta.dir}/../openapi.json`;
await Bun.write(out, `${JSON.stringify(doc, null, 2)}\n`);

const paths = Object.keys(doc.paths ?? {}).length;
console.log(`openapi.json записан: ${paths} путей`);
