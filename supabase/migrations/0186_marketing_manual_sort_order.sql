-- Orden manual (drag & drop) para las 5 tablas del pipeline de Producción.
-- `sort_order` es un entero libre que el usuario reordena a mano desde la
-- UI — se backfillea con el orden de creación para que las filas existentes
-- no queden todas en 0 (todas empatadas = orden indefinido en el primer
-- render). El "hueco" entre valores no importa: al reordenar, el cliente
-- manda la lista completa de IDs visibles y el server reescribe 0..N-1.

alter table content_pieces add column if not exists sort_order integer;
alter table recording_sessions add column if not exists sort_order integer;
alter table content_raws add column if not exists sort_order integer;
alter table content_edits add column if not exists sort_order integer;
alter table content_uploads add column if not exists sort_order integer;

with ordered as (
  select id, row_number() over (order by created_at) - 1 as rn
  from content_pieces
)
update content_pieces t set sort_order = ordered.rn
from ordered where ordered.id = t.id;

with ordered as (
  select id, row_number() over (order by created_at) - 1 as rn
  from recording_sessions
)
update recording_sessions t set sort_order = ordered.rn
from ordered where ordered.id = t.id;

with ordered as (
  select id, row_number() over (order by created_at) - 1 as rn
  from content_raws
)
update content_raws t set sort_order = ordered.rn
from ordered where ordered.id = t.id;

with ordered as (
  select id, row_number() over (order by created_at) - 1 as rn
  from content_edits
)
update content_edits t set sort_order = ordered.rn
from ordered where ordered.id = t.id;

with ordered as (
  select id, row_number() over (order by created_at) - 1 as rn
  from content_uploads
)
update content_uploads t set sort_order = ordered.rn
from ordered where ordered.id = t.id;

alter table content_pieces alter column sort_order set not null;
alter table content_pieces alter column sort_order set default 0;
alter table recording_sessions alter column sort_order set not null;
alter table recording_sessions alter column sort_order set default 0;
alter table content_raws alter column sort_order set not null;
alter table content_raws alter column sort_order set default 0;
alter table content_edits alter column sort_order set not null;
alter table content_edits alter column sort_order set default 0;
alter table content_uploads alter column sort_order set not null;
alter table content_uploads alter column sort_order set default 0;
