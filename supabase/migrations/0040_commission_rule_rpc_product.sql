-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 7 (cont.) — RPCs de reglas con `product_id`                         │
-- │                                                                          │
-- │ `create_commission_rule` y `update_commission_rule` (0031/0032) fijan    │
-- │ la firma (project_id, launch_id, accrual_mode, ...) — sin product_id.   │
-- │ Como Postgres identifica funciones por (nombre + firma), agregar un     │
-- │ parámetro crea una función NUEVA y deja la vieja huérfana. La dropeamos │
-- │ y recreamos con la firma ampliada.                                      │
-- │                                                                          │
-- │ Validación: NO se puede tener launch_id y product_id setteados a la     │
-- │ vez — el constraint `commission_rules_scope_xor` de 0039 lo bloquea a   │
-- │ nivel DB. La RPC agrega una validación explícita para dar un error     │
-- │ humano antes de golpear el constraint.                                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop function if exists public.create_commission_rule(
  uuid, uuid, text, text, numeric, uuid[], jsonb
);
drop function if exists public.update_commission_rule(
  uuid, uuid, text, text, numeric, uuid[], jsonb
);

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
      (rule_id, min_count, max_count, type, value)
    values
      (v_rule_id,
       (v_tier->>'min_count')::int,
       case when v_tier ? 'max_count' and v_tier->>'max_count' is not null
            then (v_tier->>'max_count')::int
            else null end,
       v_tier->>'type',
       (v_tier->>'value')::numeric);
  end loop;

  foreach v_mod_id in array p_modality_ids loop
    insert into public.commission_rule_modalities (rule_id, payment_modality_id)
    values (v_rule_id, v_mod_id);
  end loop;

  return v_rule_id;
end;
$$;

grant execute on function public.create_commission_rule(
  uuid, uuid, uuid, text, text, numeric, uuid[], jsonb
) to authenticated;

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
      (rule_id, min_count, max_count, type, value)
    values
      (p_rule_id,
       (v_tier->>'min_count')::int,
       case when v_tier ? 'max_count' and v_tier->>'max_count' is not null
            then (v_tier->>'max_count')::int
            else null end,
       v_tier->>'type',
       (v_tier->>'value')::numeric);
  end loop;

  foreach v_mod_id in array p_modality_ids loop
    insert into public.commission_rule_modalities (rule_id, payment_modality_id)
    values (p_rule_id, v_mod_id);
  end loop;

  return p_rule_id;
end;
$$;

grant execute on function public.update_commission_rule(
  uuid, uuid, uuid, text, text, numeric, uuid[], jsonb
) to authenticated;
