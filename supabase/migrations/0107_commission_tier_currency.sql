-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ commission_rule_tiers.currency — moneda del monto fijo                   │
-- │                                                                          │
-- │ Contexto: los tiers `fixed` guardan un `value` numérico adimensional. Al │
-- │ calcular, el resultado hereda la moneda de la venta — así una regla de   │
-- │ "500 fijos" cargada pensando en pesos aparece como US$ 500 en ventas     │
-- │ USD. El usuario reportó el bug: quiere que la moneda del tramo respete   │
-- │ lo que cargó, sin conversión automática.                                 │
-- │                                                                          │
-- │ FIX: columna `currency` NOT NULL en los tiers. Para `type='fixed'` es    │
-- │ la moneda del monto tal cual (ARS o USD). Para `type='percent'` la      │
-- │ moneda es adimensional (el % se aplica sobre el cobrado/pactado y       │
-- │ hereda la moneda de la venta) — igualmente guardamos ARS default por    │
-- │ simplicidad; el consumidor puede ignorarla cuando type='percent'.        │
-- │                                                                          │
-- │ Backfill: default 'ARS' — el usuario confirmó que todo lo cargado hasta │
-- │ hoy fue en pesos.                                                        │
-- │                                                                          │
-- │ Snapshot: `sales.commission_rule_snapshot` (jsonb) queda con tiers sin  │
-- │ `currency` para las ventas viejas. El calc TS defaultea a 'ARS' cuando  │
-- │ falta — mismo criterio que el backfill.                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.commission_rule_tiers
  add column if not exists currency text not null default 'ARS'
    check (currency in ('ARS', 'USD'));

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs — recrear con parámetro currency en el jsonb de tiers.
-- Los tiers vienen como jsonb, así que agregar `currency` no cambia la firma
-- de la función; sólo cambia cómo se extrae el campo dentro del loop. Aún
-- así reescribimos las dos RPCs para que sean consistentes y quede claro
-- que el nuevo campo se persiste (con default 'ARS' si el caller no lo pasa,
-- para no romper llamadas viejas).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.create_commission_rule(
  p_project_id      uuid,
  p_launch_id       uuid,
  p_product_id      uuid,
  p_accrual_mode    text,
  p_threshold_type  text,
  p_threshold_value numeric,
  p_modality_ids    uuid[],
  p_tiers           jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rule_id uuid;
  v_mod_id  uuid;
  v_tier    jsonb;
begin
  if p_modality_ids is null or array_length(p_modality_ids, 1) is null then
    raise exception 'Se requiere al menos una modalidad';
  end if;
  if p_tiers is null or jsonb_array_length(p_tiers) = 0 then
    raise exception 'Se requiere al menos un tier';
  end if;
  if p_launch_id is not null and p_product_id is not null then
    raise exception 'Una regla no puede ser override de launch y producto a la vez';
  end if;

  insert into public.commission_rules
    (project_id, launch_id, product_id, accrual_mode, threshold_type, threshold_value)
  values
    (p_project_id, p_launch_id, p_product_id, p_accrual_mode, p_threshold_type, p_threshold_value)
  returning id into v_rule_id;

  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    insert into public.commission_rule_tiers
      (rule_id, min_count, max_count, type, value, currency)
    values
      (v_rule_id,
       (v_tier->>'min_count')::int,
       case when v_tier ? 'max_count' and v_tier->>'max_count' is not null
            then (v_tier->>'max_count')::int
            else null end,
       v_tier->>'type',
       (v_tier->>'value')::numeric,
       coalesce(v_tier->>'currency', 'ARS'));
  end loop;

  foreach v_mod_id in array p_modality_ids loop
    insert into public.commission_rule_modalities (rule_id, payment_modality_id)
    values (v_rule_id, v_mod_id);
  end loop;

  return v_rule_id;
end;
$$;

create or replace function public.update_commission_rule(
  p_rule_id         uuid,
  p_launch_id       uuid,
  p_product_id      uuid,
  p_accrual_mode    text,
  p_threshold_type  text,
  p_threshold_value numeric,
  p_modality_ids    uuid[],
  p_tiers           jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_mod_id     uuid;
  v_tier       jsonb;
begin
  if p_modality_ids is null or array_length(p_modality_ids, 1) is null then
    raise exception 'Se requiere al menos una modalidad';
  end if;
  if p_tiers is null or jsonb_array_length(p_tiers) = 0 then
    raise exception 'Se requiere al menos un tier';
  end if;
  if p_launch_id is not null and p_product_id is not null then
    raise exception 'Una regla no puede ser override de launch y producto a la vez';
  end if;

  select project_id into v_project_id
    from public.commission_rules
   where id = p_rule_id;
  if v_project_id is null then
    raise exception 'Regla no encontrada (rule_id=%)', p_rule_id;
  end if;

  update public.commission_rules
     set launch_id       = p_launch_id,
         product_id      = p_product_id,
         accrual_mode    = p_accrual_mode,
         threshold_type  = p_threshold_type,
         threshold_value = p_threshold_value
   where id = p_rule_id;

  delete from public.commission_rule_tiers where rule_id = p_rule_id;
  delete from public.commission_rule_modalities where rule_id = p_rule_id;

  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    insert into public.commission_rule_tiers
      (rule_id, min_count, max_count, type, value, currency)
    values
      (p_rule_id,
       (v_tier->>'min_count')::int,
       case when v_tier ? 'max_count' and v_tier->>'max_count' is not null
            then (v_tier->>'max_count')::int
            else null end,
       v_tier->>'type',
       (v_tier->>'value')::numeric,
       coalesce(v_tier->>'currency', 'ARS'));
  end loop;

  foreach v_mod_id in array p_modality_ids loop
    insert into public.commission_rule_modalities (rule_id, payment_modality_id)
    values (p_rule_id, v_mod_id);
  end loop;

  return p_rule_id;
end;
$$;
