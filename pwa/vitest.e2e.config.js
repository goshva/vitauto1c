import { defineConfig } from 'vitest/config';

// Сквозные сценарии process.html через OData (e2e/processes.e2e.js): Node, прямые запросы к публикации 1С.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.js'],
    environment: 'node',
    testTimeout: 1800000,
    hookTimeout: 600000,
    fileParallelism: false
  }
});
