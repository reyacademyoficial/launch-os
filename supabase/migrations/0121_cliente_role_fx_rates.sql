-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ cliente_role: acceso a `project_fx_rates` para conversión FX             │
-- │                                                                          │
-- │ Contexto: el portal cliente hasta hoy mostraba `sale.total_amount` en   │
-- │ crudo — sumaba ARS + USD como si fueran la misma unidad. Cuando un      │
-- │ launch no tiene `ars_per_usd` propio, el equipo convierte con la tasa   │
-- │ mensual de `project_fx_rates` (via `buildSalesFxContext`). El cliente   │
-- │ no podía porque no tenía grant sobre esa tabla — resultado: números    │
-- │ mezclados, ventas en ARS que aparecen o desaparecen según el redondeo. │
-- │                                                                          │
-- │ Solo `project_fx_rates` se abre. `banks` y `payment_methods` siguen    │
-- │ cerrados (frontera org-scope de 0101) — el cliente los evita usando   │
-- │ `sales.currency` (0106) y `payments.original_currency` (0104), ya      │
-- │ backfilleados. Fallback si algún cobro tiene `original_currency=null`: │
-- │ se asume ARS (default histórico), aproximación aceptable para KPIs.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

grant select on public.project_fx_rates to cliente_role;

drop policy if exists project_fx_rates_select on public.project_fx_rates;
create policy project_fx_rates_select on public.project_fx_rates
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));
