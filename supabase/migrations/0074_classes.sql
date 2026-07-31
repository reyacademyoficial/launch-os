-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `classes`                                 │
-- │                                                                          │
-- │ Una class es una SESIÓN de una cohorte: fecha, tema, notas. La cohorte  │
-- │ es la que agrupa a los alumnos; la class es un momento en el tiempo     │
-- │ donde se dicta contenido. Los pases de asistencia (`attendance`)        │
-- │ cuelgan de class + student.                                             │
-- │                                                                          │
-- │ Scope: project_id se DENORMALIZA desde cohorts.project_id (mismo        │
-- │ patrón que courses ← products). Motivos:                                │
-- │   (a) RLS eficiente sin hop a cohorts.                                  │
-- │   (b) Guard propia funciona con la columna local.                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) classes
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.classes (
  id            uuid        primary key default gen_random_uuid(),
  cohort_id     uuid        not null references public.cohorts(id) on delete cascade,
  project_id    uuid        not null references public.projects(id) on delete cascade,
  scheduled_at  timestamptz not null,
  topic         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists classes_cohort_idx     on public.classes(cohort_id);
create index if not exists classes_project_idx    on public.classes(project_id);
create index if not exists classes_scheduled_idx  on public.classes(scheduled_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Triggers: denorm project_id desde cohort + guard propia + updated_at
--    'b' de 'before_...' garantiza orden < 'g' de guard.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.classes_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.cohorts
   where id = new.cohort_id;
  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_cohort on public.classes;
create trigger before_denorm_project_id_from_cohort
  before insert or update of cohort_id on public.classes
  for each row execute function public.classes_denorm_project_id();

drop trigger if exists guard_propia_project on public.classes;
create trigger guard_propia_project
  before insert or update of project_id on public.classes
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.classes;
create trigger set_updated_at before update on public.classes
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.classes enable row level security;
grant select, insert, update, delete on public.classes to authenticated;

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes
  for delete to authenticated
  using (public.can_edit_project(project_id));
