import { expect, test, type Page } from '@playwright/test';

// e2e прототипа: цепочка happy в РЕАЛЬНОМ браузере.
//
// Отличие от `tests/integration/ui-chain.test.ts`: там проверяется HTML-ответ,
// здесь — поведение HTMX (подстановка фрагмента, событие после swap, реальный клик).
// Дефект «статика 404» такие тесты ловят сразу: страница откроется, но клики
// перестанут работать, потому что HTMX не загрузился.

/** Создаёт строку через форму загрузки листа. Возвращает её идентификатор. */
async function createLine(page: Page, name: string, clientNumber: string): Promise<string> {
  await page.goto('/lines');
  await page.getByTestId('import-panel').locator('summary').click();
  await page.getByTestId('import-name').fill(name);
  await page.getByTestId('import-qty').fill('1');
  await page.getByTestId('import-client-number').fill(clientNumber);
  await page.getByTestId('import-submit').click();

  const row = page.getByTestId('lines-body').locator('tr').filter({ hasText: clientNumber });
  await expect(row).toHaveCount(1);
  const id = await row.getAttribute('data-id');
  expect(id, 'строка без идентификатора').toBeTruthy();
  return id!;
}

/** Текст статуса строки на экране. */
function statusCell(page: Page, id: string) {
  return page.getByTestId(`status-${id}`);
}

/** Отмечает строку и ждёт, пока счётчик отметок станет равен одному. */
async function mark(page: Page, id: string): Promise<void> {
  await page.getByTestId(`mark-${id}`).click();
  await expect(page.getByTestId('mark-count')).toHaveText('1');
}

test.describe('АРМ: цепочка happy в браузере', () => {
  test('страница открывается и HTMX загружен', async ({ page }) => {
    await page.goto('/lines');
    await expect(page.getByTestId('page-lines')).toBeVisible();
    await expect(page.getByTestId('lines-table')).toBeVisible();

    // HTMX обязан быть загружен: без него клики ничего не делают, а страница
    // при этом выглядит полностью рабочей.
    const htmxLoaded = await page.evaluate(() => typeof (window as never as { htmx?: unknown }).htmx !== 'undefined');
    expect(htmxLoaded, 'HTMX не загрузился — статика не отдаётся').toBe(true);
  });

  test('загрузка листа создаёт строку в статусе «Новый»', async ({ page }) => {
    const id = await createLine(page, 'Фильтр масляный', 'E2E-1');
    await expect(statusCell(page, id)).toHaveText('Новый');
  });

  test('отметка строки показывает счётчик и кнопки', async ({ page }) => {
    const id = await createLine(page, 'Фильтр салонный', 'E2E-2');
    await mark(page, id);

    // Для статуса new доступен резерв и недоступна комплектация.
    await expect(page.getByTestId('action-reserve')).toBeVisible();
    await expect(page.getByTestId('action-assembly')).toHaveCount(0);
  });

  test('цепочка от «Новый» до «Закрыт» проходит целиком', async ({ page }) => {
    const id = await createLine(page, 'Колодки тормозные', 'E2E-3');

    const step = async (action: () => Promise<void>, expected: string) => {
      await mark(page, id);
      await action();
      await expect(statusCell(page, id)).toHaveText(expected);
      // После действия отметки снимаются — это поведение АРМ, а не дефект.
      await expect(page.getByTestId('mark-count')).toHaveText('0');
    };

    await step(() => page.getByTestId('chain-job').click(), 'Заказан');
    await step(() => page.getByTestId('chain-supply-paid').click(), 'Оплачен');
    await step(() => page.getByTestId('chain-supply-in_transit').click(), 'В пути');
    await step(() => page.getByTestId('chain-supply-acceptance').click(), 'Приёмка');
    await step(() => page.getByTestId('chain-cell').click(), 'Приёмка');
    await step(() => page.getByTestId('action-assembly').click(), 'Комплектация');
    await step(() => page.getByTestId('action-ready_to_ship').click(), 'Собрано');
    await step(() => page.getByTestId('action-closed').click(), 'Закрыт');
  });

  test('кнопка недопустимого перехода не появляется (C21 в браузере)', async ({ page }) => {
    const id = await createLine(page, 'Антифриз', 'E2E-4');

    await mark(page, id);
    await page.getByTestId('action-reserve').click();
    await expect(statusCell(page, id)).toHaveText('Резерв');

    // Отмечаем снова: набор кнопок обязан пересчитаться на сервере.
    await mark(page, id);
    await expect(page.getByTestId('action-reserve'), 'кнопка резерва не должна вернуться').toHaveCount(0);
    await expect(page.getByTestId('action-assembly')).toBeVisible();
  });

  test('браузер получает HTML, а fetch — JSON по тому же адресу', async ({ page }) => {
    await page.goto('/lines');
    await expect(page.getByTestId('lines-table')).toBeVisible();

    const api = await page.evaluate(async () => {
      const r = await fetch('/lines', { headers: { accept: 'application/json' } });
      return { status: r.status, type: r.headers.get('content-type') ?? '' };
    });
    expect(api.status).toBe(200);
    expect(api.type).toContain('application/json');
  });
});
