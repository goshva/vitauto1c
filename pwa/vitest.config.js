import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Интеграционные тесты: компоненты в happy-dom ходят в живой HTTP-сервис 1С.
// Страница «открыта» на origin публикации, чтобы запросы были same-origin (без CORS).
const target = new URL(process.env.ARM_API_URL || 'http://127.0.0.1:8090/vitauto/hs/api/arm/v1');

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: target.origin + '/' } },
    env: { ARM_API_BASE: target.pathname },
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false
  }
});
