-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Procesos / SOPs                       │
-- │                                                                          │
-- │ Procedimientos operativos documentados de la agencia. Contenido en      │
-- │ Markdown. Uso: onboarding de team member nuevo, playbooks de campañas, │
-- │ checklist de cierre de mes, etc.                                        │
-- │                                                                          │
-- │ VERSIONADO SIMPLE — decisión explícita                                   │
-- │ Sin tabla `process_revisions` aparte. `version` es un int que el        │
-- │ operador incrementa a mano cuando reescribe algo importante. El         │
-- │ historial fino queda fuera de scope de este bloque — si aparece la      │
-- │ necesidad real de trazar cambios, se agrega una tabla satélite después.│
-- │ YAGNI mientras solo haya que ver "el proceso actual".                   │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │ - `title`, `slug`, `content_md`, `category`, `version`, `active`.       │
-- │ - `slug` es único por org (para linkear procesos por URL amigable).    │
-- │   Case-insensitive vía lower() en el índice para evitar duplicados      │
-- │   por mayúsculas. Nullable — no toda org va a usar slugs desde día 1.  │
-- │ - `category` texto libre para agrupar (Ventas, Media, Onboarding…).    │
-- │   Sin CHECK porque cada org va a inventarse el suyo.                    │
-- │ - `active=false` = deprecado. NO se borra para preservar referencias.  │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.processes (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  title                 text not null,
  slug                  text,
  content_md            text not null default '',
  category              text,

  version               integer not null default 1 check (version >= 1),
  active                boolean not null default true,

  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists processes_org_idx
  on public.processes(organization_id);
create index if not exists processes_org_category_idx
  on public.processes(organization_id, category) where active = true;

-- slug único por org (case-insensitive), sólo cuando hay slug.
create unique index if not exists processes_org_slug_uniq
  on public.processes(organization_id, lower(slug))
  where slug is not null;

drop trigger if exists set_updated_at on public.processes;
create trigger set_updated_at before update on public.processes
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.processes enable row level security;

revoke all on public.processes from public;
revoke all on public.processes from cliente_role;

grant select, insert, update, delete on public.processes to authenticated;

drop policy if exists processes_select on public.processes;
create policy processes_select on public.processes
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists processes_insert on public.processes;
create policy processes_insert on public.processes
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists processes_update on public.processes;
create policy processes_update on public.processes
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists processes_delete on public.processes;
create policy processes_delete on public.processes
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
