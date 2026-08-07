-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Backfill de conciliación histórica    │
-- │                                                                          │
-- │ Problema detectado tras aplicar 0117:                                    │
-- │   - Fase A (venta → facturas por cuota): backfill hecho en 0115. Cada  │
-- │     cuota tiene su factura, y `invoices.installment_id` está seteado.  │
-- │   - Fase B (cobro → factura): NO había backfill. Todos los payments    │
-- │     históricos quedaron con `invoice_id=null`.                          │
-- │   - Fase C bridge (factura → movimiento): NO tenía datos porque nadie  │
-- │     había cargado movimientos entrantes; el backfill de 0117 copió     │
-- │     invoices.bank_movement_id que estaba en null.                       │
-- │                                                                          │
-- │ Consecuencia: las facturas emitidas por el backfill de 0115 quedaron  │
-- │ marcadas 'emitida' aunque las cuotas correspondientes ya estuvieran     │
-- │ cobradas (payments históricos apuntan al installment vía installment_id │
-- │ pero no a la invoice).                                                  │
-- │                                                                          │
-- │ Esta migración hace 3 cosas:                                             │
-- │                                                                          │
-- │ 1. Verificación pre-backfill via RAISE NOTICE (cuántas facturas por    │
-- │    venta, cuántas cuotas sin factura, cuántos payments huérfanos, etc).│
-- │                                                                          │
-- │ 2. Backfill payments.invoice_id: dado que invoices.installment_id es   │
-- │    UNIQUE parcial (0114), el mapping payment.installment_id →           │
-- │    invoice.id es determinístico.                                        │
-- │                                                                          │
-- │ 3. Backfill status='cobrada' + paid_at + payment_date para facturas   │
-- │    donde SUM(payments.amount) >= amount_gross. Excepción para el       │
-- │    backfill: normalmente el status transiciona a cobrada al linkear un │
-- │    movimiento del banco (regla del trigger de 0117), pero los cobros   │
-- │    históricos existen SIN movimientos cargados. Marcar cobrada por    │
-- │    suma de cobros preserva la realidad contable pre-existente.        │
-- │                                                                          │
-- │ 4. Blindaje del trigger recompute_invoice_status: no degradar facturas │
-- │    cobradas cuando el bridge invoice_bank_movements está VACÍO para   │
-- │    esa factura. Motivo: sin bridge, esa factura vive por el backfill  │
-- │    de esta migración (o por un update manual futuro); no queremos     │
-- │    revertirla espúreamente al primer link/unlink de un vecino.        │
-- │                                                                          │
-- │ IDEMPOTENTE: los UPDATE tienen WHERE que ya excluye lo hecho.          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Verificación pre-backfill
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_sales_total          int;
  v_sales_with_invoices  int;
  v_installments_total   int;
  v_installments_no_inv  int;
  v_invoices_venta       int;
  v_payments_total       int;
  v_payments_orphan_inst int;
  v_payments_orphan_inv  int;
begin
  select count(*) into v_sales_total from public.sales;

  select count(distinct sale_id)
    into v_sales_with_invoices
  from public.invoices where sale_id is not null;

  select count(*) into v_installments_total from public.installments;

  select count(*)
    into v_installments_no_inv
  from public.installments i
  where not exists (
    select 1 from public.invoices where installment_id = i.id
  );

  select count(*)
    into v_invoices_venta
  from public.invoices where sale_id is not null;

  select count(*) into v_payments_total from public.payments;

  select count(*)
    into v_payments_orphan_inst
  from public.payments where installment_id is null;

  select count(*)
    into v_payments_orphan_inv
  from public.payments
  where installment_id is not null and invoice_id is null;

  raise notice '─── Verificación pre-backfill ───';
  raise notice 'Ventas totales                       : %', v_sales_total;
  raise notice 'Ventas con al menos una factura      : %', v_sales_with_invoices;
  raise notice 'Cuotas totales                       : %', v_installments_total;
  raise notice 'Cuotas SIN factura ligada            : %', v_installments_no_inv;
  raise notice 'Facturas de venta (sale_id not null) : %', v_invoices_venta;
  raise notice 'Cobros totales                       : %', v_payments_total;
  raise notice 'Cobros SIN cuota (installment null)  : %', v_payments_orphan_inst;
  raise notice 'Cobros con cuota pero SIN factura    : % ← este se backfillea abajo', v_payments_orphan_inv;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Backfill payments.invoice_id ← invoices.id via installment_id
-- ═══════════════════════════════════════════════════════════════════════════
--
-- invoices.installment_id es UNIQUE parcial (0114 línea 45), así que el
-- mapping es 1:1. Sólo tocamos payments donde invoice_id ya está null (para
-- ser idempotentes) y que tengan installment_id (los legacy sin cuota se
-- mantienen huérfanos — el operador los ata a mano si aplica).

