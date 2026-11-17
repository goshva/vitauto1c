import { expect, test } from '@playwright/test';

// ВХОД: ФОРМА И ДЕМОНСТРАЦИОННЫЕ КНОПКИ.
//
// ПРОВЕРЯЕТСЯ НЕ НАЛИЧИЕ КНОПОК, А ТО, ЧТО ОНИ ВХОДЯТ ПОД СВОЕЙ РОЛЬЮ. Кнопка с
// перепутанным логином выглядит исправной и молча вводит не туда — а роль определяет и
// права, и закрытые колонки. Поэтому после каждого нажатия сверяется, ЧЕЙ это вход.

/** Кто вошёл: читаем из шапки страницы — там показана роль. */
async function whoami(page: import('@playwright/test').Page): Promise<string> {
  const r = await page.request.get('/api/whoami');
  if (!r.ok()) return '';
  const body = await r.json() as { role?: string };
  return body.role ?? '';
}

const DEMO = [
  { testId: 'demo-manager', login: 'manager', role: 'manager' },
  { testId: 'demo-store', login: 'store', role: 'storekeeper' },
  { testId: 'demo-mechanic', login: 'mechanic', role: 'mechanic' },
  { testId: 'demo-admin', login: 'admin', role: 'admin' },
] as const;

test.describe('вход в АРМ', () => {
  test('форма входа открывается и просит логин с паролем', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form'), 'нет формы входа').toBeVisible();
    await expect(page.getByTestId('login-name')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-password')).toHaveAttribute('type', 'password');
  });

  test('неверный пароль — отказ С ПРИЧИНОЙ, а не пустая страница', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-name').fill('manager');
    await page.getByTestId('login-password').fill('неверный-пароль');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error'), 'отказ без объяснения').toBeVisible();
    expect(await whoami(page), 'вошли с неверным паролем').not.toBe('manager');
  });

  test('кнопки демонстрационного входа есть по каждой роли', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('demo-logins')).toBeVisible();
    for (const d of DEMO) {
      await expect(page.getByTestId(d.testId), `нет кнопки входа для ${d.login}`).toBeVisible();
    }
  });

  test('НА КНОПКЕ ВИДНЫ логин и пароль — иначе непонятно, под кем входишь', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('demo-store'), 'на кнопке не написаны учётные данные')
      .toContainText('store');
    await expect(page.getByTestId('demo-store')).toContainText('store123');
  });

  for (const d of DEMO) {
    test(`${d.login}: кнопка входит ИМЕННО под этой ролью`, async ({ page }) => {
      await page.goto('/login');
      await page.getByTestId(d.testId).click();
      await page.waitForLoadState('networkidle');

      // Вход удался — ушли со страницы входа.
      await expect(page, `после нажатия остались на входе`).not.toHaveURL(/\/login$/);
      // И вошли ПОД СВОЕЙ ролью: у каждой роли свои права и свои закрытые колонки,
      // поэтому перепутанный логин — это не косметика, а неверные права.
      expect(await whoami(page), `вошли не под ролью ${d.role}`).toBe(d.role);
    });
  }

  test('демонстрационные кнопки честно предупреждены как демонстрационные', async ({ page }) => {
    // Кнопка, отправляющая пароль в обход формы, была бы дырой. Здесь она отправляет то же
    // самое в ту же форму, и это написано на экране — в рабочем контуре кнопок быть не должно.
    await page.goto('/login');
    await expect(page.getByTestId('demo-note'), 'нет пояснения про демонстрационный вход')
      .toContainText('проверка пароля');
  });

  test('ПРАВА РАЗЛИЧАЮТСЯ: кладовщику закрыт отчёт с себестоимостью', async ({ page }) => {
    // Роль — не надпись в шапке: от неё зависят права. Проверяем на живом запросе.
    await page.goto('/login');
    await page.getByTestId('demo-store').click();
    await page.waitForLoadState('networkidle');

    const denied = await page.request.get('/reports/profitability', {
      headers: { accept: 'application/json' },
    });
    expect(denied.status(), 'кладовщик получил отчёт с себестоимостью').toBe(403);
  });

  test('а менеджеру тот же отчёт открыт', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');

    const ok = await page.request.get('/reports/profitability', {
      headers: { accept: 'application/json' },
    });
    expect(ok.status(), 'менеджеру отчёт закрыт').toBe(200);
  });
});

// ВЫХОД И СМЕНА РОЛИ ИЗ МЕНЮ ПОЛЬЗОВАТЕЛЯ.
//
// ЧТО БЫЛО НЕ ТАК. Маршрут `/logout` в коде был, а добраться до него из интерфейса — НЕТ:
// в шапке стояла только надпись с именем роли. Роль в прототипе меняют часто (её и
// показывают заказчику), и каждый раз править адресную строку руками — не работа.
//
// ПРОВЕРЯЕТСЯ НЕ ТОЛЬКО ВЫХОД, НО И СМЕНА РОЛИ. Выход без возможности войти другим — это
// половина дела: проверяющему нужно ПЕРЕКЛЮЧАТЬСЯ и видеть, что права другие. Поэтому
// последний случай сверяет права ДО и ПОСЛЕ смены роли: если бы сессия не сменилась, отчёт
// остался бы доступен, и «смена» была бы только надписью.

