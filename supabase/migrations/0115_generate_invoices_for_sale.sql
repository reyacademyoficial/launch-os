-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 4: auto-generar facturas por venta│
-- │                                                                          │
-- │ Contrato:                                                                │
-- │   generate_invoices_for_sale(p_sale_id uuid)                             │
-- │     Para cada installment de la venta:                                   │
-- │       - Si ya existe una factura VIVA (status='emitida' y sin paid_at),  │
-- │         se BORRA y se recrea. Sirve para regeneración cuando el operador │
-- │         cambia installment_count / frequency / total en la venta.        │
-- │       - Si existe una factura COBRADA o ANULADA, se PRESERVA. Regla dura │
-- │         cerrada con Finanzas: la regeneración jamás toca historial       │
-- │         contable. En ese caso NO se crea factura duplicada para esa      │
-- │         cuota (queda cubierta por la que ya tenía).                      │
-- │                                                                          │
-- │ CAMPOS QUE COPIA de la venta al momento de emitir:                       │
-- │   sale_id, installment_id, product_id, organization_id (via project),   │
-- │   purchase_date = sale.closed_at (fecha de la compra),                   │
-- │   due_date = installment.due_date,                                       │
-- │   amount_gross = installment.amount,                                     │
-- │   currency = sale.currency ('ARS' o 'USD' desde 0106),                   │
-- │   buyer_name / buyer_email / buyer_document = del lead ligado a la venta,│
-- │   description libre autogenerada,                                        │
-- │   invoice_number = next_invoice_number(organization_id),                 │
-- │   status = 'emitida'.                                                    │
-- │                                                                          │
-- │ SECURITY DEFINER + search_path fijo. RLS del caller no aplica adentro,   │
-- │ pero la RPC valida que el sale exista antes de leer/escribir. Los grants │
-- │ se limitan a `authenticated`.                                            │
-- │                                                                          │
-- │ IDEMPOTENCIA: se puede correr N veces sobre la misma venta; el resultado │
-- │ es el mismo (una factura viva por cuota sin cobrar, sin duplicar las     │
-- │ cobradas/anuladas). Los números de factura SÍ se consumen — cada corrida │
-- │ que borra y recrea, quema números de la secuencia. Es aceptable: el      │
-- │ talonario admite gaps.                                                   │
-- │                                                                          │
-- │ BACKFILL AL FINAL: aplica la RPC a todas las sales existentes que no    │
-- │ tengan facturas ligadas. Cubre las 58 ventas pre-existentes de una vez. │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.generate_invoices_for_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id      uuid;
  v_org_id          uuid;
  v_product_id      uuid;
  v_closed_at       date;
  v_currency        text;
  v_buyer_name      text;
  v_buyer_email     text;
  v_buyer_document  text;
  v_sale_label      text;
  v_lead_id         uuid;
  v_inst            record;
  v_existing_status text;
  v_number          text;
  v_description     text;
