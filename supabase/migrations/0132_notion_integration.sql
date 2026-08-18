-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0132 — Notion integration (Anexo C · Fase 4a)                            │
-- │                                                                          │
-- │ Sync one-way de Notion databases → `internal_projects` de Ops. Ver       │
-- │ diseño completo en `docs/INTEGRATIONS_NOTION.md`.                        │
-- │                                                                          │
-- │ ARQUITECTURA                                                             │
-- │                                                                          │
-- │ Multi-workspace: cada workspace de Notion se registra como fila en       │
-- │ `notion_workspaces` con su propio `secret_token` (internal integration). │
-- │ Cada workspace expone N databases sincronizables (`notion_databases`)    │
-- │ con mapeo de propiedades Notion→KG guardado como jsonb.                  │
-- │                                                                          │
-- │ Los usuarios de cada workspace se cachean en `notion_users` con un       │
-- │ mapeo opcional (`kg_person_id`) a `organization_people`. Ese mapeo lo    │
-- │ usa el sync de projects para resolver el `owner_id` a partir del         │
-- │ assignee de Notion.                                                      │
-- │                                                                          │
-- │ Los pages de Notion aterrizan en `internal_projects` usando tres cols    │
-- │ nuevas de metadata (page_id / database_id / workspace_id) y una marca    │
-- │ de última sincronización. La UI usa `notion_page_id NOT NULL` como       │
-- │ señal de "este project vino de Notion" (badge + warning al editar).     │
-- │                                                                          │
-- │ Cada corrida de sync loguea en `notion_sync_log` con status y errores.   │
-- │                                                                          │
-- │ TOKENS                                                                    │
-- │                                                                          │
-- │ `secret_token` se guarda como texto claro. RLS con `can_edit_organization`│
-- │ restringe SELECT/UPDATE a superadmin+dev (el helper 0051 hoy devuelve    │
-- │ `is_superadmin()`, que incluye ambos roles). Rotación del token: el      │
-- │ usuario regenera en Notion y edita la fila desde `/configuracion/notion`.│
-- │ Encriptación at-rest con pgsodium queda para v2 si aparece la necesidad. │
-- │                                                                          │
-- │ FRONTERA ORG                                                              │
-- │                                                                          │
-- │ `notion_workspaces` tiene `organization_id` directo. Las otras 3 tablas  │
-- │ (databases / users / sync_log) heredan la org vía `workspace_id` — se    │
-- │ resuelve con un helper `org_of_notion_workspace()` (mismo patrón que     │
-- │ `org_of_payroll` / `org_of_client_transfer` de 0129).                    │
-- │                                                                          │
-- │ `on delete cascade` en workspace_id → databases/users/sync_log: si se    │
-- │ elimina un workspace, todo lo colgado desaparece. Los internal_projects  │
-- │ NO tienen FK a workspace — sobreviven con notion_page_id apuntando a un  │
-- │ workspace que ya no existe (huérfanos trazables).                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) internal_projects — metadata de origen Notion
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.internal_projects
  add column if not exists notion_page_id      text,
  add column if not exists notion_database_id  text,
  add column if not exists notion_workspace_id uuid,
  add column if not exists notion_synced_at    timestamptz;

comment on column public.internal_projects.notion_page_id is
  'Page id de Notion cuando este project fue sincronizado (0132). '
  'NULL = project creado nativo en KG. UNIQUE — usado como clave de upsert.';

comment on column public.internal_projects.notion_database_id is
  'ID de la Notion database de origen. NULL para projects nativos.';

comment on column public.internal_projects.notion_workspace_id is
  'FK al workspace de origen. NULL para projects nativos. Sin ON DELETE '
  'CASCADE — un project synced sobrevive aunque se elimine el workspace, '
  'queda como registro histórico huérfano.';

comment on column public.internal_projects.notion_synced_at is
  'Timestamp del último sync exitoso desde Notion. Sirve para: (a) mostrar '
  '"sincronizado hace X" en UI, (b) sync incremental filtrando por '
  'last_edited_time > notion_synced_at.';

