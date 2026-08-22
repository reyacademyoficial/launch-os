-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0148 — student_module_progress: avance por (enrollment, módulo)         │
-- │                                                                          │
-- │ Fase C. Registra qué módulos completó un alumno dentro de su            │
-- │ enrollment. Alimentado por dos fuentes:                                 │
-- │   - 'ghl_tag'  → el sync pull (ghl-tag-sync.ts) upsertea al detectar    │
-- │                  la tag correspondiente en el contacto GHL.            │
-- │   - 'manual'   → carga manual desde la UI (curso 'manual' o override    │
-- │                  administrativo).                                      │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - unique (enrollment_id, course_module_id) — un enrollment tiene UN  │
-- │     estado por módulo. Los re-syncs son upserts idempotentes.         │
-- │   - completed_at nullable: permite tener la fila creada como "trackeada"│
-- │     y setear la fecha cuando efectivamente completa.                   │
-- │   - source_ref text nullable: guardamos el nombre de la tag ('mod-01') │
-- │     para auditoría / debug.                                            │
-- │   - project_id DENORM desde enrollment.                                │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) student_module_progress
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.student_module_progress (
  id                uuid        primary key default gen_random_uuid(),
  enrollment_id     uuid        not null references public.enrollments(id) on delete cascade,
  course_module_id  uuid        not null references public.course_modules(id) on delete cascade,
  project_id        uuid        not null references public.projects(id) on delete cascade,
  completed_at      timestamptz,
  source            text        not null check (source in ('ghl_tag','manual')),
  source_ref        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (enrollment_id, course_module_id)
);

create index if not exists student_module_progress_enrollment_idx
  on public.student_module_progress(enrollment_id);
create index if not exists student_module_progress_module_idx
  on public.student_module_progress(course_module_id);
create index if not exists student_module_progress_project_idx
  on public.student_module_progress(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia enrollment.project_id → progress.
--    Prefijo 'before_' garantiza que corre antes que guard_propia_project.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.student_module_progress_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.enrollments
   where id = new.enrollment_id;

  if new.project_id is null then
    raise exception 'student_module_progress: enrollment % no existe',
      new.enrollment_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_enrollment on public.student_module_progress;
create trigger before_denorm_project_id_from_enrollment
  before insert or update of enrollment_id on public.student_module_progress
  for each row execute function public.student_module_progress_denorm_project_id();

drop trigger if exists guard_propia_project on public.student_module_progress;
create trigger guard_propia_project
  before insert or update of project_id on public.student_module_progress
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.student_module_progress;
create trigger set_updated_at before update on public.student_module_progress
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.student_module_progress enable row level security;
grant select, insert, update, delete on public.student_module_progress to authenticated;

drop policy if exists student_module_progress_select on public.student_module_progress;
create policy student_module_progress_select on public.student_module_progress
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists student_module_progress_insert on public.student_module_progress;
create policy student_module_progress_insert on public.student_module_progress
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists student_module_progress_update on public.student_module_progress;
create policy student_module_progress_update on public.student_module_progress
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists student_module_progress_delete on public.student_module_progress;
create policy student_module_progress_delete on public.student_module_progress
  for delete to authenticated
  using (public.can_edit_project(project_id));
