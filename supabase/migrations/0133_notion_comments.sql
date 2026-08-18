-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0133 — Notion comments cache (Anexo C · Fase 4d)                          │
-- │                                                                          │
-- │ Cache local de los comentarios de las Notion pages que aterrizan como     │
-- │ `internal_projects`. Se popula desde `syncNotionDatabase` haciendo        │
-- │ `GET /v1/comments?block_id={pageId}` por page.                           │
-- │                                                                          │
-- │ Por qué cache y no fetch on-demand desde la ficha:                        │
-- │  - Notion Comments API pagina por page → una ficha con N proyectos        │
-- │    haría N requests + espera. Mala latencia.                              │
-- │  - Rate limit de Notion (3 req/s) se agotaría rápido con varios usuarios  │
-- │    abriendo fichas al mismo tiempo.                                       │
-- │  - Los comentarios cambian relativamente poco vs las views a la ficha.    │
-- │                                                                          │
-- │ SHAPE                                                                     │
-- │                                                                          │
-- │ `notion_comment_id` es UNIQUE global (Notion garantiza uuids únicos).     │
-- │ `internal_project_id` FK con ON DELETE CASCADE — si se borra el project,  │
-- │ los comentarios también. `organization_id` denormalizado siguiendo la     │
-- │ convención del bloque Ops (0093 checklists, 0095 blockers).               │
-- │                                                                          │
-- │ `notion_user_id` es texto sin FK compuesta a `notion_users(workspace_id,  │
-- │ notion_user_id)` — el sync ya escribe solo ids que existen en el cache    │
-- │ de users; la resolución a `organization_person` se hace por query cuando  │
-- │ la UI arma la vista.                                                     │
-- │                                                                          │
-- │ `content_plain` es v1: sin rich_text, sin mentions renderizados. En 4e    │
-- │ (write path) seguimos guardando plano en el cache pero enviamos rich a   │
-- │ Notion.                                                                  │
-- │                                                                          │
-- │ `created_time` y `updated_time` vienen tal cual de Notion (los usa la    │
-- │ UI para ordenar y mostrar "hace X"). `synced_at` es cuándo lo trajimos.  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.internal_project_notion_comments (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  internal_project_id   uuid not null references public.internal_projects(id) on delete cascade,

  -- ID del comentario en Notion (uuid). Único globalmente — lo usamos como
  -- clave de upsert en el sync incremental.
  notion_comment_id     text not null,

  -- Autor del comentario (raw notion_user_id). Puede quedar sin match en
  -- notion_users si el user fue eliminado del workspace después del comment.
  notion_user_id        text,

  content_plain         text not null default '',

  -- Timestamps de Notion (no locales). Notion los devuelve como ISO-8601
  -- con timezone; los guardamos como timestamptz.
  created_time          timestamptz not null,
  updated_time          timestamptz not null,

  -- Cuándo trajimos este comentario en el último sync. Sirve para debug
  -- ("¿por qué no veo el comentario nuevo?" — chequeás synced_at) y para
  -- futura invalidación selectiva.
  synced_at             timestamptz not null default now(),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint internal_project_notion_comments_notion_id_uniq
    unique (notion_comment_id)
);

create index if not exists internal_project_notion_comments_project_idx
  on public.internal_project_notion_comments(internal_project_id, created_time desc);

create index if not exists internal_project_notion_comments_org_idx
  on public.internal_project_notion_comments(organization_id);

drop trigger if exists set_updated_at on public.internal_project_notion_comments;
create trigger set_updated_at before update on public.internal_project_notion_comments
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.internal_project_notion_comments enable row level security;

revoke all on public.internal_project_notion_comments from public;
revoke all on public.internal_project_notion_comments from cliente_role;

grant select, insert, update, delete
  on public.internal_project_notion_comments to authenticated;

drop policy if exists internal_project_notion_comments_select
  on public.internal_project_notion_comments;
create policy internal_project_notion_comments_select
  on public.internal_project_notion_comments
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists internal_project_notion_comments_insert
  on public.internal_project_notion_comments;
create policy internal_project_notion_comments_insert
  on public.internal_project_notion_comments
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_project_notion_comments_update
  on public.internal_project_notion_comments;
create policy internal_project_notion_comments_update
  on public.internal_project_notion_comments
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_project_notion_comments_delete
  on public.internal_project_notion_comments;
create policy internal_project_notion_comments_delete
  on public.internal_project_notion_comments
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
