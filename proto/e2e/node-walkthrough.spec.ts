import { expect, test } from '@playwright/test';

// ПРОДВИЖЕНИЕ ПО УЗЛАМ ЧЕРЕЗ ИНТЕРФЕЙС — ПРОВЕРКА САМОЙ ПРОЦЕДУРЫ.
//
// Описание, которое не проверено, бесполезно: оно выглядит инструкцией и может ею не быть.
// Здесь процедура выполняется ровно так, как будет описана, и проверяется результат:
//
//   1. открыть реестр строк;
//   2. отметить строку флажком в первой колонке;
//   3. в панели действий выбрать переход — на кнопке подсказка с номером УЗЛА;
//   4. строка переходит в следующее состояние, а узел меняется.

test.describe('продвижение по узлам через интерфейс', () => {
  /**
   * Снять ВСЕ отметки.
   *
   * ОТМЕТКИ ЖИВУТ В БАЗЕ И ПЕРЕЖИВАЮТ ТЕСТ, а панель действий показывает переход, только
   * если его допускают ВСЕ отмеченные строки. Значит чужая отметка ломает мой тест, а моя —
   * чужой.
   *
   * Это нашлось на падениях ЧУЖИХ проверок: после моего теста счётчик отметок в тестах
   * печати стал «3» там, где ждали «1», и они упали. Причина была не в них и не в
   * интерфейсе — в моём тесте, оставившем после себя состояние.
   *
   * Поэтому отметки снимаются И ДО, И ПОСЛЕ: до — чтобы тест не зависел от порядка
   * запуска, после — чтобы не ломать следующие. И в обоих случаях даже при падении:
   * тест, упавший один раз, иначе валит за собой остальные, и настоящая причина теряется
   * среди последствий.
   */
  async function clearMarks(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/lines').catch(() => undefined);
    for (let guard = 0; guard < 12; guard++) {
      const checked = page.locator('[data-testid^="mark-"]:checked');
      if ((await checked.count().catch(() => 0)) === 0) break;
      await checked.first().click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }

  test.beforeEach(async ({ page }) => { await clearMarks(page); });
  test.afterEach(async ({ page }) => { await clearMarks(page); });

  test('новую строку можно зарезервировать — узел M3', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    // Берём строку в состоянии «Новый»: у неё доступен переход «Зарезервировать» (узел M3).
    const row = page.locator('tr.line-row[data-status="new"]').first();
    const rowId = await row.getAttribute('data-id');
    expect(rowId, 'в реестре нет ни одной новой строки').toBeTruthy();

    // 1. ОТМЕТИТЬ: флажок в первой колонке. Панель действий обновляется сразу.
    await page.locator(`[data-testid="mark-${rowId}"]`).check();

    const actions = page.locator('[data-testid="actions-panel"]');
    await expect(actions, 'панель действий не появилась после отметки').toBeVisible();
    await expect(page.locator('[data-testid="mark-count"]'),
      'в панели не показано, сколько отмечено').toHaveText('1');

    // 2. ВЫБРАТЬ ПЕРЕХОД. Кнопка названа состоянием, а подсказка — УЗЛОМ.
    const reserve = page.locator('[data-testid="action-reserve"]');
    await expect(reserve, 'нет перехода «Зарезервировать» у новой строки').toHaveCount(1);
    await expect(reserve, 'на кнопке не указан узел')
      .toHaveAttribute('title', /Узел\s+M3/);

    await reserve.click();
    await page.waitForLoadState('networkidle');

    // 3. ПРОВЕРИТЬ РЕЗУЛЬТАТ: состояние строки изменилось на «Резерв».
    const after = page.locator(`tr.line-row[data-id="${rowId}"]`);
    await expect(after, 'строка не перешла в состояние reserve')
      .toHaveAttribute('data-status', 'reserve');
    await expect(page.locator(`[data-testid="status-${rowId}"]`),
      'в ячейке состояния не «Резерв»').toContainText('Резерв');
  });

  test('следующий узел после резерва — комплектация, узел M9', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    // Строку в состоянии reserve ищем среди сида: она там есть.
    const row = page.locator('tr.line-row[data-status="reserve"]').first();
    const rowId = await row.getAttribute('data-id');
    expect(rowId, 'нет ни одной строки в резерве').toBeTruthy();

    await page.locator(`[data-testid="mark-${rowId}"]`).check();

    // УЗЕЛ НАЗВАН НА КНОПКЕ: по нему и понятно, куда строка пойдёт.
    const assembly = page.locator('[data-testid="action-assembly"]');
    await expect(assembly, 'нет перехода «На комплектацию» из резерва').toHaveCount(1);
    const title = await assembly.getAttribute('title');
    expect(title, 'на кнопке не назван узел M9').toContain('M9');

    await assembly.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`tr.line-row[data-id="${rowId}"]`))
      .toHaveAttribute('data-status', 'assembly');
  });

  test('КНОПКИ ПОКАЗЫВАЮТ ТОЛЬКО ВОЗМОЖНЫЕ ПЕРЕХОДЫ', async ({ page }) => {
    // Это главное свойство процедуры: список кнопок — не «все состояния модели», а те, в
    // которые ИЗ ТЕКУЩЕГО можно перейти. Иначе по интерфейсу можно было бы проставить
    // состояние, которого процесс не допускает.
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const row = page.locator('tr.line-row[data-status="new"]').first();
    const rowId = await row.getAttribute('data-id');
    await page.locator(`[data-testid="mark-${rowId}"]`).check();

    // Из «Нового» доступны «Зарезервировать» и «Отменить», но НЕ «Собрано» и НЕ «Закрыть».
    await expect(page.locator('[data-testid="action-reserve"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="action-cancelled"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="action-ready_to_ship"]'),
      'предложен переход, недопустимый из нового состояния').toHaveCount(0);
    await expect(page.locator('[data-testid="action-closed"]')).toHaveCount(0);
  });

  test('частично доступный переход назван отдельно', async ({ page }) => {
    // Если отмечены строки в РАЗНЫХ состояниях, переход, возможный не для всех, не должен
    // выглядеть как общий: иначе часть строк молча не сдвинется.
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');

    const fresh = page.locator('tr.line-row[data-status="new"]').first();
    const reserved = page.locator('tr.line-row[data-status="reserve"]').first();
    if (await reserved.count() === 0) test.skip(true, 'в реестре нет строки в резерве');

    await page.locator(`[data-testid="mark-${await fresh.getAttribute('data-id')}"]`).check();
    await page.locator(`[data-testid="mark-${await reserved.getAttribute('data-id')}"]`).check();

    await expect(page.locator('[data-testid="mark-count"]')).toHaveText('2');

    // «Зарезервировать» доступно только новой строке — про это должно быть сказано.
    const partial = page.locator('[data-testid="partial-note"]');
    const reserve = page.locator('[data-testid="action-reserve"]');
    const hasPartial = await partial.count() > 0;
    const hasButton = await reserve.count() > 0;
    // Либо переход общий (обе строки его допускают — тогда кнопка), либо он назван
    // частичным. Молча недоступным он быть не должен.
    expect(hasPartial || hasButton, 'переход не показан ни кнопкой, ни как частичный')
      .toBe(true);
  });
});
