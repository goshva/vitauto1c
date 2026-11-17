import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { pool } from './db.ts';
import { layout, esc } from './views/html.ts';
import { actorOf } from './auth.ts';
import { encodeSession, SESSION_COOKIE } from './session.ts';

// Вход и выход.
//
// Учётные записи заказчик задал сам: Administrator/admin123, Manager/manager123,
// Storagekeeper/store123, Mechanic/mechanic123. Логин — короткий (`store`, а не
// `storekeeper`), потому что его набирают руками каждый день.
//
// ДЕМОНСТРАЦИОННЫЙ ВХОД ОДНИМ НАЖАТИЕМ. Прототип показывают заказчику и проверяющему, и
// каждый раз набирать логин с паролем руками — потеря времени и повод ошибиться. Поэтому
// рядом с формой стоят кнопки по ролям: нажатие входит под этой ролью.
//
// ЭТО НЕ ОСЛАБЛЕНИЕ ЗАЩИТЫ: кнопка отправляет ТЕ ЖЕ логин и пароль в ту же форму, и
// проверка пароля остаётся на месте. Она лишь избавляет от набора — а в рабочем контуре
// её быть не должно, и это сказано на экране.

export const loginUi = new Hono();

/**
 * Демонстрационные учётные записи: логин, пароль и подпись роли.
 *
 * Список в одном месте, а не в разметке: по нему и рисуются кнопки, и проверяется вход.
 * Разойдись он с сидом — кнопка предлагала бы учётку, которой нет.
 */
const DEMO = [
  { login: 'manager', password: 'manager123', title: 'Менеджер', testId: 'demo-manager' },
  { login: 'store', password: 'store123', title: 'Кладовщик', testId: 'demo-store' },
  { login: 'mechanic', password: 'mechanic123', title: 'Механик', testId: 'demo-mechanic' },
  { login: 'admin', password: 'admin123', title: 'Администратор', testId: 'demo-admin' },
] as const;

/** Форма входа. `error` — причина, если вход не удался. */
function loginPage(error?: string): string {
  const buttons = DEMO.map((d) => `<form method="post" action="/login" class="demo-login">
      <input type="hidden" name="login" value="${esc(d.login)}">
      <input type="hidden" name="password" value="${esc(d.password)}">
      <button type="submit" data-testid="${esc(d.testId)}">
        ${esc(d.title)}<span class="demo-creds">${esc(d.login)} / ${esc(d.password)}</span>
      </button>
    </form>`).join('\n      ');

  return layout({
    title: 'Вход в АРМ',
    testId: 'page-login',
    body: `<div class="login-card">
      <h2>Вход в АРМ</h2>
      ${error ? `<p class="hint-partial" data-testid="login-error">${esc(error)}</p>` : ''}
      <form method="post" action="/login" data-testid="login-form">
        <label>Логин
          <input name="login" data-testid="login-name" autocomplete="username" required>
        </label>
        <label>Пароль
          <input name="password" type="password" data-testid="login-password"
                 autocomplete="current-password" required>
        </label>
        <button type="submit" data-testid="login-submit">Войти</button>
      </form>

      <div class="demo-logins" data-testid="demo-logins">
        <p class="hint">Демонстрационный вход — одним нажатием:</p>
        ${buttons}
        <p class="hint" data-testid="demo-note">Кнопки отправляют те же логин и пароль, что
          и форма: проверка пароля остаётся. В рабочем контуре их быть не должно.</p>
      </div>
    </div>`,
  });
}

// --- GET /login ----------------------------------------------------------------------
loginUi.get('/login', (c) => c.html(loginPage()));

// --- POST /login ---------------------------------------------------------------------
loginUi.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const login = String(form.login ?? '').trim();
  const password = String(form.password ?? '');

  const r = await pool.query<{ id: string; role: string; password_hash: string }>(
    `select id, role, password_hash from app_user
      where lower(login) = lower($1) and active and deleted_at is null`,
    [login],
  );

  // Одна причина на оба случая — «неверный логин или пароль». Разные сообщения
  // подсказали бы, какие логины существуют.
  const wrong = 'Неверный логин или пароль.';
  const user = r.rows[0];
  if (!user) return c.html(loginPage(wrong), 401);

  const ok = await Bun.password.verify(password, user.password_hash);
  if (!ok) return c.html(loginPage(wrong), 401);

  setCookie(c, SESSION_COOKIE, encodeSession({ userId: user.id, role: user.role }), {
    httpOnly: true,           // из скрипта куку не прочесть: XSS не украдёт сессию
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,     // смена: дольше не нужно, и это ограничивает ущерб
  });

  return c.redirect('/lines');
});

// --- GET /api/whoami — кто вошёл -------------------------------------------------------
//
// Отвечает ИМЕНЕМ И РОЛЬЮ, а не «да/нет»: проверяющему и тесту нужно знать, ПОД КЕМ он
// вошёл, а не только что вход состоялся. Кнопка с перепутанным логином выглядит исправной
// и молча вводит не туда — а роль определяет права и закрытые колонки.
//
// Без входа отвечает 401, а не пустым объектом: «никто не вошёл» и «вошёл некто без роли» —
// разные состояния, и путать их нельзя.
loginUi.get('/api/whoami', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, fullName: user.fullName, role: user.role }, 200);
});

// --- POST /logout --------------------------------------------------------------------
loginUi.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login');
});

/** Кто вошёл — для верхней панели. */
export async function currentUser(c: Parameters<typeof actorOf>[0]): Promise<{
  fullName: string; role: string;
} | null> {
  const { userId } = actorOf(c);
  if (!userId) return null;

  const r = await pool.query<{ full_name: string; role: string }>(
    `select full_name, role from app_user where id = $1 and active and deleted_at is null`,
    [userId],
  );
  return r.rows[0] ? { fullName: r.rows[0].full_name, role: r.rows[0].role } : null;
}
