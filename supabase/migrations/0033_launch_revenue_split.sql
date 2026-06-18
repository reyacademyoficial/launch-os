-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 9 — Revenue del lanzamiento: estimado vs cobrado                   │
-- │                                                                          │
-- │ Antes:                                                                   │
-- │   `launches.revenue` era UN solo campo manual. El KPI revenue venía de   │
-- │   GHL opportunities (si había wonCount > 0) o caía al manual.            │
-- │                                                                          │
-- │ Ahora:                                                                   │
-- │   El revenue se calcula combinando DOS fuentes simétricas:                │
-- │     1) Kanban: Σ sales.total_amount (estimado/pactado) y                  │
-- │                Σ payments.amount (cobrado real) sobre leads en columna   │
-- │                `cerrado` del launch.                                     │
-- │     2) Manual: dos campos sumables — para revenue que no pasó por        │
-- │                kanban (cargas históricas o flujos fuera de pipeline).    │
-- │                                                                          │
-- │   GHL opportunities QUEDA EN DB pero NO alimenta más el KPI. El sync    │
-- │   sigue corriendo (decisión 2.a: desconectar sin borrar).               │
-- │                                                                          │
-- │ Cambios:                                                                 │
-- │   1) Rename `launches.revenue` → `launches.revenue_estimated_manual`     │
-- │   2) Add `launches.revenue_collected_manual` (numeric, default 0)        │
-- │                                                                          │
-- │ `ventas_total` queda igual (manual sumable, decisión 3.b — se suma al    │
-- │ count del kanban).                                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Rename revenue → revenue_estimated_manual
--    Preservamos la data existente. Si alguna fila tenía revenue cargado a
--    mano, sigue como "estimado manual" (el flujo más común: el usuario
--    sabía cuánto facturó y lo metió ahí).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  rename column revenue to revenue_estimated_manual;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Nuevo campo revenue_collected_manual
--    Sumable al cobrado del kanban. Para registrar plata efectivamente
--    cobrada que no quedó modelada como payments contra sales del kanban.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column if not exists revenue_collected_manual numeric(14, 2);
