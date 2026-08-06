-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 5: link cobro → factura           │
-- │                                                                          │
-- │ Ahora que las ventas emiten una factura por cuota, el cobro se aplica a │
-- │ una factura puntual. Es el paso previo a la conciliación bancaria:      │
-- │                                                                          │
-- │   cobro ──se ata──▶ factura ──se ata──▶ movimiento bancario             │
-- │           (paso 5)             (paso 5b, migración 0117)                │
-- │                                                                          │
-- │ REGLA (importante, cerrada con Finanzas):                                │
-- │   Atar el cobro NO cambia `invoices.status` a 'cobrada'. La factura     │
-- │   sólo pasa a 'cobrada' cuando queda linkeada a un movimiento entrante │
-- │   del banco (paso 5b). Motivo: "cobro registrado" ≠ "plata en el banco"; │
-- │   entre uno y otro puede haber commission / delay / rechazo.            │
-- │                                                                          │
-- │ FK nullable con ON DELETE SET NULL: si la factura se anula o se borra   │
-- │ (rarísimo, no debería pasar), el cobro sobrevive suelto y se re-linkea │
-- │ manualmente desde la ficha de la venta.                                 │
-- │                                                                          │
-- │ SIN backfill: los cobros históricos quedan con invoice_id=null. El       │
-- │ operador puede atarlos manualmente uno por uno desde el modal de cobros │
-- │ (la migración 0116 sólo abre el campo). Es la contracara del backfill   │
-- │ de facturas del paso 4 — allá creamos 1 factura por cuota; acá no      │
-- │ podemos auto-atar porque un cobro histórico podría haber cubierto     │
-- │ parcialmente varias cuotas y no hay forma de adivinar sin humano.      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.payments
  add column if not exists invoice_id uuid
    references public.invoices(id) on delete set null;

create index if not exists payments_invoice_idx
  on public.payments(invoice_id)
  where invoice_id is not null;
