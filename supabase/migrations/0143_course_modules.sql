-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0143 — course_modules: unidades de contenido dentro de un curso          │
-- │                                                                          │
-- │ Un curso se compone de N módulos ordenados. Ejemplos:                   │
-- │   - Máquina del Éxito: Fundamentos → Avanzado → Implementación → ...    │
-- │   - Nitro: Diagnóstico → Ventas → Talento → ...                          │
-- │                                                                          │
-- │ Los módulos son la unidad sobre la que se mide progreso cuando el       │
-- │ curso tiene progress_source = 'ghl_tags'. Fase C agrega el mapping      │
-- │ módulo ↔ tag GHL (tabla module_ghl_tag_mappings, migración 0147).       │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - course_id FK → courses (cascade on delete)                          │
-- │   - project_id DENORM desde course (mismo patrón que classes ←cohort)   │
-- │   - order_index int: unique por curso, controla el orden de display    │
-- │   - name required; description opcional                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) course_modules
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.course_modules (
  id           uuid        primary key default gen_random_uuid(),
  course_id    uuid        not null references public.courses(id) on delete cascade,
  project_id   uuid        not null references public.projects(id) on delete cascade,
  name         text        not null,
  description  text,
  order_index  integer     not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, order_index)
);

create index if not exists course_modules_course_idx
  on public.course_modules(course_id, order_index);
create index if not exists course_modules_project_idx
  on public.course_modules(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia courses.project_id → course_modules.project_id
--    Nombre 'before_denorm_project_id_from_course' — 'b' < 'g' garantiza que
--    corre antes que guard_propia_project.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.course_modules_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.courses
   where id = new.course_id;
  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_course on public.course_modules;
create trigger before_denorm_project_id_from_course
  before insert or update of course_id on public.course_modules
  for each row execute function public.course_modules_denorm_project_id();

drop trigger if exists guard_propia_project on public.course_modules;
create trigger guard_propia_project
  before insert or update of project_id on public.course_modules
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.course_modules;
create trigger set_updated_at before update on public.course_modules
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.course_modules enable row level security;
grant select, insert, update, delete on public.course_modules to authenticated;

drop policy if exists course_modules_select on public.course_modules;
create policy course_modules_select on public.course_modules
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists course_modules_insert on public.course_modules;
create policy course_modules_insert on public.course_modules
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists course_modules_update on public.course_modules;
create policy course_modules_update on public.course_modules
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists course_modules_delete on public.course_modules;
create policy course_modules_delete on public.course_modules
  for delete to authenticated
  using (public.can_edit_project(project_id));
