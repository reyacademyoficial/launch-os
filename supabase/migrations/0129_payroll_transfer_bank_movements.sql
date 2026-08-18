-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 6b: bridges N:M para nómina      │
-- │ y transferencias a clientes, con rol.                                    │
-- │                                                                          │
-- │ CONTEXTO                                                                 │
-- │ 0117 (invoice_bank_movements) y 0119 (expense_bank_movements) armaron    │
-- │ bridges N:M con role ∈ {principal, comision, otro} para poder separar   │
-- │ el pago principal de la comisión bancaria/pasarela que suele venir en   │
-- │ otro movimiento. Payroll y client_transfers quedaron con FK 1:1         │
-- │ (bank_movement_id) — servía para linkear el pago pero no permitía       │
-- │ registrar la comisión bancaria del sueldo o de la transferencia.       │
-- │                                                                          │
-- │ Ahora hace falta el dato: el KPI de "Comisiones bancarias" del panel    │
-- │ dedicado en /financiero/bancos suma bridges 'comision' de las 4 tablas │
-- │ (facturas + gastos + nómina + transferencias) para saber cuánto se     │
-- │ lleva cada banco por operar la plata.                                   │
-- │                                                                          │
-- │ Roles (idénticos a 0117/0119):                                          │
-- │   'principal' → el movimiento que ES el pago (kind='out' para nómina y │
-- │                  transferencia; nunca 'in').                             │
-- │   'comision'  → fee bancario asociado (kind='out'). El humano lo       │
-- │                  vincula manualmente después de conciliar el principal.│
-- │   'otro'      → ajuste, reembolso parcial (puede ser 'in').             │
-- │                                                                          │
-- │ AUTO paid_at (solo en payroll — client_transfers no tiene paid_at):    │
-- │ trigger análogo a recompute_expense_paid_at (0119). Con bridge:        │
-- │   - Al menos un principal → paid_at = MAX(occurred_at) de principales. │
-- │   - Bridge sin principal (solo comisión/otro) → paid_at = null.        │
-- │   - Sin bridge → no toca (preserva la FK vieja payroll.bank_movement_id│
-- │     por compat con la UI legacy).                                       │
-- │                                                                          │
-- │ client_transfers NO tiene paid_at ni status derivado: es en sí una      │
-- │ fila manual (una transferencia registrada). El bridge solo agrega       │
-- │ trazabilidad de comisiones asociadas — sin trigger de estado.           │
-- │                                                                          │
-- │ COLUMNAS VIEJAS payroll.bank_movement_id + client_transfers.            │
-- │ bank_movement_id: DEPRECATED, preservadas por compat con la UI vieja    │
-- │ mientras migra. Backfill copia los non-null al bridge con role=         │
-- │ 'principal'. Se limpian en migración posterior.                         │
-- │                                                                          │
-- │ RLS: hereda de la fila padre (org-scope). Idéntico patrón a 0117/0119. │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Helpers org_of_* para las RLS de los bridges
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.org_of_payroll(p_payroll_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.payroll where id = p_payroll_id
$$;

create or replace function public.org_of_client_transfer(p_client_transfer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.client_transfers where id = p_client_transfer_id
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Bridge payroll ↔ bank_movements
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.payroll_bank_movements (
  payroll_id       uuid not null references public.payroll(id)         on delete cascade,
  bank_movement_id uuid not null references public.bank_movements(id)  on delete cascade,
  role             text not null default 'principal'
                   check (role in ('principal', 'comision', 'otro')),
  created_at       timestamptz not null default now(),
  primary key (payroll_id, bank_movement_id)
);

create index if not exists pbm_movement_idx
  on public.payroll_bank_movements(bank_movement_id);
create index if not exists pbm_payroll_idx
  on public.payroll_bank_movements(payroll_id);

alter table public.payroll_bank_movements enable row level security;
revoke all on public.payroll_bank_movements from public;
revoke all on public.payroll_bank_movements from cliente_role;
grant select, insert, update, delete on public.payroll_bank_movements to authenticated;

drop policy if exists pbm_select on public.payroll_bank_movements;
create policy pbm_select on public.payroll_bank_movements
  for select to authenticated
  using (public.can_edit_organization(public.org_of_payroll(payroll_id)));

drop policy if exists pbm_insert on public.payroll_bank_movements;
create policy pbm_insert on public.payroll_bank_movements
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_payroll(payroll_id)));

drop policy if exists pbm_update on public.payroll_bank_movements;
create policy pbm_update on public.payroll_bank_movements
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_payroll(payroll_id)))
  with check (public.can_edit_organization(public.org_of_payroll(payroll_id)));

