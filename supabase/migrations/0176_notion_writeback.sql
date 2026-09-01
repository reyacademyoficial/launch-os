-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0176 — Notion write-back (Anexo C · Fase 4a bis)                         │
-- │                                                                          │
-- │ PROBLEMA QUE RESUELVE                                                    │
-- │                                                                          │
-- │ Hasta 0132 el sync era one-way (Notion → KG). Marcar un proyecto como    │
-- │ 'listo' en KG modificaba solo la fila local; el siguiente sync leía      │
-- │ Notion (que seguía en el estado viejo) y pisaba el cambio. Desde el      │
-- │ punto de vista del operador, "los proyectos volvían solos al estado      │
-- │ original".                                                               │
-- │                                                                          │
-- │ A partir de acá, editar un proyecto sourced empuja los campos mapeados   │
-- │ de vuelta a la page de Notion (PATCH /v1/pages/:id). Estas 3 columnas    │
-- │ hacen ese push confiable ante fallos de red / token / permisos:          │
-- │                                                                          │
-- │   notion_push_pending — true cuando hay un cambio local que todavía no   │
-- │     llegó a Notion. El sync-runner NO pisa un proyecto con esta marca:   │
-- │     primero reintenta el push y recién después vuelve a leer. Así un     │
-- │     push fallido nunca se traduce en pérdida del cambio del operador.    │
-- │   notion_push_error — último error del push, para mostrarlo en la UI.    │
-- │   notion_pushed_at — timestamp del último push exitoso.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.internal_projects
  add column if not exists notion_push_pending boolean not null default false,
  add column if not exists notion_push_error   text,
  add column if not exists notion_pushed_at    timestamptz;

comment on column public.internal_projects.notion_push_pending is
  'true = hay una edición local que todavía no se escribió en Notion (0176). '
  'El sync salta la lectura Notion→KG de estos proyectos hasta reconciliar, '
  'para no pisar el cambio del operador con el valor viejo de Notion.';

comment on column public.internal_projects.notion_push_error is
  'Último error al escribir en Notion (token inválido, permiso faltante, '
  'propiedad inexistente). NULL cuando el último push salió bien.';

comment on column public.internal_projects.notion_pushed_at is
  'Timestamp del último push KG → Notion exitoso.';

-- Índice parcial: el sync-runner y la UI preguntan "¿qué quedó pendiente?".
-- Partial porque la enorme mayoría de las filas tienen false.
create index if not exists internal_projects_notion_push_pending_idx
  on public.internal_projects(notion_push_pending)
  where notion_push_pending;
