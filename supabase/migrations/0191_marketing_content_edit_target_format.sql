-- Formato esperado de una edición (0180 content_edits), nullable — se
-- conoce típicamente al asignar editor, pero no es obligatorio: una edición
-- se puede crear sin saber todavía qué va a salir de ahí.
--
-- Alimenta el cálculo de capacidad diaria por editor (editor-load.ts):
-- convierte esta edición pendiente en una fracción de la jornada del editor
-- asignado, según su editor_format_capacity (0190) para este formato.
-- Usa el enum de 0192 (otro/nugget/anuncios/reel/long).
--
-- `if not exists` + constraint separada (en vez de check inline en el add
-- column) para que esta migración sea re-corrible: si la columna ya existe
-- de una corrida anterior (con el CHECK viejo de 0191, previo a 0192), el
-- add column se saltea pero el constraint se reemplaza igual por el nuevo.
alter table public.content_edits add column if not exists target_format text;

alter table public.content_edits drop constraint if exists content_edits_target_format_check;
alter table public.content_edits
  add constraint content_edits_target_format_check
  check (target_format is null or target_format in (
    'otro','nugget','anuncios','reel','long'
  ));
