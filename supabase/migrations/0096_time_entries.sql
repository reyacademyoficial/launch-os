-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Registro de tiempo                    │
-- │                                                                          │
-- │ Asiento contable de horas trabajadas — NO cronómetro. La persona        │
-- │ carga cuánto tiempo dedicó y a qué después de que pasó, no en vivo.    │
-- │ Decisión explícita: `minutes` + `logged_on` (fecha) en lugar de         │
-- │ `started_at`/`ended_at`. Motivo empírico: el cronómetro en vivo casi   │
-- │ nunca se usa bien y ensucia la data. Si en el futuro aparece la        │
-- │ necesidad, se agrega `started_at`/`ended_at` nullable en una migración │
-- │ aditiva.                                                                 │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │ - `person_id` → organization_people NOT NULL. Sin persona no hay        │
-- │   asiento posible. on delete restrict: bloquea borrar persona con      │
-- │   asientos históricos — el registro de horas es dato contable, no se   │
-- │   sacrifica por limpieza de catálogo.                                   │
-- │ - `task_id` NULL / `internal_project_id` NULL — ambos permitidos       │
-- │   sueltos (hora general de ops) o linkeados. NO hay XOR: 0, 1 o 2      │
-- │   pueden estar seteados (ej. tarea dentro de un proyecto interno).    │
-- │   on delete set null en ambos: el asiento de horas sobrevive aunque   │
-- │   borren la tarea/proyecto — es dato de nómina y reporting.            │
-- │ - `minutes` > 0. Enteros — nadie carga 3.5 minutos. 8 horas = 480.    │
-- │ - `logged_on` DATE default hoy. Un asiento se imputa a UN día — si    │
-- │   la persona trabajó cruzando medianoche, carga dos asientos.         │
-- │ - `notes` texto libre opcional.                                        │
-- │                                                                          │
-- │ REPORTING: `src/lib/ops/carga.ts` suma horas por persona y filtra por │
-- │ ventana temporal (caller pasa rows ya filtradas por logged_on).       │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.time_entries (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organization(id) on delete restrict,

  person_id              uuid not null references public.organization_people(id) on delete restrict,

  task_id                uuid references public.tasks(id)             on delete set null,
  internal_project_id    uuid references public.internal_projects(id) on delete set null,

  minutes                integer not null check (minutes > 0),
  logged_on              date    not null default current_date,
  notes                  text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists time_entries_org_idx
  on public.time_entries(organization_id);
create index if not exists time_entries_org_date_idx
  on public.time_entries(organization_id, logged_on desc);
create index if not exists time_entries_person_date_idx
  on public.time_entries(person_id, logged_on desc);
create index if not exists time_entries_task_idx
  on public.time_entries(task_id) where task_id is not null;
create index if not exists time_entries_project_idx
  on public.time_entries(internal_project_id) where internal_project_id is not null;

drop trigger if exists set_updated_at on public.time_entries;
create trigger set_updated_at before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.time_entries enable row level security;

revoke all on public.time_entries from public;
revoke all on public.time_entries from cliente_role;

grant select, insert, update, delete on public.time_entries to authenticated;

drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
