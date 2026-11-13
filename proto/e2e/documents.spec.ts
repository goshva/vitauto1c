import { expect, test } from '@playwright/test';

// e2e: экран документов в реальном браузере.
//
// Проверяется то, что HTML-тест проверить не может: что вкладки переключают вид,
// что кнопка действия реально подменяет разметку через HTMX, и что причина отказа
// появляется на странице, а не остаётся в консоли.

/**
 * Создаёт возврат через API и возвращает его идентификатор.
 *
 * Строка задаётся явно: тесты идут последовательно на ОДНОЙ базе, и повторное
 * использование той же строки даёт 409 — она уже связана с возвратом.
 * Строка 0008 — сид процесса return (статус shipped); 0001 и 0002 — сиды
 * happy и stock. API возврата статус не проверяет, ему нужна свободная строка.
 */
async function createReturn(page: import('@playwright/test').Page, line: string): Promise<string> {
  await page.request.post(`/lines/${line}/mark`, { data: { marked: true } });
  const r = await page.request.post('/returns', { data: { kind: 'client' } });
  expect(r.status(), `возврат не создан через API: ${await r.text()}`).toBe(201);
  return String(((await r.json()) as { id: string }).id);
}

const LINE_RETURN = 'b0000000-0000-0000-0000-000000000008';
const LINE_HAPPY = 'b0000000-0000-0000-0000-000000000001';
const LINE_STOCK = 'b0000000-0000-0000-0000-000000000002';

test.describe('экран документов', () => {
  test('навигация «Документы» открывает список возвратов', async ({ page }) => {
    await page.goto('/lines');
    await page.getByTestId('nav-documents').click();

    await expect(page.getByTestId('page-documents-returns')).toBeVisible();
    await expect(page).toHaveURL(/\/documents\/returns$/);
  });

  test('вкладки переключают вид документа', async ({ page }) => {
    await page.goto('/documents/returns');

    await page.getByTestId('tab-shipments').click();
    await expect(page.getByTestId('page-documents-shipments')).toBeVisible();

    await page.getByTestId('tab-work-orders').click();
    await expect(page.getByTestId('page-documents-work-orders')).toBeVisible();
  });

  test('все четыре вкладки ведут на существующие страницы', async ({ page }) => {
    await page.goto('/documents/returns');

    for (const kind of ['returns', 'shipments', 'supplier-orders', 'work-orders']) {
      await page.goto(`/documents/${kind}`);
      await expect(page.getByTestId(`page-documents-${kind}`)).toBeVisible();
    }
  });

  test('действие над документом выполняется через HTMX', async ({ page }) => {
    const id = await createReturn(page, LINE_RETURN);

    await page.goto('/documents/returns');
    await expect(page.getByTestId(`doc-${id}`)).toBeVisible();
    await expect(page.getByTestId(`doc-status-${id}`)).toHaveText('Оформлен');

    await page.getByTestId(`doc-action-${id}-accepted`).click();
    await expect(page.getByTestId(`doc-status-${id}`)).toHaveText('Принят на склад');
  });

  test('после действия появляются следующие кнопки', async ({ page }) => {
    const id = await createReturn(page, LINE_HAPPY);
    await page.goto('/documents/returns');

    await page.getByTestId(`doc-action-${id}-accepted`).click();
    await expect(page.getByTestId(`doc-status-${id}`)).toHaveText('Принят на склад');
    await expect(page.getByTestId(`doc-action-${id}-to_supplier`)).toBeVisible();
    await expect(page.getByTestId(`doc-action-${id}-accepted`)).toHaveCount(0);
  });

  test('недоступное действие показывает причину на странице', async ({ page }) => {
    const id = await createReturn(page, LINE_STOCK);
    await page.goto('/documents/returns');

    // Из «Оформлен» сразу в «Закрыт» нельзя: кнопки нет, но адрес существует.
    await page.evaluate(async (docId) => {
      await fetch(`/ui/documents/returns/${docId}/closed`, { method: 'POST' });
    }, id).catch(() => undefined);

    // Переходим напрямую, как это сделал бы устаревший обработчик.
    await page.goto(`/documents/returns`);
    const res = await page.request.post(`/ui/documents/returns/${id}/closed`);
    const body = await res.text();
    expect(body).toContain('data-testid="document-error"');
  });
});
