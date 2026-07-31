-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — Motor de split: settlement_rules                    │
-- │                                                                          │
-- │ Cada proyecto (= empresa gestionada) tiene una "regla de split" que      │
-- │ dice cuánto de lo cobrado se queda Kingrow. Para empresas PROPIAS        │
-- │ (Growins, Rey Academy) la regla operativa es percent_of_collected=100.  │
-- │ Para EXTERNAS, un % o combinación de componentes definen la retención.  │
-- │                                                                          │
-- │ Un solo modelo cubre los dos casos. Regla más específica (launch_id     │
-- │ setteado) sobrescribe la default del proyecto (launch_id NULL).         │
-- │                                                                          │
-- │ COMPONENTES SUMABLES (todos ≥ 0, cero = ignorado):                      │
-- │   percent_of_collected  → % del cobrado (aplicado sobre `base` según    │
-- │                           applies_on).                                   │
-- │   fixed_fee_per_launch  → monto fijo por liquidación.                    │
-- │   fixed_fee_per_sale    → monto fijo × cantidad de ventas del launch.   │
-- │   min_guarantee         → piso para la retención de Kingrow.             │
-- │   applies_on            → 'collected' (base = cobrado) o 'sold' (base = │
-- │                           total pactado).                                │
-- │                                                                          │
-- │ La aritmética completa vive en `src/lib/settlements/calc.ts` (función   │
-- │ pura TS, mismo lugar que `commissions/calc.ts`). Al liquidar, la regla  │
-- │ vigente se CONGELA como jsonb en launch_settlements.settlement_rule_    │
-- │ snapshot (mismo patrón que commission_rule_snapshot de 0039).           │
-- │                                                                          │
-- │ NIVEL DE TENANCY: ORG. Sigue la REGLA DURA de 0052 al pie de la letra: │
-- │   - RLS habilitada desde creación.                                       │
-- │   - REVOKE ALL from cliente_role explícito (defense-in-depth).          │
-- │   - GRANT r/w a authenticated (los admins de Kingrow escriben desde     │
-- │     server actions cuando llegue el shell).                             │
-- │   - Policies via can_edit_organization. NUNCA has_project_access.       │
-- │                                                                          │
-- │ UNIQUENESS: partial unique index sobre (project_id, launch_id) WHERE   │
-- │   active=true. Permite historial de reglas desactivadas coexistiendo    │
-- │   sin forzar borrado. Convención NULLS NOT DISTINCT: launch_id NULL     │
-- │   cuenta como valor → una sola default activa por proyecto.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tabla settlement_rules
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.settlement_rules (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,
  project_id            uuid not null references public.projects(id)     on delete cascade,
  launch_id             uuid references public.launches(id)              on delete cascade,

  name                  text not null,

  -- Componentes combinables. Todos ≥ 0. Cero = componente ignorado en el calc.
  percent_of_collected  numeric not null default 0
                        check (percent_of_collected >= 0
                           and percent_of_collected <= 100),
  fixed_fee_per_launch  numeric not null default 0
                        check (fixed_fee_per_launch >= 0),
  fixed_fee_per_sale    numeric not null default 0
                        check (fixed_fee_per_sale >= 0),

  -- Piso opcional de retención (Kingrow no baja de acá aun si el % da menos).
  -- El cap "retención ≤ cobrado" se aplica DESPUÉS en calc.ts.
  min_guarantee         numeric check (min_guarantee is null or min_guarantee >= 0),

  applies_on            text not null default 'collected'
                        check (applies_on in ('collected', 'sold')),

  active                boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists settlement_rules_project_idx
  on public.settlement_rules(project_id);
create index if not exists settlement_rules_launch_idx
  on public.settlement_rules(launch_id) where launch_id is not null;
create index if not exists settlement_rules_organization_idx
  on public.settlement_rules(organization_id);

-- Partial unique: una sola regla ACTIVA por (proyecto, launch). launch_id NULL
-- (regla default del proyecto) cuenta como valor gracias a NULLS NOT DISTINCT.
-- Reglas inactivas coexisten libremente para preservar historial.
create unique index if not exists settlement_rules_active_scope_uniq
  on public.settlement_rules(project_id, launch_id)
  nulls not distinct
  where active = true;

-- Trigger updated_at (patrón estándar del repo)
drop trigger if exists set_updated_at on public.settlement_rules;
create trigger set_updated_at before update on public.settlement_rules
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Frontera org — sigue TEMPLATE de 0052 al pie de la letra
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.settlement_rules enable row level security;

revoke all on public.settlement_rules from public;
revoke all on public.settlement_rules from cliente_role;

grant select, insert, update, delete on public.settlement_rules to authenticated;

drop policy if exists settlement_rules_select on public.settlement_rules;
create policy settlement_rules_select on public.settlement_rules
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists settlement_rules_insert on public.settlement_rules;
create policy settlement_rules_insert on public.settlement_rules
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists settlement_rules_update on public.settlement_rules;
create policy settlement_rules_update on public.settlement_rules
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists settlement_rules_delete on public.settlement_rules;
create policy settlement_rules_delete on public.settlement_rules
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
