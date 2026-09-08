-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ "Formato" deja de ser el layout de publicación (reel/short/long/         │
-- │ carousel/story/post) y pasa a ser el TIPO de pieza que mide la           │
-- │ capacidad de edición: otro/nugget/anuncios/reel/long. El layout de       │
-- │ publicación real vive en `platform` (0158) — nunca hizo falta un         │
-- │ formato aparte para eso.                                                 │
-- │                                                                          │
-- │ Remapeo de valores viejos → nuevos (antes de tocar el CHECK, porque      │
-- │ Postgres valida TODAS las filas existentes contra un CHECK nuevo):       │
-- │   short              → reel      (ambos video corto vertical)           │
-- │   carousel/story/post → otro     (sin equivalente 1:1 en el nuevo enum)  │
-- │                                                                          │
-- │ ORDEN CRÍTICO: el CHECK viejo se dropea ANTES del remapeo, no después —  │
-- │ si se remapea primero, el valor nuevo ('otro') todavía no es válido      │
-- │ bajo el CHECK viejo y el UPDATE explota (pasó en la primera versión de   │
-- │ esta migración).                                                        │
-- │                                                                          │
-- │ `publishing_cadences` tiene PK (content_owner_id, platform, format) —    │
-- │ el remapeo puede generar colisiones (ej: un owner con cadencia 'story'   │
-- │ Y 'post' en la misma plataforma, ambas migran a 'otro'). Se resuelve     │
-- │ quedándose con la de mayor tasa diaria (times_count/period_days) y       │
-- │ borrando el resto — perder la cadencia menos exigente es más seguro que  │
-- │ perder la más exigente.                                                 │
-- │                                                                          │
-- │ Re-corrible: todos los pasos usan `if exists`/`if not exists` y los      │
-- │ UPDATE de remapeo son no-ops si ya no queda ningún valor viejo.          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Dropear los 3 CHECK viejos ANTES de tocar ningún dato.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_pieces drop constraint if exists content_pieces_format_check;
alter table public.content_assets drop constraint if exists content_assets_format_check;
alter table public.publishing_cadences drop constraint if exists publishing_cadences_format_check;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · Remapeo de valores viejos → nuevos, sin CHECK que lo bloquee.
-- ═══════════════════════════════════════════════════════════════════════════

update public.content_pieces set format = 'reel' where format = 'short';
update public.content_pieces set format = 'otro' where format in ('carousel', 'story', 'post');

update public.content_assets set format = 'reel' where format = 'short';
update public.content_assets set format = 'otro' where format in ('carousel', 'story', 'post');

update public.publishing_cadences set format = 'reel' where format = 'short';
update public.publishing_cadences set format = 'otro' where format in ('carousel', 'story', 'post');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · publishing_cadences — dedupe de colisiones de PK post-remapeo.
-- ═══════════════════════════════════════════════════════════════════════════

with ranked as (
  select
    ctid,
    row_number() over (
      partition by content_owner_id, platform, format
      order by (times_count::numeric / period_days) desc, created_at asc
    ) as rn
  from public.publishing_cadences
)
delete from public.publishing_cadences t
where t.ctid in (select ctid from ranked where rn > 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Agregar los 3 CHECK nuevos, con los datos ya remapeados.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_pieces
  add constraint content_pieces_format_check
  check (format in ('otro', 'nugget', 'anuncios', 'reel', 'long'));

alter table public.content_assets
  add constraint content_assets_format_check
  check (format in ('otro', 'nugget', 'anuncios', 'reel', 'long'));

alter table public.publishing_cadences
  add constraint publishing_cadences_format_check
  check (format in ('otro', 'nugget', 'anuncios', 'reel', 'long'));
