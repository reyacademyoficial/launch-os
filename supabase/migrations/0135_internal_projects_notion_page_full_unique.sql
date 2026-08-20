-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0135 — internal_projects.notion_page_id: partial → full unique index     │
-- │                                                                          │
-- │ El índice creado en 0132 era parcial (`where notion_page_id is not      │
-- │ null`). PostgREST no puede pasar el predicado del WHERE al ejecutar     │
-- │ `ON CONFLICT`, así que el `upsert(..., { onConflict: 'notion_page_id' })│
-- │ del sync fallaba con:                                                    │
-- │   "there is no unique or exclusion constraint matching the ON CONFLICT  │
-- │    specification"                                                        │
-- │                                                                          │
-- │ Reemplazamos por un índice pleno. En Postgres UNIQUE es NULLS DISTINCT  │
-- │ por default → múltiples filas con notion_page_id = NULL (projects       │
-- │ nativos) siguen conviviendo sin conflicto.                              │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop index if exists public.internal_projects_notion_page_uidx;

create unique index if not exists internal_projects_notion_page_uidx
  on public.internal_projects(notion_page_id);
