-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6c-b (Kingrow) — RPC atómica: rotate_settlement_rule              │
-- │                                                                          │
-- │ El unique parcial `settlement_rules_active_scope_uniq` (0053) exige que  │
-- │ para cada (project_id, launch_id) haya como máximo UNA fila activa.     │
-- │ Reemplazar la vigente son dos operaciones (desactivar + insertar), y    │
-- │ el orden lo fuerza el constraint: si insertás primero, choca.           │
-- │                                                                          │
-- │ El cliente JS de Supabase no ofrece transacciones. Dos llamadas         │
-- │ separadas dejan al proyecto sin regla activa cuando la segunda falla,   │
-- │ y sus lanzamientos dejan de poder liquidarse en silencio. Esta función  │
-- │ hace las dos operaciones dentro del mismo statement (todo cuerpo de     │
-- │ función es atómico) y expone la operación al server action vía RPC.     │
-- │                                                                          │
-- │ PENDIENTE aditivo (fuera de esta migración): agregar `created_by uuid`  │
-- │ nullable a settlement_rules para dejar rastro de quién cambió la regla. │
-- │ Cuando llegue esa migración se suma un parámetro a esta función.        │
-- │                                                                          │
-- │ QUÉ VALIDA                                                               │
-- │   1. Que el proyecto pertenezca a la organización declarada. Sin este   │
-- │      check, un payload mal armado desde la UI podría cargar reglas con  │
-- │      org y proyecto cruzados — y el resolver del orquestador matchea   │
-- │      reglas por launch_id sin filtrar por proyecto (bug latente         │
-- │      apuntado para revisar aparte), agravando el problema.              │
-- │   2. Que el lanzamiento pertenezca al proyecto (cuando launch_id no es  │
-- │      NULL). Simétrico al anterior.                                       │
-- │   Nada de esto reemplaza la RLS — la RLS gatea AL LLAMANTE; estas       │
-- │   validaciones gatean la COHERENCIA de los parámetros.                   │
-- │                                                                          │
-- │ SEGURIDAD                                                                │
-- │   - security invoker: la función corre con el rol del llamante, así que │
-- │     las policies de settlement_rules (can_edit_organization) se aplican │
-- │     al UPDATE y al INSERT internos. Sin bypass de RLS. Un usuario sin   │
-- │     permiso sobre la organización pega contra RLS antes de nada útil.   │
-- │   - set search_path = public, pg_temp: aunque sea invoker, es la        │
-- │     práctica estándar y silencia el linter de Supabase                  │
-- │     (function_search_path_mutable). Sin esto la resolución de nombres  │
-- │     dependería del search_path de la sesión que llama.                 │
-- │                                                                          │
-- │ CONCURRENCIA                                                             │
-- │   Dos ediciones simultáneas al mismo (project_id, launch_id): ambas    │
-- │   entran al UPDATE, la primera toma el lock de fila, la segunda espera. │
-- │   Al soltarse el lock, la segunda encuentra la fila ya inactiva y su   │
-- │   INSERT choca con el unique parcial (SQLSTATE 23505). El server       │
-- │   action que llama traduce ese código a un mensaje entendible ("otra   │
-- │   persona modificó la regla, recargá y reintentá"). Ninguna fila queda │
-- │   huérfana; ninguna queda duplicada.                                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.rotate_settlement_rule(
  p_organization_id       uuid,
  p_project_id            uuid,
  p_launch_id             uuid,           -- null = regla default del proyecto
  p_name                  text,
  p_percent_of_collected  numeric,
  p_fixed_fee_per_launch  numeric,
  p_fixed_fee_per_sale    numeric,
  p_min_guarantee         numeric,        -- null = sin piso
  p_applies_on            text            -- 'collected' | 'sold'
)
returns public.settlement_rules
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new public.settlement_rules;
begin
  -- ─── Coherencia (a): proyecto pertenece a la organización declarada ───
  if not exists (
    select 1 from public.projects
     where id = p_project_id
       and organization_id = p_organization_id
  ) then
    raise exception 'El proyecto no pertenece a la organización indicada'
      using errcode = 'check_violation';
  end if;

  -- ─── Coherencia (b): lanzamiento pertenece al proyecto (si aplica) ───
  if p_launch_id is not null and not exists (
    select 1 from public.launches
     where id = p_launch_id
       and project_id = p_project_id
  ) then
    raise exception 'El lanzamiento no pertenece al proyecto indicado'
      using errcode = 'check_violation';
  end if;

  -- ─── Desactivar la vigente para el mismo scope (project, launch) ───
  -- `is not distinct from` matchea NULL con NULL — necesario para que la
  -- default del proyecto (launch_id NULL) también se desactive al rotarla.
  -- El unique parcial garantiza que a lo sumo una fila cumple el filtro.
  update public.settlement_rules
     set active     = false,
         updated_at = now()
   where project_id = p_project_id
     and launch_id is not distinct from p_launch_id
     and active     = true;

  -- ─── Insertar la nueva regla activa. Ya no hay fila activa que compita ─
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
    active
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
    true
  )
  returning * into v_new;

  return v_new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants — mismo patrón que las tablas de 0053+
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on function public.rotate_settlement_rule(
  uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, text
) from public;

revoke execute on function public.rotate_settlement_rule(
  uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, text
) from cliente_role;

grant execute on function public.rotate_settlement_rule(
  uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, text
) to authenticated;
