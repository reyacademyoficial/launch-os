-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 3b+ — GHL Opportunities → ventas_total + revenue                    │
-- │                                                                          │
-- │ GHL Opportunities (pipelines de venta) son la fuente autoritativa de    │
-- │ ventas cerradas por launch. Las KPIs `ventas_total` y `revenue` del     │
-- │ launch se derivan acá cuando el sync corre; cuando no hay datos del    │
-- │ sync, `calculateLaunchKPIs` cae a las columnas `launches.*` cargadas a │
-- │ mano (mismo patrón que `launch_daily_ads` para ads).                   │
-- │                                                                          │
-- │ Decisiones de producto (Fase 3b+):                                       │
-- │  1. NO split WhatsApp/Otros en v1 — guardamos `source` crudo para v2.   │
-- │  2. `won_at ∈ [date_start, date_end]` define pertenencia al launch.    │
-- │  3. Fallback al form manual via TS, no en SQL.                          │
-- │  4. Soft delete: si una opp desaparece de GHL, la fila acá NO se borra.│
-- │     El sync upsertea lo que ve; lo no visto queda como histórico.      │
-- │                                                                          │
-- │ RLS:                                                                    │
-- │   SELECT  → has_project_access(project_of_launch(launch_id))           │
-- │   I/U/D   → SIN policies; solo service-role escribe (igual que         │
-- │            launch_daily_ads y leads-via-sync).                          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.launch_opportunities (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id)  on delete cascade,
  launch_id              uuid not null references public.launches(id)  on delete cascade,

  -- Identidad GHL
  external_id            text not null,
  contact_external_id    text,
  assigned_to_ghl_user   text,

  -- Estado y dinero
  status                 text not null check (status in ('open','won','lost','abandoned')),
  monetary_value         numeric check (monetary_value is null or monetary_value >= 0),

  -- Metadatos para v2 (whatsapp split por pipeline/source)
  source                 text,
  pipeline_id            text,
  pipeline_stage_id      text,

  -- Fechas de GHL (autoritativas; las propias del row son auditoría local)
  won_at                 timestamptz,
  created_at_ghl         timestamptz,
  updated_at_ghl         timestamptz,

  raw                    jsonb not null default '{}'::jsonb,
  synced_at              timestamptz not null default now(),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Idempotencia: la misma opp de GHL no puede entrar dos veces por proyecto.
  -- Mismo proyecto puede tener varios launches que compartan location de GHL
  -- (ver INTEGRATIONS_GHL.md §1) → si un opp aparece en ventana de dos
  -- launches simultáneos, el último sync se queda con el `launch_id`. Mismo
  -- trade-off conocido que con leads.
  unique (project_id, external_id)
);

create index if not exists launch_opportunities_launch_idx
  on public.launch_opportunities(launch_id);

create index if not exists launch_opportunities_project_idx
  on public.launch_opportunities(project_id);

-- Hot path del agregado: ventas_total y revenue del launch leen filas con
-- status='won' y won_at en ventana. Partial index sobre status='won' mantiene
-- el índice compacto (opps abiertas/perdidas dominan en volumen).
create index if not exists launch_opportunities_launch_won_idx
  on public.launch_opportunities(launch_id, won_at)
  where status = 'won';

alter table public.launch_opportunities enable row level security;
grant select, insert, update, delete on public.launch_opportunities to authenticated;

drop trigger if exists set_updated_at on public.launch_opportunities;
create trigger set_updated_at before update on public.launch_opportunities
  for each row execute function public.set_updated_at();

drop policy if exists launch_opportunities_select on public.launch_opportunities;
create policy launch_opportunities_select on public.launch_opportunities
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));
-- (sin I/U/D policies — escribe solo service-role)

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime: el dashboard se suscribe al launch_id y refetchea KPIs cuando
-- el sync escribe filas nuevas, igual que launch_daily_ads.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  alter publication supabase_realtime add table public.launch_opportunities;
exception when duplicate_object then
  null;
end$$;
