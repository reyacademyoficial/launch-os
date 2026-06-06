-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ projections — saved calculator scenarios                                 │
-- │                                                                          │
-- │ Pure planning artifacts: a snapshot of the calculator's inputs and the   │
-- │ derived outputs at save time, scoped to a project. RLS rides on the      │
-- │ existing project helpers — read = any member, write = admin+.            │
-- │                                                                          │
-- │ outputs are stored alongside inputs (instead of recomputing on read)     │
-- │ so a historical snapshot survives future changes to the math.            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.projections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  name        text not null,
  mode        text not null check (mode in ('reverse', 'forward')),
  inputs      jsonb not null default '{}'::jsonb,
  outputs     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists projections_project_idx
  on public.projections(project_id, created_at desc);

grant select, insert, update, delete on public.projections to authenticated;

alter table public.projections enable row level security;

drop policy if exists projections_select on public.projections;
drop policy if exists projections_insert on public.projections;
drop policy if exists projections_update on public.projections;
drop policy if exists projections_delete on public.projections;

create policy projections_select on public.projections
  for select to authenticated
  using (public.has_project_access(project_id));

create policy projections_insert on public.projections
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy projections_update on public.projections
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy projections_delete on public.projections
  for delete to authenticated
  using (public.can_edit_project(project_id));
