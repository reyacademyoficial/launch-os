-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 8/9: content_uploads                                  │
-- │                                                                          │
-- │ Cada acto de subida a una plataforma específica en una fecha. Un asset  │
-- │ (`content_assets`) puede tener N uploads:                               │
-- │   - mismo asset a distintas plataformas (IG + TikTok)                  │
-- │   - mismo asset a la misma plataforma en distintas fechas (re-post)    │
-- │   - reintento tras fallo (status='fallida' + otra fila 'planificada')  │
-- │                                                                          │
-- │ El "no repetir" NO es constraint DB — vive en la UI + en el flag        │
-- │ `allow_repeat_asset` de `publishing_cadences`. Explícitamente permitido │
-- │ crear filas duplicadas si el operador lo quiere hacer.                  │
-- │                                                                          │
-- │ SHAPE                                                                    │
-- │   (id, organization_id, content_asset_id, platform, scheduled_for,     │
-- │    uploaded_at?, status, public_url?, notes?, ...timestamps)           │
-- │                                                                          │
-- │ ON DELETE                                                                │
-- │   content_asset_id RESTRICT — no se puede borrar un asset con uploads. │
-- │   Bloquea corrupción del historial de posteos.                          │
-- │                                                                          │
-- │ Triggers (0163):                                                         │
-- │   - upload_set_uploaded_at: al pasar status a 'subida' pobla            │
-- │     uploaded_at = now() si estaba null. Al retroceder, limpia.          │
-- │   - guard org-match: upload.org = asset.org (blinda cross-org).         │
-- │                                                                          │
-- │ Los triggers de "stage del piece origen se mueve a publicado" y         │
-- │ "regenerar hermano diario" viven en 0165 — separan el motor de stage    │
-- │ del CRUD de la tabla, mismo criterio que asset→piece (0162).            │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090.                                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_uploads (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  -- ON DELETE RESTRICT protege el historial de posteos.
  content_asset_id      uuid not null references public.content_assets(id) on delete restrict,

  platform              text not null check (platform in (
    'instagram', 'facebook', 'tiktok', 'youtube'
  )),

  scheduled_for         date not null,

  -- Poblado por trigger cuando status pasa a 'subida'. Manualmente
  -- sobrescribible desde la UI si se marca "ya subida antes de esta fecha".
  uploaded_at           timestamptz,

  status                text not null default 'planificada' check (status in (
    'planificada', 'subida', 'fallida', 'cancelada'
  )),

  -- Link al posteo real (IG permalink, TikTok URL, etc.). Solo tiene sentido
  -- cuando status='subida'. Sin constraint — un fallido puede quedar sin URL.
  public_url            text,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists content_uploads_org_idx
  on public.content_uploads(organization_id);
create index if not exists content_uploads_asset_idx
  on public.content_uploads(content_asset_id);
create index if not exists content_uploads_scheduled_idx
  on public.content_uploads(scheduled_for);
-- Índice pensado para la vista "próximas subidas" (planificadas por platform+fecha).
create index if not exists content_uploads_platform_scheduled_open_idx
  on public.content_uploads(platform, scheduled_for)
  where status = 'planificada';
-- Índice pensado para "uploads exitosos" (los que cuentan como asset usado).
create index if not exists content_uploads_asset_uploaded_idx
  on public.content_uploads(content_asset_id, status)
  where status = 'subida';

drop trigger if exists set_updated_at on public.content_uploads;
create trigger set_updated_at before update on public.content_uploads
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: upload.org = asset.org.
-- Blinda contra payloads cross-org (mismo patrón que assets/sessions).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_uploads_asset_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_org uuid;
begin
  select organization_id into v_asset_org
    from public.content_assets
    where id = new.content_asset_id;

  if v_asset_org is null then
    raise exception 'content_asset % not found', new.content_asset_id
      using errcode = '23503';
  end if;

  if v_asset_org <> new.organization_id then
    raise exception
      'content_upload.organization_id (%) does not match asset.organization_id (%)',
      new.organization_id, v_asset_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists content_uploads_asset_org_match_tg on public.content_uploads;
create trigger content_uploads_asset_org_match_tg
  before insert or update of content_asset_id, organization_id on public.content_uploads
  for each row execute function public.content_uploads_asset_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-fill de uploaded_at al pasar status a 'subida'. Retrocesos limpian
-- el campo. Idempotente (mismo patrón que recording_sessions.completed_at).
--
-- Excepción: si el operador setea explícitamente uploaded_at (ej. "ya se
-- subió hace 3 días"), respetamos su valor. La regla es "poblar SI está
-- null" — no pisamos un timestamp explícito.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_uploads_set_uploaded_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'subida'
     and old.status is distinct from 'subida'
     and new.uploaded_at is null then
    new.uploaded_at := now();
  elsif new.status <> 'subida' and old.status = 'subida' then
    new.uploaded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists content_uploads_set_uploaded_at_tg on public.content_uploads;
create trigger content_uploads_set_uploaded_at_tg
  before update of status on public.content_uploads
  for each row execute function public.content_uploads_set_uploaded_at();

-- Segundo trigger para INSERT: si viene creado directo con status='subida'
-- y sin uploaded_at, poblamos también. Un INSERT no dispara el BEFORE UPDATE.
create or replace function public.content_uploads_set_uploaded_at_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'subida' and new.uploaded_at is null then
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists content_uploads_set_uploaded_at_insert_tg on public.content_uploads;
create trigger content_uploads_set_uploaded_at_insert_tg
  before insert on public.content_uploads
  for each row execute function public.content_uploads_set_uploaded_at_insert();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_uploads enable row level security;

revoke all on public.content_uploads from public;
revoke all on public.content_uploads from cliente_role;

grant select, insert, update, delete on public.content_uploads to authenticated;

drop policy if exists content_uploads_select on public.content_uploads;
create policy content_uploads_select on public.content_uploads
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_uploads_insert on public.content_uploads;
create policy content_uploads_insert on public.content_uploads
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_uploads_update on public.content_uploads;
create policy content_uploads_update on public.content_uploads
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_uploads_delete on public.content_uploads;
create policy content_uploads_delete on public.content_uploads
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
