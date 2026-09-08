-- Generaliza `posts_per_day` (entero, mínimo 1/día) a una tasa
-- `times_count` cada `period_days` días — permite "día por medio"
-- (1 cada 2) o "3 veces por semana" (3 cada 7), no solo diario.
-- El diario de siempre queda como el caso `times_count=N, period_days=1`.

alter table public.publishing_cadences add column if not exists times_count integer;
alter table public.publishing_cadences add column if not exists period_days integer;

-- El backfill sólo toca filas sin times_count todavía — si `posts_per_day`
-- ya se dropeó en una corrida anterior, este UPDATE no tiene de dónde leer
-- así que se saltea solo (posts_per_day ya no existe → el `where` de abajo
-- no matchea nada porque la columna fuente no está).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'publishing_cadences'
      and column_name = 'posts_per_day'
  ) then
    update public.publishing_cadences
      set times_count = posts_per_day, period_days = 1
      where times_count is null;
  end if;
end $$;

alter table public.publishing_cadences
  alter column times_count set not null;
alter table public.publishing_cadences
  alter column period_days set not null;

alter table public.publishing_cadences
  drop constraint if exists publishing_cadences_times_count_check;
alter table public.publishing_cadences
  add constraint publishing_cadences_times_count_check check (times_count > 0);
alter table public.publishing_cadences
  drop constraint if exists publishing_cadences_period_days_check;
alter table public.publishing_cadences
  add constraint publishing_cadences_period_days_check check (period_days > 0);

alter table public.publishing_cadences drop column if exists posts_per_day;
