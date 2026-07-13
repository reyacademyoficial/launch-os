-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 7 — Comisiones por producto + snapshot al cierre                    │
-- │                                                                          │
-- │ TRES cambios estructurales, en este orden:                              │
-- │                                                                          │
-- │ 1) commission_rules gana `product_id` opcional. Prioridad de matching:  │
-- │      (mod + producto) → (mod + launch) → (mod) default → null           │
-- │    Constraint XOR: launch_id y product_id nunca están setteados los     │
-- │    dos a la vez (opción B del diseño). Una regla es override de UNA     │
-- │    dimensión — producto o launch — pero no combinación.                 │
-- │                                                                          │
-- │ 2) sales.commission_rule_snapshot (jsonb) — congela la regla vigente    │
-- │    al momento del cierre. computeCommission prefiere el snapshot; si    │
-- │    no existe, cae a findApplicableRule (legacy fallback).               │
-- │                                                                          │
-- │ 3) Backfill: para cada sale existente, computar la regla vigente HOY    │
-- │    y guardarla como snapshot. IMPORTANTE: el snapshot NO reconstruye    │
-- │    la regla "que estaba vigente al día del cierre" (ese dato no lo     │
-- │    tenemos). Fija el histórico a partir de la migración. Ventas         │
-- │    futuras SÍ preservan la regla exacta del cierre.                     │
-- │                                                                          │
-- │ El trigger `check_commission_rule_modality_unique` de 0031 se           │
-- │ actualiza para considerar también `product_id` en el chequeo de         │
-- │ conflicto — si no lo tocamos, el trigger permitiría dos reglas          │
-- │ distintas para el mismo (project, modality, producto) al no compararlo. │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) commission_rules.product_id
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.commission_rules
  add column if not exists product_id uuid references public.products(id) on delete cascade;

alter table public.commission_rules
  drop constraint if exists commission_rules_scope_xor;
alter table public.commission_rules
  add constraint commission_rules_scope_xor
  check (launch_id is null or product_id is null);

create index if not exists commission_rules_product_idx
  on public.commission_rules(product_id) where product_id is not null;

-- Reemplazamos el trigger de 0031 para que el chequeo de unicidad incluya
-- product_id. Sin esto: dos reglas distintas con el mismo (project, mod,
-- launch=null, product=X) podrían coexistir y el matcher rompería empate
-- de forma no determinística.
create or replace function public.check_commission_rule_modality_unique()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
  v_launch_id  uuid;
  v_product_id uuid;
  v_conflict   uuid;
begin
  select project_id, launch_id, product_id
    into v_project_id, v_launch_id, v_product_id
    from public.commission_rules
   where id = new.rule_id;

  select cr.id into v_conflict
    from public.commission_rule_modalities crm
    join public.commission_rules cr on cr.id = crm.rule_id
   where crm.payment_modality_id = new.payment_modality_id
     and cr.project_id           = v_project_id
     and cr.launch_id  is not distinct from v_launch_id
     and cr.product_id is not distinct from v_product_id
     and crm.rule_id <> new.rule_id
   limit 1;

  if v_conflict is not null then
    raise exception 'Ya hay otra regla para esa modalidad y ese scope (rule_id=%)', v_conflict
      using errcode = '23505';
  end if;

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) sales.commission_rule_snapshot
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  add column if not exists commission_rule_snapshot jsonb;

comment on column public.sales.commission_rule_snapshot is
  'Snapshot de la regla al momento del cierre: {accrual_mode, threshold_type, threshold_value, tiers[]}. NULL solo para ventas legacy anteriores a Fase 7 que no lograron backfill (sin regla que matchee). computeCommission prefiere esto sobre buscar la regla vigente.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Backfill del snapshot para ventas existentes
--
-- Para cada sale computamos la regla que aplicaría hoy con la misma cascada
-- que va a usar `findApplicableRule` en TypeScript:
--   1. Regla por (modality, product) — launch_id NULL
--   2. Regla por (modality, launch)  — product_id NULL
--   3. Default (modality)            — ambos NULL
--
-- Congelamos el JSON con la forma que `computeCommission` va a leer. Si no
-- matchea ninguna regla (venta huérfana), snapshot queda NULL y el calc
-- devuelve comisión 0, igual que antes.
-- ═══════════════════════════════════════════════════════════════════════════

with sale_rule as (
  select
    s.id as sale_id,
    -- lead.launch_id es la atribución de launch de una sale hoy (Fase 8 le da
    -- columna propia; hasta entonces derivamos por el lead).
    (select l.launch_id from public.leads l where l.id = s.lead_id) as launch_id,
    s.product_id,
    s.payment_modality_id,
    s.project_id,
    -- Cascada de matching: buscamos la regla más específica que tenga la
    -- modality en su pivot.
    coalesce(
      -- 1) modality + product (launch null)
      (
        select cr.id from public.commission_rules cr
        join public.commission_rule_modalities crm on crm.rule_id = cr.id
        where cr.project_id = s.project_id
          and cr.launch_id  is null
          and cr.product_id = s.product_id
          and crm.payment_modality_id = s.payment_modality_id
        limit 1
      ),
      -- 2) modality + launch (product null)
      (
        select cr.id from public.commission_rules cr
        join public.commission_rule_modalities crm on crm.rule_id = cr.id
        where cr.project_id = s.project_id
          and cr.launch_id  = (select l2.launch_id from public.leads l2 where l2.id = s.lead_id)
          and cr.product_id is null
          and crm.payment_modality_id = s.payment_modality_id
        limit 1
      ),
      -- 3) default (mod, ambos null)
      (
        select cr.id from public.commission_rules cr
        join public.commission_rule_modalities crm on crm.rule_id = cr.id
        where cr.project_id = s.project_id
          and cr.launch_id  is null
          and cr.product_id is null
          and crm.payment_modality_id = s.payment_modality_id
        limit 1
      )
    ) as rule_id
  from public.sales s
  where s.commission_rule_snapshot is null
),
rule_snapshot as (
  select
    sr.sale_id,
    jsonb_build_object(
      'accrual_mode',    cr.accrual_mode,
      'threshold_type',  cr.threshold_type,
      'threshold_value', cr.threshold_value,
      'tiers', coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'min_count', t.min_count,
                     'max_count', t.max_count,
                     'type',      t.type,
                     'value',     t.value
                   )
                   order by t.min_count asc
                 )
            from public.commission_rule_tiers t
           where t.rule_id = cr.id
        ),
        '[]'::jsonb
      )
    ) as snapshot
  from sale_rule sr
  join public.commission_rules cr on cr.id = sr.rule_id
)
update public.sales s
   set commission_rule_snapshot = rs.snapshot
  from rule_snapshot rs
 where s.id = rs.sale_id
   and s.commission_rule_snapshot is null;
