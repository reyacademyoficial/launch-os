-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 9/9: triggers upload → piece stage + daily regenerate │
-- │                                                                          │
-- │ Dos triggers finales del pipeline. Cierran la cadena:                    │
-- │   planificado → en_grabacion → en_edicion → listo_para_subir → publicado│
-- │                                                                          │
-- │ 1) content_piece_stage_from_upload                                       │
-- │    ─────────────────────────────                                         │
-- │    Cuando un content_upload pasa a status='subida' (o entra creado así),│
-- │    resolvemos su asset origen → si tiene source_content_piece_id,       │
-- │    movemos ese piece a `publicado`. Guarda:                              │
-- │      - solo si el piece está en 'listo_para_subir' (idempotente + no    │
-- │        retrocede desde publicado ni salta desde stages anteriores).     │
-- │      - AFTER INSERT + AFTER UPDATE OF status (transición → 'subida').  │
-- │                                                                          │
-- │ 2) content_piece_daily_regenerate                                        │
-- │    ────────────────────────────                                          │
-- │    Cuando un piece con is_daily_recurring=true pasa a `publicado`,      │
-- │    insertamos un CLON con:                                               │
-- │      - scheduled_publish_at = scheduled_publish_at + 1 día              │
-- │      - scheduled_recording_at = null (grabación es aparte)              │
-- │      - stage = 'planificado'                                             │
-- │      - recording_session_id = null (nueva sesión si hace falta)         │
-- │      - is_daily_recurring = true (herencia — hermano también regenera) │
-- │      - copia title, script_md, category, format, platforms, notes,      │
-- │        content_owner_id, organization_id                                │
-- │    AFTER UPDATE OF stage. Guarda con `IS DISTINCT FROM` — solo la       │
-- │    transición a 'publicado' genera hermano, no re-publicaciones          │
-- │    idempotentes ni cambios laterales.                                    │
-- │                                                                          │
-- │    Si `scheduled_publish_at` es null en el piece original, no hay a qué  │
-- │    sumarle 1 día → usamos `current_date + 1` como fallback.              │
-- │                                                                          │
-- │    Cascada: el hermano hereda `is_daily_recurring=true`, así que también│
-- │    va a regenerar. Se detiene solo si el operador cambia is_daily_       │
-- │    recurring=false en algún clon (posible desde el drawer).             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) content_piece_stage_from_upload
--
-- Resuelve el piece a través del asset:
--   upload.content_asset_id → asset.source_content_piece_id
-- Si ambos existen y el piece está en `listo_para_subir`, avanza a publicado.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_stage_from_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece_id uuid;
  v_should_run boolean;
begin
  -- Filtro: solo transición a 'subida'.
  if tg_op = 'INSERT' then
    v_should_run := new.status = 'subida';
  else
    v_should_run := new.status = 'subida' and old.status is distinct from 'subida';
  end if;

  if not v_should_run then
    return null;
  end if;

  -- Resolver el piece origen a través del asset.
  select source_content_piece_id into v_piece_id
    from public.content_assets
    where id = new.content_asset_id;

  if v_piece_id is null then
    return null;
  end if;

  update public.content_pieces
    set stage = 'publicado'
    where id = v_piece_id
      and stage = 'listo_para_subir';

  return null;
end;
$$;

drop trigger if exists content_piece_stage_from_upload_insert_tg on public.content_uploads;
create trigger content_piece_stage_from_upload_insert_tg
  after insert on public.content_uploads
  for each row execute function public.content_piece_stage_from_upload();

drop trigger if exists content_piece_stage_from_upload_update_tg on public.content_uploads;
create trigger content_piece_stage_from_upload_update_tg
  after update of status on public.content_uploads
  for each row execute function public.content_piece_stage_from_upload();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) content_piece_daily_regenerate
--
-- Al pasar un piece con is_daily_recurring=true a 'publicado', clonar
-- un hermano con scheduled_publish_at + 1 día en estado 'planificado'.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_daily_regenerate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_publish date;
begin
  -- Solo la transición fresca a 'publicado' con flag activo.
  if not (new.is_daily_recurring = true
          and new.stage = 'publicado'
          and old.stage is distinct from 'publicado') then
    return null;
  end if;

  -- Fallback: si el piece no tenía scheduled_publish_at, arrancamos "mañana".
  v_next_publish := coalesce(new.scheduled_publish_at, current_date) + 1;

  insert into public.content_pieces (
    organization_id,
    content_owner_id,
    title,
    script_md,
    category,
    format,
    platforms,
    scheduled_recording_at,
    scheduled_publish_at,
    stage,
    recording_session_id,
    is_daily_recurring,
    notes
  ) values (
    new.organization_id,
    new.content_owner_id,
    new.title,
    new.script_md,
    new.category,
    new.format,
    new.platforms,
    null,                    -- grabación se planifica aparte
    v_next_publish,
    'planificado',
    null,                    -- session se asigna aparte
    true,                    -- hereda flag → cascada natural
    new.notes
  );

  return null;
end;
$$;

drop trigger if exists content_piece_daily_regenerate_tg on public.content_pieces;
create trigger content_piece_daily_regenerate_tg
  after update of stage on public.content_pieces
  for each row execute function public.content_piece_daily_regenerate();
