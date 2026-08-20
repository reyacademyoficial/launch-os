-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0141 — task_assignees: M2M asignados para tareas                        │
-- │                                                                          │
-- │ Consistente con 0140 (owners de proyectos). Motivo simétrico: Notion   │
-- │ permite N asignados por task y una tarea del equipo puede tener        │
-- │ varios responsables (ej. dos personas working juntas).                 │
-- │                                                                          │
-- │ SHAPE                                                                    │
-- │   task_assignees(task_id, person_id, organization_id)                  │
-- │   PK compuesto. `organization_id` para RLS directa.                    │
-- │                                                                          │
-- │ ON DELETE                                                                │
-- │   task_id   CASCADE — si la task desaparece, el assignment también.   │
-- │   person_id CASCADE — si la persona se elimina, sale del assignment.  │
-- │                                                                          │
-- │ IMPACTO EN APP                                                           │
-- │   - Form: multi-select checkboxes en vez de dropdown único.           │
-- │   - Filtro "mis tareas": JOIN con junction (persona ∈ assignees).      │
-- │   - carga por persona: bump por cada assignee, no por asignee_id único.│
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ─── 1) Tabla junction ─────────────────────────────────────────────────────
create table if not exists public.task_assignees (
  task_id         uuid not null
    references public.tasks(id) on delete cascade,
  person_id       uuid not null
    references public.organization_people(id) on delete cascade,
  organization_id uuid not null
    references public.organization(id) on delete restrict,
  created_at      timestamptz not null default now(),

  primary key (task_id, person_id)
);

create index if not exists task_assignees_person_idx
  on public.task_assignees(person_id);
create index if not exists task_assignees_task_idx
  on public.task_assignees(task_id);
create index if not exists task_assignees_org_idx
  on public.task_assignees(organization_id);

-- ─── 2) Backfill desde tasks.assignee_id ────────────────────────────────────
insert into public.task_assignees (task_id, person_id, organization_id)
select t.id, t.assignee_id, t.organization_id
from public.tasks t
where t.assignee_id is not null
on conflict do nothing;

-- ─── 3) Drop col + índice parcial que la referenciaba ──────────────────────
drop index if exists public.tasks_assignee_open_idx;
alter table public.tasks drop column if exists assignee_id;

-- Nuevo índice sobre la junction filtrado por persona — reemplaza el que
-- servía "tareas abiertas por assignee".
create index if not exists task_assignees_person_task_idx
  on public.task_assignees(person_id, task_id);

-- ─── 4) RLS ────────────────────────────────────────────────────────────────
alter table public.task_assignees enable row level security;

revoke all on public.task_assignees from public;
revoke all on public.task_assignees from cliente_role;
grant select, insert, update, delete on public.task_assignees to authenticated;

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert on public.task_assignees
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists task_assignees_update on public.task_assignees;
create policy task_assignees_update on public.task_assignees
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete on public.task_assignees
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
