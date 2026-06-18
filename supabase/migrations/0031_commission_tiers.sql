-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4d — Reglas de comisión escalonadas (tiers) + accrual configurable │
-- │                                                                          │
-- │ Generaliza el modelo de 4b en tres direcciones:                          │
-- │                                                                          │
-- │ 1) TIERS marginales por launch (commission_rule_tiers)                   │
-- │    Una regla deja de tener un único `type/value` y pasa a tener N        │
-- │    tramos por cantidad de ventas del miembro EN EL LAUNCH. Rankeo por    │
-- │    `sales.closed_at` asc (empate: `created_at`). Es MARGINAL: ventas     │
-- │    1..N1 usan tier_1, N1+1..N2 usan tier_2, etc. Una regla con un solo  │
-- │    tier (0, NULL, type, value) = el modelo de 4b → equivalencia exacta.  │
-- │                                                                          │
-- │ 2) M:N regla ↔ modalidad (commission_rule_modalities)                   │
-- │    Una misma regla escalonada se aplica a varias modalidades sin         │
-- │    duplicarse. La columna `payment_modality_id` sale de commission_rules.│
-- │                                                                          │
-- │ 3) ACCRUAL configurable en la regla                                      │
-- │    - `proportional` (default, comportamiento 4b): comisión = cobrado×%   │
-- │    - `threshold_full`: 0 hasta cruzar threshold; luego TOTAL × %.        │
-- │      Caso típico: cuotas, "comisión sobre el total recién en la cuota 3".│
-- │    - `threshold_proportional`: 0 hasta threshold; luego cobrado × %.     │
-- │    Threshold se expresa como `payment_count` (entero) o `paid_ratio`     │
-- │    (0..1) según el negocio.                                              │
-- │                                                                          │
-- │ CONVIVENCIA DE FUENTE DE VERDAD — DROPEAMOS columnas viejas              │
-- │ commission_rules.{type, value, payment_modality_id} dejan de existir.    │
-- │ El cálculo derivado de cada lectura ahora se alimenta de tiers+pivot.    │
-- │ Migramos data existente: 1 tier (0..NULL) + 1 fila pivot por regla.      │
-- │                                                                          │
-- │ UNIQUENESS por (modalidad, launch)                                       │
-- │ El UNIQUE NULLS NOT DISTINCT de 4b ya no aplica (payment_modality_id     │
-- │ migró al pivot). Lo enforzamos vía trigger en commission_rule_modalities │
-- │ — más una garantía de defensa en profundidad junto a la del server       │
-- │ action.                                                                  │
-- │                                                                          │
-- │ PERMISOS — sin cambios respecto a 4b: tiers y pivot son                  │
-- │ `can_edit_project` (admin+).                                             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) commission_rules — accrual configurable
--    Agregamos columnas, después backfilleamos, después dropeamos las viejas.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.commission_rules
  add column if not exists accrual_mode    text,
  add column if not exists threshold_type  text,
  add column if not exists threshold_value numeric;

-- Backfill: todas las reglas previas eran proporcionales puras (sin threshold).
update public.commission_rules
   set accrual_mode = 'proportional'
 where accrual_mode is null;

alter table public.commission_rules
  alter column accrual_mode set not null,
  alter column accrual_mode set default 'proportional';

-- Constraints sobre accrual + threshold.
--   - accrual_mode ∈ {proportional, threshold_full, threshold_proportional}
--   - threshold_type ∈ {payment_count, paid_ratio} cuando aplica
--   - proportional ⇒ threshold_* NULL
--   - threshold_* ⇒ accrual_mode != 'proportional'
--   - payment_count ⇒ entero positivo
--   - paid_ratio    ⇒ 0 < ratio ≤ 1
alter table public.commission_rules
  drop constraint if exists commission_rules_accrual_mode_check;
alter table public.commission_rules
  add constraint commission_rules_accrual_mode_check
  check (accrual_mode in ('proportional', 'threshold_full', 'threshold_proportional'));

