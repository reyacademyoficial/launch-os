-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 11 — Cuotas + métodos de pago                                       │
-- │                                                                          │
-- │ Concepto: cada venta ahora se descompone en N cuotas (installments),     │
-- │ generadas al cierre a partir de `installment_count` + `frequency` +      │
-- │ `closed_at`. Cada cobro se asocia a UNA cuota puntual (payments.         │
-- │ installment_id). Con eso podemos:                                        │
-- │   - Calcular monto vencido (cuotas cuya due_date + grace_days < hoy y    │
-- │     saldo > 0).                                                          │
-- │   - Clasificar al cliente (bueno / regular / malo) en runtime.           │
-- │   - A futuro: conectar con HighLevel para dar/quitar acceso al curso     │
-- │     en función de la cuota que se está cobrando.                         │
-- │                                                                          │
-- │ MÉTODO DE PAGO (`payment_methods`) es distinto de modalidad              │
-- │ (`payment_modalities`):                                                  │
-- │   - Modalidad: define la regla de comisión ("contado", "3 cuotas").     │
-- │   - Método: por dónde entró la guita ("transferencia", "Stripe").      │
-- │ Ambos son project-scoped y CRUD idéntico al de `products`.               │
-- │                                                                          │
-- │ COMPATIBILIDAD:                                                          │
-- │   - `payments.installment_id` es nullable — cobros históricos que        │
-- │     necesitan re-asignación manual quedan flotando visibles en UI.       │
-- │   - `payments.payment_method_id` es nullable — históricos sin backfill   │
-- │     se muestran como "—" hasta que el operador los complete.             │
-- │   - Backfill: cada venta existente gana 1 cuota (número=1, due_date=     │
-- │     closed_at, amount=total_amount). Sus cobros se auto-asocian a ella.  │
-- │                                                                          │
-- │ REGENERACIÓN: cambiar `installment_count` o `frequency` en una venta     │
-- │ regenera las cuotas (todos los payments quedan huérfanos por             │
-- │ `on delete set null`). La UI expone dropdowns para re-linkar. Es lo      │
-- │ que necesita el flujo de carga de clientes existentes.                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) sales — nuevas columnas de plan de pagos
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  add column if not exists installment_count int not null default 1
    check (installment_count >= 1),
  add column if not exists installment_frequency text not null default 'single'
    check (installment_frequency in ('single', 'weekly', 'monthly')),
  add column if not exists grace_days int not null default 5
    check (grace_days >= 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) payment_methods — catálogo por proyecto (mismo patrón que products)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists payment_methods_project_idx
  on public.payment_methods(project_id);

alter table public.payment_methods enable row level security;
grant select, insert, update, delete on public.payment_methods to authenticated;

drop trigger if exists set_updated_at on public.payment_methods;
create trigger set_updated_at before update on public.payment_methods
  for each row execute function public.set_updated_at();

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists payment_methods_insert on public.payment_methods;
create policy payment_methods_insert on public.payment_methods
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists payment_methods_update on public.payment_methods;
create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists payment_methods_delete on public.payment_methods;
create policy payment_methods_delete on public.payment_methods
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) installments — plan de cuotas por venta
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.installments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  number      int not null check (number >= 1),
  due_date    date not null,
  amount      numeric not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (sale_id, number)
);

create index if not exists installments_sale_idx
  on public.installments(sale_id, number);
create index if not exists installments_due_idx
  on public.installments(due_date);

alter table public.installments enable row level security;
grant select, insert, update, delete on public.installments to authenticated;

drop trigger if exists set_updated_at on public.installments;
create trigger set_updated_at before update on public.installments
  for each row execute function public.set_updated_at();

drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments
  for select to authenticated
  using (public.has_project_access(public.project_of_sale(sale_id)));

drop policy if exists installments_insert on public.installments;
create policy installments_insert on public.installments
  for insert to authenticated
  with check (public.can_edit_launches_in(public.project_of_sale(sale_id)));

