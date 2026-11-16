import { expect, test } from '@playwright/test';

// ВСПЛЫВАЮЩИЕ СООБЩЕНИЯ СНИЗУ: НЕ ДЁРГАЮТ СТРАНИЦУ И ПРЕДЛАГАЮТ ДЕЙСТВИЕ.
//
// ГЛАВНОЕ ЗДЕСЬ — ПРОВЕРКА ТОГО, ЧТО ПОЛОСА ПРОКРУТКИ НЕ ДЁРГАЕТСЯ. На это указал заказчик,
// и проверить это можно только измерением: высота страницы и ширина полосы прокрутки ДО и
// ПОСЛЕ появления панели обязаны совпасть. На глаз «вроде не дёргается» ничего не значит.
//
// ЧТО БЫЛО НЕ ТАК. Панель действий была `position: sticky` — то есть ОСТАВАЛАСЬ В ПОТОКЕ и
// занимала своё место. Пока она видна, высота страницы больше; при появлении полоса
// прокрутки меняла длину, а на коротком списке — появлялась и исчезала.

/** Ширина полосы прокрутки: разница между окном и областью содержимого. */
const scrollbarWidth = (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);

/** Полная высота страницы. */
const pageHeight = (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollHeight);

/** Снять все отметки, если они есть. */
async function clearMarks(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/lines');
  const all = page.locator('[data-testid="unmark-all"]');
  if (await all.count() > 0) { await all.click(); await page.waitForTimeout(200); }
  for (let guard = 0; guard < 12; guard++) {
    const checked = page.locator('[data-testid^="mark-"]:checked');
    if ((await checked.count().catch(() => 0)) === 0) break;
    await checked.first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test.describe('всплывающие сообщения снизу', () => {
  test.beforeEach(async ({ page }) => { await clearMarks(page); });
  test.afterEach(async ({ page }) => { await clearMarks(page); });

  test('ПОЯВЛЕНИЕ ПАНЕЛИ НЕ ДВИГАЕТ СТРАНИЦУ', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const heightBefore = await pageHeight(page);
    const barBefore = await scrollbarWidth(page);

    // Отмечаем строку: панель действий появляется.
    const row = page.locator('tr.line-row').first();
    const id = await row.getAttribute('data-id');
    await page.locator(`[data-testid="mark-${id}"]`).check();
    await expect(page.locator('[data-testid="actions-panel"]')).toBeVisible();
    await page.waitForTimeout(250);

    const heightAfter = await pageHeight(page);
    const barAfter = await scrollbarWidth(page);

    // ВЫСОТА СТРАНИЦЫ НЕ ИЗМЕНИЛАСЬ: нижние панели выведены из потока.
    expect(heightAfter, 'появление панелей изменило высоту страницы — они в потоке')
      .toBe(heightBefore);
    // И ПОЛОСА ПРОКРУТКИ ТОЙ ЖЕ ШИРИНЫ: она не появилась и не исчезла.
    expect(barAfter, 'полоса прокрутки изменилась при появлении панелей').toBe(barBefore);
  });

  test('панель ВИСИТ НАД СТРАНИЦЕЙ, а не стоит в её конце', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const row = page.locator('tr.line-row').first();
    await page.locator(`[data-testid="mark-${await row.getAttribute('data-id')}"]`).check();
    await page.waitForTimeout(250);

    // Берём КОНТЕЙНЕР, а не `.chain`: этот класс носят две панели, и поиск по нему дал бы
    // два совпадения — на этом тест и споткнулся в первый раз.
    const box = await page.locator('.floating-bottom').boundingBox();
    const view = page.viewportSize()!;
    expect(box, 'всплывающий низ не найден').toBeTruthy();
    // Нижний край — У КРАЯ ОКНА, а не в конце документа.
    expect(box!.y + box!.height, 'панель не у нижнего края окна')
      .toBeLessThanOrEqual(view.height + 1);
    // И ширина меньше окна: она по содержимому, а не на весь экран.
    expect(box!.width, 'панель растянута на весь экран').toBeLessThan(view.width);
  });

  test('СООБЩЕНИЕ О ЧАСТИЧНОЙ ДОСТУПНОСТИ ПРЕДЛАГАЕТ СНЯТЬ ВЫДЕЛЕНИЕ', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    // Две строки в РАЗНЫХ состояниях: переход «Зарезервировать» применим только к новой,
    // значит он частичный — и про это должно быть сказано с предложением действия.
    const fresh = page.locator('tr.line-row[data-status="new"]').first();
    const reserved = page.locator('tr.line-row[data-status="reserve"]').first();
    if (await reserved.count() === 0) test.skip(true, 'нет строки в резерве');

    await page.locator(`[data-testid="mark-${await fresh.getAttribute('data-id')}"]`).check();
    await page.locator(`[data-testid="mark-${await reserved.getAttribute('data-id')}"]`).check();

    const note = page.locator('[data-testid="partial-note"]');
    await expect(note, 'нет сообщения о частичной доступности').toBeVisible();
    await expect(note, 'сообщение не называет переходы').toContainText('Недоступно для части строк');
    // ГЛАВНОЕ: В СООБЩЕНИИ ЕСТЬ ДЕЙСТВИЕ, а не только жалоба.
    await expect(page.locator('[data-testid="unmark-all"]'), 'нет кнопки снятия выделения')
      .toBeVisible();

    await page.screenshot({ path: 'e2e-shots/10-toast-partial.png', fullPage: false });
  });

  test('СНЯТИЕ ВЫДЕЛЕНИЯ СО ВСЕХ РАБОТАЕТ', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const fresh = page.locator('tr.line-row[data-status="new"]').first();
    const reserved = page.locator('tr.line-row[data-status="reserve"]').first();
    if (await reserved.count() === 0) test.skip(true, 'нет строки в резерве');

    await page.locator(`[data-testid="mark-${await fresh.getAttribute('data-id')}"]`).check();
    await page.locator(`[data-testid="mark-${await reserved.getAttribute('data-id')}"]`).check();
    await expect(page.locator('[data-testid="mark-count"]')).toHaveText('2');

    await page.locator('[data-testid="unmark-all"]').click();
    await page.waitForTimeout(300);

    // Все отметки сняты — и сообщение исчезло вместе с ними.
    await expect(page.locator('[data-testid="mark-count"]'), 'отметки не сняты').toHaveText('0');
    await expect(page.locator('[data-testid="partial-note"]'),
      'сообщение осталось после снятия выделения').toHaveCount(0);
    await expect(page.locator('[data-testid^="mark-"]:checked'),
      'остались отмеченные строки').toHaveCount(0);
  });

  test('сообщение ВИСИТ НАД панелью действий, а не за ней', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const fresh = page.locator('tr.line-row[data-status="new"]').first();
    const reserved = page.locator('tr.line-row[data-status="reserve"]').first();
    if (await reserved.count() === 0) test.skip(true, 'нет строки в резерве');

    await page.locator(`[data-testid="mark-${await fresh.getAttribute('data-id')}"]`).check();
    await page.locator(`[data-testid="mark-${await reserved.getAttribute('data-id')}"]`).check();

    // Сообщение и панель всплывают снизу одновременно: сообщение должно читаться поверх.
    const z = await page.evaluate(() => {
      const t = document.querySelector('.toast');
      const c = document.querySelector('.chain');
      const zOf = (e: Element | null) => (e ? Number(getComputedStyle(e).zIndex) || 0 : 0);
      return { toast: zOf(t), chain: zOf(c) };
    });
    expect(z.toast, 'сообщение не выше панели действий по z-index')
      .toBeGreaterThan(z.chain);
  });

  test('при «меньше движения» анимация выключена', async ({ browser }) => {
    // Настройка доступности: всплытие не должно быть обязательным.
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const row = page.locator('tr.line-row').first();
    await page.locator(`[data-testid="mark-${await row.getAttribute('data-id')}"]`).check();
    await page.waitForTimeout(200);

    const anim = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.chain')!).animationName);
    expect(anim, 'анимация осталась при настройке «меньше движения»').toBe('none');
    await context.close();
  });
});