drop policy if exists pbm_delete on public.payroll_bank_movements;
create policy pbm_delete on public.payroll_bank_movements
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_payroll(payroll_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Trigger auto paid_at para payroll
-- ═══════════════════════════════════════════════════════════════════════════
-- Copia estructural de recompute_expense_paid_at (0119). Sin bridge → no
-- toca. Con bridge y al menos un principal → paid_at = MAX(occurred_at).
-- Con bridge sin principal (solo comisiones/otro) → paid_at = null.
create or replace function public.recompute_payroll_paid_at(p_payroll_id uuid)
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
  from public.payroll_bank_movements
  where payroll_id = p_payroll_id;

  -- Sin bridge → no tocar. Preserva paid_at seteado por la UI vieja.
  if v_bridge_row_count = 0 then
    return;
  end if;

  select max(bm.occurred_at)
    into v_max_occurred
  from public.payroll_bank_movements pbm
  join public.bank_movements bm on bm.id = pbm.bank_movement_id
  where pbm.payroll_id = p_payroll_id
    and pbm.role       = 'principal';

  if v_max_occurred is not null then
    update public.payroll
       set paid_at = v_max_occurred
     where id = p_payroll_id;
  else
    -- Bridge sin principal → sueldo sin pago concreto → volver a impago.
    update public.payroll
       set paid_at = null
     where id = p_payroll_id;
  end if;
end;
$$;

revoke all on function public.recompute_payroll_paid_at(uuid) from public;
grant execute on function public.recompute_payroll_paid_at(uuid) to authenticated;

create or replace function public.trg_pbm_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_payroll_paid_at(old.payroll_id);
    return old;
  else
    perform public.recompute_payroll_paid_at(new.payroll_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_pbm_recompute_ins on public.payroll_bank_movements;
create trigger trg_pbm_recompute_ins
  after insert on public.payroll_bank_movements
  for each row execute function public.trg_pbm_recompute();

drop trigger if exists trg_pbm_recompute_upd on public.payroll_bank_movements;
create trigger trg_pbm_recompute_upd
  after update on public.payroll_bank_movements
  for each row execute function public.trg_pbm_recompute();

drop trigger if exists trg_pbm_recompute_del on public.payroll_bank_movements;
create trigger trg_pbm_recompute_del
  after delete on public.payroll_bank_movements
  for each row execute function public.trg_pbm_recompute();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Bridge client_transfers ↔ bank_movements
-- ═══════════════════════════════════════════════════════════════════════════
-- SIN trigger de estado: client_transfers no deriva paid_at ni status desde
-- movimientos — es en sí una fila manual (la RPC transfer_to_client crea
-- una fila 'transferido' y linkea el bank_movement en la col vieja). El
-- bridge solo se usa para agregar comisiones adicionales que el humano
-- vincula manualmente después de la RPC.
create table if not exists public.client_transfer_bank_movements (
  client_transfer_id uuid not null references public.client_transfers(id) on delete cascade,
  bank_movement_id   uuid not null references public.bank_movements(id)   on delete cascade,
  role               text not null default 'principal'
                     check (role in ('principal', 'comision', 'otro')),
  created_at         timestamptz not null default now(),
  primary key (client_transfer_id, bank_movement_id)
);

create index if not exists ctbm_movement_idx
  on public.client_transfer_bank_movements(bank_movement_id);
create index if not exists ctbm_transfer_idx
  on public.client_transfer_bank_movements(client_transfer_id);

alter table public.client_transfer_bank_movements enable row level security;
revoke all on public.client_transfer_bank_movements from public;
revoke all on public.client_transfer_bank_movements from cliente_role;
grant select, insert, update, delete on public.client_transfer_bank_movements to authenticated;

drop policy if exists ctbm_select on public.client_transfer_bank_movements;
create policy ctbm_select on public.client_transfer_bank_movements
  for select to authenticated
  using (public.can_edit_organization(public.org_of_client_transfer(client_transfer_id)));

drop policy if exists ctbm_insert on public.client_transfer_bank_movements;
create policy ctbm_insert on public.client_transfer_bank_movements
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_client_transfer(client_transfer_id)));

drop policy if exists ctbm_update on public.client_transfer_bank_movements;
create policy ctbm_update on public.client_transfer_bank_movements
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_client_transfer(client_transfer_id)))
  with check (public.can_edit_organization(public.org_of_client_transfer(client_transfer_id)));

drop policy if exists ctbm_delete on public.client_transfer_bank_movements;
create policy ctbm_delete on public.client_transfer_bank_movements
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_client_transfer(client_transfer_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Backfill: FKs viejas → bridge role='principal'
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.payroll_bank_movements (payroll_id, bank_movement_id, role)
select id, bank_movement_id, 'principal'
from public.payroll
where bank_movement_id is not null
on conflict do nothing;

insert into public.client_transfer_bank_movements (client_transfer_id, bank_movement_id, role)
select id, bank_movement_id, 'principal'
from public.client_transfers
where bank_movement_id is not null
on conflict do nothing;

comment on column public.payroll.bank_movement_id is
  'DEPRECATED (2026-08 paso 6b): usar la tabla puente payroll_bank_movements. Se mantiene por compat con UI vieja; se limpia en migración posterior cuando la UI migre.';

comment on column public.client_transfers.bank_movement_id is
  'DEPRECATED (2026-08 paso 6b): usar la tabla puente client_transfer_bank_movements. Se mantiene por compat con UI vieja; se limpia en migración posterior cuando la UI migre.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Verificación
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_pay_total  int;
  v_pay_linked int;
  v_pbm_rows   int;
  v_ct_total   int;
  v_ct_linked  int;
  v_ctbm_rows  int;
begin
  select count(*) into v_pay_total  from public.payroll;
  select count(*) into v_pay_linked from public.payroll where bank_movement_id is not null;
  select count(*) into v_pbm_rows   from public.payroll_bank_movements;

  select count(*) into v_ct_total   from public.client_transfers;
  select count(*) into v_ct_linked  from public.client_transfers where bank_movement_id is not null;
  select count(*) into v_ctbm_rows  from public.client_transfer_bank_movements;

  raise notice '─── Backfill payroll_bank_movements ───';
  raise notice 'Payroll totales                        : %', v_pay_total;
  raise notice 'Payroll con bank_movement_id (col vieja): %', v_pay_linked;
  raise notice 'Filas del bridge post-backfill          : % (esperado ≥ anterior)', v_pbm_rows;

  raise notice '─── Backfill client_transfer_bank_movements ───';
  raise notice 'Client transfers totales                : %', v_ct_total;
  raise notice 'Client transfers con bank_movement_id   : %', v_ct_linked;
  raise notice 'Filas del bridge post-backfill          : % (esperado ≥ anterior)', v_ctbm_rows;
end $$;
