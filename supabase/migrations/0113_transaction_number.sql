-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Paso 1: transaction_number             │
-- │                                                                          │
-- │ El operador financiero concilia moviendo comprobantes bancarios (extracto│
-- │ del banco, ticket de transferencia, ID de cobro Stripe) con lo cargado   │
-- │ en el sistema. Ese identificador es el "número de transacción".          │
-- │                                                                          │
-- │ Va en las 3 tablas donde vive la trazabilidad:                           │
-- │   - payments        → lo que el cliente pagó                             │
-- │   - bank_movements  → la línea del extracto del banco                    │
-- │   - expenses        → la contrapartida en cuentas por pagar              │
-- │                                                                          │
-- │ Sin unique: dos filas legítimas pueden compartir número (un cobro y su   │
-- │ comisión aparecen como 2 movimientos con mismo comprobante; un gasto y   │
-- │ su fee bancario idem). El match cobro↔factura↔movimiento se hace en la  │
-- │ UI del bloque financiero por búsqueda + sugerencia, no por FK dura.     │
-- │                                                                          │
-- │ ADITIVA. Columna nullable — todos los registros históricos quedan sin   │
-- │ número (mostrar "—" en UI). Se completa hacia adelante o manual.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.payments
  add column if not exists transaction_number text;

alter table public.bank_movements
  add column if not exists transaction_number text;

alter table public.expenses
  add column if not exists transaction_number text;

create index if not exists payments_transaction_number_idx
  on public.payments(transaction_number)
  where transaction_number is not null;

create index if not exists bank_movements_transaction_number_idx
  on public.bank_movements(transaction_number)
  where transaction_number is not null;

create index if not exists expenses_transaction_number_idx
  on public.expenses(transaction_number)
  where transaction_number is not null;
