-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Launch OS — schema                                                       │
-- │                                                                          │
-- │ Tables only. Functions/triggers in 0002, RLS in 0003, seed in 0004.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ═══════════════════════════════════════════════════════════════════════════
-- profiles
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'cliente'
              check (role in ('superadmin', 'admin', 'cliente')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- ═══════════════════════════════════════════════════════════════════════════
-- projects (the tenant)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  business_name text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- project_members — junction admin/cliente ↔ project. Superadmin needs no row.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- launches — flat metrics per launch. Integrations metadata lives elsewhere.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launches (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  name               text not null,
  date               date,
  type               text check (type in ('En Vivo', 'Automatizado', 'Replay')),
  status             text check (status in ('Activo', 'Escalando', 'Finalizado', 'Evergreen')),
  platforms          text[] not null default '{}',

  -- Ad spend / clicks / leads, per network
  meta_investment    numeric default 0,
  meta_clicks        integer default 0,
  meta_leads         integer default 0,
  google_investment  numeric default 0,
  google_clicks      integer default 0,
  google_leads       integer default 0,
  tiktok_investment  numeric default 0,
  tiktok_clicks      integer default 0,
  tiktok_leads       integer default 0,

  -- Lifecycle metrics
  contactos_api      integer default 0,
  ingresos_whatsapp  numeric default 0,
  registrados        integer default 0,
  asistentes         integer default 0,
  hasta_pitch        integer default 0,
  ventas_total       integer default 0,
  ventas_mensuales   integer default 0,
  ventas_anuales     integer default 0,
  revenue            numeric default 0,

  -- Per-metric provenance: { metaLeads: "manual" | "meta" | ... }
  sources            jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists launches_project_idx on public.launches(project_id);
create index if not exists launches_date_idx    on public.launches(date desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- launch_daily — one row per launch+day with per-channel lead counts
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launch_daily (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,
  date        date not null,

  meta_ads    integer not null default 0,
  google_ads  integer not null default 0,
  tiktok_ads  integer not null default 0,
  organico    integer not null default 0,
  whatsapp    integer not null default 0,
  referidos   integer not null default 0,
  otro        integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (launch_id, date)
);

create index if not exists launch_daily_launch_idx on public.launch_daily(launch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- project_integrations — non-secret connection metadata (admin+ can see this)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.project_integrations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  provider    text not null,
  connected   boolean not null default false,
  account_id  text,
  status      text not null default 'disconnected',
  last_sync   timestamptz,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, provider)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- project_secrets — API keys/tokens. BLINDED via RLS (no policies in 0003).
-- Only the service-role (which bypasses RLS) reads/writes. Server-only.
-- Future hardening: encrypt with Supabase Vault.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.project_secrets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  provider    text not null,
  secret      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, provider)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- audit_log — per-project action log
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  ts          timestamptz not null default now(),
  action      text not null,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_project_ts_idx on public.audit_log(project_id, ts desc);
