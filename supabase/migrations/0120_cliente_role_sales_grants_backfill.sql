-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ cliente_role: backfill de grants column-level sobre `sales`             │
-- │                                                                          │
-- │ 0023 congeló el grant SELECT column-level de `sales` para cliente_role  │
-- │ en: id, project_id, lead_id, payment_modality_id, total_amount,        │
-- │ closed_at, created_at, updated_at.                                      │
-- │                                                                          │
-- │ Desde entonces la tabla creció y nadie extendió el grant:               │
-- │   0038 → product_id                                                    │
-- │   0041 → launch_id (atribución propia de la venta)                    │
-- │   0043 → installment_count, installment_frequency, grace_days         │
-- │   0103 → original_total_amount, original_currency (auditoría backfill)│
-- │   0106 → currency                                                     │
-- │                                                                          │
-- │ Bug reportado: el portal del cliente muestra ventas y revenue           │
-- │ estimado/cobrado en 0. La causa: `getKanbanSalesAggregatesForProject`  │
-- │ pide `launch_id` y `currency`, y PostgREST responde 42501 antes de     │
-- │ evaluar RLS; el helper hace `.data ?? []` y el agregado queda vacío.   │
-- │                                                                          │
-- │ Este parche solo suma columnas NO sensibles. La frontera dura sigue    │
-- │ siendo `sales.team_member_id` (atribución al vendedor) — no se toca.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

grant select (
  launch_id,
  product_id,
  currency,
  installment_count,
  installment_frequency,
  grace_days,
  original_total_amount,
  original_currency
) on public.sales to cliente_role;
