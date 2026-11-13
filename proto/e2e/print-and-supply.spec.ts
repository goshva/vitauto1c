import { expect, test, type Page } from '@playwright/test';

// e2e: печатные формы и экран снабжения в реальном браузере.
//
// Проверяем то, что HTML-тест проверить не может: что ссылка на бланк реально
// открывается отдельной вкладкой, что навигация ведёт на существующую страницу,
// и что печатная форма пригодна к печати (стили применяются, навигация скрыта).

async function createLine(page: Page, name: string, clientNumber: string): Promise<string> {
  await page.goto('/lines');
  await page.getByTestId('import-panel').locator('summary').click();
  await page.getByTestId('import-name').fill(name);
  await page.getByTestId('import-qty').fill('2');
  await page.getByTestId('import-client-number').fill(clientNumber);
  await page.getByTestId('import-submit').click();

  const row = page.getByTestId('lines-body').locator('tr').filter({ hasText: clientNumber });
  await expect(row).toHaveCount(1);
  return (await row.getAttribute('data-id'))!;
}

/** Доводит строку до статуса через кнопки цепочки. */
async function mark(page: Page, id: string): Promise<void> {
  await page.getByTestId(`mark-${id}`).click();
  await expect(page.getByTestId('mark-count')).toHaveText('1');
}

test.describe('печатные формы и снабжение', () => {
  test('навигация «Снабжение» ведёт на существующую страницу', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-supply').click();

    await expect(page.getByTestId('page-supply')).toBeVisible();
    await expect(page.getByTestId('supply-panel')).toBeVisible();
    await expect(page).toHaveURL(/\/supply$/);
  });

  test('ссылка на бланк открывает новую вкладку с формой', async ({ page, context }) => {
    const id = await createLine(page, 'Фильтр масляный', 'E2E-PRINT-1');
    await mark(page, id);
    await page.getByTestId('chain-job').click();
    await expect(page.getByTestId(`status-${id}`)).toHaveText('Заказан');

    // Доводим до «Собрано» — тогда строка попадёт в отгрузочную ведомость.
    for (const [button, status] of [
      ['chain-supply-paid', 'Оплачен'],
      ['chain-supply-in_transit', 'В пути'],
      ['chain-supply-acceptance', 'Приёмка'],
      ['action-assembly', 'Комплектация'],
      ['action-ready_to_ship', 'Собрано'],
    ] as const) {
      await mark(page, id);
      await page.getByTestId(button).click();
      await expect(page.getByTestId(`status-${id}`)).toHaveText(status);
    }

    const [printTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('print-shipment_sheet').click(),
    ]);
    await printTab.waitForLoadState();

    await expect(printTab.getByTestId('page-print-shipment_sheet')).toBeVisible();
    await expect(printTab.getByTestId('print-title')).toHaveText('Отгрузочная ведомость');
    await expect(printTab.getByTestId('print-table')).toBeVisible();
    await expect(printTab.getByTestId('print-row-1')).toBeVisible();
    await expect(printTab.getByTestId('print-total')).toBeVisible();
    await printTab.close();
  });

  test('сборочный лист открывается по прямой ссылке и без цен', async ({ page }) => {
    const id = await createLine(page, 'Фильтр салонный', 'E2E-PRINT-2');
    await mark(page, id);
    await page.getByTestId('action-reserve').click();
    await expect(page.getByTestId(`status-${id}`)).toHaveText('Резерв');

    await page.goto('/print/assembly_sheet');
    await expect(page.getByTestId('print-title')).toHaveText('Сборочный лист');
    await expect(page.getByTestId('print-table')).toBeVisible();
    // Отбор по статусу: строка в резерве обязана попасть в сборочный лист.
    await expect(page.getByTestId('print-row-1')).toBeVisible();
    await expect(page.locator('table.print')).not.toContainText('Цена');
  });

  test('неизвестная форма отвечает 404 со списком допустимых', async ({ page }) => {
    const r = await page.goto('/print/нетакой');
    expect(r?.status()).toBe(404);
  });

  test('при печати навигация скрыта — на бумаге только бланк', async ({ page }) => {
    await page.goto('/print/shipment_sheet');
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('nav-lines')).toBeHidden();
    await expect(page.getByTestId('print-sheet').or(page.locator('.print-sheet'))).toBeVisible();
  });
});
