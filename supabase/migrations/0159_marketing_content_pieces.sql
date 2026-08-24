-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 3/9: content_pieces                                    │
-- │                                                                          │
-- │ Unidad atómica del plan editorial. Cada fila representa una pieza de     │
-- │ contenido que va a recorrer el pipeline: `planificado → en_grabacion →   │
-- │ en_edicion → listo_para_subir → publicado` (o `descartado` en cualquier  │
-- │ punto). Los stages se mueven automáticamente por triggers en 0165        │
-- │ cuando se completan las etapas siguientes (grabación realizada, asset    │
-- │ editado, upload subido).                                                 │
-- │                                                                          │
-- │ Multi-plataforma: una pieza puede estar destinada a IG + TikTok + YT     │
-- │ (por ejemplo un "reel" que se cross-postea). El array `platforms`        │
-- │ guarda ese fan-out en el nivel de plan. Los uploads reales viven en      │
-- │ 0163 con 1 fila por platform + fecha.                                    │
-- │                                                                          │
-- │ `recording_session_id` es nullable + SIN FK todavía — la tabla           │
-- │ `recording_sessions` entra en 0160. La FK se agrega en 0160 con         │
-- │ `on delete set null`. Este orden mantiene las migraciones atómicas:      │
-- │ ninguna tabla depende de una futura para su create table.                │
-- │                                                                          │
-- │ `is_daily_recurring` — cuando true, el trigger 0165                     │
-- │ (`content_piece_daily_regenerate`) crea un hermano al día siguiente     │
-- │ cuando el piece pasa a `publicado`. Sirve para el contenido diario que  │
-- │ el usuario describió: la tarea "cuando se marca como terminada en una    │
-- │ etapa se vuelve a generar automáticamente".                             │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Trigger extra: valida que el owner es      │
-- │ de la misma org (mismo patrón que 0158).                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_pieces (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organization(id) on delete restrict,
  content_owner_id          uuid not null references public.content_owners(id) on delete restrict,

  title                     text not null,
  script_md                 text,

  category                  text not null check (category in ('viral','nugget','otro')),
  format                    text not null check (format in ('reel','short','long','carousel','story','post')),

  -- Fan-out de plataformas destino. El array garantiza al menos 1 elemento
  -- y solo valores del repertorio conocido (mismo repertorio que
  -- publishing_cadences y content_uploads).
  platforms                 text[] not null check (
    array_length(platforms, 1) >= 1
    and platforms <@ array['instagram','facebook','tiktok','youtube']::text[]
  ),

  scheduled_recording_at    timestamptz,
  scheduled_publish_at      date,

  stage                     text not null default 'planificado' check (stage in (
    'planificado', 'en_grabacion', 'en_edicion',
    'listo_para_subir', 'publicado', 'descartado'
  )),

  -- Nullable + sin FK — la tabla `recording_sessions` entra en 0160. La FK
  -- (`on delete set null`) se agrega en esa migración. No poner FK acá
  -- evita que 0159 falle si se corre antes de 0160.
  recording_session_id      uuid,

  -- Cuando true, al pasar a `publicado` el trigger de 0165 clona el piece
  -- con scheduled_publish_at + 1 día y stage='planificado'. Sin cascada
  -- infinita: el flag se hereda, así que el hermano también regenera.
  is_daily_recurring        boolean not null default false,

  notes                     text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Índices frecuentes.
create index if not exists content_pieces_org_idx
  on public.content_pieces(organization_id);
create index if not exists content_pieces_owner_idx
  on public.content_pieces(content_owner_id);
create index if not exists content_pieces_stage_open_idx
  on public.content_pieces(organization_id, stage)
  where stage not in ('publicado', 'descartado');
create index if not exists content_pieces_publish_idx
  on public.content_pieces(scheduled_publish_at)
  where scheduled_publish_at is not null;
create index if not exists content_pieces_recording_idx
  on public.content_pieces(scheduled_recording_at)
  where scheduled_recording_at is not null;
create index if not exists content_pieces_session_idx
  on public.content_pieces(recording_session_id)
  where recording_session_id is not null;

drop trigger if exists set_updated_at on public.content_pieces;
create trigger set_updated_at before update on public.content_pieces
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard de coherencia: piece y owner deben vivir en la misma org.
--
-- Mismo patrón que publishing_cadences_owner_org_match (0158). Blinda contra
-- payloads manipulados que superen la RLS del owner. security definer con
-- search_path fijo — regla del proyecto.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_pieces_owner_org_match()
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
      'content_piece.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists content_pieces_owner_org_match_tg on public.content_pieces;
create trigger content_pieces_owner_org_match_tg
  before insert or update of content_owner_id, organization_id on public.content_pieces
  for each row execute function public.content_pieces_owner_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_pieces enable row level security;

revoke all on public.content_pieces from public;
revoke all on public.content_pieces from cliente_role;

grant select, insert, update, delete on public.content_pieces to authenticated;

drop policy if exists content_pieces_select on public.content_pieces;
create policy content_pieces_select on public.content_pieces
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_pieces_insert on public.content_pieces;
create policy content_pieces_insert on public.content_pieces
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_pieces_update on public.content_pieces;
create policy content_pieces_update on public.content_pieces
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_pieces_delete on public.content_pieces;
create policy content_pieces_delete on public.content_pieces
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
