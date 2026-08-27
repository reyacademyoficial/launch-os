-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Fix: duplicación de facturas al editar │
-- │ una venta.                                                               │
-- │                                                                          │
-- │ BUG:                                                                     │
-- │   `generate_installments_for_sale` borra y recrea todas las cuotas       │
-- │   (0043 línea 197). Como `invoices.installment_id` está declarado        │
-- │   `on delete set null` (0114 línea 37), las facturas viejas NO se        │
-- │   borran: les queda `installment_id = NULL` (huérfanas).                 │
-- │                                                                          │
-- │   La versión previa de `generate_invoices_for_sale` (0115) chequeaba     │
-- │   duplicados con `where installment_id = v_inst.id`. Como las huérfanas  │
-- │   quedan con `installment_id NULL`, no las encuentra y crea facturas     │
-- │   nuevas. Resultado: 2 facturas por cada cuota (1 huérfana emitida + 1   │
-- │   emitida "nueva" ligada al nuevo installment_id).                       │
-- │                                                                          │
-- │ FIX:                                                                     │
-- │   Antes del loop, borrar TODAS las facturas `emitida` de esta venta      │
-- │   (linked y huérfanas). Cobradas y anuladas se preservan intactas —      │
-- │   siguen siendo prueba contable de lo que efectivamente pasó, aunque su  │
-- │   `installment_id` haya quedado en NULL tras una regeneración previa.    │
-- │                                                                          │
-- │ CONTRATO POST-FIX (idéntico al original en espíritu):                    │
-- │   - Corridas repetidas sobre la misma venta convergen a: una factura     │
-- │     `emitida` por cuota viva + las cobradas/anuladas históricas intactas.│
-- │   - Los números de factura de las emitidas SÍ se consumen en cada        │
-- │     corrida — el talonario admite gaps.                                  │
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
  if v_lead_id is not null then
    select name
      into v_buyer_name
    from public.leads
    where id = v_lead_id;
  end if;
  v_buyer_email := null;
  v_buyer_document := null;

  -- ═════════════════════════════════════════════════════════════════════════
  -- Purga de emitidas — CORE DEL FIX 0168.
  -- Borra TODAS las facturas 'emitida' de esta venta, tengan o no
  -- installment_id. Cobradas/anuladas quedan intactas.
  -- ═════════════════════════════════════════════════════════════════════════
  delete from public.invoices
  where sale_id = p_sale_id
    and status = 'emitida';

  -- Recorrer cuotas de esta venta.
  for v_inst in
    select id, number, due_date, amount
    from public.installments
    where sale_id = p_sale_id
    order by number
  loop
    -- Post-purga: si aparece una fila viva para esta cuota, sólo puede ser
    -- 'cobrada' o 'anulada' (las emitidas ya no existen). En ese caso NO se
    -- crea duplicado.
    select status
      into v_existing_status
    from public.invoices
    where installment_id = v_inst.id;

    if v_existing_status is not null then
      -- 'cobrada' o 'anulada' → preservar. No tocar.
      continue;
    end if;

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
  end loop;
end;
$$;

revoke all on function public.generate_invoices_for_sale(uuid) from public;
grant execute on function public.generate_invoices_for_sale(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Limpieza retroactiva: barrer las emitidas huérfanas que ya existan en la DB
-- por ventas editadas antes de este fix. Para cada venta con emitidas
-- huérfanas (installment_id NULL) o con más de una emitida por cuota,
-- re-correr la RPC deja el estado consistente.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct i.sale_id
    from public.invoices i
    where i.sale_id is not null
      and i.status = 'emitida'
      and (
        i.installment_id is null
        or i.sale_id in (
          select sale_id
          from public.invoices
          where status = 'emitida' and installment_id is not null
          group by sale_id, installment_id
          having count(*) > 1
        )
      )
  loop
    perform public.generate_invoices_for_sale(r.sale_id);
    n := n + 1;
  end loop;
  raise notice 'generate_invoices_for_sale cleanup 0168: % ventas normalizadas', n;
end $$;
