-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase — Presupuesto por país y etapa                                     │
-- │                                                                          │
-- │ El equipo carga manualmente cuánto presupuesta gastar en cada etapa del  │
-- │ lanzamiento (creación, nutrición, captación, calentamiento, consumo),    │
-- │ desglosado por país. La tab presupuesto muestra una tabla por etapa con  │
-- │ país + monto + % del total de esa etapa. No hay integración con ads —    │
-- │ es entrada manual pura para planning.                                    │
-- │                                                                          │
-- │ Decisiones:                                                              │
-- │   - Moneda única por launch (launches.budget_currency, nullable). Se     │
-- │     setea antes de cargar cualquier entrada; free 3-letter code (USD,    │
-- │     ARS, MXN, etc.) sin enum para no requerir migración al agregar una.  │
-- │   - Lista de países `budget_countries` scoped por PROYECTO: se agregan   │
-- │     una vez y se reusan en todos los launches del proyecto. name text    │
-- │     libre (dropdown en UI se llena de esta tabla). unique(project_id,    │
-- │     name) para bloquear duplicados exactos.                              │
-- │   - `launch_budget_entries`: una fila = (launch, etapa, país). stage     │
-- │     CHECK a las 5 etapas soportadas (creacion|nutricion|captacion|       │
-- │     calentamiento|consumo — compra y cierre NO tienen presupuesto).      │
-- │     unique(launch_id, stage, country_id) — un país no puede aparecer 2   │
-- │     veces en la misma etapa del mismo launch (editás en vez de agregar). │
-- │   - Permisos (mismo split que alert_rules):                              │
-- │       SELECT  → has_project_access                                       │
-- │       I/U/D   → can_edit_launches_in (admin/operador, NO analista)       │
-- │       cliente_role: SIN grant (no aplica al cliente).                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Moneda del presupuesto (una por launch)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.launches
  add column if not exists budget_currency text;

alter table public.launches
  drop constraint if exists launches_budget_currency_chk;
alter table public.launches
  add constraint launches_budget_currency_chk
  check (budget_currency is null or budget_currency ~ '^[A-Z]{3}$');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Catálogo de países por proyecto (dropdown que se autogestiona)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.budget_countries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (project_id, name)
);

create index if not exists budget_countries_project_idx
  on public.budget_countries(project_id);

alter table public.budget_countries enable row level security;

grant select, insert, update, delete on public.budget_countries to authenticated;

drop policy if exists budget_countries_select on public.budget_countries;
create policy budget_countries_select on public.budget_countries
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists budget_countries_insert on public.budget_countries;
create policy budget_countries_insert on public.budget_countries
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists budget_countries_update on public.budget_countries;
create policy budget_countries_update on public.budget_countries
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists budget_countries_delete on public.budget_countries;
create policy budget_countries_delete on public.budget_countries
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Entradas de presupuesto (fila = launch × etapa × país)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.launch_budget_entries (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,
  stage       text not null check (
                stage in ('creacion','nutricion','captacion','calentamiento','consumo')
              ),
  country_id  uuid not null references public.budget_countries(id) on delete cascade,
  amount      numeric not null check (amount >= 0),

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (launch_id, stage, country_id)
);

create index if not exists launch_budget_entries_launch_stage_idx
  on public.launch_budget_entries(launch_id, stage);
create index if not exists launch_budget_entries_country_idx
  on public.launch_budget_entries(country_id);

alter table public.launch_budget_entries enable row level security;

grant select, insert, update, delete on public.launch_budget_entries to authenticated;

drop trigger if exists set_updated_at on public.launch_budget_entries;
create trigger set_updated_at before update on public.launch_budget_entries
  for each row execute function public.set_updated_at();

-- RLS — resolución de project vía project_of_launch (igual que alert_rules).
-- Adicionalmente exigimos que el country pertenezca al mismo proyecto (no
-- podés mezclar países de otro proyecto en un launch tuyo).
drop policy if exists launch_budget_entries_select on public.launch_budget_entries;
create policy launch_budget_entries_select on public.launch_budget_entries
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));

drop policy if exists launch_budget_entries_insert on public.launch_budget_entries;
create policy launch_budget_entries_insert on public.launch_budget_entries
  for insert to authenticated
  with check (
    public.can_edit_launches_in(public.project_of_launch(launch_id))
    and exists (
      select 1 from public.budget_countries bc
      where bc.id = country_id
        and bc.project_id = public.project_of_launch(launch_id)
    )
  );

drop policy if exists launch_budget_entries_update on public.launch_budget_entries;
create policy launch_budget_entries_update on public.launch_budget_entries
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_launch(launch_id)))
  with check (
    public.can_edit_launches_in(public.project_of_launch(launch_id))
    and exists (
      select 1 from public.budget_countries bc
      where bc.id = country_id
        and bc.project_id = public.project_of_launch(launch_id)
    )
  );

drop policy if exists launch_budget_entries_delete on public.launch_budget_entries;
create policy launch_budget_entries_delete on public.launch_budget_entries
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_launch(launch_id)));
