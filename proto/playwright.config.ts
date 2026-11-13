import { defineConfig, devices } from '@playwright/test';

// e2e прототипа: реальный браузер против HTMX-экрана на порту 18190.
//
// Отдельно от `pwa/playwright.config.ts`: там e2e легаси-приложения (Vue на 18180),
// здесь — прототипа. Общая у них только причина флагов ниже.
//
// Локально используется СИСТЕМНЫЙ Chrome (`channel: 'chrome'`): он не требует
// `npx playwright install chromium` (≈150 МБ). В CI ставится штатный chromium.
const useSystemChrome = !process.env.CI;
const PORT = Number(process.env.PROTO_PORT ?? 18190);

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Последовательно: экран один, база одна. Параллельные сценарии сбрасывали бы
  // данные друг друга — ровно та гонка, из-за которой в unit-тестах пришлось
  // перейти на `--parallel=1`.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    // `--no-proxy-server`: при заданных в системе HTTP_PROXY/HTTPS_PROXY headless
    // Chromium уходит через прокси и не исключает loopback — получается
    // «health ok, а page.goto висит». `proxy: { server: 'direct://' }` НЕ работает:
    // Playwright принимает это как имя хоста (проверено в pwa).
    launchOptions: { args: ['--no-proxy-server'] },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
      },
    },
  ],
  // Сервер поднимается сам: тест не должен требовать «сначала запусти вручную».
  webServer: {
    command: 'bun run src/server.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 40_000,
    // PROTO_TEST_HOOKS=1 включает подготовку состояния процесса (/__test__/seed):
    // e2e идут последовательно на одной базе, и без сброса каждый тест ловил бы
    // состояние предыдущего. В обычном запуске этих адресов нет.
    env: { PORT: String(PORT), PROTO_TEST_HOOKS: '1' },
  },
});
