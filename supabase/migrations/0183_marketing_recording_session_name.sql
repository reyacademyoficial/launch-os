-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — recording_sessions.name                               │
-- │                                                                          │
-- │ Las sesiones de grabación no tenían nombre propio — se identificaban     │
-- │ sólo por fecha + dueño ("24/08 · Rey Academy"), lo que las hace          │
-- │ ambiguas apenas hay más de una sesión el mismo día para el mismo dueño,  │
-- │ o cuando se las referencia desde otro lado del pipeline (picker de       │
-- │ Crudos, label del calendario). Columna nullable — no rompe sesiones      │
-- │ existentes, la UI cae al label de fecha+dueño cuando no hay nombre.      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.recording_sessions
  add column if not exists name text;

comment on column public.recording_sessions.name is
  'Nombre libre de la sesión (ej. "Reels semana 34"). Opcional — sin nombre, la UI muestra fecha + dueño.';
