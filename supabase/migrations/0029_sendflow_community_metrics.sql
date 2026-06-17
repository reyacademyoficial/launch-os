-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 3b — SendFlow: métricas de comunidad WhatsApp por lanzamiento     │
-- │                                                                          │
-- │ SendFlow es un provider de SOLO LECTURA: trae cuántos entraron / salieron│
-- │ / clickearon en la comunidad. NO alimenta el pipeline de leads (eso es   │
-- │ GHL); deriva dos KPIs:                                                   │
-- │                                                                          │
-- │   - retencion        = (entered - removed) / entered                     │
-- │   - % que entró      = entered / leads_totales_del_lanzamiento           │
-- │                                                                          │
-- │ Una tabla nueva — NO reusamos launch_daily_ads porque la semántica es    │
-- │ distinta (comunidad vs. ads) y porque la API de SendFlow nos da el       │
-- │ desglose por release pero el dato útil es el AGREGADO por lanzamiento    │
-- │ acotado a la ventana [date_start, date_end]. Un launch puede tener N     │
-- │ releases — el sync suma todas y guarda UNA fila por (launch, ventana).  │
-- │                                                                          │
-- │ RLS espejo de launch_daily_ads: lectura para miembros del proyecto,      │
-- │ escritura solo service-role (sin policies de I/U/D).                     │
-- │                                                                          │
-- │ El config por lanzamiento (release_ids) vive en launches.integration_    │
-- │ config.sendflow.release_ids — no necesita columna nueva. El secret va a  │
-- │ launch_secrets con provider='sendflow' (tabla ya existente, blindada).   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) launch_community_metrics — agregado por (launch, provider, ventana).
--    Idempotencia: upsert por (launch_id, provider, window_start, window_end).
--    Si el usuario reabre el launch y mueve date_end, el sync re-corre con la
--    nueva ventana y queda otra fila — la UI lee la más reciente por
--    synced_at (o se hace garbage collection en 3c). En la práctica, mientras
--    la ventana no cambie, sync = upsert sobre la misma fila.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launch_community_metrics (
  id            uuid primary key default gen_random_uuid(),
  launch_id     uuid not null references public.launches(id) on delete cascade,
  provider      text not null check (provider in ('sendflow')),

  window_start  date not null,
  window_end    date not null,

  entered       integer not null default 0  check (entered >= 0),
  removed       integer not null default 0  check (removed >= 0),
  clicks        integer not null default 0  check (clicks >= 0),

  -- raw: { releases: [{ release_id, entered, removed, clicks }] } — por release
  -- post-acotado a la ventana. Para debug; no se consume en KPI.
  raw           jsonb       not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),

  unique (launch_id, provider, window_start, window_end)
);

create index if not exists launch_community_metrics_launch_idx
  on public.launch_community_metrics(launch_id, synced_at desc);

alter table public.launch_community_metrics enable row level security;
grant select, insert, update, delete on public.launch_community_metrics to authenticated;

drop policy if exists launch_community_metrics_select on public.launch_community_metrics;
create policy launch_community_metrics_select on public.launch_community_metrics
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));
-- (no I/U/D policies — solo service-role escribe)

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Realtime — habilitar publication para que el dashboard refetchee KPIs
--    cuando el sync escribe (mismo patrón que launch_daily_ads / launch_daily).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  alter publication supabase_realtime add table public.launch_community_metrics;
exception when duplicate_object then
  null;
end$$;
