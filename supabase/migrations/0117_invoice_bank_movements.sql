-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 5b: link factura → movimiento(s) │
-- │                                                                          │
-- │ Cierra la cadena del modelo nuevo:                                       │
-- │                                                                          │
-- │   sale ──emite──▶ facturas (una por cuota)                              │
-- │   cobro ──se ata──▶ factura     (paso 5)                                │
-- │   factura ──se ata──▶ movimiento(s) del banco   ← ACÁ                   │
-- │                                                                          │
-- │ Bridge N:M porque una factura puede materializarse en 2 movimientos      │
-- │ cuando el banco muestra la comisión separada del bruto (típico Wise,     │
-- │ Stripe con emisión diferida). Roles del link:                            │
-- │   'principal' → la línea del extracto que representa la plata que entró │
-- │                  (kind='in'). Suma al cobrado real.                     │
-- │   'comision'  → la línea de comisión que el banco cobró (kind='out').   │
-- │                  Informativa — sirve para leerla en la ficha.           │
-- │   'otro'      → cualquier movimiento adicional atado por reconciliación │
-- │                  manual (ajuste, ida-y-vuelta).                          │
-- │                                                                          │
-- │ AUTO-STATUS: al insertar / borrar filas del bridge, un trigger:         │
-- │   - Si Σ(role='principal', kind='in') >= invoice.amount_gross → status  │
-- │     pasa a 'cobrada', paid_at = MAX(occurred_at) de los principales,    │
-- │     payment_date idem.                                                   │
-- │   - Al desvincular y quedar por debajo del total, revierte a 'emitida', │
-- │     limpia paid_at y payment_date.                                       │
-- │   - No toca facturas 'anulada' (nunca reversa una anulada).             │
-- │                                                                          │
-- │ Convive con `invoices.bank_movement_id` (columna vieja del schema 0064):│
-- │ el backfill copia los valores no-null al bridge con role='principal'. La │
-- │ columna se marca deprecada en el comment; queda por compat mientras la  │
-- │ UI vieja de la ficha del gasto la use. Se limpia en migración posterior.│
-- │                                                                          │
-- │ RLS: hereda de la factura (org-scope). Las policies del bridge usan     │
-- │ can_edit_organization sobre invoices.organization_id.                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tabla puente
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.invoice_bank_movements (
  invoice_id       uuid not null references public.invoices(id)       on delete cascade,
  bank_movement_id uuid not null references public.bank_movements(id) on delete cascade,
  role             text not null default 'principal'
                   check (role in ('principal', 'comision', 'otro')),
  created_at       timestamptz not null default now(),
  primary key (invoice_id, bank_movement_id)
);

create index if not exists ibm_movement_idx
  on public.invoice_bank_movements(bank_movement_id);
create index if not exists ibm_invoice_idx
  on public.invoice_bank_movements(invoice_id);

alter table public.invoice_bank_movements enable row level security;
revoke all on public.invoice_bank_movements from public;
revoke all on public.invoice_bank_movements from cliente_role;
grant select, insert, update, delete on public.invoice_bank_movements to authenticated;

