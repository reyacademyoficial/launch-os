-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — launch_settlements: split de cobro por canal        │
-- │                                                                          │
-- │ CONTEXTO                                                                  │
-- │   Con la incorporación de "bancos externos" (mig 0169), un lanzamiento   │
-- │   puede tener cobros por DOS canales:                                    │
-- │     · mis bancos          → plata que ya tengo en Kingrow                 │
-- │     · banco del cliente   → plata que el cliente cobró y tiene él        │
-- │                                                                          │
-- │   El motor de split retiene un % (o fijo) sobre el TOTAL cobrado sin    │
-- │   importar por dónde entró. Pero para saber "quién le transfiere a      │
-- │   quién y cuánto" al cerrar la liquidación, necesito guardar CÓMO se    │
-- │   partió ese cobrado al momento de liquidar. Recalcularlo mañana desde  │
-- │   `payments` es frágil: los métodos/bancos pueden ser re-tageados y el  │
-- │   histórico se rompe.                                                    │
-- │                                                                          │
-- │ SEMÁNTICA DE LOS NUEVOS CAMPOS                                            │
-- │   collected_by_me              = Σ payments cuyo método rutea a banco    │
-- │                                  is_external_collector = false          │
-- │   collected_by_client_external = Σ payments cuyo método rutea a banco    │
-- │                                  is_external_collector = true           │
-- │                                                                          │
-- │   Invariante (CHECK):                                                    │
-- │     collected_by_me + collected_by_client_external = collected_total    │
-- │                                                                          │
-- │ NETO DE TRANSFERENCIA (calc en TS, NO se persiste)                       │
-- │     net = collected_by_me − kingrow_retained                            │
-- │     · net > 0 → Kingrow transfiere `net` al cliente                     │
-- │     · net < 0 → cliente transfiere `-net` a Kingrow                     │
-- │     · net = 0 → no hay movimiento pendiente                             │
-- │                                                                          │
-- │ EL owed_to_client CLÁSICO SIGUE VIVO                                     │
-- │   Mantiene su significado: cuánto le corresponde AL CLIENTE del total   │
-- │   cobrado, independientemente de dónde esté esa plata hoy. Es la línea  │
-- │   que las liquidaciones históricas venían mostrando y no vamos a         │
-- │   romperla. La UI muestra AMBOS: owed_to_client (contable) y net        │
-- │   (operativo — qué transferencia falta).                                │
-- │                                                                          │
-- │ BACKFILL                                                                  │
-- │   Ninguna liquidación existente tenía canales externos, así que          │
-- │   collected_by_me = collected_total y collected_by_client_external = 0. │
-- │   Los DEFAULT (0, 0) permiten el ALTER sin bloquear; el UPDATE post-    │
-- │   alter setea collected_by_me al valor histórico y satisface el CHECK.  │
-- │                                                                          │
-- │ COMPATIBILIDAD                                                            │
-- │   El CHECK de suma se agrega DESPUÉS del backfill — si se agregara      │
-- │   antes, filas existentes con collected_total > 0 y las dos nuevas en 0│
-- │   fallarían.                                                             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columnas nuevas con default 0 (permite ALTER en tabla no vacía)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_settlements
  add column if not exists collected_by_me              numeric not null default 0,
  add column if not exists collected_by_client_external numeric not null default 0;

comment on column public.launch_settlements.collected_by_me is
  'Σ payments del launch cuyos métodos rutean a bancos NO externos (bancos propios de Kingrow). Congelado al liquidar. Junto con collected_by_client_external suma collected_total (CHECK).';

comment on column public.launch_settlements.collected_by_client_external is
  'Σ payments del launch cuyos métodos rutean a bancos is_external_collector=true del proyecto del lanzamiento. Congelado al liquidar. Representa plata que ya tiene el cliente por su cuenta.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Backfill histórico
--    Todas las liquidaciones previas a 0169 fueron 100% por bancos propios
--    (no existía el concepto de banco externo). Seteamos collected_by_me al
--    collected_total histórico y dejamos collected_by_client_external en 0.
-- ═══════════════════════════════════════════════════════════════════════════
update public.launch_settlements
   set collected_by_me = collected_total
 where collected_by_me = 0
   and collected_total > 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) CHECKS (post-backfill)
--    - Ambos ≥ 0 (los DEFAULT y el negocio ya lo garantizan; defense-in-depth).
--    - Suma exacta con collected_total. Sin este CHECK, un futuro insert
--      podría dejar la partición inconsistente y romper el cálculo del neto.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_settlements
  drop constraint if exists launch_settlements_collected_by_me_nonneg;
alter table public.launch_settlements
  add  constraint launch_settlements_collected_by_me_nonneg
  check (collected_by_me >= 0);

alter table public.launch_settlements
  drop constraint if exists launch_settlements_collected_by_client_external_nonneg;
alter table public.launch_settlements
  add  constraint launch_settlements_collected_by_client_external_nonneg
  check (collected_by_client_external >= 0);

alter table public.launch_settlements
  drop constraint if exists launch_settlements_channel_split_sum;
alter table public.launch_settlements
  add  constraint launch_settlements_channel_split_sum
  check (collected_by_me + collected_by_client_external = collected_total);
