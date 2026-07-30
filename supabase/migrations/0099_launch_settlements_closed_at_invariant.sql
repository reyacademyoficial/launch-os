-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6c-c (Kingrow) — Invariante closed_at ↔ status en                 │
-- │                          launch_settlements                              │
-- │                                                                          │
-- │ La migración original 0055 dejó `closed_at` como timestamptz opcional    │
-- │ y `status` con un CHECK de dominio, pero SIN atar los dos campos. Esto  │
-- │ permitía dos estados inconsistentes que rompen la lectura del tablero:  │
-- │                                                                          │
-- │   (a) status='abierta' con closed_at seteado → un borrador con fecha   │
-- │       de cierre no significa nada; el resto del código lo ignora, pero │
-- │       cuando alguien lo inspecciona a mano queda ambiguo si es cierre  │
-- │       real o metadata heredada.                                          │
-- │   (b) status='liquidada' con closed_at NULL → el peor caso. El         │
-- │       selector `computeRevenue` filtra por status y cuenta la fila en  │
-- │       el revenueTotal; el sparkline y el panel "Liquidaciones del      │
-- │       período" filtran por `inPeriodTs(closed_at, ...)` y NO la ven.   │
-- │       Resultado: un ingreso que aparece en la tarjeta pero no en la    │
-- │       serie temporal. Bug muy difícil de rastrear.                     │
-- │                                                                          │
-- │ Este invariante los descarta a nivel DB:                                │
-- │   · abierta                → closed_at IS NULL                          │
-- │   · liquidada, transferida → closed_at IS NOT NULL                     │
-- │                                                                          │
-- │ Mismo patrón que `invoices` (0064: paid_at ↔ status='cobrada') y       │
-- │ `upsells` (0084: closed_at ↔ status='cobrada').                         │
-- │                                                                          │
-- │ NO IMPIDE REAPERTURA                                                     │
-- │   El CHECK acepta pasar de (liquidada, closed_at=X) a (abierta,        │
-- │   closed_at=NULL) — que es exactamente "reabrir". La regla de negocio  │
-- │   "no se reabre" vive únicamente en el server action y en la RPC de    │
-- │   cierre (que solo escribe la transición hacia adelante, nunca inserta │
-- │   la inversa). Si alguien mañana necesita bloquearlo también en DB,    │
-- │   agrega un trigger BEFORE UPDATE que rechace `NEW.status='abierta' AND│
-- │   OLD.status IN ('liquidada','transferida')`. Hoy no es necesario.     │
-- │                                                                          │
-- │ SEGURIDAD DEL DEPLOY                                                     │
-- │   La tabla está vacía. Ejecutar este ALTER sobre datos existentes NO   │
-- │   requiere backfill — no hay filas que puedan violar el CHECK. Si en   │
-- │   una copia futura de este esquema hay filas cargadas, esta migración  │
-- │   fallaría hasta backfillear las inconsistencias primero. Documento    │
-- │   la expectativa acá para que quede explícita.                          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.launch_settlements
  drop constraint if exists launch_settlements_closed_at_matches_status;

alter table public.launch_settlements
  add  constraint launch_settlements_closed_at_matches_status
  check (
    (status = 'abierta'                     and closed_at is null) or
    (status in ('liquidada', 'transferida') and closed_at is not null)
  );
