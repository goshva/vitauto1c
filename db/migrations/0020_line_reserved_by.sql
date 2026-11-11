-- +goose Up
-- ФТ п. 10: «Снять резерв» активна только для того пользователя, который резерв поставил (D-03).
-- Кто зарезервировал строку — arm.line.reserved_by_id; ставится при переходе «В резерв»
-- (POST /lines/transition to=reserve и POST /lines/reserve-available), снимается при снятии резерва.
alter table arm.line add column if not exists reserved_by_id uuid;
comment on column arm.line.reserved_by_id is 'Кто поставил строку в резерв (ФТ п. 10: снять резерв может только автор)';

-- +goose Down
alter table arm.line drop column if exists reserved_by_id;
