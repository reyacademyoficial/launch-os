-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0154 — course_parameters: simplificar tipos ('boolean','integer')       │
-- │                                                                          │
-- │ El editor de parámetros original (Fase B · 0145) exponía 3 tipos:       │
-- │ boolean, integer, text. El feedback del usuario (2026-08-22) fue que el │
-- │ tipo 'text' no aporta al caso de uso real (parámetros del alumno son   │
-- │ Sí/No o Cantidad — ej: "hizo diagnóstico", "cantidad de coaching").    │
-- │                                                                          │
-- │ Esta migración:                                                         │
-- │   1) Borra cualquier fila existente con type='text' (si el user creó   │
-- │      alguna en pruebas). Sus valores se eliminan por CASCADE.          │
-- │   2) Restringe el CHECK a ('boolean','integer').                       │
-- │                                                                          │
-- │ La columna value_text de student_parameter_values se mantiene — no    │
-- │ ocupa espacio significativo y evita un ciclo de add/drop si mañana se │
-- │ agrega un tipo texto de nuevo. El trigger b_check_value_shape         │
-- │ (creado en 0146) ya no será invocado con type='text', pero se deja    │
-- │ tolerante por si mañana cambia.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Borrar filas legacy con type='text' (si existieran)
--    Cascade elimina también los student_parameter_values asociados.
-- ═══════════════════════════════════════════════════════════════════════════
delete from public.course_parameters where type = 'text';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Restringir CHECK — solo boolean e integer
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.course_parameters
  drop constraint if exists course_parameters_type_check;

alter table public.course_parameters
  add constraint course_parameters_type_check
  check (type in ('boolean', 'integer'));

comment on column public.course_parameters.type is
  'Tipo del parámetro: boolean (Sí/No) o integer (Cantidad). El tipo ''text'' fue removido en 0154.';
