-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `students`                                │
-- │                                                                          │
-- │ Un student es un ALUMNO de una empresa propia de Kingrow. NO es:         │
-- │   - un `lead` (los leads son contactos de un lanzamiento; muchos nunca   │
-- │     compran ni cursan).                                                  │
-- │   - un `cliente` del portal (los clientes son los stakeholders de un     │
-- │     proyecto externo que miran su lanzamiento en el portal).             │
-- │                                                                          │
-- │ Un student puede coincidir humanamente con un lead o con un cliente,     │
-- │ pero la unión NO se modela acá — student vive en su propia tabla y su    │
-- │ propio lifecycle. Si mañana Kingrow quiere trazabilidad "compró en el    │
-- │ lanzamiento → cursa acá", se agrega un puente explícito en otro bloque, │
-- │ sin difuminar la separación conceptual.                                 │
-- │                                                                          │
-- │ Scope: project_id → projects (con trigger que exige ownership='propia'). │
-- │                                                                          │
-- │ RLS: patrón LaunchOS (has_project_access / can_edit_project). SIN grant │
-- │ a cliente_role — un portal de alumno es otro bloque futuro.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) students
--    - phone_normalized: mismo formato que leads (E.164 sin espacios) para
--      que un futuro puente student↔lead sea trivial.
--    - status: 'active' (cursando), 'inactive' (baja), 'graduated'
--      (finalizó al menos un curso). Free-form check para permitir extender.
--    - enrolled_at: fecha de alta como alumno (primera inscripción o
--      manual). Distinto del created_at (row creation).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.students (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references public.projects(id) on delete cascade,
  name              text        not null,
  email             text,
  phone             text,
  phone_normalized  text,
  status            text        not null default 'active'
                       check (status in ('active','inactive','graduated')),
  enrolled_at       date        not null default current_date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists students_project_idx
  on public.students(project_id);

-- Unicidad por teléfono dentro del mismo project (mismo patrón que leads):
-- parcial para permitir students sin teléfono en el sistema.
create unique index if not exists students_phone_normalized_unique_idx
  on public.students(project_id, phone_normalized)
  where phone_normalized is not null;

create unique index if not exists students_email_unique_idx
  on public.students(project_id, lower(email))
  where email is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) updated_at + guard propia
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_updated_at on public.students;
create trigger set_updated_at before update on public.students
  for each row execute function public.set_updated_at();

drop trigger if exists guard_propia_project on public.students;
create trigger guard_propia_project
  before insert or update of project_id on public.students
  for each row execute function public.guard_propia_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS (has_project_access / can_edit_project)
--    SIN grant a cliente_role (portal de alumno es otro bloque futuro).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.students enable row level security;
grant select, insert, update, delete on public.students to authenticated;

drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists students_insert on public.students;
create policy students_insert on public.students
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists students_update on public.students;
create policy students_update on public.students
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists students_delete on public.students;
create policy students_delete on public.students
  for delete to authenticated
  using (public.can_edit_project(project_id));
