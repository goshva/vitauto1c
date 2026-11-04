-- +goose Up
-- Миграция 0009: запрос доступа (M13 → A3). Пользователь запрашивает действие вне своей матрицы;
-- администратор одобряет — команда выполняется от его имени и пишется в журнал (AccessRequest, node-map.json).

create table auth.access_request (
  id              uuid primary key default uuidv7(),
  onec_key        text not null unique default 'app:' || gen_random_uuid()::text,
  version         bigint not null default 1,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  requester_id    uuid not null references auth."user" (id),
  requester_role  text not null,                    -- роль на момент запроса
  action          text not null,                    -- запрашиваемое действие (transition:shipped, field:costPrice …)
  line_id         uuid references arm.line (id),
  payload         jsonb not null default '{}',      -- аргументы команды для повторения администратором
  reason          text,                             -- обоснование
  status          text not null default 'new' check (status in ('new', 'approved', 'denied')),
  decided_by_id   uuid references auth."user" (id), -- администратор
  decided_at      timestamptz,
  decision_note   text,
  executed_at     timestamptz                       -- когда исходная команда выполнена от имени администратора
);
create index access_request_open on auth.access_request (status, created_at) where status = 'new';
comment on table auth.access_request is 'Запрос доступа M13 → A3: одобряет только администратор, выполнение от его имени';

-- Уведомления администратору о новых запросах + NOTIFY для WebSocket (план, раздел 11)
-- +goose StatementBegin
create function auth.access_request_notice() returns trigger language plpgsql as $$
declare
  v_id     uuid := uuidv7();
  v_author uuid := new.requester_id;
  v_text   text;
begin
  if new.status <> 'new' or pg_trigger_depth() > 1 then
    return new;
  end if;
  select btrim(coalesce(u.name, '')) || ': ' || new.action
         || case when coalesce(new.reason, '') = '' then '' else ' — ' || btrim(new.reason) end
    into v_text
    from auth."user" u where u.id = new.requester_id;
  -- событие в WS отдаёт триггер arm.notice_notify на вставке уведомления
  insert into arm.notice (id, onec_record_id, created_at, node, kind, recipient_role, text, author_id, is_read, onec_key)
  values (v_id, v_id::text, localtimestamp, 'A3', 'Запрос доступа', 'admin',
          left('Запрос доступа: ' || coalesce(v_text, new.action), 1000), v_author, false, 'app:' || v_id);
  return new;
end $$;
-- +goose StatementEnd

create trigger access_request_notice after insert on auth.access_request
  for each row execute function auth.access_request_notice();

-- +goose Down
drop trigger if exists access_request_notice on auth.access_request;
drop function if exists auth.access_request_notice();
drop index if exists auth.access_request_open;
drop table if exists auth.access_request;