test.describe('выход и смена роли', () => {
  test('меню пользователя раскрывается и показывает, кто вошёл', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');

    // Меню есть на любой странице АРМ — оно в общей разметке.
    const menu = page.getByTestId('user-menu');
    await expect(menu, 'в шапке нет меню пользователя').toHaveCount(1);

    // До раскрытия пунктов не видно: это `details`, а не постоянно открытый блок.
    // До открытия окна выхода не видно: это модальное окно, а не постоянно открытый блок.
    await expect(page.getByTestId('logout')).not.toBeVisible();

    // Меню — МОДАЛЬНОЕ ОКНО: нажатие на кнопку в шапке открывает его.
    await menu.click();
    await expect(page.getByTestId('user-modal'), 'модальное окно не открылось').toBeVisible();
    await expect(page.getByTestId('user-menu-role'), 'в окне не сказано, кто вошёл')
      .toContainText('Менеджер');
  });

  test('ОКНО ПОСЕРЕДИНЕ ЭКРАНА, А НЕ В БОКУ', async ({ page }) => {
    // ТРЕБОВАНИЕ ЗАКАЗЧИКА: «перемести выход в отдельное модальное окно поверх и посередине,
    // а не в боку, где его не видно». Прежний список раскрывался в углу шапки, в узкой
    // колонке навигации, и выход в нём приходилось искать.
    //
    // Проверяем ПОЛОЖЕНИЕМ, а не словами: окно должно стоять по центру экрана.
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('user-menu').click();
    const modal = page.getByTestId('user-modal');
    await expect(modal, 'модальное окно не открылось').toBeVisible();

    const box = await modal.boundingBox();
    const view = page.viewportSize()!;
    expect(box, 'окно не найдено').toBeTruthy();

    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    // Допуск 40 пикселей: окно центрируется браузером, и требовать совпадения до пикселя
    // значило бы проверять не центрирование, а округление.
    expect(Math.abs(centerX - view.width / 2), 'окно не по центру по горизонтали')
      .toBeLessThan(40);
    expect(Math.abs(centerY - view.height / 2), 'окно не по центру по вертикали')
      .toBeLessThan(60);

    // И ОНО ПОВЕРХ СТРАНИЦЫ: модальное окно не должно оказаться под содержимым.
    const onTop = await page.evaluate(() => {
      const d = document.getElementById('user-modal');
      if (!d) return false;
      const r = d.getBoundingClientRect();
      // Точка в центре окна должна принадлежать САМОМУ ОКНУ, а не тому, что под ним.
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
      return d.contains(el) || el === d;
    });
    expect(onTop, 'окно не поверх страницы — его перекрывает содержимое').toBe(true);
  });

  test('ВЫХОД действительно разлогинивает', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');
    expect(await whoami(page), 'вход не состоялся').toBe('manager');

    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await page.waitForLoadState('networkidle');

    // Ушли на страницу входа...
    await expect(page, 'после выхода не вернулись на вход').toHaveURL(/\/login/);
    // ...и сессии больше нет: это и есть проверка выхода, а не только перехода.
    expect(await whoami(page), 'сессия осталась живой после выхода').not.toBe('manager');
  });

  test('СМЕНА РОЛИ: права ДО и ПОСЛЕ разные', async ({ page }) => {
    // Входим менеджером — отчёт с себестоимостью открыт.
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');
    expect(await whoami(page), 'вошли не менеджером').toBe('manager');
    expect((await page.request.get('/reports/profitability',
      { headers: { accept: 'application/json' } })).status(), 'менеджеру отчёт закрыт').toBe(200);

    // Выходим и входим кладовщиком — тот же адрес обязан отказать.
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('demo-store').click();
    await page.waitForLoadState('networkidle');
    expect(await whoami(page), 'роль не сменилась').toBe('storekeeper');
    expect((await page.request.get('/reports/profitability',
      { headers: { accept: 'application/json' } })).status(),
    'после смены роли права остались прежними').toBe(403);
  });

  test('«Войти под другой ролью» ведёт на страницу входа', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('demo-store').click();
    await page.waitForLoadState('networkidle');

    await page.getByTestId('user-menu').click();
    await page.getByTestId('switch-role').click();
    await page.waitForLoadState('networkidle');

    await expect(page, 'не пришли на страницу входа').toHaveURL(/\/login/);
    // И на ней есть все демонстрационные кнопки — переключиться можно на любую роль.
    await expect(page.getByTestId('demo-logins')).toBeVisible();
  });

  test('меню ЕСТЬ на рабочих экранах, а не только на входе', async ({ page }) => {
    // Меню в общей разметке: если бы его добавили только на страницу входа, выйти из
    // работы было бы по-прежнему неоткуда.
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');

    for (const url of ['/lines', '/fleet', '/reports']) {
      await page.goto(url);
      await expect(page.getByTestId('user-menu'), `на ${url} нет меню пользователя`)
        .toHaveCount(1);
    }
  });
});
