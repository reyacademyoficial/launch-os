-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 4 (escala) — Import masivo + tabla a volumen + buscador             │
-- │                                                                          │
-- │ Decisiones del brief:                                                    │
-- │   - Un launch puede tener ~20k leads. El kanban no soporta ese volumen;  │
-- │     pasa a mostrar solo los leads "pinned" (promovidos a mano).         │
-- │   - El import xlsx normaliza el teléfono a E.164 al cargar y dedupea     │
-- │     por (project_id, phone_normalized).                                 │
-- │   - El buscador es server-side con índices trigram (GIN) para que ilike  │
-- │     parcial sea rápido en datasets grandes.                             │
-- │                                                                          │
-- │ NO se tocan policies — los nuevos campos están cubiertos por las RLS    │
-- │ existentes (`leads_*`) sin cambios.                                     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Extensión pg_trgm (búsqueda parcial rápida con ilike)
-- ═══════════════════════════════════════════════════════════════════════════
create extension if not exists pg_trgm;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Nuevas columnas en leads
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists email             text,
  add column if not exists phone_normalized  text,
  add column if not exists pinned_to_kanban  boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Extender check de source: sumar 'import' como origen distinto de manual
--    para que sea auditable de dónde vino cada lead.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  drop constraint if exists leads_source_check;

alter table public.leads
  add constraint leads_source_check
  check (source in ('manual', 'import', 'meta', 'ghl', 'otro'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Índice unique parcial sobre (project_id, phone_normalized).
--    Dedup hard a nivel DB: el import skipea duplicados y reporta.
--    Partial WHERE phone_normalized IS NOT NULL para que leads sin teléfono
--    no compitan entre sí por el constraint.
-- ═══════════════════════════════════════════════════════════════════════════
create unique index if not exists leads_phone_normalized_unique_idx
  on public.leads(project_id, phone_normalized)
  where phone_normalized is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Índices btree para filtros server-side de la tabla a volumen
--    Ya existen: leads_project_idx, leads_project_status_idx, leads_launch_idx,
--    leads_team_member_idx (en 0013). Sumamos los faltantes.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists leads_project_source_idx
  on public.leads(project_id, source);

create index if not exists leads_project_pinned_idx
  on public.leads(project_id, pinned_to_kanban)
  where pinned_to_kanban = true;

create index if not exists leads_project_created_idx
  on public.leads(project_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Índices trigram (GIN) para búsqueda parcial rápida en name/phone/email
--    A 20k filas, ilike sin índice obliga a seq scan completo (~200ms+).
--    gin_trgm_ops permite usar el índice para `ilike '%foo%'` y devuelve en
--    pocos ms incluso a volumen alto.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists leads_name_trgm_idx
  on public.leads using gin (name gin_trgm_ops);

create index if not exists leads_phone_normalized_trgm_idx
  on public.leads using gin (phone_normalized gin_trgm_ops);

create index if not exists leads_email_trgm_idx
  on public.leads using gin (email gin_trgm_ops);
