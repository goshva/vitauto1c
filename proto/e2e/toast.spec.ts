import { expect, test } from '@playwright/test';

// ПАНЕЛЬ ДЕЙСТВИЙ И ВСПЛЫВАЮЩЕЕ СООБЩЕНИЕ.
//
// ТРЕБОВАНИЕ МЕНЯЛОСЬ ДВАЖДЫ, И ЗАМЕРЫ ЭТО ПОКАЗАЛИ.
//
// Сначала панель была `position: sticky` — то есть ОСТАВАЛАСЬ В ПОТОКЕ снизу. На коротком
// списке это дёргало полосу прокрутки: пока панель видна, высота страницы больше, и полоса
// появлялась или исчезала. Я перевёл её в `fixed` — и замер показал, что прыжок давали ТРИ
// элемента: панель действий, панель шагов и ряд кнопок. Все три переехали в один контейнер,
// и высота страницы перестала меняться вовсе.
//
// Затем заказчик решил иначе: панель должна стоять ВВЕРХУ, НАД отбором — там её законное
// место, потому что кнопки действуют на отмеченные строки. Закрепление снято, и прежнее
// утверждение «страница не двигается» стало неверным. Проверяется теперь ПОРЯДОК: панель
// выше строки отбора.
//
// Сообщение о частичной доступности остаётся ВСПЛЫВАЮЩИМ: оно появляется и исчезает при
// каждой отметке, и в потоке двигало бы строки при каждом появлении.

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

  test('ПАНЕЛЬ ДЕЙСТВИЙ СТОИТ НАД СТРОКОЙ ОТБОРА', async ({ page }) => {
    // ТРЕБОВАНИЕ ИЗМЕНИЛОСЬ, И ТЕСТ — ВМЕСТЕ С НИМ.
    //
    // Сначала панель закрепили снизу и вывели из потока: это убирало прыжок полосы
    // прокрутки, но закрывало нижнюю часть таблицы. Заказчик решил иначе — панель должна
    // стоять ВВЕРХУ, НАД отбором. Это её законное место: кнопки действуют на отмеченные
    // строки, а отбор — над списком.
    //
    // Поэтому прежнее утверждение («страница не двигается») стало НЕВЕРНЫМ: наверху панель
    // В ПОТОКЕ. Проверяем то, что теперь требуется: ПОРЯДОК на странице.
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const row = page.locator('tr.line-row').first();
    const id = await row.getAttribute('data-id');
    await page.locator(`[data-testid="mark-${id}"]`).check();
    await expect(page.locator('[data-testid="actions-panel"]')).toBeVisible();
    await page.waitForTimeout(250);

    // Панель ВЫШЕ строки отбора — по положению на экране, а не по порядку в разметке:
    // порядок в разметке можно переставить стилями, и проверка стала бы ничего не значить.
    const panel = await page.locator('[data-testid="actions-panel"]').boundingBox();
    const filters = await page.locator('[data-testid="filters-panel"]').boundingBox();
    expect(panel, 'панель действий не найдена').toBeTruthy();
    expect(filters, 'панель отбора не найдена').toBeTruthy();
    expect(panel!.y + panel!.height, 'панель действий НЕ ВЫШЕ строки отбора')
      .toBeLessThanOrEqual(filters!.y + 1);
  });

  test('панель по содержимому, а не на весь экран', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const row = page.locator('tr.line-row').first();
    await page.locator(`[data-testid="mark-${await row.getAttribute('data-id')}"]`).check();
    await page.waitForTimeout(250);

    // Берём КОНТЕЙНЕР, а не `.chain`: этот класс носят две панели, и поиск по нему дал бы
    // два совпадения — на этом тест и споткнулся в первый раз.
    const box = await page.locator('.floating-bottom').boundingBox();
    const view = page.viewportSize()!;
    expect(box, 'панель действий не найдена').toBeTruthy();
    // ШИРИНА ПО СОДЕРЖИМОМУ: растянуть на весь экран значило бы закрыть таблицу, ради
    // которой панель и появляется.
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
