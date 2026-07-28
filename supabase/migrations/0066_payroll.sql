-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Nómina                                 │
-- │                                                                          │
-- │ Pagos periódicos (sueldos) a la GENTE de Kingrow. FK a                  │
-- │ `organization_people` (0058) — la capa de identidad org-level —        │
-- │ para que si la misma persona trabaja en varios proyectos LaunchOS,     │
-- │ su nómina siga siendo UNA. team_members (project-scope) sigue reflejando │
-- │ los roles operativos por proyecto; el link                              │
-- │ team_members.organization_person_id (creado en 0058) hace el puente.   │
-- │                                                                          │
-- │ SEPARACIÓN vs COMISIONES / PAYOUTS                                       │
-- │                                                                          │
-- │ NO CONFUNDIR con `team_member_payouts` (0030), que registra las         │
-- │ COMISIONES por launch pagadas a setters/closers/ads (variable, atado    │
-- │ a ventas del launch). `payroll` es el SUELDO fijo mensual —             │
-- │ compensación no atada a un launch. Ambos coexisten:                     │
-- │   - Un closer full-time recibe SUELDO (payroll) + COMISIONES            │
-- │     (team_member_payouts).                                              │
-- │   - Un contratado que solo cobra por lanzamiento recibe SOLO comisiones.│
-- │   - Un backoffice sin comisión recibe SOLO sueldo.                      │
-- │                                                                          │
-- │ MODELO DEVENGADO vs PERCIBIDO                                            │
-- │   - `period_start / period_end`  → período contable (imputación)        │
-- │   - `due_date`                    → fecha en que se debe pagar          │
-- │   - `paid_at`                     → fecha efectiva de pago (NULL = pend)│
-- │   - `bank_movement_id`            → link al movimiento bancario (opc.)  │
-- │                                                                          │
-- │ CONCEPTOS: sueldo base + agregados libres (jsonb `extras`). Impuestos y │
-- │ aportes se pueden desglosar cuando el módulo lo requiera; hoy alcanza   │
-- │ con base + extras (aguinaldo, bonos, retenciones) para calcular         │
-- │ utilidad neta.                                                          │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.payroll (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  -- Persona (org-level). NO team_member (project-level). Ver comentario cabecera.
  person_id             uuid not null references public.organization_people(id) on delete restrict,

  -- Clasificación contable (opcional)
  account_id            uuid references public.accounts(id)     on delete set null,
  cost_center_id        uuid references public.cost_centers(id) on delete set null,

  -- Período que cubre el pago (mensual, quincenal, etc.)
  period_start          date not null,
  period_end            date not null,

  -- Conceptos
  base_salary           numeric(14, 2) not null default 0 check (base_salary >= 0),
  -- `extras` jsonb libre. Estructura sugerida (no forzada por CHECK para no
  -- atarnos a un shape específico antes de tener 5+ casos reales):
  --   { "aguinaldo": 5000, "bonus_produccion": 3000,
  --     "retencion_ganancias": -1200, "deducciones": -800 }
  -- Los negativos son deducciones. total_amount debe reflejar la suma.
  extras                jsonb not null default '{}'::jsonb,
  total_amount          numeric(14, 2) not null check (total_amount >= 0),
  currency              text not null default 'ARS',

  -- Fechas de pago
  due_date              date,
  paid_at               date,

  bank_movement_id      uuid references public.bank_movements(id) on delete set null,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.payroll
  drop constraint if exists payroll_period_ordered;
alter table public.payroll
  add  constraint payroll_period_ordered
  check (period_end >= period_start);

create index if not exists payroll_org_period_idx
  on public.payroll(organization_id, period_start desc);
create index if not exists payroll_org_unpaid_idx
  on public.payroll(organization_id, due_date)
  where paid_at is null;
create index if not exists payroll_person_idx
  on public.payroll(person_id, period_start desc);
create index if not exists payroll_cost_center_idx
  on public.payroll(cost_center_id) where cost_center_id is not null;
create index if not exists payroll_bank_movement_idx
  on public.payroll(bank_movement_id) where bank_movement_id is not null;

-- Unicidad: una sola fila de nómina por (persona, período). Evita
-- duplicados accidentales al reprocesar. Si hay que corregir, se edita.
create unique index if not exists payroll_person_period_uniq
  on public.payroll(person_id, period_start, period_end);

drop trigger if exists set_updated_at on public.payroll;
create trigger set_updated_at before update on public.payroll
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payroll enable row level security;

revoke all on public.payroll from public;
revoke all on public.payroll from cliente_role;

grant select, insert, update, delete on public.payroll to authenticated;

drop policy if exists payroll_select on public.payroll;
create policy payroll_select on public.payroll
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists payroll_insert on public.payroll;
create policy payroll_insert on public.payroll
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists payroll_update on public.payroll;
create policy payroll_update on public.payroll
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists payroll_delete on public.payroll;
create policy payroll_delete on public.payroll
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
