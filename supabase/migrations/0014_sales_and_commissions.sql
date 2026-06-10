-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4b — Ventas, cobros y comisiones                                   │
-- │                                                                          │
-- │ El corazón del CRM. 4 tablas:                                            │
-- │   - payment_modalities  → "pago total", "3 cuotas", "12 cuotas" (config) │
-- │   - commission_rules    → % o monto fijo, con override por launch       │
-- │   - sales               → venta cerrada, cuelga de un lead "cerrado"     │
-- │   - payments            → historial de cobros (manual, append-only)     │
-- │                                                                          │
-- │ FILOSOFÍA DE LA COMISIÓN — no se persiste.                              │
-- │ La comisión se DERIVA en cada lectura: sum(payments) × rule. Si admin   │
-- │ cambia la regla, las ventas previas reflejan el cambio inmediato. Misma │
-- │ idea que el status de sync que se derivaba de integration_runs (0012).  │
-- │                                                                          │
-- │ PERMISOS — split admin vs operador:                                     │
-- │   - payment_modalities + commission_rules → can_edit_project (admin+).  │
-- │     Tocar plata = decisión de admin.                                    │
-- │   - sales + payments → can_edit_launches_in (admin + operador).         │
-- │     El operador carga la venta + los cobros día a día.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) payment_modalities — opciones de pago por proyecto, administrable
--    `name` es libre para no atarse a "pago total / cuotas N". Si el negocio
--    quiere "ahora + 6 cuotas" lo carga como una modalidad más.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.payment_modalities (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists payment_modalities_project_idx
  on public.payment_modalities(project_id);

alter table public.payment_modalities enable row level security;
grant select, insert, update, delete on public.payment_modalities to authenticated;

drop trigger if exists set_updated_at on public.payment_modalities;
create trigger set_updated_at before update on public.payment_modalities
  for each row execute function public.set_updated_at();

drop policy if exists payment_modalities_select on public.payment_modalities;
create policy payment_modalities_select on public.payment_modalities
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists payment_modalities_insert on public.payment_modalities;
create policy payment_modalities_insert on public.payment_modalities
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists payment_modalities_update on public.payment_modalities;
create policy payment_modalities_update on public.payment_modalities
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists payment_modalities_delete on public.payment_modalities;
create policy payment_modalities_delete on public.payment_modalities
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) commission_rules — regla por (modalidad, launch?). type ∈ percent|fixed.
--    `launch_id IS NULL` → regla default del proyecto para esa modalidad.
--    `launch_id = X`     → override para ese launch.
--
--    UNIQUE NULLS NOT DISTINCT (Postgres 15+) trata NULL como un valor único:
--    una sola "default" por (project, modality), una sola override por
--    (project, modality, launch). Sin esto, la `unique` clásica deja insertar
--    múltiples defaults porque NULL ≠ NULL.
--
--    `type = fixed` con cobros parciales → proporcional: cobrado/total × value.
--    El cálculo vive en src/lib/commissions/calc.ts (función pura) y se
--    re-evalúa en cada lectura — no se persiste.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.commission_rules (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  payment_modality_id  uuid not null references public.payment_modalities(id) on delete cascade,
  launch_id            uuid references public.launches(id) on delete cascade,

  type                 text not null check (type in ('percent', 'fixed')),
  value                numeric not null check (value >= 0),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique nulls not distinct (project_id, payment_modality_id, launch_id)
);

create index if not exists commission_rules_modality_idx
  on public.commission_rules(payment_modality_id);
create index if not exists commission_rules_launch_idx
  on public.commission_rules(launch_id) where launch_id is not null;

alter table public.commission_rules enable row level security;
grant select, insert, update, delete on public.commission_rules to authenticated;

drop trigger if exists set_updated_at on public.commission_rules;
create trigger set_updated_at before update on public.commission_rules
  for each row execute function public.set_updated_at();

drop policy if exists commission_rules_select on public.commission_rules;
create policy commission_rules_select on public.commission_rules
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists commission_rules_insert on public.commission_rules;
create policy commission_rules_insert on public.commission_rules
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists commission_rules_update on public.commission_rules;
create policy commission_rules_update on public.commission_rules
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists commission_rules_delete on public.commission_rules;
create policy commission_rules_delete on public.commission_rules
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) sales — una venta cuelga de un lead "cerrado".
--    `project_id` redundante con `leads.project_id` pero lo guardamos para
--    que la RLS de sales no necesite hacer join a leads en cada chequeo.
--    El guard de "lead en status='cerrado'" lo hace la server action — un
--    constraint cross-row sería caro y se puede salvar con foreign data.
--
--    `total_amount` = monto pactado, REFERENCIA. La comisión NO se calcula
--    sobre esto: se calcula sobre sum(payments). Si jamás se cobra, comisión
--    = 0 aunque el `total_amount` esté cargado.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.sales (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  lead_id              uuid not null references public.leads(id) on delete cascade,
  team_member_id       uuid references public.team_members(id) on delete set null,
  payment_modality_id  uuid not null references public.payment_modalities(id) on delete restrict,

  total_amount         numeric not null check (total_amount >= 0),
  closed_at            timestamptz not null default now(),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (lead_id)   -- una sola venta por lead
);

create index if not exists sales_project_idx
  on public.sales(project_id);
create index if not exists sales_team_member_idx
  on public.sales(team_member_id) where team_member_id is not null;
create index if not exists sales_closed_at_idx
  on public.sales(project_id, closed_at desc);

alter table public.sales enable row level security;
grant select, insert, update, delete on public.sales to authenticated;

drop trigger if exists set_updated_at on public.sales;
create trigger set_updated_at before update on public.sales
  for each row execute function public.set_updated_at();

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists sales_delete on public.sales;
create policy sales_delete on public.sales
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) payments — historial de cobros, append-mostly. Cada cobro = una fila.
--    `amount > 0`: para reembolsos a futuro evaluar si conviene flag + amount
--    negativo o tabla aparte. Por ahora positivos puros.
--    RLS por sale → resolvemos al project_id via helper.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.project_of_sale(p_sale_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select project_id from public.sales where id = p_sale_id;
$$;

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  paid_at     date not null default current_date,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists payments_sale_idx
  on public.payments(sale_id, paid_at desc);

alter table public.payments enable row level security;
grant select, insert, update, delete on public.payments to authenticated;

drop trigger if exists set_updated_at on public.payments;
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.has_project_access(public.project_of_sale(sale_id)));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (public.can_edit_launches_in(public.project_of_sale(sale_id)));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_sale(sale_id)))
  with check (public.can_edit_launches_in(public.project_of_sale(sale_id)));

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_sale(sale_id)));
