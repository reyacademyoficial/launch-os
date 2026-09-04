-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 13/13: content_assets nace de content_edits           │
-- │                                                                          │
-- │ Cierra la separación crudo → edición → archivo final. Hasta acá,         │
-- │ `content_assets` cargaba editor + fecha objetivo + sesión de origen      │
-- │ directo en cada archivo (0162 + edit_due_date de 0175) — el atajo         │
-- │ "Registrar producción" creaba esas filas de un solo golpe desde la       │
-- │ sesión de grabación, sin pasar por crudo ni por un evento de edición     │
-- │ real. Ahora:                                                             │
-- │                                                                          │
-- │   content_assets.source_content_edit_id → content_edits(id)             │
-- │                                                                          │
-- │ ON DELETE RESTRICT — mismo patrón que `content_uploads → content_assets` │
-- │ (0163): no se puede borrar un evento de edición que ya produjo           │
-- │ archivos, hay que borrar los archivos primero.                          │
-- │                                                                          │
-- │ BACKFILL antes de dropear nada: cada combinación existente de            │
-- │ (owner, sesión, editor, fecha objetivo, drive_folder_url, edited_at) se  │
-- │ convierte en un `content_raw` sintético (si había sesión) + un           │
-- │ `content_edit` sintético, y los assets de esa combinación quedan         │
-- │ apuntando ahí. No se pierde ningún dato — se reorganiza.                 │
-- │                                                                          │
-- │ Después del backfill se dropean `editor_person_id`, `edit_due_date`,     │
-- │ `source_recording_session_id` y `drive_folder_url` de `content_assets`   │
-- │ (superados por `content_edits` / `content_raws`).                        │
-- │                                                                          │
-- │ Esta migración se aplica JUNTO con el rewrite de `/marketing/edicion` y  │
-- │ `/marketing/grabacion` — no correr sin actualizar el código, las         │
-- │ server actions viejas (`createProductionBatch`, `createAsset` con        │
-- │ editor/fecha) dejan de compilar contra el schema nuevo.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Columna nueva (nullable — un asset puede seguir siendo huérfano, mismo
--     criterio que source_content_piece_id).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_assets
  add column if not exists source_content_edit_id uuid
    references public.content_edits(id) on delete restrict;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · Backfill: content_assets existente → content_raws + content_edits
--     sintéticos, agrupando por la combinación de origen que ya tenía.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  v_raw_id uuid;
  v_edit_id uuid;
begin
  for r in
    select distinct
      content_owner_id,
      organization_id,
      source_recording_session_id,
      drive_folder_url,
      editor_person_id,
      edit_due_date,
      edited_at
    from public.content_assets
    where source_content_edit_id is null
      and (
        source_recording_session_id is not null
        or editor_person_id is not null
        or edit_due_date is not null
      )
  loop
    v_raw_id := null;

    if r.source_recording_session_id is not null then
      insert into public.content_raws (
        organization_id, content_owner_id, source_recording_session_id,
        name, drive_url, notes
      ) values (
        r.organization_id, r.content_owner_id, r.source_recording_session_id,
        'Crudo migrado (0181)',
        coalesce(r.drive_folder_url, '(sin link — completar tras la migración)'),
        'Generado automáticamente por la migración 0181 al separar crudos de archivos editados. Completar el link si hace falta.'
      )
      returning id into v_raw_id;
    end if;

    insert into public.content_edits (
      organization_id, content_owner_id, source_content_raw_id,
      title, editor_person_id, due_date, completed_at, notes
    ) values (
      r.organization_id, r.content_owner_id, v_raw_id,
      'Edición migrada (0181)',
      r.editor_person_id, r.edit_due_date, r.edited_at,
      'Generado automáticamente por la migración 0181 al separar crudos de archivos editados.'
    )
    returning id into v_edit_id;

    update public.content_assets a
      set source_content_edit_id = v_edit_id
      where a.source_content_edit_id is null
        and a.organization_id = r.organization_id
        and a.content_owner_id = r.content_owner_id
        and coalesce(a.source_recording_session_id::text, '') = coalesce(r.source_recording_session_id::text, '')
        and coalesce(a.drive_folder_url, '') = coalesce(r.drive_folder_url, '')
        and coalesce(a.editor_person_id::text, '') = coalesce(r.editor_person_id::text, '')
        and coalesce(a.edit_due_date::text, '') = coalesce(r.edit_due_date::text, '')
        and coalesce(a.edited_at::text, '') = coalesce(r.edited_at::text, '');
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · Reescribir el guard org-match: sale la referencia a
--     source_recording_session_id (columna a dropear), entra
--     source_content_edit_id.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_assets_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org uuid;
  v_piece_org uuid;
  v_edit_org  uuid;
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

  if new.source_content_edit_id is not null then
    select organization_id into v_edit_org
      from public.content_edits
      where id = new.source_content_edit_id;
    if v_edit_org is not null and v_edit_org <> new.organization_id then
      raise exception
        'content_asset.organization_id (%) does not match source_edit.organization_id (%)',
        new.organization_id, v_edit_org
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
    source_content_piece_id, source_content_edit_id
  on public.content_assets
  for each row execute function public.content_assets_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Dropear columnas superadas (ya migradas al backfill). Los índices que
--     dependían de estas columnas (content_assets_editor_idx,
--     content_assets_session_idx, content_assets_edit_queue_idx de 0175) se
--     dropean solos con la columna.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_assets drop column if exists editor_person_id;
alter table public.content_assets drop column if exists edit_due_date;
alter table public.content_assets drop column if exists source_recording_session_id;
alter table public.content_assets drop column if exists drive_folder_url;

create index if not exists content_assets_edit_idx
  on public.content_assets(source_content_edit_id)
  where source_content_edit_id is not null;
