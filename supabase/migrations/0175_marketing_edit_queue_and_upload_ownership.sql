-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 10/10: cola de edición + autoría de subidas           │
-- │                                                                          │
-- │ Tres cambios aditivos que alinean el schema con el procedimiento         │
-- │ operativo real del equipo de contenido:                                  │
-- │                                                                          │
-- │ 1. PLANIFICACIÓN → GRABACIÓN por FECHA, no por sesión.                   │
-- │    Hasta 0160 el piece pasaba a `en_grabacion` sólo cuando se lo         │
-- │    vinculaba a una `recording_session`. En la práctica el disparador     │
-- │    es cargar la fecha de grabación: a partir de ahí la pieza ya no vive  │
-- │    en Planificación, vive en Grabación (con o sin sesión armada). El     │
-- │    trigger nuevo hace ese movimiento y también el inverso: borrar la     │
-- │    fecha de una pieza sin sesión la devuelve a `planificado`.            │
-- │                                                                          │
-- │ 2. content_assets.edit_due_date — COLA DE EDICIÓN.                       │
-- │    `edited_at` responde "¿cuándo se editó?" (pasado). Faltaba el         │
-- │    "¿para cuándo tiene que estar?" (futuro), que es lo único que puede   │
-- │    alimentar un planning semanal de verdad. Sin este campo el pivot de   │
-- │    /marketing/edicion bucketeaba por `edited_at ?? created_at` y por     │
-- │    eso amontonaba todo en la semana actual.                             │
-- │                                                                          │
-- │ 3. content_uploads.planned_by / uploaded_by — SPLIT LÍDER ⇄ CM.          │
-- │    El líder del equipo deja la subida seteada (fecha + contenido), el    │
-- │    community manager marca que efectivamente la subió. Sin rol nuevo:    │
-- │    registramos QUIÉN hizo cada mitad. `uploaded_by_person_id` se limpia  │
-- │    si la subida se revierte, igual que `uploaded_at` en 0163.            │
-- │                                                                          │
-- │ Todo aditivo: columnas nullable, sin backfill destructivo, sin cambios   │
-- │ de RLS (las policies de 0159/0162/0163 cubren las columnas nuevas).      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · content_pieces: la fecha de grabación mueve el stage
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_stage_from_recording_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cargar fecha ⇒ la pieza sale de Planificación y entra a Grabación.
  if new.stage = 'planificado' and new.scheduled_recording_at is not null then
    new.stage := 'en_grabacion';
    return new;
  end if;

  -- Borrar la fecha ⇒ vuelve a Planificación, PERO sólo si tampoco tiene
  -- sesión vinculada. Con sesión armada la pieza sigue en Grabación aunque
  -- se limpie la fecha tentativa (manda la sesión).
  if tg_op = 'UPDATE'
     and new.stage = 'en_grabacion'
     and new.scheduled_recording_at is null
     and new.recording_session_id is null then
    new.stage := 'planificado';
  end if;

  return new;
end;
$$;

-- Nombre elegido para que ordene ANTES de
-- `content_piece_stage_from_session_link_tg` ('r' < 's'): si en el mismo
-- UPDATE llegan fecha y sesión, éste setea `en_grabacion` y el de sesión
-- queda no-op (su guard exige stage='planificado'). Idempotente.
drop trigger if exists content_piece_stage_from_recording_date_tg on public.content_pieces;
create trigger content_piece_stage_from_recording_date_tg
  before insert or update on public.content_pieces
  for each row execute function public.content_piece_stage_from_recording_date();

-- Backfill: pieces que ya tenían fecha cargada y siguen en 'planificado'.
-- El trigger es BEFORE UPDATE, así que un UPDATE no-op lo dispara.
update public.content_pieces
  set scheduled_recording_at = scheduled_recording_at
  where stage = 'planificado'
    and scheduled_recording_at is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · content_assets: fecha objetivo de edición (cola de trabajo)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_assets
  add column if not exists edit_due_date date;

comment on column public.content_assets.edit_due_date is
  'Fecha objetivo de edición (futuro). Bucket del planning semanal de /marketing/edicion. Distinto de edited_at, que registra cuándo se terminó.';

-- Índice para la cola: assets pendientes (sin edited_at) ordenados por
-- vencimiento. Parcial — los ya editados no se consultan por esta vía.
create index if not exists content_assets_edit_queue_idx
  on public.content_assets(organization_id, edit_due_date)
  where edited_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · content_uploads: quién planificó / quién subió
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_uploads
  add column if not exists planned_by_person_id uuid
    references public.organization_people(id) on delete set null;

alter table public.content_uploads
  add column if not exists uploaded_by_person_id uuid
    references public.organization_people(id) on delete set null;

comment on column public.content_uploads.planned_by_person_id is
  'Persona que dejó la subida seteada (líder del equipo). Se completa desde la server action con resolveCurrentPersonId().';
comment on column public.content_uploads.uploaded_by_person_id is
  'Persona que confirmó la subida (community manager). Se limpia si la subida se revierte, igual que uploaded_at.';

create index if not exists content_uploads_uploaded_by_idx
  on public.content_uploads(uploaded_by_person_id)
  where uploaded_by_person_id is not null;

-- Espejo de `content_uploads_set_uploaded_at` (0163): revertir el status
-- también borra la autoría de la subida, para no dejar un "lo subió Fulano"
-- colgado en una fila que ya no está subida.
create or replace function public.content_uploads_clear_uploader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'subida' and old.status = 'subida' then
    new.uploaded_by_person_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists content_uploads_clear_uploader_tg on public.content_uploads;
create trigger content_uploads_clear_uploader_tg
  before update of status on public.content_uploads
  for each row execute function public.content_uploads_clear_uploader();
