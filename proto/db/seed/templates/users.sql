-- Учётные записи АРМ. Файл СГЕНЕРИРОВАН (scripts/gen-users.ts):
-- хеши паролей зависят от соли и в шаблоне их не записать.
--
-- Пароли демонстрационные и совпадают с тем, что назвал заказчик. Хеш обязателен
-- всё равно: привычка хранить пароль как есть переносится в продакшн вместе с кодом.
--
-- Перегенерация: `bun run scripts/gen-users.ts`. Пароли не меняются, хеши — да:
-- у bcrypt своя соль на каждый запуск, и это правильно.
insert into app_user (id, login, password_hash, full_name, role) values
  ('11111111-aaaa-1111-1111-111111111101', 'admin', '$2b$10$0HVgEI1Y.xCVNDm/zTj6.OOIc1Rd7kKZNJAWHBd7kwFgqquvKSrUC', 'Администратор', 'admin'),
  ('11111111-aaaa-1111-1111-111111111102', 'manager', '$2b$10$TgU1V7zTPBaNKzUcq9BvWuO28Ta4EqyQ/z0qF5/MEAybwgsHPFa5e', 'Менеджер', 'manager'),
  ('11111111-aaaa-1111-1111-111111111103', 'store', '$2b$10$P8cIUMGkhjpSfxkENt0VTOoIy9Nck8XbCwNxkCn2.w.VjUTmC8aOa', 'Кладовщик', 'storekeeper'),
  ('11111111-aaaa-1111-1111-111111111104', 'mechanic', '$2b$10$DNB9r9ROXzisn4Pj5qDBH./cdQEym0VGYirjSZ95tWcQIWevGBeWO', 'Механик', 'mechanic')
on conflict (id) do update set login = excluded.login,
  password_hash = excluded.password_hash, full_name = excluded.full_name,
  role = excluded.role, active = true, deleted_at = null;
