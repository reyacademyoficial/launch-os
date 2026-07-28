-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — Liquidaciones: launch_settlements                   │
-- │                                                                          │
-- │ Una fila por liquidación de un launch. Puede haber varias (relaciones   │
-- │ re-liquidadas, correcciones), por eso NO hay UNIQUE(launch_id).         │
-- │                                                                          │
-- │ REGLA DE ORO — nunca recalcular lo cobrado.                             │
-- │ `collected_total` se LEE de payments al liquidar. Después queda         │
-- │ CONGELADO en esta tabla. Si mañana entra otro pago, no reescribe        │
-- │ liquidaciones cerradas: se hace una nueva liquidación (o una nota).     │
-- │                                                                          │
-- │ SNAPSHOT — misma filosofía que sales.commission_rule_snapshot (0039).   │
-- │ Al liquidar, la regla vigente se congela como jsonb con los             │
-- │ componentes ({percent_of_collected, fixed_fee_per_launch,               │
-- │ fixed_fee_per_sale, min_guarantee, applies_on, name}). Cambiar la regla │
-- │ a futuro NO reescribe esta fila.                                        │
-- │                                                                          │
-- │ CÁLCULO — `src/lib/settlements/calc.ts` (función pura TS, igual que    │
-- │ `commissions/calc.ts`). Al liquidar:                                    │
-- │   base = collected_total (applies_on='collected')                       │
-- │        | total_sold      (applies_on='sold')                            │
-- │   retención = %×base + fixed_launch + fixed_sale × cant_sales           │
-- │   retención = max(retención, min_guarantee) si min_guarantee not null   │
-- │   retención = min(retención, collected_total)  ← nunca > cobrado        │
-- │   owed_to_client = collected_total − retención                          │
-- │                                                                          │
-- │ STATUS lifecycle (informativo; la máquina de estados vive en actions):  │
-- │   abierta    → borrador con snapshot y montos calculados                │
-- │   liquidada  → confirmada, cuenta corriente registrada                  │
-- │   transferida → plata efectivamente movida al cliente (externa) o       │
-- │                 propiedad interna finalizada (propia)                    │
-- │                                                                          │
-- │ NIVEL ORG — misma frontera dura que settlement_rules (ver 0052/0053).   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.launch_settlements (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organization(id) on delete restrict,
  launch_id                 uuid not null references public.launches(id)    on delete cascade,
  project_id                uuid not null references public.projects(id)    on delete cascade,

  -- Regla congelada al liquidar. Forma esperada:
  --   { name, percent_of_collected, fixed_fee_per_launch, fixed_fee_per_sale,
  --     min_guarantee, applies_on }
  -- Sin FK a settlement_rules porque la fila puede haber sido eliminada/
  -- desactivada después; el snapshot es la única fuente de verdad para
  -- reproducir los montos de esta liquidación.
  settlement_rule_snapshot  jsonb not null,

  -- Montos congelados. Leídos de payments (collected_total), calculados con
  -- el snapshot (kingrow_retained, owed_to_client). Ninguno se recalcula al
  -- leer — se muestra tal cual quedó.
  collected_total           numeric not null check (collected_total >= 0),
  kingrow_retained          numeric not null check (kingrow_retained >= 0),
  owed_to_client            numeric not null check (owed_to_client   >= 0),

  status                    text not null default 'abierta'
                            check (status in ('abierta', 'liquidada', 'transferida')),

  created_at                timestamptz not null default now(),
  closed_at                 timestamptz
);

-- Invariante: la retención nunca supera lo cobrado. calc.ts ya lo enforza;
-- este CHECK es defensa-en-profundidad a nivel DB (protege contra escrituras
-- via SQL directo o bugs de una futura action).
alter table public.launch_settlements
  drop constraint if exists launch_settlements_retention_within_collected;
alter table public.launch_settlements
  add  constraint launch_settlements_retention_within_collected
  check (kingrow_retained <= collected_total);

-- Invariante: owed_to_client = collected_total − kingrow_retained.
alter table public.launch_settlements
  drop constraint if exists launch_settlements_owed_math;
alter table public.launch_settlements
  add  constraint launch_settlements_owed_math
  check (owed_to_client = collected_total - kingrow_retained);

create index if not exists launch_settlements_launch_idx
  on public.launch_settlements(launch_id, created_at desc);
create index if not exists launch_settlements_project_idx
  on public.launch_settlements(project_id, created_at desc);
create index if not exists launch_settlements_organization_idx
  on public.launch_settlements(organization_id, created_at desc);
create index if not exists launch_settlements_status_idx
  on public.launch_settlements(status) where status <> 'transferida';

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_settlements enable row level security;

revoke all on public.launch_settlements from public;
revoke all on public.launch_settlements from cliente_role;

grant select, insert, update, delete on public.launch_settlements to authenticated;

drop policy if exists launch_settlements_select on public.launch_settlements;
create policy launch_settlements_select on public.launch_settlements
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists launch_settlements_insert on public.launch_settlements;
create policy launch_settlements_insert on public.launch_settlements
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists launch_settlements_update on public.launch_settlements;
create policy launch_settlements_update on public.launch_settlements
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists launch_settlements_delete on public.launch_settlements;
create policy launch_settlements_delete on public.launch_settlements
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
