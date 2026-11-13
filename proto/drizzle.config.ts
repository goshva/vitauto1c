import { defineConfig } from 'drizzle-kit';

// Drizzle — единственный источник схемы БД (prototype-spec.md §3: schema-first).
// Миграции генерируются из TypeScript-схемы, а не пишутся руками.
//
// process.env, а не Bun.env: drizzle-kit запускает этот конфиг через Node (tsx),
// где глобального `Bun` нет — иначе падает «Bun is not defined».
export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto',
  },
  verbose: true,
  strict: true,
});
