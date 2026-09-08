-- Formato esperado de una edición (0180 content_edits), nullable — se
-- conoce típicamente al asignar editor, pero no es obligatorio: una edición
-- se puede crear sin saber todavía qué va a salir de ahí.
--
-- Alimenta el cálculo de capacidad diaria por editor (editor-load.ts):
-- convierte esta edición pendiente en una fracción de la jornada del editor
-- asignado, según su editor_format_capacity (0190) para este formato.
alter table public.content_edits
  add column target_format text
  check (target_format is null or target_format in (
    'reel','short','long','carousel','story','post'
  ));