drop policy if exists installments_update on public.installments;
create policy installments_update on public.installments
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_sale(sale_id)))
  with check (public.can_edit_launches_in(public.project_of_sale(sale_id)));

drop policy if exists installments_delete on public.installments;
create policy installments_delete on public.installments
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_sale(sale_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) payments — nuevas FKs a installments y payment_methods
--    Ambas nullable: no rompe cobros históricos.
--    installment on delete set null: al regenerar cuotas, cobros quedan
--    flotando y la UI los re-asigna manualmente.
--    payment_method on delete restrict: no permitir borrar un método con
--    cobros — desactivarlo (active=false) es el flujo esperado.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payments
  add column if not exists installment_id uuid
    references public.installments(id) on delete set null,
  add column if not exists payment_method_id uuid
    references public.payment_methods(id) on delete restrict;

create index if not exists payments_installment_idx
  on public.payments(installment_id);
create index if not exists payments_method_idx
  on public.payments(payment_method_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) generate_installments_for_sale — regenera el plan de cuotas
--
--    Regla de reparto: monto por cuota = round(total/N, 2). La última cuota
--    absorbe el redondeo (total - suma(N-1 primeras)) para que
--    sum(cuotas) = total exacto.
--
--    Es idempotente: borra las cuotas existentes y crea las nuevas. Los
--    payments quedan huérfanos por `on delete set null` — el server action
--    correspondiente en JS los toma después y los pasa a la UI de re-linkeo.
--
--    Security invoker (default): RLS aplica normalmente. El caller debe
--    tener can_edit_launches_in sobre el proyecto de la venta.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.generate_installments_for_sale(p_sale_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_total       numeric;
  v_count       int;
  v_freq        text;
  v_closed_at   date;
  v_amount_each numeric;
  v_amount_sum  numeric := 0;
  v_i           int;
  v_due         date;
  v_amount      numeric;
begin
  select total_amount::numeric,
         installment_count,
         installment_frequency,
         closed_at::date
    into v_total, v_count, v_freq, v_closed_at
  from public.sales
  where id = p_sale_id;

  if not found then
    raise exception 'sale % not found', p_sale_id;
  end if;

  delete from public.installments where sale_id = p_sale_id;

  if v_count = 1 then
    insert into public.installments (sale_id, number, due_date, amount)
    values (p_sale_id, 1, v_closed_at, v_total);
    return;
  end if;

  v_amount_each := round(v_total / v_count, 2);

  for v_i in 1..v_count loop
    if v_freq = 'weekly' then
      v_due := v_closed_at + ((v_i - 1) * 7) * interval '1 day';
    elsif v_freq = 'monthly' then
      v_due := v_closed_at + (v_i - 1) * interval '1 month';
    else
      v_due := v_closed_at;
    end if;

    if v_i < v_count then
      v_amount := v_amount_each;
      v_amount_sum := v_amount_sum + v_amount;
    else
      v_amount := v_total - v_amount_sum;
    end if;

    insert into public.installments (sale_id, number, due_date, amount)
    values (p_sale_id, v_i, v_due::date, v_amount);
  end loop;
end;
$$;

revoke all on function public.generate_installments_for_sale(uuid) from public;
grant execute on function public.generate_installments_for_sale(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Backfill de cuotas para ventas existentes
--
--    Para cada sale sin installments: crear 1 cuota (número=1, due_date=
--    closed_at, amount=total_amount). Después, auto-linkar sus payments a
--    esa única cuota — como sólo hay 1 cuota por venta, no hay ambigüedad.
--    El operador puede re-configurar la venta con más cuotas después y
--    re-asignar los pagos desde la ficha del alumno.
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.installments (sale_id, number, due_date, amount)
select s.id, 1, s.closed_at::date, s.total_amount
from public.sales s
where not exists (
  select 1 from public.installments i where i.sale_id = s.id
);

update public.payments p
   set installment_id = i.id
  from public.installments i
 where p.installment_id is null
   and i.sale_id = p.sale_id
   and i.number = 1;