begin
  -- Cargar cabecera de la venta.
  select s.project_id,
         s.product_id,
         s.closed_at::date,
         s.currency,
         s.lead_id,
         coalesce(p.name, 'Venta ' || substring(s.id::text, 1, 8))
    into v_project_id, v_product_id, v_closed_at, v_currency, v_lead_id, v_sale_label
  from public.sales s
  left join public.products p on p.id = s.product_id
  where s.id = p_sale_id;

  if not found then
    raise exception 'sale % not found', p_sale_id;
  end if;

  -- Resolver org desde el proyecto de la venta.
  select organization_id
    into v_org_id
  from public.projects
  where id = v_project_id;

  if v_org_id is null then
    raise exception 'project % has no organization_id (paso 0050 pendiente)', v_project_id;
  end if;

  -- Datos del comprador desde el lead ligado a la venta.
  --
  -- `leads` sólo tiene `name` y `contact` (texto libre — puede ser email o
  -- teléfono según cómo entró el lead). No separamos: el operador completa
  -- email/documento manualmente desde el drawer de edición cuando emita el
  -- remito PDF (paso 8). Acá sólo poblamos `buyer_name` para arrancar con
  -- algo útil.
  if v_lead_id is not null then
    select name
      into v_buyer_name
    from public.leads
    where id = v_lead_id;
  end if;
  v_buyer_email := null;
  v_buyer_document := null;

  -- Recorrer cuotas de esta venta.
  for v_inst in
    select id, number, due_date, amount
    from public.installments
    where sale_id = p_sale_id
    order by number
  loop
    -- ¿Hay ya una factura para esta cuota? Traer status si existe.
    select status
      into v_existing_status
    from public.invoices
    where installment_id = v_inst.id;

    if v_existing_status is null then
      -- No hay factura para esta cuota → crear una.
      v_number := public.next_invoice_number(v_org_id);
      v_description := format(
        'Cuota %s/%s — %s',
        v_inst.number,
        (select count(*) from public.installments where sale_id = p_sale_id),
        v_sale_label
      );

      insert into public.invoices (
        organization_id,
        project_id,
        sale_id,
        installment_id,
        product_id,
        invoice_number,
        description,
        amount_gross,
        tax_amount,
        currency,
        issue_date,
        due_date,
        purchase_date,
        status,
        buyer_name,
        buyer_email,
        buyer_document
      ) values (
        v_org_id,
        v_project_id,
        p_sale_id,
        v_inst.id,
        v_product_id,
        v_number,
        v_description,
        v_inst.amount,
        0,
        coalesce(v_currency, 'ARS'),
        current_date,
        v_inst.due_date,
        v_closed_at,
        'emitida',
        v_buyer_name,
        v_buyer_email,
        v_buyer_document
      );

    elsif v_existing_status = 'emitida' then
      -- Regeneración: borrar la vieja emitida (paid_at es null por invariante
      -- del CHECK invoices_paid_at_matches_status) y crear una nueva con los
      -- datos actualizados. Usa un nuevo número de factura.
      delete from public.invoices where installment_id = v_inst.id;

      v_number := public.next_invoice_number(v_org_id);
      v_description := format(
        'Cuota %s/%s — %s',
        v_inst.number,
        (select count(*) from public.installments where sale_id = p_sale_id),
        v_sale_label
      );

      insert into public.invoices (
        organization_id,
        project_id,
        sale_id,
        installment_id,
        product_id,
        invoice_number,
        description,
        amount_gross,
        tax_amount,
        currency,
        issue_date,
        due_date,
        purchase_date,
        status,
        buyer_name,
        buyer_email,
        buyer_document
      ) values (
        v_org_id,
        v_project_id,
        p_sale_id,
        v_inst.id,
        v_product_id,
        v_number,
        v_description,
        v_inst.amount,
        0,
        coalesce(v_currency, 'ARS'),
        current_date,
        v_inst.due_date,
        v_closed_at,
        'emitida',
        v_buyer_name,
        v_buyer_email,
        v_buyer_document
      );

    else
      -- 'cobrada' o 'anulada' → preservar. No tocar.
      null;
    end if;
  end loop;
end;
$$;

revoke all on function public.generate_invoices_for_sale(uuid) from public;
grant execute on function public.generate_invoices_for_sale(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL: aplicar la RPC a todas las ventas existentes sin facturas atadas.
--
-- Corre una sola vez cuando se aplica la migración. Cubre las 58 ventas
-- pre-existentes: para cada una, genera una factura por cuota. Las ventas
-- que ya tuvieran (por futuras corridas) alguna factura ligada quedan
-- intactas — la RPC es idempotente pero preferimos evitar cargar números
-- sin motivo.
--
-- Nota: si una venta no tiene installments (raro por Fase 11), la RPC entra
-- al loop 0 veces y no crea nada. No falla — es un no-op.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select s.id
    from public.sales s
    where not exists (
      select 1 from public.invoices i where i.sale_id = s.id
    )
  loop
    perform public.generate_invoices_for_sale(r.id);
    n := n + 1;
  end loop;
  raise notice 'generate_invoices_for_sale backfill: % ventas procesadas', n;
end $$;
