-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 1/9: content_owners                                    │
-- │                                                                          │
-- │ "Dueño de contenido" = la cuenta/marca a la que se sube el contenido.    │
-- │ Ejemplos: "Rey Academy", "Kevin Machado", "Growins". Cada dueño tiene    │
-- │ su propio pipeline (planificación/grabación/edición/publicación) y su    │
-- │ propio stock disponible.                                                 │
-- │                                                                          │
-- │ NO es lo mismo que `clients` (B2B externos que contratan a Kingrow) ni   │
-- │ que `projects.ownership='propia'`. En la práctica un content_owner       │
-- │ suele coincidir con un project propio, pero se mantienen separados       │
-- │ porque un dueño puede no tener project asociado (marca personal), o un   │
-- │ project propio puede no producir contenido.                              │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090 (internal_projects). Handles por            │
-- │ plataforma como columnas nullables — el CHECK de plataformas vive en    │
-- │ las tablas que referencian (0158 cadencias, 0159 pieces, 0163 uploads). │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_owners (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,

  -- Handles opcionales por plataforma. Se guardan sin el @ inicial; la UI
  -- se encarga del prefijo al mostrarlos y de construir el link al perfil.
  handle_instagram      text,
  handle_facebook       text,
  handle_tiktok         text,
  handle_youtube        text,

  notes                 text,

  active                boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Índice principal org.
create index if not exists content_owners_org_idx
  on public.content_owners(organization_id);

-- Índice parcial: listado default filtra por active=true.
create index if not exists content_owners_org_active_idx
  on public.content_owners(organization_id) where active = true;

-- Unique parcial por (org, lower(name)) mientras esté activo. Un dueño
-- archivado libera el nombre para uno nuevo (mismo criterio que `clients`).
create unique index if not exists content_owners_org_name_active_uidx
  on public.content_owners(organization_id, lower(name))
  where active = true;

drop trigger if exists set_updated_at on public.content_owners;
create trigger set_updated_at before update on public.content_owners
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_owners enable row level security;

revoke all on public.content_owners from public;
revoke all on public.content_owners from cliente_role;

grant select, insert, update, delete on public.content_owners to authenticated;

drop policy if exists content_owners_select on public.content_owners;
create policy content_owners_select on public.content_owners
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_owners_insert on public.content_owners;
create policy content_owners_insert on public.content_owners
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_owners_update on public.content_owners;
create policy content_owners_update on public.content_owners
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_owners_delete on public.content_owners;
create policy content_owners_delete on public.content_owners
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
