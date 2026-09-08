-- Generaliza `posts_per_day` (entero, mínimo 1/día) a una tasa
-- `times_count` cada `period_days` días — permite "día por medio"
-- (1 cada 2) o "3 veces por semana" (3 cada 7), no solo diario.
-- El diario de siempre queda como el caso `times_count=N, period_days=1`.

alter table public.publishing_cadences add column times_count integer;
alter table public.publishing_cadences add column period_days integer;

update public.publishing_cadences
  set times_count = posts_per_day, period_days = 1
  where times_count is null;

alter table public.publishing_cadences
  alter column times_count set not null;
alter table public.publishing_cadences
  alter column period_days set not null;

alter table public.publishing_cadences
  add constraint publishing_cadences_times_count_check check (times_count > 0);
alter table public.publishing_cadences
  add constraint publishing_cadences_period_days_check check (period_days > 0);

alter table public.publishing_cadences drop column posts_per_day;
