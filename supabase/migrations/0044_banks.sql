-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 12 — Bancos + movimientos + link con métodos de pago                │
-- │                                                                          │
-- │ Concepto: cada proyecto puede definir N cuentas bancarias donde va a     │
-- │ parar la plata cobrada. Cada `payment_methods` (Stripe, transferencia,   │
-- │ efectivo…) apunta a UN banco (o a NULL para métodos sin depósito).      │
-- │ Los cobros de `payments` no se duplican en `bank_movements`: el saldo de │
-- │ un banco se calcula en runtime =                                         │
-- │   opening_balance                                                        │
-- │   + Σ payments.amount vía métodos con bank_id = X                        │
-- │   + Σ bank_movements.amount kind='in' del banco                          │
-- │   − Σ bank_movements.amount kind='out' del banco                         │
-- │                                                                          │
-- │ `bank_movements` es para ingresos/egresos que NO son cobros de ventas:  │
-- │ gastos, retiros, transferencias inter-bancos, ajustes. Se ingresan       │
-- │ manuales.                                                                │
-- │                                                                          │
-- │ COMPATIBILIDAD:                                                          │
-- │   - `payment_methods.bank_id` es nullable — métodos existentes quedan    │
-- │     sin banco hasta que el operador los asocie. UI lo marca como         │
-- │     backfill pendiente.                                                  │
-- │   - `bank_movements.created_by` es on delete set null — si borra el     │
-- │     usuario que cargó el movimiento, el movimiento queda pero sin       │
-- │     autoría trackeable.                                                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) banks — cuentas bancarias del proyecto
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.banks (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  name              text not null,
  opening_balance   numeric(14, 2) not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists banks_project_idx on public.banks(project_id);

alter table public.banks enable row level security;
grant select, insert, update, delete on public.banks to authenticated;

drop trigger if exists set_updated_at on public.banks;
create trigger set_updated_at before update on public.banks
  for each row execute function public.set_updated_at();

drop policy if exists banks_select on public.banks;
create policy banks_select on public.banks
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists banks_insert on public.banks;
create policy banks_insert on public.banks
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists banks_update on public.banks;
create policy banks_update on public.banks
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists banks_delete on public.banks;
create policy banks_delete on public.banks
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) helper: resolver project_id desde bank_id (para RLS de movimientos)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.project_of_bank(p_bank_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.banks where id = p_bank_id
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) bank_movements — ingresos/egresos manuales que NO son cobros
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.bank_movements (
  id            uuid primary key default gen_random_uuid(),
  bank_id       uuid not null references public.banks(id) on delete cascade,
  kind          text not null check (kind in ('in', 'out')),
  amount        numeric(14, 2) not null check (amount > 0),
  occurred_at   date not null default current_date,
  description   text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bank_movements_bank_idx
  on public.bank_movements(bank_id, occurred_at desc);

alter table public.bank_movements enable row level security;
grant select, insert, update, delete on public.bank_movements to authenticated;

drop trigger if exists set_updated_at on public.bank_movements;
create trigger set_updated_at before update on public.bank_movements
  for each row execute function public.set_updated_at();

drop policy if exists bank_movements_select on public.bank_movements;
create policy bank_movements_select on public.bank_movements
  for select to authenticated
  using (public.has_project_access(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_insert on public.bank_movements;
create policy bank_movements_insert on public.bank_movements
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_update on public.bank_movements;
create policy bank_movements_update on public.bank_movements
  for update to authenticated
  using      (public.can_edit_project(public.project_of_bank(bank_id)))
  with check (public.can_edit_project(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_delete on public.bank_movements;
create policy bank_movements_delete on public.bank_movements
  for delete to authenticated
  using (public.can_edit_project(public.project_of_bank(bank_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) payment_methods.bank_id — routing method → bank
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payment_methods
  add column if not exists bank_id uuid references public.banks(id) on delete set null;

create index if not exists payment_methods_bank_idx
  on public.payment_methods(bank_id)
  where bank_id is not null;

-- Nota: NO agregamos constraint que exija bank.project_id = payment_method.project_id.
-- La UI restringe el dropdown a bancos del mismo proyecto, y RLS bloquea
-- inserts de bank_id apuntando a bancos que el usuario no ve. Podría agregarse
-- como CHECK con función más adelante si aparece un caso de drift.
