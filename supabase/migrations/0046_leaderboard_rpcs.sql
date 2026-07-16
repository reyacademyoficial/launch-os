-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 12 — RPCs de agregación para el leaderboard                         │
-- │                                                                          │
-- │ Problema: el leaderboard traía TODOS los leads (~100k) + TODOS los       │
-- │ payments (~20k) + TODAS las sales (~5k) crudos por PostgREST y agregaba │
-- │ en JS. Aunque la migración 0045 arregló la RLS N×1 de payments, el      │
-- │ transfer bruto seguía en el orden de minutos con datasets grandes.     │
-- │                                                                          │
-- │ Solución: dos funciones que hacen el GROUP BY / window / joins en la    │
-- │ DB y devuelven solo lo que el leaderboard necesita.                     │
-- │                                                                          │
-- │   leaderboard_lead_stats(project, launch?)                              │
-- │     → (team_member_id, leads_worked, closed) por miembro                │
-- │                                                                          │
-- │   leaderboard_sale_stats(project, launch?, from?, to?)                  │
-- │     → per-sale: (id, team_member_id, launch_id, product_id,             │
-- │        payment_modality_id, total_amount, closed_at,                    │
-- │        commission_rule_snapshot, sale_rank, collected, payment_count)   │
-- │                                                                          │
-- │ Rank via row_number() OVER (partition by team_member_id, launch_id      │
-- │ order by closed_at, created_at) sobre el UNIVERSO CRUDO — mismo criterio│
-- │ que buildSaleRanks JS: un filtro de UI no debe correr la posición       │
-- │ histórica.                                                              │
-- │                                                                          │
-- │ SECURITY DEFINER + guard has_project_access al top: hacemos 1 check en │
-- │ vez de N×has_project_access como haría la RLS por fila. Sin el guard,  │
-- │ un caller sin acceso podría igual leer datos vía la función definer.   │
-- │                                                                          │
-- │ Uso `sales.team_member_id` (denorm mantenida por createSale +           │
-- │ updateLead) — coincide con `lead.team_member_id` por invariante. La    │
-- │ ventaja: no hay JOIN a leads para la atribución/rank.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) leaderboard_lead_stats
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.leaderboard_lead_stats(
  p_project uuid,
  p_launch  uuid default null
)
returns table (
  team_member_id uuid,
  leads_worked   bigint,
  closed         bigint
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
    select
      l.team_member_id,
      count(*)                                             as leads_worked,
      count(*) filter (where l.status = 'cerrado')         as closed
    from public.leads l
    where l.project_id = p_project
      and (p_launch is null or l.launch_id = p_launch)
    group by l.team_member_id;
end;
$$;

grant execute on function public.leaderboard_lead_stats(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) leaderboard_sale_stats
-- ═══════════════════════════════════════════════════════════════════════════
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
    with ranked as (
      select
        s.id,
        s.team_member_id,
        s.launch_id,
        s.product_id,
        s.payment_modality_id,
        s.total_amount,
        s.closed_at,
        s.commission_rule_snapshot,
        (row_number() over (
          partition by s.team_member_id, s.launch_id
          order by s.closed_at asc, s.created_at asc
        ) - 1)::integer as sale_rank
      from public.sales s
      where s.project_id = p_project
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

grant execute on function public.leaderboard_sale_stats(uuid, uuid, date, date) to authenticated;

commit;
