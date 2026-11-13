import { expect, test } from '@playwright/test';

// e2e: карта процессов как часть приложения.
//
// Проверяется то, что HTML-тест не видит: переключение процесса реально подменяет
// схему через HTMX, а адрес обновляется (`hx-push-url`), поэтому ссылку на процесс
// можно скопировать и открыть заново.

const PROCESSES = ['happy', 'stock', 'mixed_order', 'delivery_split', 'virtual_buy',
  'defect', 'cancel_supplier', 'return', 'return_mgr', 'return_internal', 'car_repair_in'];

test.describe('карта процессов', () => {
  test('ссылка в шапке открывает карту процессов, а не 404', async ({ page }) => {
    const r = await page.goto('/lines');
    expect(r?.status()).toBe(200);

    await page.getByTestId('nav-process').click();
    await expect(page.getByTestId('page-processes')).toBeVisible();
    await expect(page).toHaveURL(/\/processes$/);
  });

  test('видны все 11 процессов и общая статистика', async ({ page }) => {
    await page.goto('/processes');

    for (const id of PROCESSES) {
      await expect(page.getByTestId(`process-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('stats-by-status')).toBeVisible();
    await expect(page.getByTestId('map-summary')).toContainText('121');
  });

  test('первый процесс показан схемой шагов сразу', async ({ page }) => {
    await page.goto('/processes');
    await expect(page.getByTestId('process-panel')).toBeVisible();
    await expect(page.getByTestId('step-1')).toBeVisible();
    await expect(page.getByTestId('step-status-1')).toBeVisible();
  });

  test('переключение процесса подменяет схему и меняет адрес', async ({ page }) => {
    await page.goto('/processes');
    await expect(page.getByTestId('process-title')).toContainText('Основной');

    await page.getByTestId('process-return').click();
    await expect(page.getByTestId('process-title')).toHaveText('Возврат от клиента');
    // hx-push-url: ссылку можно скопировать и открыть заново.
    await expect(page).toHaveURL(/\/processes\/return$/);
  });

  test('ссылка на процесс открывается напрямую', async ({ page }) => {
    const r = await page.goto('/processes/car_repair_in');
    expect(r?.status()).toBe(200);
    await expect(page.getByTestId('page-process-car_repair_in')).toBeVisible();
    await expect(page.getByTestId('process-title')).toContainText('ремонт');
  });

  test('все 11 процессов открываются карточкой', async ({ page }) => {
    for (const id of PROCESSES) {
      const r = await page.goto(`/processes/${id}`);
      expect(r?.status(), `${id}: карточка не открылась`).toBe(200);
    }
  });

  test('шаги показывают, сколько строк сейчас в их состоянии', async ({ page }) => {
    await page.goto('/processes/happy');
    // Счётчик есть у шага 1 (состояние new), и он читается как число.
    await expect(page.getByTestId('step-count-1')).toBeVisible();
    await expect(page.getByTestId('step-count-1')).toHaveText(/^\d+$/);
  });

  test('старая ссылка на статичный process.html больше не используется', async ({ page }) => {
    await page.goto('/lines');
    const href = await page.getByTestId('nav-process').getAttribute('href');
    expect(href, 'ссылка ведёт на файл, которого нет в прототипе').toBe('/processes');
  });
});
