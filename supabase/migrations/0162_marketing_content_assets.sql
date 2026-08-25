-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 6/9: content_assets                                    │
-- │                                                                          │
-- │ Pieza EDITADA que sale de una recording_session y queda en stock lista   │
-- │ para subirse. Un asset puede venir de un `source_content_piece_id`      │
-- │ (piece master) o directamente de una `source_recording_session_id` (si   │
-- │ es un corte oportunístico que no tiene piece planificado). Ambos son     │
-- │ nullable — también soporta assets importados sin origen (video de       │
-- │ stock, screencasts, etc.).                                              │
-- │                                                                          │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │  Flujo con content_pieces                                                │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │                                                                          │
-- │ Al insertar un asset con `source_content_piece_id = X` Y `edited_at`    │
-- │ ya seteado, el trigger `content_piece_stage_from_asset_insert` avanza   │
-- │ la piece a `listo_para_subir`. El mismo movimiento se dispara si el     │
-- │ asset se crea sin `edited_at` y después se le setea (UPDATE).           │
-- │                                                                          │
-- │ Guarda: solo avanza si la piece está en `en_edicion` (no retrocede      │
-- │ desde publicado, ni salta desde planificado).                            │
-- │                                                                          │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │  drive URLs                                                              │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │                                                                          │
-- │ `drive_folder_url` es la carpeta compartida (típicamente 1 por sesión,  │
-- │ se repite entre assets hermanos). `drive_asset_url` es el archivo       │
-- │ puntual. No validamos que sea Drive específico — puede ser Dropbox,     │
-- │ Frame.io, Notion. Es una etiqueta "dónde vive el archivo".              │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Trigger extra: session/piece deben        │
-- │ pertenecer a la misma org (guard cross-org).                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_assets (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organization(id) on delete restrict,
  content_owner_id              uuid not null references public.content_owners(id) on delete restrict,

  -- Origen (ambos nullable — asset huérfano permitido para importaciones).
  source_recording_session_id   uuid references public.recording_sessions(id) on delete set null,
  source_content_piece_id       uuid references public.content_pieces(id) on delete set null,

  name                          text not null,
  format                        text not null check (format in (
    'reel','short','long','carousel','story','post'
  )),

  drive_folder_url              text,
  drive_asset_url               text,
  duration_seconds              integer check (duration_seconds is null or duration_seconds > 0),

  -- Editor a cargo. Nullable — un asset se puede registrar antes de asignar
  -- editor (queda en cola). SET NULL si la persona sale de la org.
  editor_person_id              uuid references public.organization_people(id) on delete set null,

  -- Fecha en que se marcó como editado (dispara trigger de stage). Nullable
  -- mientras el asset está "asignado / en cola". Setearlo mueve el piece a
  -- `listo_para_subir`.
  edited_at                     timestamptz,

  notes                         text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists content_assets_org_idx
  on public.content_assets(organization_id);
create index if not exists content_assets_owner_idx
  on public.content_assets(content_owner_id);
create index if not exists content_assets_editor_idx
  on public.content_assets(editor_person_id)
  where editor_person_id is not null;
create index if not exists content_assets_session_idx
  on public.content_assets(source_recording_session_id)
  where source_recording_session_id is not null;
create index if not exists content_assets_piece_idx
  on public.content_assets(source_content_piece_id)
  where source_content_piece_id is not null;
create index if not exists content_assets_edited_idx
  on public.content_assets(edited_at)
  where edited_at is not null;
-- Índice pensado para stock: assets ya editados, por owner+format. Los que
-- todavía no están editados no cuentan como stock.
create index if not exists content_assets_ready_stock_idx
  on public.content_assets(organization_id, content_owner_id, format)
  where edited_at is not null;

drop trigger if exists set_updated_at on public.content_assets;
create trigger set_updated_at before update on public.content_assets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: asset.org = owner.org, y (si aplica) session.org y
-- piece.org. Blinda contra payloads cross-org.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_assets_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org   uuid;
  v_session_org uuid;
  v_piece_org   uuid;
begin
  select organization_id into v_owner_org
    from public.content_owners
    where id = new.content_owner_id;

  if v_owner_org is null then
    raise exception 'content_owner % not found', new.content_owner_id
      using errcode = '23503';
  end if;

  if v_owner_org <> new.organization_id then
    raise exception
      'content_asset.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  if new.source_recording_session_id is not null then
    select organization_id into v_session_org
      from public.recording_sessions
      where id = new.source_recording_session_id;
    if v_session_org is not null and v_session_org <> new.organization_id then
      raise exception
        'content_asset.organization_id (%) does not match source_session.organization_id (%)',
        new.organization_id, v_session_org
        using errcode = '23514';
    end if;
  end if;

  if new.source_content_piece_id is not null then
    select organization_id into v_piece_org
      from public.content_pieces
      where id = new.source_content_piece_id;
    if v_piece_org is not null and v_piece_org <> new.organization_id then
      raise exception
        'content_asset.organization_id (%) does not match source_piece.organization_id (%)',
        new.organization_id, v_piece_org
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists content_assets_org_match_tg on public.content_assets;
create trigger content_assets_org_match_tg
  before insert or update of
    content_owner_id, organization_id,
    source_recording_session_id, source_content_piece_id
  on public.content_assets
  for each row execute function public.content_assets_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger: al crear un asset con edited_at seteado (o marcarlo editado con
-- UPDATE), avanzar el piece origen a `listo_para_subir`.
--
-- Guardas:
--   - solo si source_content_piece_id no es null
--   - solo si el piece está en `en_edicion` (idempotente + no retrocede)
--   - AFTER INSERT + AFTER UPDATE OF edited_at (nueva transición null → ts)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_stage_from_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_content_piece_id is null then
    return null;
  end if;

  -- INSERT nuevo con edited_at ya seteado.
  if tg_op = 'INSERT' and new.edited_at is not null then
    update public.content_pieces
      set stage = 'listo_para_subir'
      where id = new.source_content_piece_id
        and stage = 'en_edicion';
    return null;
  end if;

  -- UPDATE que pasa edited_at de null → timestamp.
  if tg_op = 'UPDATE'
     and new.edited_at is not null
     and old.edited_at is null then
    update public.content_pieces
      set stage = 'listo_para_subir'
      where id = new.source_content_piece_id
        and stage = 'en_edicion';
    return null;
  end if;

  return null;
end;
$$;

drop trigger if exists content_piece_stage_from_asset_insert_tg on public.content_assets;
create trigger content_piece_stage_from_asset_insert_tg
  after insert on public.content_assets
  for each row execute function public.content_piece_stage_from_asset();

drop trigger if exists content_piece_stage_from_asset_update_tg on public.content_assets;
create trigger content_piece_stage_from_asset_update_tg
  after update of edited_at on public.content_assets
  for each row execute function public.content_piece_stage_from_asset();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_assets enable row level security;

revoke all on public.content_assets from public;
revoke all on public.content_assets from cliente_role;

grant select, insert, update, delete on public.content_assets to authenticated;

drop policy if exists content_assets_select on public.content_assets;
create policy content_assets_select on public.content_assets
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_assets_insert on public.content_assets;
create policy content_assets_insert on public.content_assets
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_assets_update on public.content_assets;
create policy content_assets_update on public.content_assets
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_assets_delete on public.content_assets;
create policy content_assets_delete on public.content_assets
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
