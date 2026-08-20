-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0136 — notion_databases: campos de identificación                        │
-- │                                                                          │
-- │ Con integrations que tocan varios teamspaces es común tener 2+ DBs con  │
-- │ el mismo `name` (ej: dos "Tasks" en teamspaces distintos). Antes solo   │
-- │ mostrábamos name + notion_id[0..8] → imposible distinguir cuál es cuál. │
-- │                                                                          │
-- │ Guardamos lo que la API `POST /v1/search` ya devuelve gratis:           │
-- │   - notion_url:   URL única en Notion. Clickeable = "abrir esta DB".    │
-- │   - icon:         emoji del ícono (si tiene), diferenciador visual.     │
-- │   - parent_type:  'workspace' | 'page_id' | 'database_id'.              │
-- │   - parent_id:    id del padre (null si parent_type='workspace').       │
-- │   - parent_title: resuelto por el caller con GET /v1/pages/:id o        │
-- │                   /v1/databases/:id (una llamada por padre único).      │
-- │                                                                          │
-- │ Todas nullable — DBs viejas pueden no tener estos campos hasta correr   │
-- │ "Descubrir DBs" de nuevo en la UI.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.notion_databases
  add column if not exists notion_url   text,
  add column if not exists icon         text,
  add column if not exists parent_type  text,
  add column if not exists parent_id    text,
  add column if not exists parent_title text;

comment on column public.notion_databases.notion_url is
  'URL pública de la database en Notion. Usada para link "abrir en Notion" en la UI de config.';

comment on column public.notion_databases.parent_type is
  'Tipo de padre según Notion API: workspace, page_id, database_id. Sirve para renderizar breadcrumb.';

comment on column public.notion_databases.parent_title is
  'Título del padre inmediato (page o database). Resuelto server-side durante "Descubrir DBs" con una llamada extra. NULL para parent_type=workspace o cuando la resolución falla.';
