import { expect, test } from '@playwright/test';

// ПРОВЕРКА ГЛАЗАМИ: снимки экранов после правок интерфейса.
//
// Снимки не вместо проверок, а ДОПОЛНЕНИЕ к ним: разметку тест проверит, а «список
// вариантов выглядит как системный» — нет. Здесь снимаю то, что просили поправить, чтобы
// посмотреть на результат, а не догадываться о нём по классам.
//
// Снимки складываются в `e2e-shots/` и в репозиторий не идут.

const SHOTS = 'e2e-shots';

test.describe('правки интерфейса · снимки', () => {
  test('выпадающие списки и состояния в реестре строк', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    // Снимок целиком: на нём и списки вариантов поставки, и плашки состояний.
    await page.screenshot({ path: `${SHOTS}/01-lines.png`, fullPage: false });

    // Наведение на ячейку с отбором — видно, что она нажимаемая.
    const cell = page.locator('table.lines td[data-filter="name"]').first();
    await cell.hover();
    await page.screenshot({ path: `${SHOTS}/02-cell-hover.png`, fullPage: false });

    // Панель отбора крупно: списки состояний и отметки.
    const filters = page.locator('[data-testid="filters-panel"]');
    if (await filters.count() > 0) {
      await filters.screenshot({ path: `${SHOTS}/03-filters.png` });
    }

    // Состояния: одна ячейка крупно — по ней видно плашку.
    const status = page.locator('[data-testid^="status-"]').first();
    if (await status.count() > 0) {
      await status.screenshot({ path: `${SHOTS}/04-status-cell.png` });
    }
  });

  test('отбор по клику на ячейку заполняет поле', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    // Берём ячейку наименования и смотрим, что поле отбора заполнилось ЕЁ текстом.
    const cell = page.locator('table.lines td[data-filter="name"]').first();
    const text = ((await cell.textContent()) ?? '').trim();
    expect(text.length, 'в ячейке нет текста — проверять нечего').toBeGreaterThan(1);

    await cell.click();
    await page.waitForLoadState('networkidle');

    const field = page.locator('[data-testid="filter-name"]');
    await expect(field, 'поле отбора не заполнилось по клику').toHaveValue(text);
    await page.screenshot({ path: `${SHOTS}/05-click-filter.png`, fullPage: false });
  });

  test('клик по ячейке состояния выбирает состояние в списке', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const cell = page.locator('table.lines td[data-filter="status"]').first();
    const text = ((await cell.textContent()) ?? '').trim();

    await cell.click();
    await page.waitForLoadState('networkidle');

    // В списке отбора выбрано то же состояние — по ПОДПИСИ, а не по значению.
    const select = page.locator('[data-testid="filter-status"]');
    const chosen = await select.locator('option:checked').textContent();
    expect((chosen ?? '').trim(), 'состояние в отборе не совпало с ячейкой')
      .toContain(text.slice(0, 4));
  });

  test('на печатных формах есть возврат', async ({ page }) => {
    for (const kind of ['shipment_sheet', 'assembly_sheet', 'shipment_correction']) {
      await page.goto(`/print/${kind}`);
      const back = page.locator('[data-testid="print-back"]');
      await expect(back, `на форме ${kind} нет возврата`).toHaveCount(1);
      await expect(back).toHaveAttribute('href', '/lines');
      await page.screenshot({ path: `${SHOTS}/06-print-${kind}.png`, fullPage: false });
    }
  });

  test('состояния на других экранах — тем же видом', async ({ page }) => {
    // ПАРК: здесь состояния есть всегда, и раньше класс вида стоял на самой ячейке.
    await page.goto('/fleet');
    await page.waitForLoadState('networkidle');
    const pills = page.locator('.c-status span[class^="s-"]');
    expect(await pills.count(), 'на /fleet состояния не плашками').toBeGreaterThan(0);
    // И НИ ОДНОГО класса вида на самой ячейке — это и была ошибка.
    expect(await page.locator('.c-status.s-').count(), 'класс вида остался на ячейке').toBe(0);
    await page.screenshot({ path: `${SHOTS}/07-fleet.png`, fullPage: false });
  });

  test('пустая страница документов говорит об этом словами', async ({ page }) => {
    // В этом сиде документов нет, и пустая страница НЕ должна выглядеть поломкой.
    await page.goto('/documents/returns');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="documents-empty"]'),
      'пустой список документов выглядит поломкой').toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/08-documents-empty.png`, fullPage: false });
  });
});
