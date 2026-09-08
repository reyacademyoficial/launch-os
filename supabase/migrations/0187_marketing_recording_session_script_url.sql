-- Link opcional al guion de la grabación (típicamente un doc/carpeta de
-- Drive). No es obligatorio — muchas sesiones se improvisan sin guion
-- escrito, a diferencia de `materials` que ya existe.
alter table recording_sessions add column if not exists script_url text;
