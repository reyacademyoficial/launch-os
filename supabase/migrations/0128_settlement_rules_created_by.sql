-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0128 — settlement_rules.created_by (trazabilidad)                        │
-- │                                                                          │
-- │ Cierra el pendiente aditivo enunciado en 0097: dejar rastro de quién     │
-- │ crea cada regla. Estrictamente aditiva, no requiere backfill.            │
-- │                                                                          │
-- │ DISEÑO                                                                    │
-- │   - `created_by uuid nullable references auth.users(id) on delete set    │
-- │     null`. Nullable porque las reglas anteriores a esta migración        │
-- │     quedan sin autor conocido (histórico legítimamente vacío).           │
-- │   - `on delete set null` en vez de restrict: si un usuario se borra      │
-- │     de auth (baja de la cuenta), la regla no debería ser bloqueada       │
-- │     por eso — es info secundaria de auditoría, no un vínculo duro.       │
-- │   - `rotate_settlement_rule` (RPC de 0097) resuelve `auth.uid()`         │
-- │     dentro de la función, no como parámetro. Motivo: es security         │
-- │     invoker, corre con el rol del llamante → `auth.uid()` devuelve el   │
-- │     usuario real sin depender de que la UI lo pase. La UI ni entera.    │
-- │   - Se aplica sólo en el INSERT (creación de la nueva regla activa).    │
-- │     El UPDATE que desactiva la fila vigente NO toca `created_by` — el   │
-- │     autor original de la regla desactivada se preserva.                 │
-- │                                                                          │
-- │ NO CAMBIA la signature de la RPC → grants intactos (0097) → sin drop.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.settlement_rules
  add column if not exists created_by uuid
  references auth.users(id) on delete set null;

comment on column public.settlement_rules.created_by is
  'Usuario que creó esta regla. Nullable — reglas anteriores a 0128 quedan sin '
  'autor. Se popula automáticamente en rotate_settlement_rule.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Reemplazo de rotate_settlement_rule para popular created_by en el INSERT
-- Misma signature que 0097 → no se tocan grants.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rotate_settlement_rule(
  p_organization_id       uuid,
  p_project_id            uuid,
  p_launch_id             uuid,
  p_name                  text,
  p_percent_of_collected  numeric,
  p_fixed_fee_per_launch  numeric,
  p_fixed_fee_per_sale    numeric,
  p_min_guarantee         numeric,
  p_applies_on            text
)
returns public.settlement_rules
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new public.settlement_rules;
begin
  if not exists (
    select 1 from public.projects
     where id = p_project_id
       and organization_id = p_organization_id
  ) then
    raise exception 'El proyecto no pertenece a la organización indicada'
      using errcode = 'check_violation';
  end if;

  if p_launch_id is not null and not exists (
    select 1 from public.launches
     where id = p_launch_id
       and project_id = p_project_id
  ) then
    raise exception 'El lanzamiento no pertenece al proyecto indicado'
      using errcode = 'check_violation';
  end if;

  update public.settlement_rules
     set active     = false,
         updated_at = now()
   where project_id = p_project_id
     and launch_id is not distinct from p_launch_id
     and active     = true;

  insert into public.settlement_rules (
    organization_id,
    project_id,
    launch_id,
    name,
    percent_of_collected,
    fixed_fee_per_launch,
    fixed_fee_per_sale,
    min_guarantee,
    applies_on,
    active,
    created_by
  ) values (
    p_organization_id,
    p_project_id,
    p_launch_id,
    p_name,
    p_percent_of_collected,
    p_fixed_fee_per_launch,
    p_fixed_fee_per_sale,
    p_min_guarantee,
    p_applies_on,
    true,
    auth.uid()
  )
  returning * into v_new;

  return v_new;
end;
$$;
