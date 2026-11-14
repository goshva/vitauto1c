import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { pool } from './db.ts';
import { layout, esc } from './views/html.ts';
import { actorOf } from './auth.ts';
import { encodeSession, SESSION_COOKIE } from './session.ts';

// Вход и выход.
//
// Учётные записи заказчик задал сам: Administrator/admin, Manager/manager,
// Storagekeeper/store, Mechanic/mechanic. Логин — короткий (`store`, а не
// `storekeeper`), потому что его набирают руками каждый день.

export const loginUi = new Hono();

/** Форма входа. `error` — причина, если вход не удался. */
function loginPage(error?: string): string {
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
      <p class="hint">Демонстрационные учётки: <strong>admin / admin123</strong>,
        <strong>manager / manager123</strong>, <strong>store / store123</strong>,
        <strong>mechanic / mechanic123</strong>.</p>
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
