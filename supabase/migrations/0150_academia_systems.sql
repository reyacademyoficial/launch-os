-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0150 — academia_systems: sub-divisiones internas de un curso             │
-- │                                                                          │
-- │ Fase E del plan Academia. Un curso puede tener N "sistemas" (Nitro:      │
-- │ Producto, Talento, Ventas, Admin&Finanzas). Los sistemas cuelgan del     │
-- │ CURSO (no del proyecto). El flag courses.has_systems (0142) activa la   │
-- │ UI de sistemas — cursos sin flag no muestran nada.                       │
-- │                                                                          │
-- │ Cada sistema puede tener un experto asignado (team_member org-scope,     │
-- │ post 0124). El experto es opcional y `on delete set null` — si el       │
-- │ team_member se borra, el sistema queda sin experto pero no se rompe.    │
-- │                                                                          │
-- │ project_id se DENORMALIZA desde courses.project_id (mismo patrón que    │
-- │ classes ← cohort, course_modules ← courses). RLS estándar via           │
-- │ has_project_access / can_edit_project.                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) academia_systems
--    - unique(course_id, lower(name)): dos sistemas con el mismo nombre en
--      el mismo curso serían confusos. Case-insensitive.
--    - color: opcional, hex string (ej: "#3B82F6"). No validado por CHECK
--      para permitir formatos alternos (nombre CSS, oklch, etc.) — la UI
--      valida.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.academia_systems (
  id                      uuid        primary key default gen_random_uuid(),
  course_id               uuid        not null references public.courses(id) on delete cascade,
  project_id              uuid        not null references public.projects(id) on delete cascade,
  name                    text        not null,
  expert_team_member_id   uuid        references public.team_members(id) on delete set null,
  color                   text,
  active                  boolean     not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists academia_systems_course_name_idx
  on public.academia_systems (course_id, lower(name));

create index if not exists academia_systems_course_idx
  on public.academia_systems(course_id);
create index if not exists academia_systems_project_idx
  on public.academia_systems(project_id);
create index if not exists academia_systems_expert_idx
  on public.academia_systems(expert_team_member_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: denormalizar project_id desde courses.project_id
--    'before_denorm_project_id_from_course' — 'b' < 'g' garantiza que corre
--    antes que guard_propia_project (mismo patrón que course_modules).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.academia_systems_denorm_project_id()
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

drop trigger if exists before_denorm_project_id_from_course on public.academia_systems;
create trigger before_denorm_project_id_from_course
  before insert or update of course_id on public.academia_systems
  for each row execute function public.academia_systems_denorm_project_id();

drop trigger if exists guard_propia_project on public.academia_systems;
create trigger guard_propia_project
  before insert or update of project_id on public.academia_systems
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.academia_systems;
create trigger set_updated_at before update on public.academia_systems
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.academia_systems enable row level security;
grant select, insert, update, delete on public.academia_systems to authenticated;

drop policy if exists academia_systems_select on public.academia_systems;
create policy academia_systems_select on public.academia_systems
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists academia_systems_insert on public.academia_systems;
create policy academia_systems_insert on public.academia_systems
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists academia_systems_update on public.academia_systems;
create policy academia_systems_update on public.academia_systems
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists academia_systems_delete on public.academia_systems;
create policy academia_systems_delete on public.academia_systems
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on table public.academia_systems is
  'Sub-divisiones de un curso (Nitro: Producto, Talento, Ventas, Admin&Finanzas). Activadas por courses.has_systems.';
comment on column public.academia_systems.expert_team_member_id is
  'Team member (org-scope) responsable del sistema. Opcional. on delete set null.';
comment on column public.academia_systems.color is
  'Color para display en UI (hex, nombre CSS, etc.). Validado en la UI.';
