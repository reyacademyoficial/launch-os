-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 4/9: recording_sessions + FK y triggers de stage      │
-- │                                                                          │
-- │ Sesión de grabación. Agrupa 1..N content_pieces (de un mismo owner —     │
-- │ una sesión se hace con el experto de una marca a la vez). Fecha, dur,   │
-- │ ubicación, materiales, notas y status. Los assignees (filmaker,          │
-- │ experto, asistente) viven en el junction de 0161.                        │
-- │                                                                          │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │  FK diferida de 0159 — content_pieces.recording_session_id              │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │                                                                          │
-- │ La columna se creó en 0159 sin FK porque `recording_sessions` no        │
-- │ existía. Ahora que existe, agregamos la FK con `on delete set null`:    │
-- │ borrar una sesión no destruye las piezas, solo las desata (vuelven al   │
-- │ estado de "no asociadas"). NOTA: el status de la piece NO se toca al    │
-- │ desatar — si la sesión ya se realizó y la piece pasó a `en_edicion`,   │
-- │ borrar la sesión la deja en `en_edicion` con recording_session_id=null.│
-- │ Es intencional: el historial de que ya se grabó no se pierde por        │
-- │ borrar la sesión.                                                        │
-- │                                                                          │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │  Triggers de stage — flujo de grabación                                 │
-- │ ─────────────────────────────────────────────────────────────────────── │
-- │                                                                          │
-- │ Dos triggers componen el flujo de esta etapa del pipeline:              │
-- │                                                                          │
-- │  1. content_piece_stage_from_session_link                                │
-- │     ─────────────────────────────────────                                │
-- │     Cuando `recording_session_id` de una piece pasa de NULL a un valor  │
-- │     (asignación), y la piece está en `planificado`, la movemos a        │
-- │     `en_grabacion`. Así la tabla de planificación deja de mostrarla     │
-- │     como "por hacer" y la grabación toma el relevo visual.              │
-- │                                                                          │
-- │  2. content_piece_stage_from_session_status                              │
-- │     ────────────────────────────────────────                             │
-- │     Cuando una session pasa a `status='realizada'`, TODAS las pieces    │
-- │     que la referencian y que estén en `planificado` o `en_grabacion`    │
-- │     avanzan a `en_edicion`. Las que ya están en stages más adelantados │
-- │     (listo_para_subir, publicado) o descartadas NO se tocan — sería     │
-- │     retroceder o pisar historial.                                        │
-- │                                                                          │
-- │ Ambos triggers son idempotentes: transiciones ya aplicadas no vuelven a │
-- │ ejecutar (guarda con `IS DISTINCT FROM`).                                │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Trigger extra org-match owner.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.recording_sessions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,
  content_owner_id      uuid not null references public.content_owners(id) on delete restrict,

  scheduled_at          timestamptz not null,
  duration_minutes      integer check (duration_minutes is null or duration_minutes > 0),
  location              text,
  materials             text,
  notes                 text,

  status                text not null default 'planificada' check (status in (
    'planificada', 'confirmada', 'realizada', 'cancelada'
  )),

  -- Poblado por trigger cuando status pasa a 'realizada'. Mismo criterio
  -- que tickets.resolved_at (bloque Clientes) / tasks.completed_at (bloque
  -- Operaciones).
  completed_at          timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists recording_sessions_org_idx
  on public.recording_sessions(organization_id);
create index if not exists recording_sessions_owner_idx
  on public.recording_sessions(content_owner_id);
create index if not exists recording_sessions_scheduled_idx
  on public.recording_sessions(scheduled_at);
create index if not exists recording_sessions_status_idx
  on public.recording_sessions(organization_id, status)
  where status not in ('realizada', 'cancelada');

drop trigger if exists set_updated_at on public.recording_sessions;
create trigger set_updated_at before update on public.recording_sessions
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: session.organization_id = owner.organization_id.
-- Mismo patrón que 0158 y 0159.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.recording_sessions_owner_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org uuid;
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
      'recording_session.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists recording_sessions_owner_org_match_tg on public.recording_sessions;
create trigger recording_sessions_owner_org_match_tg
  before insert or update of content_owner_id, organization_id on public.recording_sessions
  for each row execute function public.recording_sessions_owner_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-fill de completed_at al pasar a 'realizada'. Idempotente:
-- retrocesos (a planificada/confirmada) limpian el campo; ir dos veces a
-- realizada no toca (ya estaba seteado).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.recording_sessions_set_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'realizada' and old.status is distinct from 'realizada' then
    new.completed_at := now();
  elsif new.status <> 'realizada' and old.status = 'realizada' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists recording_sessions_set_completed_at_tg on public.recording_sessions;
create trigger recording_sessions_set_completed_at_tg
  before update of status on public.recording_sessions
  for each row execute function public.recording_sessions_set_completed_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.recording_sessions enable row level security;

revoke all on public.recording_sessions from public;
revoke all on public.recording_sessions from cliente_role;

grant select, insert, update, delete on public.recording_sessions to authenticated;

drop policy if exists recording_sessions_select on public.recording_sessions;
create policy recording_sessions_select on public.recording_sessions
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists recording_sessions_insert on public.recording_sessions;
create policy recording_sessions_insert on public.recording_sessions
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists recording_sessions_update on public.recording_sessions;
create policy recording_sessions_update on public.recording_sessions
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists recording_sessions_delete on public.recording_sessions;
create policy recording_sessions_delete on public.recording_sessions
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- FK diferida de 0159 — ya podemos poner content_pieces.recording_session_id
-- apuntando a esta tabla.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_pieces
  drop constraint if exists content_pieces_recording_session_fk;

alter table public.content_pieces
  add constraint content_pieces_recording_session_fk
  foreign key (recording_session_id)
  references public.recording_sessions(id)
  on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger 1: al asignar/desasignar una session a un piece, avanzar el stage.
--
-- Solo se dispara en la transición NULL → uuid (asignación fresca) y solo
-- si el piece está en 'planificado'. Cambiar la asociación de una session
-- a otra (uuid → uuid distinto) NO retrocede stage — la interpretación es
-- "cambio de sesión, mismo pipeline", no "reasignar de cero".
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_stage_from_session_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recording_session_id is not null
     and old.recording_session_id is null
     and new.stage = 'planificado' then
    new.stage := 'en_grabacion';
  end if;
  return new;
end;
$$;

drop trigger if exists content_piece_stage_from_session_link_tg on public.content_pieces;
create trigger content_piece_stage_from_session_link_tg
  before update of recording_session_id on public.content_pieces
  for each row execute function public.content_piece_stage_from_session_link();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger 2: al pasar una session a 'realizada', avanzar las pieces
-- asociadas que estén en planificado|en_grabacion a en_edicion.
--
-- AFTER UPDATE + statement-level bulk update para evitar N triggers row-by-
-- row. Idempotente: si una piece ya está en un stage posterior, no se toca
-- (WHERE stage in ('planificado','en_grabacion')).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_piece_stage_from_session_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'realizada' and old.status is distinct from 'realizada' then
    update public.content_pieces
      set stage = 'en_edicion'
      where recording_session_id = new.id
        and stage in ('planificado', 'en_grabacion');
  end if;
  return null;
end;
$$;

drop trigger if exists content_piece_stage_from_session_status_tg on public.recording_sessions;
create trigger content_piece_stage_from_session_status_tg
  after update of status on public.recording_sessions
  for each row execute function public.content_piece_stage_from_session_status();
