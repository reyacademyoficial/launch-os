-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 3: extender invoices              │
-- │                                                                          │
-- │ Cambio de modelo post-reunión:                                           │
-- │                                                                          │
-- │ Antes: `invoices` era exclusivamente el fee de Kingrow a clientes        │
-- │ externos (retainer / honorarios). Ahora conviven en la misma tabla dos   │
-- │ tipos de factura:                                                        │
-- │   - FEE: la actual, sin sale_id / installment_id. Sigue igual.           │
-- │   - VENTA: una factura por cuota de venta. Con sale_id, installment_id,  │
-- │     product_id, buyer_*.                                                 │
-- │                                                                          │
-- │ Discriminador implícito: `sale_id IS NOT NULL` ⇒ es factura de venta.    │
-- │                                                                          │
-- │ 1 cuota = 1 factura. `installment_id` es UNIQUE (parcial where not null).│
-- │ Regla acordada: si una factura de una cuota ya está cobrada o anulada,   │
-- │ la regeneración (paso 4) NO la toca — sólo regenera las emitidas sin    │
-- │ paid_at.                                                                 │
-- │                                                                          │
-- │ NUMERACIÓN: entero secuencial por org, arranca en 1, formato 7 dígitos  │
-- │ zero-padded (0000001). Talonario único por org — no separamos fee vs    │
-- │ venta. Vive en `invoice_sequences(org_id → next_value)` con RPC          │
-- │ `next_invoice_number` que hace SELECT ... FOR UPDATE para concurrencia. │
-- │                                                                          │
-- │ ADITIVA — columnas nullable; las filas fee-a-cliente existentes siguen  │
-- │ funcionando sin cambios. Backfill de invoice_sequences infiere el       │
-- │ next_value a partir del máximo invoice_number numérico existente por org│
-- │ (o 1 si no hay ninguno parseable).                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) invoices — columnas nuevas (todo nullable — aditivo)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.invoices
  add column if not exists sale_id            uuid references public.sales(id)         on delete set null,
  add column if not exists installment_id     uuid references public.installments(id)  on delete set null,
  add column if not exists product_id         uuid references public.products(id)      on delete set null,
  add column if not exists purchase_date      date,
  add column if not exists payment_date       date,
  add column if not exists buyer_name         text,
  add column if not exists buyer_email        text,
  add column if not exists buyer_document     text,
  add column if not exists transaction_number text;

-- 1 cuota = 1 factura (parcial: sólo cuando installment_id NO es null; las
-- fee-a-cliente comparten "sin cuota", no colisionan).
create unique index if not exists invoices_installment_uniq
  on public.invoices(installment_id)
  where installment_id is not null;

create index if not exists invoices_sale_idx
  on public.invoices(sale_id)
  where sale_id is not null;

create index if not exists invoices_product_idx
  on public.invoices(product_id)
  where product_id is not null;

create index if not exists invoices_transaction_number_idx
  on public.invoices(transaction_number)
  where transaction_number is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) invoice_sequences — talonario por organización
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Alternativa considerada y descartada: usar una secuencia de Postgres. No
-- sirve porque `sequence` es global — no soporta "arranca en 1 POR org" con
-- concurrencia segura y sin gaps globales visibles. Tabla + FOR UPDATE es el
-- patrón estándar cuando el contador es multi-tenant.

create table if not exists public.invoice_sequences (
  organization_id uuid primary key references public.organization(id) on delete cascade,
  next_value      bigint not null default 1 check (next_value >= 1),
  updated_at      timestamptz not null default now()
);

alter table public.invoice_sequences enable row level security;
revoke all on public.invoice_sequences from public;
revoke all on public.invoice_sequences from cliente_role;
-- Sin GRANT a authenticated: escritura sólo vía la RPC (security definer).
-- Lectura vía la RPC también — nadie necesita hacer SELECT directo.

drop trigger if exists set_updated_at on public.invoice_sequences;
create trigger set_updated_at before update on public.invoice_sequences
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) next_invoice_number(org_id) — asignador atómico
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER + search_path fijo. El caller es una server action que ya
-- verifica pertenencia a la org antes de invocar; acá el FOR UPDATE garantiza
-- que dos requests concurrentes no consuman el mismo número.
--
-- Formato: LPAD(seq, 7, '0'). Cambiar el largo acá exige backfill visual, no
-- rompe nada estructural.

create or replace function public.next_invoice_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  -- UPSERT + FOR UPDATE: si no había fila para esta org, la creamos con
  -- next_value=1 y devolvemos 1. Si ya había, incrementamos.
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

revoke all on function public.next_invoice_number(uuid) from public;
grant execute on function public.next_invoice_number(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Backfill de invoice_sequences
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Para cada org que hoy tenga facturas cargadas, sembrar next_value con el
-- máximo invoice_number parseable como entero, +1. Facturas con número no
-- numérico (formato libre viejo) las ignoramos — el operador no las va a
-- confundir con las nuevas 0000001+.
--
-- Orgs sin facturas: no se siembra fila; la primera invocación de la RPC la
-- crea con next_value=1.

insert into public.invoice_sequences (organization_id, next_value)
select
  organization_id,
  coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) + 1
from public.invoices
where invoice_number is not null
group by organization_id
on conflict (organization_id) do update
  set next_value = greatest(invoice_sequences.next_value, excluded.next_value);