alter table public.commission_rules
  drop constraint if exists commission_rules_threshold_type_check;
alter table public.commission_rules
  add constraint commission_rules_threshold_type_check
  check (threshold_type is null or threshold_type in ('payment_count', 'paid_ratio'));

alter table public.commission_rules
  drop constraint if exists commission_rules_threshold_consistency;
alter table public.commission_rules
  add constraint commission_rules_threshold_consistency
  check (
    (accrual_mode = 'proportional' and threshold_type is null and threshold_value is null)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) commission_rule_tiers — tramos marginales por cantidad de ventas
--    `min_count` 0-based: la 1ra venta es rank=0. `max_count` NULL = ∞.
--    Tier match: rank >= min_count AND (max_count is null OR rank <= max_count).
--    UNIQUE sobre (rule_id, min_count) evita overlaps idénticos. Solapamientos
--    parciales o huecos se validan en server action (no hay constraint SQL
--    barato para rangos).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.commission_rule_tiers (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid not null references public.commission_rules(id) on delete cascade,
  min_count   integer not null check (min_count >= 0),
  max_count   integer check (max_count is null or max_count >= min_count),
  type        text not null check (type in ('percent', 'fixed')),
  value       numeric not null check (value >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (rule_id, min_count)
);

create index if not exists commission_rule_tiers_rule_idx
  on public.commission_rule_tiers(rule_id, min_count);

alter table public.commission_rule_tiers enable row level security;
grant select, insert, update, delete on public.commission_rule_tiers to authenticated;

drop trigger if exists set_updated_at on public.commission_rule_tiers;
create trigger set_updated_at before update on public.commission_rule_tiers
  for each row execute function public.set_updated_at();

-- RLS: leer/escribir tier requiere lectura/edición del proyecto de la regla.
create or replace function public.project_of_commission_rule(p_rule_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select project_id from public.commission_rules where id = p_rule_id;
$$;

drop policy if exists commission_rule_tiers_select on public.commission_rule_tiers;
create policy commission_rule_tiers_select on public.commission_rule_tiers
  for select to authenticated
  using (public.has_project_access(public.project_of_commission_rule(rule_id)));

drop policy if exists commission_rule_tiers_insert on public.commission_rule_tiers;
create policy commission_rule_tiers_insert on public.commission_rule_tiers
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_commission_rule(rule_id)));

drop policy if exists commission_rule_tiers_update on public.commission_rule_tiers;
create policy commission_rule_tiers_update on public.commission_rule_tiers
  for update to authenticated
  using      (public.can_edit_project(public.project_of_commission_rule(rule_id)))
  with check (public.can_edit_project(public.project_of_commission_rule(rule_id)));

drop policy if exists commission_rule_tiers_delete on public.commission_rule_tiers;
create policy commission_rule_tiers_delete on public.commission_rule_tiers
  for delete to authenticated
  using (public.can_edit_project(public.project_of_commission_rule(rule_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) commission_rule_modalities — pivot regla ↔ modalidad de pago
--    Una regla puede aplicar a varias modalidades. El UNIQUE por (mod, launch)
--    se enforza con trigger porque launch_id vive en commission_rules.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.commission_rule_modalities (
  rule_id              uuid not null references public.commission_rules(id) on delete cascade,
  payment_modality_id  uuid not null references public.payment_modalities(id) on delete cascade,
  created_at           timestamptz not null default now(),
  primary key (rule_id, payment_modality_id)
);

create index if not exists commission_rule_modalities_modality_idx
  on public.commission_rule_modalities(payment_modality_id);

alter table public.commission_rule_modalities enable row level security;
grant select, insert, delete on public.commission_rule_modalities to authenticated;

drop policy if exists commission_rule_modalities_select on public.commission_rule_modalities;
create policy commission_rule_modalities_select on public.commission_rule_modalities
  for select to authenticated
  using (public.has_project_access(public.project_of_commission_rule(rule_id)));

drop policy if exists commission_rule_modalities_insert on public.commission_rule_modalities;
create policy commission_rule_modalities_insert on public.commission_rule_modalities
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_commission_rule(rule_id)));