update public.payments p
   set invoice_id = i.id
  from public.invoices i
 where p.installment_id = i.installment_id
   and p.invoice_id is null
   and i.installment_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Marcar facturas cobradas por suma de cobros históricos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Para cada factura emitida con installment_id (facturas auto-generadas del
-- paso 4), si la suma de payments linkeados por invoice_id (recién
-- backfilleado en el paso 2) cubre amount_gross, marcar cobrada.
-- paid_at / payment_date = MAX(payments.paid_at) — la fecha del último cobro
-- que cerró la cuota.
--
-- Sólo aplica a facturas 'emitida'. Las 'anulada' quedan intocadas (regla
-- dura). Las 'cobrada' preexistentes tampoco (ya están bien).

update public.invoices inv
   set status       = 'cobrada',
       paid_at      = agg.max_paid_at,
       payment_date = agg.max_paid_at
  from (
    select p.invoice_id,
           sum(p.amount)    as total_paid,
           max(p.paid_at)   as max_paid_at
    from public.payments p
    where p.invoice_id is not null
    group by p.invoice_id
  ) agg
 where inv.id = agg.invoice_id
   and inv.status = 'emitida'
   and inv.installment_id is not null
   and agg.total_paid >= inv.amount_gross;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Blindaje: recompute_invoice_status no degrada si el bridge está vacío
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La versión de 0117 revertía a 'emitida' cuando la suma principal era
-- insuficiente. Eso rompe las cobradas por backfill (que no tienen bridge).
-- Regla nueva: sólo degradar si HAY al menos una fila del bridge para esa
-- factura y no cubre. Sin bridge, la factura sigue con lo que tenga (sea
-- 'emitida' o 'cobrada' por backfill).
--
-- El caso de 'subir a cobrada' cuando el bridge cubre queda igual — sigue
-- siendo la regla canónica para movimientos que se carguen a futuro.

create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount_gross     numeric;
  v_current_status   text;
  v_paid_sum         numeric;
  v_max_occurred     date;
  v_bridge_row_count int;
begin
  select amount_gross, status
    into v_amount_gross, v_current_status
  from public.invoices
  where id = p_invoice_id;

  if not found then
    return; -- factura borrada en carrera; nada que hacer
  end if;

  if v_current_status = 'anulada' then
    return; -- regla dura: nunca reversar una anulada
  end if;

  select count(*)
    into v_bridge_row_count
  from public.invoice_bank_movements
  where invoice_id = p_invoice_id;

  -- Sin bridge → no tocar. La factura vive por backfill (0118) o por update
  -- manual; el trigger sólo actúa cuando hay filas del bridge que lo
  -- justifiquen.
  if v_bridge_row_count = 0 then
    return;
  end if;

  select coalesce(sum(bm.amount), 0), max(bm.occurred_at)
    into v_paid_sum, v_max_occurred
  from public.invoice_bank_movements ibm
  join public.bank_movements bm on bm.id = ibm.bank_movement_id
  where ibm.invoice_id = p_invoice_id
    and ibm.role       = 'principal'
    and bm.kind        = 'in';

  if v_paid_sum >= v_amount_gross and v_amount_gross > 0 then
    update public.invoices
       set status       = 'cobrada',
           paid_at      = v_max_occurred,
           payment_date = v_max_occurred
     where id = p_invoice_id;
  else
    -- Bridge existe pero no cubre → degradar (fase natural de "desvinculé
    -- el principal que la cubría"). NO tocamos las backfilleadas porque
    -- para ellas el bridge está vacío y ya salimos arriba.
    update public.invoices
       set status       = 'emitida',
           paid_at      = null,
           payment_date = null
     where id = p_invoice_id
       and status = 'cobrada';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Verificación post-backfill
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_payments_linked  int;
  v_payments_orphan  int;
  v_invoices_cobrada int;
  v_invoices_emitida int;
begin
  select count(*)
    into v_payments_linked
  from public.payments where invoice_id is not null;

  select count(*)
    into v_payments_orphan
  from public.payments
  where installment_id is not null and invoice_id is null;

  select count(*)
    into v_invoices_cobrada
  from public.invoices where status = 'cobrada';

  select count(*)
    into v_invoices_emitida
  from public.invoices where status = 'emitida';

  raise notice '─── Verificación post-backfill ───';
  raise notice 'Cobros ahora linkeados a factura     : %', v_payments_linked;
  raise notice 'Cobros con cuota pero SIN factura    : % (esperado 0)', v_payments_orphan;
  raise notice 'Facturas COBRADAS (post backfill)    : %', v_invoices_cobrada;
  raise notice 'Facturas EMITIDAS (aún sin cobrar)   : %', v_invoices_emitida;
end $$;
