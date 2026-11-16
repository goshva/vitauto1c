import { expect, test } from '@playwright/test';

// НАЛИЧИЕ ПЕЧАТНЫХ ФОРМ И ФУНКЦИИ ПЕЧАТИ.
//
// Проверка идёт ПО ТРЁМ ФОРМАМ ИЗ ЗАДАНИЯ: сборочный лист, отгрузочная ведомость,
// корректировка ведомости. Для каждой — три вопроса:
//
//   1. форма ОТКРЫВАЕТСЯ по прямой ссылке (её печатают и отправляют ссылкой);
//   2. у неё ЕСТЬ название — то, что видно на бумаге;
//   3. кнопка «Печать» ДЕЙСТВИТЕЛЬНО вызывает печать.
//
// ТРЕТИЙ ПУНКТ ПРОВЕРЯЕТСЯ ПОДМЕНОЙ `window.print`. «Кнопка есть» и «кнопка работает» —
// разные утверждения, и проверить второе можно только так: щёлкнуть и увидеть вызов.
// Иначе кнопка с опечаткой в `onclick` пройдёт любую проверку разметки.

const FORMS = [
  { kind: 'assembly_sheet', title: 'Сборочный лист', node: 'K3' },
  { kind: 'shipment_sheet', title: 'Отгрузочная ведомость', node: 'M12' },
  { kind: 'shipment_correction', title: 'Корректировка отгрузочной ведомости', node: 'M19' },
] as const;

/** Подменить печать счётчиком: настоящий диалог в тесте открывать нельзя. */
async function stubPrint(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
}

const printedCount = (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __printed: number }).__printed ?? 0);

test.describe('печатные формы и функция печати', () => {
  for (const form of FORMS) {
    test(`${form.title}: открывается, назван и печатается`, async ({ page }) => {
      await stubPrint(page);
      const response = await page.goto(`/print/${form.kind}`);

      // 1. ФОРМА ОТКРЫВАЕТСЯ ПО ПРЯМОЙ ССЫЛКЕ.
      expect(response?.status(), 'форма не открылась по прямой ссылке').toBe(200);

      // 2. НАЗВАНИЕ ЕСТЬ — это то, что видно на бумаге.
      await expect(page.getByTestId('print-title'), 'название формы не совпало')
        .toHaveText(form.title);
      // И УЗЕЛ назван: по нему форма привязана к карте процессов.
      await expect(page.locator('.print-head'), 'на форме не назван узел')
        .toContainText(form.node);

      // 3. КНОПКА ПЕЧАТИ ЕСТЬ И РАБОТАЕТ.
      const print = page.getByTestId('print-go');
      await expect(print, 'нет кнопки печати').toBeVisible();

      expect(await printedCount(page), 'печать вызвана до нажатия').toBe(0);
      await print.click();
      expect(await printedCount(page), 'нажатие на «Печать» не вызвало печать').toBe(1);
    });
  }

  test('КНОПКИ СЛУЖЕБНЫЕ: на бумагу не идут', async ({ page }) => {
    // Кнопка печати, попавшая на бумагу, — брак бланка: она печатается поверх таблицы.
    for (const form of FORMS) {
      await page.goto(`/print/${form.kind}`);
      const hidden = await page.evaluate(() => {
        const el = document.querySelector('.print-actions');
        if (!el) return null;
        // Проверяем ПРАВИЛО печати, а не текущую видимость: на экране кнопки нужны.
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList;
          try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSMediaRule && rule.conditionText.includes('print')) {
              for (const inner of Array.from(rule.cssRules)) {
                if (inner instanceof CSSStyleRule && inner.selectorText.includes('no-print')) {
                  return inner.style.display;
                }
              }
            }
          }
        }
        return null;
      });
      expect(hidden, `на форме ${form.kind} кнопки не скрыты от печати`).toBe('none');
      await expect(page.locator('.print-actions')).toHaveClass(/no-print/);
    }
  });

  test('бланк печатается и БЕЗ строк, с объяснением', async ({ page }) => {
    // Форма без подходящих строк — не ошибка: так выглядит месяц без отгрузок.
    await page.goto('/print/shipment_correction');
    const empty = page.getByTestId('print-empty');
    const table = page.getByTestId('print-table');
    // Одно из двух обязано быть: либо таблица, либо объяснение. Пустоты быть не должно.
    const hasEmpty = await empty.count() > 0;
    const hasTable = await table.count() > 0;
    expect(hasEmpty || hasTable, 'форма пуста: ни таблицы, ни объяснения').toBe(true);
  });

  test('формы ремонта тоже печатаются', async ({ page }) => {
    // Заказ-наряд и акт — из той же семьи, у них своя оболочка.
    for (const url of ['/print/work_order', '/print/work_act']) {
      await page.goto(url);
      // Без заказ-наряда форма обязана отказать ПОНЯТНО, а не отдать пустой бланк.
      const body = await page.textContent('body');
      const ok = (body ?? '').includes('заказ-наряд') || (body ?? '').includes('Заказ-наряд');
      expect(ok, `форма ${url} ответила невнятно`).toBe(true);
    }
  });

  test('ссылки на все три формы есть в АРМ', async ({ page }) => {
    await page.goto('/lines');
    await page.waitForSelector('[data-testid="lines-table"]');
    for (const form of FORMS) {
      await expect(page.getByTestId(`print-${form.kind}`),
        `в АРМ нет ссылки на «${form.title}»`).toHaveCount(1);
    }
  });
});
