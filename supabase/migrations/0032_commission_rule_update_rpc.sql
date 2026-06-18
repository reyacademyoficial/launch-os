-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4d.1 — RPC update_commission_rule                                  │
-- │                                                                          │
-- │ Edición atómica de una regla existente:                                  │
-- │   1) actualiza accrual + threshold + launch en commission_rules          │
-- │   2) borra tiers actuales e inserta los nuevos                           │
-- │   3) borra pivot actual y reinserta modalidades                          │
-- │                                                                          │
-- │ Todo en una transacción implícita de la función → si algo falla, rolea   │
-- │ back (no quedan reglas con tiers a medio reemplazar). El trigger del     │
-- │ pivot sigue garantizando unicidad por (modalidad, launch).               │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.update_commission_rule(
  p_rule_id         uuid,
  p_launch_id       uuid,
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

  -- Validación de existencia + autorización vía RLS del UPDATE de abajo.
  select project_id into v_project_id
    from public.commission_rules
   where id = p_rule_id;
  if v_project_id is null then
    raise exception 'Regla no encontrada (rule_id=%)', p_rule_id;
  end if;

  update public.commission_rules
     set launch_id       = p_launch_id,
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
  uuid, uuid, text, text, numeric, uuid[], jsonb
) to authenticated;
