import { expect, test } from '@playwright/test';

// Сворачивание боковой панели: живёт на клиенте, поэтому проверяется в браузере.
//
// Главное здесь — ПАМЯТЬ: состояние хранится в localStorage и переживает
// перезагрузку. Без этого «свернул» означало бы «свернул до следующего клика»,
// и оператор сворачивал бы панель на каждой странице заново.

const width = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Math.round(document.querySelector('.navbar')!.getBoundingClientRect().width));

const state = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-nav'));

test.describe('боковая панель сворачивается', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('кнопка «Свернуть» есть и видна на ПК', async ({ page }) => {
    await page.goto('/lines');
    await expect(page.getByTestId('nav-toggle')).toBeVisible();
    await expect(page.getByTestId('nav-toggle')).toContainText('Свернуть');
    expect(await width(page)).toBe(232);
  });

  test('нажатие сужает панель и скрывает подписи', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-toggle').click();

    await expect.poll(() => width(page)).toBe(64);
    expect(await state(page)).toBe('collapsed');

    // Подпись пункта скрыта, а сам пункт остался видимым.
    await expect(page.locator('.navbar a[data-testid="nav-lines"] .label')).toBeHidden();
    await expect(page.getByTestId('nav-lines')).toBeVisible();
  });

  test('состояние переживает перезагрузку — это и есть «запомнить»', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-toggle').click();
    await expect.poll(() => width(page)).toBe(64);

    await page.reload();
    expect(await state(page), 'после перезагрузки панель развернулась').toBe('collapsed');
    expect(await width(page)).toBe(64);
  });

  test('состояние переживает переход на другую страницу', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-toggle').click();
    await expect.poll(() => width(page)).toBe(64);

    await page.getByTestId('nav-fleet').click();
    await expect(page).toHaveURL(/\/fleet$/);
    expect(await width(page)).toBe(64);
  });

  test('повторное нажатие разворачивает', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-toggle').click();
    await expect.poll(() => width(page)).toBe(64);

    await page.getByTestId('nav-toggle').click();
    await expect.poll(() => width(page)).toBe(232);
    expect(await state(page)).toBe('expanded');
    await expect(page.locator('.navbar a[data-testid="nav-lines"] .label')).toBeVisible();
  });

  test('при свёрнутой панели у пунктов есть подсказка и имя для диктора', async ({ page }) => {
    await page.goto('/lines');
    for (const id of ['nav-lines', 'nav-fleet', 'nav-invoices']) {
      const link = page.getByTestId(id);
      expect(await link.getAttribute('title'), `${id}: нет подсказки`).toBeTruthy();
      expect(await link.getAttribute('aria-label'), `${id}: нет имени`).toBeTruthy();
    }
  });

  test('выбор панели не зависит от темы', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('nav-toggle').click();

    await expect.poll(() => width(page)).toBe(64);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .not.toBeNull();
  });
});

test.describe('на телефоне панель не сворачивается', () => {
  test.use({ viewport: { width: 420, height: 900 } });

  test('кнопки «Свернуть» нет — панель и так нижняя навигация', async ({ page }) => {
    await page.goto('/lines');
    await expect(page.getByTestId('nav-toggle')).toBeHidden();
  });
});
