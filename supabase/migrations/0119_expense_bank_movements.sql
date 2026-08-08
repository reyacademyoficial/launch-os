-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 6: gasto ↔ N movimientos         │
-- │                                                                          │
-- │ Simétrico al bridge factura↔movimiento de 0117. Un gasto puede           │
-- │ materializarse en varios movimientos del banco cuando:                  │
-- │   - El proveedor cobra el neto y aparte una comisión (Wise, transf.    │
-- │     internacionales).                                                   │
-- │   - El pago se hace en cuotas de tarjeta (una fila por cuota).          │
-- │   - Hay ajustes ida-y-vuelta.                                            │
-- │                                                                          │
-- │ Roles:                                                                   │
-- │   'principal' → la línea del gasto en sí (kind='out' típicamente).      │
-- │   'comision'  → fee bancario o de la pasarela (kind='out').            │
-- │   'otro'      → reembolso parcial, ajuste (puede ser kind='in').        │
-- │                                                                          │
-- │ AUTO paid_at: al insertar/borrar filas del bridge, un trigger:         │
-- │   - Si hay al menos un principal linkeado → paid_at = MAX(occurred_at) │
-- │     de los principales.                                                 │
-- │   - Si no hay principal → paid_at queda null (gasto vuelve a impago).   │
-- │                                                                          │
-- │ La columna vieja `expenses.bank_movement_id` (0063) queda deprecada.   │
-- │ Backfill copia los valores no-null al bridge con role='principal'. Se  │
-- │ mantiene por compat con la UI vieja mientras migra. Se limpia después. │
-- │                                                                          │
-- │ deleteExpense: post-migración chequea el bridge además de la columna   │
-- │ vieja (el guard actual de la action ya lo hace por bank_movement_id;   │
-- │ se extiende en el paso 6 en el código).                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tabla puente
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.expense_bank_movements (
  expense_id       uuid not null references public.expenses(id)       on delete cascade,
  bank_movement_id uuid not null references public.bank_movements(id) on delete cascade,
  role             text not null default 'principal'
                   check (role in ('principal', 'comision', 'otro')),
  created_at       timestamptz not null default now(),
  primary key (expense_id, bank_movement_id)
);

create index if not exists ebm_movement_idx
  on public.expense_bank_movements(bank_movement_id);
create index if not exists ebm_expense_idx
  on public.expense_bank_movements(expense_id);

alter table public.expense_bank_movements enable row level security;
revoke all on public.expense_bank_movements from public;
revoke all on public.expense_bank_movements from cliente_role;
grant select, insert, update, delete on public.expense_bank_movements to authenticated;

-- Helper simétrico a org_of_invoice (0117).
create or replace function public.org_of_expense(p_expense_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.expenses where id = p_expense_id
$$;

drop policy if exists ebm_select on public.expense_bank_movements;
create policy ebm_select on public.expense_bank_movements
  for select to authenticated
  using (public.can_edit_organization(public.org_of_expense(expense_id)));

drop policy if exists ebm_insert on public.expense_bank_movements;
create policy ebm_insert on public.expense_bank_movements
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_expense(expense_id)));

drop policy if exists ebm_update on public.expense_bank_movements;
create policy ebm_update on public.expense_bank_movements
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_expense(expense_id)))
  with check (public.can_edit_organization(public.org_of_expense(expense_id)));

drop policy if exists ebm_delete on public.expense_bank_movements;
create policy ebm_delete on public.expense_bank_movements
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_expense(expense_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de auto paid_at
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Simétrico al recompute_invoice_status (0117 + guard 0118). Con blindaje:
-- si el bridge está vacío para el gasto, no tocamos paid_at (respeta la
-- columna vieja bank_movement_id que puede estar seteada por la UI legacy).

create or replace function public.recompute_expense_paid_at(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bridge_row_count int;
  v_max_occurred     date;
begin
  select count(*)
    into v_bridge_row_count
  from public.expense_bank_movements
  where expense_id = p_expense_id;

  -- Sin bridge → no tocar. Preserva paid_at seteado por la UI vieja.
  if v_bridge_row_count = 0 then
    return;
  end if;

  select max(bm.occurred_at)
    into v_max_occurred
  from public.expense_bank_movements ebm
  join public.bank_movements bm on bm.id = ebm.bank_movement_id
  where ebm.expense_id = p_expense_id
    and ebm.role       = 'principal';

  if v_max_occurred is not null then
    update public.expenses
       set paid_at = v_max_occurred
     where id = p_expense_id;
  else
    -- Hay bridge pero sin principal (sólo comisión / otro) → gasto sin
    -- pago concreto todavía. Limpiamos paid_at para que aparezca en AP.
    update public.expenses
       set paid_at = null
     where id = p_expense_id;
  end if;
end;
$$;

revoke all on function public.recompute_expense_paid_at(uuid) from public;
grant execute on function public.recompute_expense_paid_at(uuid) to authenticated;

create or replace function public.trg_ebm_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_expense_paid_at(old.expense_id);
    return old;
  else
    perform public.recompute_expense_paid_at(new.expense_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_ebm_recompute_ins on public.expense_bank_movements;
create trigger trg_ebm_recompute_ins
  after insert on public.expense_bank_movements
  for each row execute function public.trg_ebm_recompute();

drop trigger if exists trg_ebm_recompute_upd on public.expense_bank_movements;
create trigger trg_ebm_recompute_upd
  after update on public.expense_bank_movements
  for each row execute function public.trg_ebm_recompute();

drop trigger if exists trg_ebm_recompute_del on public.expense_bank_movements;
create trigger trg_ebm_recompute_del
  after delete on public.expense_bank_movements
  for each row execute function public.trg_ebm_recompute();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Backfill: expenses.bank_movement_id existente → bridge role='principal'
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.expense_bank_movements (expense_id, bank_movement_id, role)
select id, bank_movement_id, 'principal'
from public.expenses
where bank_movement_id is not null
on conflict do nothing;

comment on column public.expenses.bank_movement_id is
  'DEPRECATED (2026-08 paso 6): usar la tabla puente expense_bank_movements. Se mantiene por compat con UI vieja de gastos; se limpia en migración posterior cuando la UI migre.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Verificación
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_expenses_total  int;
  v_expenses_linked int;
  v_bridge_rows     int;
begin
  select count(*) into v_expenses_total from public.expenses;
  select count(*) into v_expenses_linked from public.expenses where bank_movement_id is not null;
  select count(*) into v_bridge_rows from public.expense_bank_movements;

  raise notice '─── Backfill expense_bank_movements ───';
  raise notice 'Gastos totales                         : %', v_expenses_total;
  raise notice 'Gastos con bank_movement_id (col vieja): %', v_expenses_linked;
  raise notice 'Filas del bridge post-backfill         : % (esperado ≥ anterior)', v_bridge_rows;
end $$;
