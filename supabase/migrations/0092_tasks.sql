-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Tareas                                │
-- │                                                                          │
-- │ Unidad de trabajo mínima. Puede colgar de un `internal_project` (parte  │
-- │ de una iniciativa) o vivir suelta (tarea ad-hoc, "revisar factura       │
-- │ pendiente"). Puede tener asignado o estar sin owner.                     │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │ - `internal_project_id` NULL permitido: tareas sueltas OK.               │
-- │   on delete set null: si borran el proyecto interno, la tarea sobrevive │
-- │   como huérfana (aparece en "tareas sin proyecto"). Preserva historial.│
-- │ - `assignee_id` → `organization_people`. NULL = sin asignar. Mismo     │
-- │   criterio on delete set null.                                          │
-- │ - `status` acotado: {todo,doing,blocked,done,cancelled}. `blocked` es  │
-- │   estado terminal transicional — se cruza con `blockers` (0095) para   │
-- │   la razón. `cancelled` ≠ `done`: cancelled es "no se hace más",       │
-- │   done es "se hizo". Ambos son estados finales.                        │
-- │ - `priority` acotado: {low,med,high,urgent}.                            │
-- │ - `due_on` — fecha vencimiento opcional. Usado por selector de         │
-- │   overdue en src/lib/ops/overdue.ts.                                    │
-- │ - `completed_at` — auto-set desde app cuando status pasa a done|cancelled│
-- │   (NO trigger — dejamos al caller para que la fecha refleje decisión   │
-- │   del operador, no del reloj de la DB). Nullable siempre.               │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organization(id) on delete restrict,

  internal_project_id    uuid references public.internal_projects(id)   on delete set null,
  assignee_id            uuid references public.organization_people(id) on delete set null,

  title                  text not null,
  description            text,

  status                 text not null default 'todo' check (status in (
    'todo', 'doing', 'blocked', 'done', 'cancelled'
  )),
  priority               text not null default 'med' check (priority in (
    'low', 'med', 'high', 'urgent'
  )),

  due_on                 date,
  completed_at           timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists tasks_org_idx
  on public.tasks(organization_id);
create index if not exists tasks_org_status_idx
  on public.tasks(organization_id, status);
create index if not exists tasks_org_open_due_idx
  on public.tasks(organization_id, due_on)
  where status in ('todo', 'doing', 'blocked');
create index if not exists tasks_project_idx
  on public.tasks(internal_project_id) where internal_project_id is not null;
create index if not exists tasks_assignee_open_idx
  on public.tasks(assignee_id) where assignee_id is not null
                                and status in ('todo', 'doing', 'blocked');

drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.tasks enable row level security;

revoke all on public.tasks from public;
revoke all on public.tasks from cliente_role;

grant select, insert, update, delete on public.tasks to authenticated;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
