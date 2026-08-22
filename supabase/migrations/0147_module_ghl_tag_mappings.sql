-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0147 — module_ghl_tag_mappings: puente módulo ↔ tag GHL                 │
-- │                                                                          │
-- │ Fase C del plan Academia. Cuando un curso tiene                         │
-- │ progress_source='ghl_tags' cada módulo se identifica con una tag GHL:  │
-- │ el sync pull-based (POST /contacts/search filter tags contains ...)   │
-- │ trae los contactos con la tag y matchea por email contra students.    │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - course_module_id FK → course_modules (cascade)                     │
-- │   - project_id DENORM desde course_module (patrón LaunchOS)            │
-- │   - unique (project_id, ghl_tag) — una tag mapea a un único módulo    │
-- │     dentro del mismo proyecto (evita colisiones de tags recicladas    │
-- │     entre cursos del mismo project).                                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) module_ghl_tag_mappings
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.module_ghl_tag_mappings (
  id                uuid        primary key default gen_random_uuid(),
  course_module_id  uuid        not null references public.course_modules(id) on delete cascade,
  project_id        uuid        not null references public.projects(id) on delete cascade,
  ghl_tag           text        not null,
  created_at        timestamptz not null default now(),
  unique (project_id, ghl_tag)
);

create index if not exists module_ghl_tag_mappings_module_idx
  on public.module_ghl_tag_mappings(course_module_id);
create index if not exists module_ghl_tag_mappings_project_idx
  on public.module_ghl_tag_mappings(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia course_modules.project_id → mapping.
--    Prefijo 'before_' asegura orden alfabético < 'guard_'.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.module_ghl_tag_mappings_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.course_modules
   where id = new.course_module_id;

  if new.project_id is null then
    raise exception 'module_ghl_tag_mappings: course_module % no existe',
      new.course_module_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_module on public.module_ghl_tag_mappings;
create trigger before_denorm_project_id_from_module
  before insert or update of course_module_id on public.module_ghl_tag_mappings
  for each row execute function public.module_ghl_tag_mappings_denorm_project_id();

drop trigger if exists guard_propia_project on public.module_ghl_tag_mappings;
create trigger guard_propia_project
  before insert or update of project_id on public.module_ghl_tag_mappings
  for each row execute function public.guard_propia_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.module_ghl_tag_mappings enable row level security;
grant select, insert, update, delete on public.module_ghl_tag_mappings to authenticated;

drop policy if exists module_ghl_tag_mappings_select on public.module_ghl_tag_mappings;
create policy module_ghl_tag_mappings_select on public.module_ghl_tag_mappings
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists module_ghl_tag_mappings_insert on public.module_ghl_tag_mappings;
create policy module_ghl_tag_mappings_insert on public.module_ghl_tag_mappings
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists module_ghl_tag_mappings_update on public.module_ghl_tag_mappings;
create policy module_ghl_tag_mappings_update on public.module_ghl_tag_mappings
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists module_ghl_tag_mappings_delete on public.module_ghl_tag_mappings;
create policy module_ghl_tag_mappings_delete on public.module_ghl_tag_mappings
  for delete to authenticated
  using (public.can_edit_project(project_id));
