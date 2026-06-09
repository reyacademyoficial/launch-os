-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 3a — integraciones por lanzamiento (Meta Ads end-to-end)          │
-- │                                                                          │
-- │ Decisión central (brief Fase 3a): TODO por lanzamiento. Nada queda a    │
-- │ nivel proyecto. La página stub `/integraciones` del proyecto se vuelve  │
-- │ inerte (no la borramos por compatibilidad de URL, no la vamos a usar).  │
-- │                                                                          │
-- │ Tres tablas nuevas:                                                      │
-- │   - launch_secrets      → token (blindada, RLS sin policies)            │
-- │   - launch_daily_ads    → datos sintetizados de cada provider           │
-- │   - integration_runs    → log de cada sync (status/error/ventana)       │
-- │                                                                          │
-- │ Más una columna nueva: launches.integration_config jsonb (ad_account_id │
-- │ + campaign_ids por provider).                                            │
-- │                                                                          │
-- │ Status y last_sync se DERIVAN de integration_runs en la capa de lectura │
-- │ — no hay tabla `launch_integrations` extra. Menos estado, sin races.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) launches.integration_config — config por (launch, provider) en jsonb
--    Shape esperada:
--      { "meta": { "ad_account_id": "act_123", "campaign_ids": ["..."] },
--        "google": { ... } }
--    Es visible a TODOS los miembros del proyecto via launches_select. Son
--    IDs de ads, no secretos.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column if not exists integration_config jsonb not null default '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) launch_secrets — token por (launch, provider). BLINDADA.
--    Mismo patrón que project_secrets: RLS enabled, ZERO policies, GRANT
--    SELECT a authenticated para que un SELECT devuelva 0 filas (filtrado por
--    RLS) en lugar de permission denied — UX consistente.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launch_secrets (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,
  provider    text not null,
  secret      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (launch_id, provider)
);

alter table public.launch_secrets enable row level security;
grant select, insert, update, delete on public.launch_secrets to authenticated;
-- (no policies — solo service-role pasa)

drop trigger if exists set_updated_at on public.launch_secrets;
create trigger set_updated_at before update on public.launch_secrets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) launch_daily_ads — datos sintetizados de las APIs de ads.
--    Append-only por (launch, date, provider). El sync hace upsert
--    idempotente — correr 2 veces deja el mismo resultado.
--
--    RLS:
--      SELECT  → has_project_access(project_of_launch(launch_id))
--      I/U/D   → SIN policies; solo service-role escribe. Esto garantiza que
--                ningún usuario corrompa el dato del sync por accidente.
--
--    `raw jsonb` guarda la respuesta cruda por día para debug. No contiene
--    secretos (el token va en la request, no en la response).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launch_daily_ads (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,
  date        date not null,
  provider    text not null check (provider in ('meta','google','tiktok')),

  spend       numeric not null default 0  check (spend >= 0),
  impressions integer not null default 0  check (impressions >= 0),
  clicks      integer not null default 0  check (clicks >= 0),
  leads       integer not null default 0  check (leads >= 0),

  raw         jsonb   not null default '{}'::jsonb,
  synced_at   timestamptz not null default now(),

  unique (launch_id, date, provider)
);

create index if not exists launch_daily_ads_launch_date_idx
  on public.launch_daily_ads(launch_id, date desc);

alter table public.launch_daily_ads enable row level security;
grant select, insert, update, delete on public.launch_daily_ads to authenticated;

drop policy if exists launch_daily_ads_select on public.launch_daily_ads;
create policy launch_daily_ads_select on public.launch_daily_ads
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));
-- (no INSERT/UPDATE/DELETE policies — solo service-role)

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) integration_runs — log de cada corrida del sync.
--    El status final + finished_at sirven para:
--      - mostrar "última sync" en la UI (derivar de la fila más reciente).
--      - debug post-mortem cuando algo falla (error_detail).
--
--    Status enum cubre todos los caminos del orchestrator:
--      running        ← insertada al empezar
--      success        ← terminó OK
--      partial        ← algunos días OK, otros no (no usado en 3a; queda
--                       para 3c con paginación)
--      error          ← falla genérica (5xx, malformed, etc.)
--      token_invalid  ← Meta code 190
--      rate_limited   ← Meta code 4/17/throttle
--      config_missing ← falta ad_account_id, campaign_ids o token al disparar
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.integration_runs (
  id            uuid primary key default gen_random_uuid(),
  launch_id     uuid not null references public.launches(id) on delete cascade,
  provider      text not null,
  triggered_by  uuid references auth.users(id) on delete set null,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,

  status        text not null check (status in (
    'running','success','partial','error','token_invalid','rate_limited','config_missing'
  )),
  rows_written  integer default 0,
  error_detail  jsonb,

  window_start  date,
  window_end    date
);

create index if not exists integration_runs_launch_idx
  on public.integration_runs(launch_id, started_at desc);
create index if not exists integration_runs_launch_provider_idx
  on public.integration_runs(launch_id, provider, started_at desc);

alter table public.integration_runs enable row level security;
grant select, insert, update, delete on public.integration_runs to authenticated;

drop policy if exists integration_runs_select on public.integration_runs;
create policy integration_runs_select on public.integration_runs
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));
-- (no I/U/D policies — solo service-role)

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Realtime — habilitar publication en las 2 tablas de daily
--    El front se suscribe filtrando por launch_id y refetchea KPIs/chart
--    cuando el sync escribe. RLS-aware: cada client solo ve lo suyo.
--
--    Si Supabase Studio ya las tenía pulled en alguna acción previa, ALTER
--    PUBLICATION ADD TABLE falla con duplicate_object — lo hacemos
--    defensivamente con un DO block.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  alter publication supabase_realtime add table public.launch_daily_ads;
exception when duplicate_object then
  null;
end$$;

do $$
begin
  alter publication supabase_realtime add table public.launch_daily;
exception when duplicate_object then
  null;
end$$;
