-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 12 — Leaderboard usa lead.team_member_id (autoritativo)             │
-- │                                                                          │
-- │ Bug encontrado: 0046 partía de la premisa "sales.team_member_id =        │
-- │ lead.team_member_id porque updateLead + bulkAssignSetter re-sincronizan".│
-- │ En la práctica hay drift — sales legacy, cambios via Studio, o cualquier │
-- │ path que edite el lead sin pasar por esas dos actions dejan sale con la │
-- │ atribución vieja. Síntoma: la ficha del alumno (que lee lead.team_...)  │
-- │ muestra el vendor pero la tabla de Ventas y el leaderboard (que leen    │
-- │ sale.team_...) muestran "Sin asignar".                                  │
-- │                                                                          │
-- │ Fix: JOIN con leads en `leaderboard_sale_stats` y usar leads.team_...   │
-- │ para atribución y ranking. Es la misma fuente que usa `aggregateLeader- │
-- │ board` JS (via ownerByLead), así números cuadran independientemente de │
-- │ si el denorm está alineado o no.                                        │
-- │                                                                          │
-- │ leaderboard_lead_stats no cambia: ya usaba leads.team_member_id.        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

create or replace function public.leaderboard_sale_stats(
  p_project uuid,
  p_launch  uuid  default null,
  p_from    date  default null,
  p_to      date  default null
)
returns table (
  id                       uuid,
  team_member_id           uuid,
  launch_id                uuid,
  product_id               uuid,
  payment_modality_id      uuid,
  total_amount             numeric,
  closed_at                timestamptz,
  commission_rule_snapshot jsonb,
  sale_rank                integer,
  collected                numeric,
  payment_count            integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.has_project_access(p_project) then
    return;
  end if;

  return query
    with sales_with_owner as (
      -- Atribución autoritativa desde el lead. `sale.team_member_id` es
      -- denorm que puede driftear; ignoramos ese valor acá.
      select
        s.id,
        l.team_member_id                                                  as team_member_id,
        s.launch_id,
        s.product_id,
        s.payment_modality_id,
        s.total_amount,
        s.closed_at,
        s.created_at,
        s.commission_rule_snapshot
      from public.sales s
      join public.leads l on l.id = s.lead_id
      where s.project_id = p_project
    ),
    ranked as (
      -- Rank sobre TODAS las ventas del proyecto — el filtro de UI no debe
      -- correr la posición histórica. Bucket = (owner_del_lead, launch_id).
      select
        so.*,
        (row_number() over (
          partition by so.team_member_id, so.launch_id
          order by so.closed_at asc, so.created_at asc
        ) - 1)::integer as sale_rank
      from sales_with_owner so
    ),
    filtered as (
      select r.*
        from ranked r
       where (p_launch is null or r.launch_id = p_launch)
         and (p_from is null   or r.closed_at::date >= p_from)
         and (p_to is null     or r.closed_at::date <= p_to)
    ),
    pays as (
      select p.sale_id,
             sum(p.amount)      as collected,
             count(*)::integer  as payment_count
        from public.payments p
       where p.project_id = p_project
         and exists (select 1 from filtered f where f.id = p.sale_id)
       group by p.sale_id
    )
    select
      f.id,
      f.team_member_id,
      f.launch_id,
      f.product_id,
      f.payment_modality_id,
      f.total_amount,
      f.closed_at,
      f.commission_rule_snapshot,
      f.sale_rank,
      coalesce(pa.collected, 0)      as collected,
      coalesce(pa.payment_count, 0)  as payment_count
    from filtered f
    left join pays pa on pa.sale_id = f.id;
end;
$$;

commit;
