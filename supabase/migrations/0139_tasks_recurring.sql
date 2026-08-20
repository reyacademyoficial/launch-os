-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0139 — tasks: patrón recurrente diario + historial de completaciones    │
-- │                                                                          │
-- │ Una tarea puede marcarse como "diaria": se ejecuta en los días de la    │
-- │ semana elegidos (recurrence_days) y se completa/descompleta por día.    │
-- │ El historial vive en `task_completions` (una fila por día completado).  │
-- │                                                                          │
-- │ DECISIÓN — mantener los campos en `tasks` (nullables) en vez de tabla   │
-- │ aparte: es una faceta opcional de la misma entidad. Frenar la           │
-- │ recurrencia = apagar `is_recurring`; el historial se preserva.          │
-- │                                                                          │
-- │ `status`/`completed_at` siguen siendo válidos para tareas no-recurrentes.│
-- │ Para recurrentes, el "hecho hoy" NO toca esos campos — vive en          │
-- │ `task_completions(task_id, on_date)`. La app decide qué mostrar.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Campos nuevos en tasks
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.tasks
  add column if not exists is_recurring      boolean not null default false,
  add column if not exists recurrence_days   smallint[],
  add column if not exists estimated_minutes integer;

-- Si is_recurring, recurrence_days debe estar poblado y contener sólo 0..6
-- (0=domingo, 6=sábado — mismo criterio que `Date.getDay()` en JS).
alter table public.tasks
  drop constraint if exists tasks_recurrence_shape;
alter table public.tasks
  add constraint tasks_recurrence_shape check (
    (is_recurring = false)
    or (
      recurrence_days is not null
      and array_length(recurrence_days, 1) > 0
      and recurrence_days <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  );

-- estimated_minutes positivo si presente (evitamos 0 o negativos).
alter table public.tasks
  drop constraint if exists tasks_estimated_minutes_positive;
alter table public.tasks
  add constraint tasks_estimated_minutes_positive check (
    estimated_minutes is null or estimated_minutes > 0
  );

-- Índice parcial para lookups de "tareas diarias de hoy por persona".
create index if not exists tasks_recurring_assignee_idx
  on public.tasks(assignee_id)
  where is_recurring = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) task_completions — historial de días completados
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.task_completions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  task_id            uuid not null references public.tasks(id) on delete cascade,
  on_date            date not null,

  -- Persona que marcó. NULL si el user no está vinculado (dev/admin) o si
  -- la persona se dio de baja. No bloqueamos: la fila del día importa.
  completed_by       uuid references public.organization_people(id) on delete set null,

  created_at         timestamptz not null default now(),

  -- Un día puede estar hecho una sola vez por tarea. Toggle = upsert/delete.
  constraint task_completions_unique_day unique (task_id, on_date)
);

create index if not exists task_completions_org_idx
  on public.task_completions(organization_id);
create index if not exists task_completions_task_date_idx
  on public.task_completions(task_id, on_date desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.task_completions enable row level security;

revoke all on public.task_completions from public;
revoke all on public.task_completions from cliente_role;

grant select, insert, update, delete on public.task_completions to authenticated;

drop policy if exists task_completions_select on public.task_completions;
create policy task_completions_select on public.task_completions
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists task_completions_insert on public.task_completions;
create policy task_completions_insert on public.task_completions
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists task_completions_update on public.task_completions;
create policy task_completions_update on public.task_completions
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists task_completions_delete on public.task_completions;
create policy task_completions_delete on public.task_completions
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
