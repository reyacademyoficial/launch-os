-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Pentest Etapa 4 — guards de tenant en RPCs con p_org_id/p_project_id     │
-- │                                                                          │
-- │ Cierra B5, B6 y el latente B7 (scripts/pentest/results/ETAPA_0_HALLAZGOS)│
-- │                                                                          │
-- │ Raíz común: estas 3 funciones son SECURITY DEFINER + grant a            │
-- │ `authenticated`, y confían en que el ÚNICO camino de invocación es la    │
-- │ server action que ya valida pertenencia. Falso — cualquier authenticated │
-- │ puede pegarle directo a `POST /rest/v1/rpc/<fn>` con cualquier UUID,      │
-- │ salteando esa validación por completo (así se confirmaron B5/B6).        │
-- │                                                                          │
-- │   B5 create_notification    → sin chequeo de que el caller tenga acceso  │
-- │                                al project_id destino. Vector de phishing │
-- │                                interno cross-tenant.                      │
-- │   B6 next_invoice_number    → sin chequeo de que el caller pertenezca a  │
-- │                                la org. Quema numeración fiscal ajena.     │
-- │   B7 generate_invoices_for_sale → mismo patrón sobre un p_sale_id real   │
-- │                                de otra org (el pentest no lo confirmó    │
-- │                                por falta de seed, pero el código no      │
-- │                                tenía ningún guard — closeamos preventivo)│
-- │                                                                          │
-- │ FIX: agregar el chequeo adentro de cada función, usando los helpers ya   │
-- │ existentes (`has_project_access`, y uno nuevo `can_access_organization`  │
-- │ para el caso org-level). auth.uid() IS NULL identifica invocaciones      │
-- │ internas vía service_role (watchdog, sync GHL/Meta) — esas quedan        │
-- │ exceptuadas porque ya corren fuera del contexto de un usuario final.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) can_access_organization(p_org_id) — ¿el caller pertenece a esta org?
--    Superadmin/dev O es project_member de algún project de esa org.
--    Espejo de has_project_access, pero a nivel organización.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_access_organization(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members pm
        join public.projects pr on pr.id = pm.project_id
        where pm.user_id = auth.uid()
          and pr.organization_id = p_org_id
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) B6 — next_invoice_number: exigir pertenencia a la org antes de quemar
--    numeración. auth.uid() IS NULL = invocación interna (service_role).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.next_invoice_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  if auth.uid() is not null and not public.can_access_organization(p_org_id) then
    raise exception 'access denied for organization %', p_org_id;
  end if;

  insert into public.invoice_sequences (organization_id, next_value)
  values (p_org_id, 1)
  on conflict (organization_id) do nothing;

  update public.invoice_sequences
     set next_value = next_value + 1,
         updated_at = now()
   where organization_id = p_org_id
  returning next_value - 1 into v_next;

  return lpad(v_next::text, 7, '0');
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) B7 (latente) — generate_invoices_for_sale: exigir acceso al proyecto de
--    la venta antes de mutar. Se agrega apenas se resuelve v_project_id.
-- ═══════════════════════════════════════════════════════════════════════════
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

  if auth.uid() is not null and not public.has_project_access(v_project_id) then
    raise exception 'access denied for project %', v_project_id;
  end if;

  select organization_id
    into v_org_id
  from public.projects
  where id = v_project_id;

  if v_org_id is null then
    raise exception 'project % has no organization_id (paso 0050 pendiente)', v_project_id;
  end if;

  if v_lead_id is not null then
    select name
      into v_buyer_name
    from public.leads
    where id = v_lead_id;
  end if;
  v_buyer_email := null;
  v_buyer_document := null;

  for v_inst in
    select id, number, due_date, amount
    from public.installments
    where sale_id = p_sale_id
    order by number
  loop
    select status
      into v_existing_status
    from public.invoices
    where installment_id = v_inst.id;

    if v_existing_status is null then
      v_number := public.next_invoice_number(v_org_id);
      v_description := format(
        'Cuota %s/%s — %s',
        v_inst.number,
        (select count(*) from public.installments where sale_id = p_sale_id),
        v_sale_label
      );

      insert into public.invoices (
        organization_id, project_id, sale_id, installment_id, product_id,
        invoice_number, description, amount_gross, tax_amount, currency,
        issue_date, due_date, purchase_date, status,
        buyer_name, buyer_email, buyer_document
      ) values (
        v_org_id, v_project_id, p_sale_id, v_inst.id, v_product_id,
        v_number, v_description, v_inst.amount, 0, coalesce(v_currency, 'ARS'),
        current_date, v_inst.due_date, v_closed_at, 'emitida',
        v_buyer_name, v_buyer_email, v_buyer_document
      );

    elsif v_existing_status = 'emitida' then
      delete from public.invoices where installment_id = v_inst.id;

      v_number := public.next_invoice_number(v_org_id);
      v_description := format(
        'Cuota %s/%s — %s',
        v_inst.number,
        (select count(*) from public.installments where sale_id = p_sale_id),
        v_sale_label
      );

      insert into public.invoices (
        organization_id, project_id, sale_id, installment_id, product_id,
        invoice_number, description, amount_gross, tax_amount, currency,
        issue_date, due_date, purchase_date, status,
        buyer_name, buyer_email, buyer_document
      ) values (
        v_org_id, v_project_id, p_sale_id, v_inst.id, v_product_id,
        v_number, v_description, v_inst.amount, 0, coalesce(v_currency, 'ARS'),
        current_date, v_inst.due_date, v_closed_at, 'emitida',
        v_buyer_name, v_buyer_email, v_buyer_document
      );

    else
      null;
    end if;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) B5 — create_notification: exigir acceso al project_id destino antes de
--    insertar. auth.uid() IS NULL cubre el watchdog / sync (service_role vía
--    createServiceClient en runs.ts / sync.ts / evaluate.ts).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_notification(
  p_project_id     uuid,
  p_type           text,
  p_title          text,
  p_severity       text default 'info',
  p_body           text default null,
  p_target_role    text default null,
  p_target_user_id uuid default null,
  p_launch_id      uuid default null,
  p_dedup_key      text default null,
  p_metadata       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.has_project_access(p_project_id) then
    raise exception 'access denied for project %', p_project_id;
  end if;

  insert into public.notifications (
    project_id, launch_id, type, severity, title, body,
    target_role, target_user_id, dedup_key, metadata
  )
  values (
    p_project_id, p_launch_id, p_type, p_severity, p_title, p_body,
    p_target_role, p_target_user_id, p_dedup_key, p_metadata
  )
  on conflict (project_id, dedup_key) where dedup_key is not null
    do nothing
  returning id into v_id;

  return v_id;
end;
$$;
