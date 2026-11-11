-- +goose Up
-- Миграция 0016: у зон склада появляется version — как у остальных справочников (ref.*).
-- Общий CRUD справочников (backend/internal/arm/directories.go) увеличивает version
-- при изменении строки: оптимистическая блокировка и события WS (план, раздел 11).
alter table ref.warehouse_zone add column if not exists version bigint not null default 1;
comment on column ref.warehouse_zone.version is 'версия строки: оптимистическая блокировка, события WS (план, раздел 11)';

-- +goose Down
alter table ref.warehouse_zone drop column if exists version;