-- Índice UNIQUE parcial: los page_id son únicos globalmente en Notion,
-- pero los projects nativos tienen NULL en la columna. Partial evita
-- que "múltiples NULLs" violen la unicidad.
create unique index if not exists internal_projects_notion_page_uidx
  on public.internal_projects(notion_page_id)
  where notion_page_id is not null;

-- Índices auxiliares para el sync (buscar todos los projects de un
-- workspace o una database para reconciliar deletes).
create index if not exists internal_projects_notion_workspace_idx
  on public.internal_projects(notion_workspace_id)
  where notion_workspace_id is not null;

create index if not exists internal_projects_notion_database_idx
  on public.internal_projects(notion_database_id)
  where notion_database_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) notion_workspaces
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notion_workspaces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,

  name            text not null,
  -- Internal integration token de Notion. Formato "secret_xxx...".
  -- Guardado en claro; RLS restringe a superadmin+dev de la org.
  secret_token    text not null,
  enabled         boolean not null default true,

  -- Última vez que se probó la conexión (para mostrar "válido/expirado" en UI).
  last_verified_at timestamptz,
  last_verify_ok   boolean,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Un mismo workspace no debería registrarse dos veces en la misma org.
  -- Aunque Notion no expone workspace_id públicamente en el API, sí en el
  -- `bot.workspace_name` y el user con type=bot. Como fallback usamos
  -- el nombre elegido por el usuario en KG — no perfecto pero suficiente
  -- para prevenir duplicados obvios.
  constraint notion_workspaces_org_name_uniq unique (organization_id, name)
);

create index if not exists notion_workspaces_org_idx
  on public.notion_workspaces(organization_id);

drop trigger if exists set_updated_at on public.notion_workspaces;
create trigger set_updated_at before update on public.notion_workspaces
  for each row execute function public.set_updated_at();

alter table public.notion_workspaces enable row level security;

revoke all on public.notion_workspaces from public;
revoke all on public.notion_workspaces from cliente_role;
grant select, insert, update, delete on public.notion_workspaces to authenticated;

drop policy if exists notion_workspaces_select on public.notion_workspaces;
create policy notion_workspaces_select on public.notion_workspaces
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists notion_workspaces_insert on public.notion_workspaces;
create policy notion_workspaces_insert on public.notion_workspaces
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists notion_workspaces_update on public.notion_workspaces;
create policy notion_workspaces_update on public.notion_workspaces
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists notion_workspaces_delete on public.notion_workspaces;
create policy notion_workspaces_delete on public.notion_workspaces
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Helper de org-inheritance para las 3 tablas hijas
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.org_of_notion_workspace(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.notion_workspaces where id = p_workspace_id
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) notion_databases
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notion_databases (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.notion_workspaces(id) on delete cascade,

  -- ID interno de la Notion database ("32 chars hex sin guiones" en su API).
  notion_id    text not null,
  name         text not null,

  -- Mapeo de propiedades Notion → shape internal_project. Ver
  -- INTEGRATIONS_NOTION.md §4c para el shape esperado.
  -- Estructura sugerida:
  --   {
  --     "title_prop":       "Name",
  --     "status_prop":      "Status",
  --     "status_map":       { "Not started":"backlog", "In progress":"active", ... },
  --     "priority_prop":    "Priority",
  --     "priority_map":     { "Low":"low", "Medium":"med", ... },
  --     "assignee_prop":    "Assignee",
  --     "due_prop":         "Due",
  --     "start_prop":       "Start",
  --     "description_source": "body"    -- o "property:Description"
  --   }
  -- default '{}': la DB se descubre pero no importa hasta configurar el mapeo.
  property_map jsonb not null default '{}'::jsonb,
  enabled      boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Una DB de Notion no debería aparecer dos veces bajo el mismo workspace.
  constraint notion_databases_workspace_notion_uniq unique (workspace_id, notion_id)
);

create index if not exists notion_databases_workspace_idx
  on public.notion_databases(workspace_id);

