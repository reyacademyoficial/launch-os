-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque FX — monedas por banco + tasa por lanzamiento + tasas mensuales   │
-- │                                                                          │
-- │ Contexto: hoy toda la plata vive en `numeric` sueltos y se asume una     │
-- │ moneda implícita por proyecto. En la realidad los bancos son mixtos      │
-- │ (algunos en ARS, otros en USD), los cobros se hacen en la moneda del    │
-- │ banco al que caen, y el dashboard financiero necesita consolidarse en    │
-- │ USD sin destruir el saldo real de cada banco.                            │
-- │                                                                          │
-- │ MODELO:                                                                  │
-- │   - `banks.currency` (ARS|USD) — fuente de verdad de la moneda del      │
-- │     cobro. El saldo del banco se muestra siempre en su moneda nativa    │
-- │     para conciliar con el banco físico.                                  │
-- │   - `payment_methods.currency` — override solo para métodos SIN banco   │
-- │     (efectivo, otros). Métodos con `bank_id` heredan la moneda del      │
-- │     banco (la columna del método se ignora).                            │
-- │   - `launches.ars_per_usd` — tasa aplicada a los cobros/spend en pesos │
-- │     del launch al mostrarlos convertidos en dashboards USD.             │
-- │     NULL = launch operado en USD nativo, no convierte nada.             │
-- │   - `project_fx_rates(project_id, month)` — tasa mensual global para   │
-- │     movimientos que NO tienen launch (bank_movements, expenses,        │
-- │     payroll, invoices). Granularidad mensual porque hacer una tasa por │
-- │     día es carga operativa que no aporta con este volumen.             │
-- │   - `payments.original_amount` + `original_currency` y equivalentes en │
-- │     `sales` — auditoría del backfill que convertirá los cobros         │
-- │     históricos cargados en pesos contra bancos USD.                    │
-- │                                                                          │
-- │ NO se toca la lógica de conversión en SQL. Todo el rendering + agregado │
-- │ se hace en TS via helper central `src/lib/money/` — el mismo dato en    │
-- │ DB se puede mostrar en su moneda nativa o convertido según contexto.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) banks.currency — moneda nativa del banco
--    Default 'ARS' porque hasta hoy todo se cargaba asumiendo pesos. El
--    operador va a marcar manualmente cuáles son USD via UI.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks
  add column if not exists currency text not null default 'ARS'
    check (currency in ('ARS', 'USD'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) payment_methods.currency — override para métodos sin banco
--    Nullable: si el método tiene `bank_id`, la moneda efectiva la resuelve
--    el helper de TS via join. Si NO tiene banco (efectivo, otros), el
--    helper cae a esta columna. La UI valida "requerido si bank_id IS NULL"
--    porque un CHECK cross-column con un lookup a otra tabla es caro.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payment_methods
  add column if not exists currency text
    check (currency is null or currency in ('ARS', 'USD'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) launches.ars_per_usd — tasa del launch
--    Nullable con CHECK > 0. NULL = "no convertir" (launch en USD nativo).
--    Con valor = "cobros/spend en pesos de este launch se dividen por esta
--    tasa al mostrar en USD". Un solo campo — el operador borra el valor
--    para desactivar la conversión.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column if not exists ars_per_usd numeric(14, 4)
    check (ars_per_usd is null or ars_per_usd > 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) project_fx_rates — tasa mensual para movimientos sin launch
--    Un par (proyecto, mes) es único. `month` se guarda como date pero
--    representa el primer día del mes — el CHECK lo enforce para que el
--    helper de TS no tenga que normalizar al buscar.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.project_fx_rates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  month        date not null,
  ars_per_usd  numeric(14, 4) not null check (ars_per_usd > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, month),
  check (month = date_trunc('month', month)::date)
);

create index if not exists project_fx_rates_project_month_idx
  on public.project_fx_rates(project_id, month desc);

alter table public.project_fx_rates enable row level security;
grant select, insert, update, delete on public.project_fx_rates to authenticated;

drop trigger if exists set_updated_at on public.project_fx_rates;
create trigger set_updated_at before update on public.project_fx_rates
  for each row execute function public.set_updated_at();

drop policy if exists project_fx_rates_select on public.project_fx_rates;
create policy project_fx_rates_select on public.project_fx_rates
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists project_fx_rates_insert on public.project_fx_rates;
create policy project_fx_rates_insert on public.project_fx_rates
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists project_fx_rates_update on public.project_fx_rates;
create policy project_fx_rates_update on public.project_fx_rates
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists project_fx_rates_delete on public.project_fx_rates;
create policy project_fx_rates_delete on public.project_fx_rates
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) payments — columnas de auditoría del backfill
--    Cuando el backfill convierta un cobro cargado en pesos contra un banco
--    USD: `original_amount` guarda el numérico que estaba en `amount`, y
--    `original_currency` fija 'ARS'. El backfill es idempotente vía
--    `original_currency IS NULL` — segunda corrida no toca nada.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payments
  add column if not exists original_amount numeric
    check (original_amount is null or original_amount > 0),
  add column if not exists original_currency text
    check (original_currency is null or original_currency in ('ARS', 'USD'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) sales — mismo tratamiento para total_amount
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  add column if not exists original_total_amount numeric
    check (original_total_amount is null or original_total_amount >= 0),
  add column if not exists original_currency text
    check (original_currency is null or original_currency in ('ARS', 'USD'));
