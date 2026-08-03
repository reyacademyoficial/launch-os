-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ leaderboard_sale_stats — exponer `sales.currency`                        │
-- │                                                                          │
-- │ La RPC de 0047 devolvía todo lo necesario para reconstruir la comisión   │
-- │ salvo la moneda de la venta — necesaria desde 0107 para que              │
-- │ `computeCommissionFromAgg` decida la moneda de la comisión (tiers        │
-- │ percent heredan la moneda del sale; tiers fixed usan la propia).         │
-- │                                                                          │
-- │ Cambio mínimo: agregar la columna a la firma y al SELECT final.         │
-- │ El wrapper TS ya defaultea 'ARS' cuando el campo no viene, así que la    │
-- │ app funciona antes y después de correr esta migración.                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

drop function if exists public.leaderboard_sale_stats(uuid, uuid, date, date);

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
  currency                 text,
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
      select
        s.id,
        l.team_member_id                                                  as team_member_id,
        s.launch_id,
        s.product_id,
        s.payment_modality_id,
        s.total_amount,
        s.currency,
        s.closed_at,
        s.created_at,
        s.commission_rule_snapshot
      from public.sales s
      join public.leads l on l.id = s.lead_id
      where s.project_id = p_project
    ),
    ranked as (
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
      f.currency,
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
