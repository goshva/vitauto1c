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
    await expect(page.getByTestId('logout')).not.toBeVisible();

    await menu.locator('summary').click();
    await expect(page.getByTestId('user-menu-list'), 'меню не раскрылось').toBeVisible();
    await expect(page.getByTestId('user-menu-role'), 'в меню не сказано, кто вошёл')
      .toContainText('Менеджер');
  });

  test('ВЫХОД действительно разлогинивает', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('demo-manager').click();
    await page.waitForLoadState('networkidle');
    expect(await whoami(page), 'вход не состоялся').toBe('manager');

    await page.getByTestId('user-menu').locator('summary').click();
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
    await page.getByTestId('user-menu').locator('summary').click();
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

    await page.getByTestId('user-menu').locator('summary').click();
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