drop trigger if exists set_updated_at on public.notion_databases;
create trigger set_updated_at before update on public.notion_databases
  for each row execute function public.set_updated_at();

alter table public.notion_databases enable row level security;

revoke all on public.notion_databases from public;
revoke all on public.notion_databases from cliente_role;
grant select, insert, update, delete on public.notion_databases to authenticated;

drop policy if exists notion_databases_select on public.notion_databases;
create policy notion_databases_select on public.notion_databases
  for select to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_databases_insert on public.notion_databases;
create policy notion_databases_insert on public.notion_databases
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_databases_update on public.notion_databases;
create policy notion_databases_update on public.notion_databases
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)))
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_databases_delete on public.notion_databases;
create policy notion_databases_delete on public.notion_databases
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) notion_users
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notion_users (
  workspace_id      uuid not null references public.notion_workspaces(id) on delete cascade,
  notion_user_id    text not null,

  email             text,
  name              text,
  avatar_url        text,
  -- Mapeo opcional a una persona de la org. NULL = sin mapear (aparece en
  -- la UI para asignar manualmente). Se popula automáticamente en el
  -- sync de users por email match. on delete set null preserva histórico.
  kg_person_id      uuid references public.organization_people(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (workspace_id, notion_user_id)
);

create index if not exists notion_users_workspace_idx
  on public.notion_users(workspace_id);

create index if not exists notion_users_kg_person_idx
  on public.notion_users(kg_person_id) where kg_person_id is not null;

drop trigger if exists set_updated_at on public.notion_users;
create trigger set_updated_at before update on public.notion_users
  for each row execute function public.set_updated_at();

alter table public.notion_users enable row level security;

revoke all on public.notion_users from public;
revoke all on public.notion_users from cliente_role;
grant select, insert, update, delete on public.notion_users to authenticated;

drop policy if exists notion_users_select on public.notion_users;
create policy notion_users_select on public.notion_users
  for select to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_users_insert on public.notion_users;
create policy notion_users_insert on public.notion_users
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_users_update on public.notion_users;
create policy notion_users_update on public.notion_users
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)))
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_users_delete on public.notion_users;
create policy notion_users_delete on public.notion_users
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) notion_sync_log
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notion_sync_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.notion_workspaces(id) on delete cascade,
  -- NULL cuando el sync corrió sobre "todos" (users + todas las DBs del
  -- workspace). Con un ID puntual cuando corre sobre una DB específica.
  database_id   uuid references public.notion_databases(id) on delete set null,

  -- Tipo de sync — separa runs de users vs projects vs "todo" para
  -- diagnóstico rápido.
  kind          text not null check (kind in ('users', 'database', 'workspace')),

  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  -- Estados: running (arrancó y no terminó), ok, error, partial.
  -- partial: procesó algunos items y falló antes de completar.
  status        text not null default 'running'
                check (status in ('running', 'ok', 'error', 'partial')),
  error         text,
  items_synced  int  not null default 0
);

create index if not exists notion_sync_log_workspace_started_idx
  on public.notion_sync_log(workspace_id, started_at desc);

create index if not exists notion_sync_log_running_idx
  on public.notion_sync_log(workspace_id) where status = 'running';

alter table public.notion_sync_log enable row level security;

revoke all on public.notion_sync_log from public;
revoke all on public.notion_sync_log from cliente_role;
grant select, insert, update, delete on public.notion_sync_log to authenticated;

drop policy if exists notion_sync_log_select on public.notion_sync_log;
create policy notion_sync_log_select on public.notion_sync_log
  for select to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_sync_log_insert on public.notion_sync_log;
create policy notion_sync_log_insert on public.notion_sync_log
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_sync_log_update on public.notion_sync_log;
create policy notion_sync_log_update on public.notion_sync_log
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)))
  with check (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));

drop policy if exists notion_sync_log_delete on public.notion_sync_log;
create policy notion_sync_log_delete on public.notion_sync_log
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_notion_workspace(workspace_id)));
