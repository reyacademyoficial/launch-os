-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 10 — Modo `on_close` para reglas de comisión                       │
-- │                                                                          │
-- │ Semántica: la comisión se libera al 100% en el momento del cierre de    │
-- │ la venta, indistinto de los cobros posteriores. Casos típicos:          │
-- │   - "El closer cobra 20% del pactado apenas cierra la venta."           │
-- │   - "El closer cobra $100 fijos por cada venta cerrada, no importa el   │
-- │      precio ni cuántas cuotas paga el alumno."                          │
-- │                                                                          │
-- │ Diferencia con `threshold_full` + `payment_count=1`: en on_close no     │
-- │ hace falta que exista NI UN payment cargado; la comisión ya está        │
-- │ devengada. En threshold_full=1 el closer tiene que esperar al primer    │
-- │ cobro para verla en su leaderboard.                                     │
-- │                                                                          │
-- │ Ajustamos DOS checks:                                                    │
-- │   1) `accrual_mode_check` — suma `on_close` a los valores válidos.     │
-- │   2) `threshold_consistency` — on_close debe tener threshold_* NULL     │
-- │      (mismo trato que proportional).                                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.commission_rules
  drop constraint if exists commission_rules_accrual_mode_check;
alter table public.commission_rules
  add constraint commission_rules_accrual_mode_check
  check (accrual_mode in ('proportional', 'threshold_full', 'threshold_proportional', 'on_close'));

alter table public.commission_rules
  drop constraint if exists commission_rules_threshold_consistency;
alter table public.commission_rules
  add constraint commission_rules_threshold_consistency
  check (
    (accrual_mode in ('proportional', 'on_close') and threshold_type is null and threshold_value is null)
    or (
      accrual_mode in ('threshold_full', 'threshold_proportional')
      and threshold_type is not null
      and threshold_value is not null
      and (
        (threshold_type = 'payment_count' and threshold_value >= 1 and threshold_value = floor(threshold_value))
        or (threshold_type = 'paid_ratio' and threshold_value > 0 and threshold_value <= 1)
      )
    )
  );
