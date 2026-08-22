-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0153 — external_apps: registro de apps externas por proyecto            │
-- │                                                                          │
-- │ Fase G del plan Academia (docs/kingrow-academia-plan.md). Un curso      │
-- │ puede tener una app externa asociada (ej: Nitro tiene una app de agenda │
-- │ de turnos con expertos). Desde el detalle del curso se abre la app en  │
-- │ nueva pestaña con SSO (el usuario ya autenticado).                     │
-- │                                                                          │
-- │ La tabla vive a NIVEL PROYECTO (no curso) porque:                       │
-- │   1) un proyecto puede tener varias apps (agenda, chat, LMS, etc.)     │
-- │   2) una misma app puede servir a varios cursos del mismo proyecto     │
-- │                                                                          │
-- │ El link app↔curso vive en courses.external_app_id (0142). Esta         │
-- │ migración cierra el ciclo agregando la FK diferida.                   │
-- │                                                                          │
-- │ auth_strategy: cómo generamos el token de SSO al abrir la app          │
-- │   - 'jwt'           → firmamos JWT HS256 con secret shared             │
-- │   - 'shared_secret' → HMAC(email+ts) firmado con secret shared         │
-- │   - 'oauth2'        → intercambio OAuth (TODO — no implementado hoy)   │
-- │   - 'magic_link'    → llamada al backend, devuelve URL única           │
-- │                                                                          │
-- │ config jsonb guarda:                                                    │
-- │   - secret: shared secret (para jwt / shared_secret / magic_link)      │
-- │   - magic_link_endpoint: URL del backend para magic_link               │
-- │   - token_param: nombre del query param ('token' por default)          │
-- │   - token_placement: 'query' | 'hash' (default 'query')                │
-- │   - issuer, audience: claims JWT opcionales                            │
-- │                                                                          │
-- │ ⚠ El secret vive en config jsonb sin cifrado nativo — el usuario        │
-- │ debería usar una env var y guardar solo la referencia. Documentado en  │
-- │ docs/INTEGRATIONS_NITRO_APP.md.                                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) external_apps
--    unique (project_id, lower(name)) — dos apps con el mismo nombre en el
--    mismo proyecto serían confusas. Case-insensitive.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.external_apps (
  id              uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.projects(id) on delete cascade,
  name            text        not null,
  base_url        text        not null,
  auth_strategy   text        not null
    check (auth_strategy in ('jwt','oauth2','shared_secret','magic_link')),
  config          jsonb       not null default '{}'::jsonb,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists external_apps_project_name_idx
  on public.external_apps (project_id, lower(name));

create index if not exists external_apps_project_idx
  on public.external_apps(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Triggers estándar: guard_propia_project + set_updated_at
--    external_apps vive sobre proyectos propios (misma regla que resto de
--    academia — 0070). El guard chequea projects.ownership='propia'.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists guard_propia_project on public.external_apps;
create trigger guard_propia_project
  before insert or update of project_id on public.external_apps
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.external_apps;
create trigger set_updated_at before update on public.external_apps
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS estándar (has_project_access / can_edit_project)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.external_apps enable row level security;
grant select, insert, update, delete on public.external_apps to authenticated;

drop policy if exists external_apps_select on public.external_apps;
create policy external_apps_select on public.external_apps
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists external_apps_insert on public.external_apps;
create policy external_apps_insert on public.external_apps
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists external_apps_update on public.external_apps;
create policy external_apps_update on public.external_apps
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists external_apps_delete on public.external_apps;
create policy external_apps_delete on public.external_apps
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) FK diferida en courses.external_app_id
--    La columna se agregó en 0142 nullable sin FK — ahora que existe
--    external_apps, cerramos con ON DELETE SET NULL para no romper cursos si
--    se elimina la app. Usamos DO NOT VALID no-op — si hubiera datos previos
--    inválidos, esto los rechazaría (no hay porque la columna nació vacía).
--
--    Guarda: si ya se corrió esta migración una vez, el ADD CONSTRAINT tira.
--    Verificamos primero con information_schema.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public'
       and table_name = 'courses'
       and constraint_name = 'courses_external_app_fk'
  ) then
    alter table public.courses
      add constraint courses_external_app_fk
      foreign key (external_app_id)
      references public.external_apps(id)
      on delete set null;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on table public.external_apps is
  'Apps externas asociadas a un proyecto propio (ej: Nitro tiene una app de agenda de turnos con expertos). El link app↔curso vive en courses.external_app_id.';
comment on column public.external_apps.auth_strategy is
  'Cómo generar el token de SSO: jwt | shared_secret | oauth2 | magic_link. Ver src/lib/academia/external-app-sso.ts.';
comment on column public.external_apps.config is
  'Config específica de la strategy. Claves esperadas: secret, magic_link_endpoint, token_param, token_placement (query|hash), issuer, audience.';
comment on column public.external_apps.base_url is
  'URL raíz de la app externa (ej: https://agenda.nitro.reyacademy.com). El SSO url se construye a partir de esta base.';
