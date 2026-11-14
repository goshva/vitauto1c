import { writeFileSync } from 'node:fs';

// Учётные записи в сид: логины и ХЕШИ паролей.
//
// Хеши считает Bun (`Bun.password`), а не сид-файл: в SQL-шаблоне их не записать —
// они зависят от соли. Поэтому сид учёток — отдельный шаг, а не строка в `refs.sql`.
//
// Пароли здесь ДЕМОНСТРАЦИОННЫЕ и совпадают с тем, что заказчик назвал сам. Хеш
// всё равно обязателен: привычка «хранить пароль как есть» переносится в продакшн
// вместе с кодом.

const ACCOUNTS = [
  { login: 'admin', password: 'admin123', fullName: 'Администратор', role: 'admin' },
  { login: 'manager', password: 'manager123', fullName: 'Менеджер', role: 'manager' },
  { login: 'store', password: 'store123', fullName: 'Кладовщик', role: 'storekeeper' },
  { login: 'mechanic', password: 'mechanic123', fullName: 'Механик', role: 'mechanic' },
];

// Идентификаторы фиксированы: на них ссылаются тесты и документы.
const IDS: Record<string, string> = {
  admin: '11111111-aaaa-1111-1111-111111111101',
  manager: '11111111-aaaa-1111-1111-111111111102',
  store: '11111111-aaaa-1111-1111-111111111103',
  mechanic: '11111111-aaaa-1111-1111-111111111104',
};

const lines: string[] = [];
for (const a of ACCOUNTS) {
  const hash = await Bun.password.hash(a.password, { algorithm: 'bcrypt', cost: 10 });
  lines.push(
    `  ('${IDS[a.login]}', '${a.login}', '${hash}', '${a.fullName}', '${a.role}')`,
  );
  console.log(`  ${a.login} / ${a.password} — ${a.role}`);
}

const file = 'db/seed/templates/users.sql';
writeFileSync(file, `-- Учётные записи АРМ. Файл СГЕНЕРИРОВАН (scripts/gen-users.ts):
-- хеши паролей зависят от соли и в шаблоне их не записать.
--
-- Пароли демонстрационные и совпадают с тем, что назвал заказчик. Хеш обязателен
-- всё равно: привычка хранить пароль как есть переносится в продакшн вместе с кодом.
--
-- Перегенерация: \`bun run scripts/gen-users.ts\`. Пароли не меняются, хеши — да:
-- у bcrypt своя соль на каждый запуск, и это правильно.
insert into app_user (id, login, password_hash, full_name, role) values
${lines.join(',\n')}
on conflict (id) do update set login = excluded.login,
  password_hash = excluded.password_hash, full_name = excluded.full_name,
  role = excluded.role, active = true, deleted_at = null;
`, 'utf8');
console.log('записано:', file);
