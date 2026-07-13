-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 8 — Múltiples ventas por lead (A1)                                  │
-- │                                                                          │
-- │ Un mismo cliente (lead) puede tener N ventas — típicamente una por cada  │
-- │ launch en el que le vendemos algo (curso en launch A, mentoría en B).   │
-- │ Hasta ahora la constraint `unique (lead_id)` en `sales` forzaba 1-a-1.  │
-- │                                                                          │
-- │ CAMBIOS:                                                                 │
-- │                                                                          │
-- │ 1) Drop del unique(lead_id). Ahora N sales por lead son válidas. El     │
-- │    lead queda en `cerrado` con la primera venta y ahí permanece; ventas │
-- │    subsecuentes se apilan.                                              │
-- │                                                                          │
-- │ 2) `sales.launch_id` nueva columna nullable, referencia a launches.     │
-- │    Hasta hoy la atribución de launch se derivaba de `lead.launch_id`,   │
-- │    pero eso no puede representar "el mismo cliente en dos launches      │
-- │    distintos". La atribución pasa a ser propia de cada venta.           │
-- │                                                                          │
-- │    Nullable: mantiene compatibilidad con ventas off-books (sin launch   │
-- │    asignado). El operador puede pactar una venta directo con el         │
-- │    cliente sin que cuelgue de un launch específico.                     │
-- │                                                                          │
-- │ 3) Backfill de `sales.launch_id` desde `leads.launch_id`. Snapshot al   │
-- │    momento de la migración — si mañana el lead cambia de launch, la    │
-- │    venta queda anclada al launch original (que es lo correcto: la      │
-- │    venta pertenece al launch donde se cerró, no al último del lead).   │
-- │                                                                          │
-- │ 4) Índices para queries típicas (agregados por launch, kanban).        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Drop unique(lead_id)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  drop constraint if exists sales_lead_id_key;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) sales.launch_id — atribución propia de la venta
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  add column if not exists launch_id uuid references public.launches(id) on delete set null;

-- Backfill: heredamos el launch_id del lead al momento de la migración.
-- Sales creadas antes que el lead tuviera launch_id quedan con NULL — es
-- correcto, no las inventamos.
update public.sales s
   set launch_id = l.launch_id
  from public.leads l
 where s.lead_id = l.id
   and s.launch_id is null
   and l.launch_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Índices
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists sales_launch_idx
  on public.sales(launch_id) where launch_id is not null;

-- El índice por (project, closed_at desc) de 0014 sigue siendo útil para el
-- CobrosView general. Sumamos uno por (launch, closed_at desc) para agilizar
-- los agregados por launch (KPI, cobros/launch, leaderboard).
create index if not exists sales_launch_closed_at_idx
  on public.sales(launch_id, closed_at desc) where launch_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) sales.lead_id ya no es unique — pero seguimos queriendo un índice para
--    join lead → sales (kanban card, historial de cobros de un cliente). El
--    unique nos daba el índice gratis; ahora hay que crearlo explícito.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists sales_lead_idx
  on public.sales(lead_id);