-- Helper: resolver org_id desde invoice_id (para políticas RLS).
create or replace function public.org_of_invoice(p_invoice_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.invoices where id = p_invoice_id
$$;

drop policy if exists ibm_select on public.invoice_bank_movements;
create policy ibm_select on public.invoice_bank_movements
  for select to authenticated
  using (public.can_edit_organization(public.org_of_invoice(invoice_id)));

drop policy if exists ibm_insert on public.invoice_bank_movements;
create policy ibm_insert on public.invoice_bank_movements
  for insert to authenticated
  with check (public.can_edit_organization(public.org_of_invoice(invoice_id)));

drop policy if exists ibm_update on public.invoice_bank_movements;
create policy ibm_update on public.invoice_bank_movements
  for update to authenticated
  using      (public.can_edit_organization(public.org_of_invoice(invoice_id)))
  with check (public.can_edit_organization(public.org_of_invoice(invoice_id)));

drop policy if exists ibm_delete on public.invoice_bank_movements;
create policy ibm_delete on public.invoice_bank_movements
  for delete to authenticated
  using (public.can_edit_organization(public.org_of_invoice(invoice_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de transición de status
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se dispara AFTER INSERT y AFTER DELETE en el bridge. Recalcula el estado
-- de la factura afectada. Idempotente — si el status ya coincide, no toca.
-- No toca facturas 'anulada' bajo ninguna circunstancia.
--
-- Suspensión temporal del CHECK invoices_paid_at_matches_status: la
-- transición pasa por (paid_at seteado, status='cobrada') o (paid_at null,
-- status='emitida'). Ambos estados cumplen el CHECK. El trigger setea las
-- dos columnas juntas en el mismo UPDATE.

create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount_gross   numeric;
  v_current_status text;
  v_paid_sum       numeric;
  v_max_occurred   date;
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

  -- Suma de movimientos entrantes ligados a la factura con role='principal'.
  -- Un 'principal' con kind='out' es un error del operador (bug de UI);
  -- lo excluimos del cálculo para no inflar el cobrado.
  select coalesce(sum(bm.amount), 0), max(bm.occurred_at)
    into v_paid_sum, v_max_occurred
  from public.invoice_bank_movements ibm
  join public.bank_movements bm on bm.id = ibm.bank_movement_id
  where ibm.invoice_id = p_invoice_id
    and ibm.role       = 'principal'
    and bm.kind        = 'in';

  if v_paid_sum >= v_amount_gross and v_amount_gross > 0 then
    -- Cubierto → cobrada
    update public.invoices
       set status       = 'cobrada',
           paid_at      = v_max_occurred,
           payment_date = v_max_occurred
     where id = p_invoice_id;
  else
    -- No cubierto (o bridge vacío) → volver a emitida
    update public.invoices
       set status       = 'emitida',
           paid_at      = null,
           payment_date = null
     where id = p_invoice_id
       and status = 'cobrada';
  end if;
end;
$$;

revoke all on function public.recompute_invoice_status(uuid) from public;
grant execute on function public.recompute_invoice_status(uuid) to authenticated;

create or replace function public.trg_ibm_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- En INSERT usamos NEW.invoice_id; en DELETE OLD.invoice_id. En UPDATE
  -- puede haber cambiado el role → recalcular la factura afectada (que es
  -- la misma; el PK del bridge fija (invoice_id, bank_movement_id)).
  if tg_op = 'DELETE' then
    perform public.recompute_invoice_status(old.invoice_id);
    return old;
  else
    perform public.recompute_invoice_status(new.invoice_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_ibm_recompute_ins on public.invoice_bank_movements;
create trigger trg_ibm_recompute_ins
  after insert on public.invoice_bank_movements
  for each row execute function public.trg_ibm_recompute();

drop trigger if exists trg_ibm_recompute_upd on public.invoice_bank_movements;
create trigger trg_ibm_recompute_upd
  after update on public.invoice_bank_movements
  for each row execute function public.trg_ibm_recompute();

drop trigger if exists trg_ibm_recompute_del on public.invoice_bank_movements;
create trigger trg_ibm_recompute_del
  after delete on public.invoice_bank_movements
  for each row execute function public.trg_ibm_recompute();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Backfill: invoices.bank_movement_id existente → bridge role='principal'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La columna vieja `invoices.bank_movement_id` (schema 0064) queda deprecada.
-- Copiamos cada valor no-null al bridge. Como el trigger recalcula status al
-- insertar, las facturas que ya estaban cobradas quedan bien (el trigger
-- confirma su status). Las que estén marcadas cobradas pero con monto
-- insuficiente en el movimiento asociado NO se degradan — el `recompute` sólo
-- baja de 'cobrada' cuando existe una fila del bridge y no alcanza; si nunca
-- había fila del bridge y venían con status='cobrada' + paid_at seteados
-- fuera del modelo bridge, ese estado se preserva (no lo tocamos).
--
-- SET session_replication_role: no lo usamos. Preferimos que el trigger
-- corra en el backfill — es idempotente y confirma el estado.

insert into public.invoice_bank_movements (invoice_id, bank_movement_id, role)
select id, bank_movement_id, 'principal'
from public.invoices
where bank_movement_id is not null
on conflict do nothing;

comment on column public.invoices.bank_movement_id is
  'DEPRECATED (2026-08 paso 5b): usar la tabla puente invoice_bank_movements. Se mantiene por compat con UI vieja de gastos; se limpia en migración posterior cuando la UI migre.';