drop policy if exists commission_rule_modalities_delete on public.commission_rule_modalities;
create policy commission_rule_modalities_delete on public.commission_rule_modalities
  for delete to authenticated
  using (public.can_edit_project(public.project_of_commission_rule(rule_id)));

-- Guard: una modalidad no puede estar linkeada a dos reglas del mismo
-- (project_id, launch_id). Cubrimos `launch_id IS NULL` con IS NOT DISTINCT FROM.
create or replace function public.check_commission_rule_modality_unique()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
  v_launch_id  uuid;
  v_conflict   uuid;
begin
  select project_id, launch_id
    into v_project_id, v_launch_id
    from public.commission_rules
   where id = new.rule_id;

  select cr.id into v_conflict
    from public.commission_rule_modalities crm
    join public.commission_rules cr on cr.id = crm.rule_id
   where crm.payment_modality_id = new.payment_modality_id
     and cr.project_id           = v_project_id
     and cr.launch_id is not distinct from v_launch_id
     and crm.rule_id <> new.rule_id
   limit 1;

  if v_conflict is not null then
    raise exception 'Ya hay otra regla para esa modalidad y lanzamiento (rule_id=%)', v_conflict
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists check_unique_modality on public.commission_rule_modalities;
create trigger check_unique_modality
  before insert or update on public.commission_rule_modalities
  for each row execute function public.check_commission_rule_modality_unique();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Backfill — migrar reglas 4b a tier+pivot, después dropear columnas viejas
--    Cada regla existente se convierte en:
--      - 1 tier (min_count=0, max_count=NULL, type=rule.type, value=rule.value)
--      - 1 fila en pivot (rule_id, payment_modality_id de la regla vieja)
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.commission_rule_tiers (rule_id, min_count, max_count, type, value)
select id, 0, null, type, value
  from public.commission_rules
 where not exists (
   select 1 from public.commission_rule_tiers t where t.rule_id = commission_rules.id
 );

insert into public.commission_rule_modalities (rule_id, payment_modality_id)
select id, payment_modality_id
  from public.commission_rules
 where payment_modality_id is not null
   and not exists (
     select 1 from public.commission_rule_modalities m
      where m.rule_id = commission_rules.id
        and m.payment_modality_id = commission_rules.payment_modality_id
   );

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Dropear columnas viejas — el código TS va a leer SOLO el nuevo modelo.
--    El índice `commission_rules_modality_idx` cae junto con la columna.
--    Eliminamos también el UNIQUE NULLS NOT DISTINCT de 4b (su semántica
--    se cubre ahora por el trigger del pivot).
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropear cualquier UNIQUE remanente sobre commission_rules (era
-- (project, modality, launch) con NULLS NOT DISTINCT). El nombre lo genera
-- Postgres así que lo buscamos por catálogo.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname
      from pg_constraint
     where conrelid = 'public.commission_rules'::regclass
       and contype  = 'u'
  loop
    execute format('alter table public.commission_rules drop constraint %I', v_name);
  end loop;
end $$;

drop index if exists public.commission_rules_modality_idx;

alter table public.commission_rules
  drop column if exists type,
  drop column if exists value,
  drop column if exists payment_modality_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) RPC create_commission_rule — alta atómica (regla + tiers + pivot)
--    El server action TS llama esta RPC. Si cualquier insert falla, la
--    transacción rolea back todo (regla huérfana imposible).
--    `security invoker` → la RLS sigue aplicando con el caller real.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_commission_rule(
  p_project_id      uuid,
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

  insert into public.commission_rules
    (project_id, launch_id, accrual_mode, threshold_type, threshold_value)
  values
    (p_project_id, p_launch_id, p_accrual_mode, p_threshold_type, p_threshold_value)
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
  uuid, uuid, text, text, numeric, uuid[], jsonb
) to authenticated;
