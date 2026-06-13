-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ ghl_user_mappings — vincular GHL users con team_members locales         │
-- │                                                                          │
-- │ Cuando un contact en GHL viene con `assignedTo: <ghl_user_id>`, queremos │
-- │ que el lead en nuestro sistema tenga `team_member_id` apuntando al      │
-- │ vendedor correspondiente. La traducción `ghl_user_id → team_member_id`  │
-- │ vive acá, configurable por el admin del proyecto desde la UI.           │
-- │                                                                          │
-- │ A nivel proyecto, no launch: los GHL users del location son los mismos │
-- │ entre launches del mismo proyecto, no tiene sentido remapear por cada   │
-- │ uno. Un proyecto que use varios locations tendrá ghl_user_ids distintos │
-- │ → no chocan.                                                            │
-- │                                                                          │
-- │ RLS:                                                                    │
-- │   SELECT → has_project_access(project_id) — todo miembro lee.           │
-- │   I/U/D  → can_edit_launches_in(project_id) — operador + admin escriben │
-- │            (mismo gate que usa team_members).                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.ghl_user_mappings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  ghl_user_id     text not null,
  team_member_id  uuid not null references public.team_members(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, ghl_user_id)
);

create index if not exists ghl_user_mappings_project_idx
  on public.ghl_user_mappings(project_id);

alter table public.ghl_user_mappings enable row level security;
grant select, insert, update, delete on public.ghl_user_mappings to authenticated;

drop trigger if exists set_updated_at on public.ghl_user_mappings;
create trigger set_updated_at before update on public.ghl_user_mappings
  for each row execute function public.set_updated_at();

drop policy if exists ghl_user_mappings_select on public.ghl_user_mappings;
create policy ghl_user_mappings_select on public.ghl_user_mappings
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists ghl_user_mappings_insert on public.ghl_user_mappings;
create policy ghl_user_mappings_insert on public.ghl_user_mappings
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists ghl_user_mappings_update on public.ghl_user_mappings;
create policy ghl_user_mappings_update on public.ghl_user_mappings
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists ghl_user_mappings_delete on public.ghl_user_mappings;
create policy ghl_user_mappings_delete on public.ghl_user_mappings
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));
