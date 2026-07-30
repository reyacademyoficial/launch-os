-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 6d-A (Kingrow) — banks y bank_movements a scope organización      │
-- │                                                                          │
-- │ El schema original (0044) modeló `banks.project_id NOT NULL` porque en   │
-- │ ese momento cada proyecto administraba sus propias cuentas. Con la      │
-- │ realidad de Kingrow como operador único, esa asunción es incorrecta:   │
-- │ TODOS los bancos son de Kingrow. Los proyectos externos cobran a través │
-- │ de nuestros bancos y después les transferimos su parte (registrado como │
-- │ `client_transfers`). Los bancos no le pertenecen al proyecto.           │
-- │                                                                          │
-- │ QUÉ CAMBIA                                                               │
-- │   1. `banks.project_id` pasa a NULLABLE. Los bancos existentes se       │
-- │      backfillean a NULL (todos son de Kingrow — la org existente). Se  │
-- │      preserva la columna por si mañana aparece un caso legítimo         │
-- │      "banco escrow de este proyecto específico" — hoy no lo hay pero    │
-- │      nullable no cuesta nada.                                            │
-- │   2. `banks.organization_id` (ya existente desde 0057) pasa a ser el    │
-- │      scope efectivo. RLS y el nuevo UNIQUE se apoyan en esta columna.   │
-- │   3. RLS de `banks` — de `has_project_access(project_id)` a             │
-- │      `can_edit_organization(organization_id)`. Cliente_role sigue sin  │
-- │      grant; superadmin sigue viendo todo por is_kingrow_admin().        │
-- │   4. RLS de `bank_movements` — de `has_project_access(project_of_bank   │
-- │      (bank_id))` a `can_edit_organization(organization_id)`. Simetría. │
-- │   5. El UNIQUE (project_id, name) del schema original ya no protege     │
-- │      contra duplicados (NULLs se consideran distintos por default en   │
-- │      Postgres). Se agrega UNIQUE(organization_id, name) — el CHECK      │
-- │      efectivo para "no dos bancos con el mismo nombre en la org".       │
-- │                                                                          │
-- │ QUÉ NO CAMBIA                                                            │
-- │   · `bank_movements.bank_id` sigue apuntando a banks. Su                 │
-- │     `organization_id` denormalizado (0057) queda igual.                 │
-- │   · `payment_methods.bank_id` sigue apuntando a banks. Ningún cambio.   │
-- │   · El helper `project_of_bank()` deja de usarse en RLS. Se DEPRECA en  │
-- │     el comentario pero se conserva la función por si algún caller       │
-- │     externo la usa; se puede borrar en una migración futura.           │
-- │                                                                          │
-- │ IMPACTO EN CALLERS                                                       │
-- │   Auditado en 6d-A: 13 archivos consumen banks/bank_movements. Todos    │
-- │   los de Kingrow ya asumen org-scope (superadmin ve todo). El único    │
-- │   caller project-scope que va a fallar post-migración es                │
-- │   `/proyectos/[id]/bancos` — se elimina en el mismo bloque.            │
-- │                                                                          │
-- │ SEGURIDAD DEL DEPLOY                                                     │
-- │   La tabla no está vacía (5 bancos, 44 movimientos). El backfill de     │
-- │   project_id = NULL es idempotente. El UNIQUE nuevo se agrega DESPUÉS   │
-- │   del backfill para que si por casualidad hubiera duplicados (mismo    │
-- │   organization_id, mismo name), la migración falle de forma explícita  │
-- │   y no silenciosa. Rey Academy tiene 5 nombres únicos — no debería     │
-- │   fallar.                                                                │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) banks.project_id → nullable + backfill a NULL para todos
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks
  alter column project_id drop not null;

-- Backfill: TODOS los bancos existentes son de Kingrow. Cortar el amarre a
-- proyecto. Si algún día vuelve a ser útil (banco escrow), se setea a mano.
update public.banks
   set project_id = null
 where project_id is not null;

-- El UNIQUE original (project_id, name) queda sin efecto una vez que
-- project_id es NULL para todos. Lo dropeamos para no dejar ruido — el
-- reemplazo real es UNIQUE(organization_id, name) más abajo.
alter table public.banks
  drop constraint if exists banks_project_id_name_key;

-- Reemplazo: unicidad por organización. Un nombre puede repetirse ENTRE orgs
-- pero no DENTRO de la misma org. Kingrow tiene un solo "Mercado Pago".
alter table public.banks
  drop constraint if exists banks_organization_id_name_key;
alter table public.banks
  add  constraint banks_organization_id_name_key
  unique (organization_id, name);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) RLS de banks → can_edit_organization(organization_id)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks enable row level security;

-- El template original de 0044 no revocaba `public` ni `cliente_role`
-- explícitamente (venía de un modelo antiguo). Redraft completo acá para
-- alinear con el patrón de 0052 (organization boundary).
revoke all on public.banks from public;
revoke all on public.banks from cliente_role;

grant select, insert, update, delete on public.banks to authenticated;

drop policy if exists banks_select on public.banks;
create policy banks_select on public.banks
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists banks_insert on public.banks;
create policy banks_insert on public.banks
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists banks_update on public.banks;
create policy banks_update on public.banks
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists banks_delete on public.banks;
create policy banks_delete on public.banks
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS de bank_movements → can_edit_organization(organization_id)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.bank_movements enable row level security;

revoke all on public.bank_movements from public;
revoke all on public.bank_movements from cliente_role;

grant select, insert, update, delete on public.bank_movements to authenticated;

drop policy if exists bank_movements_select on public.bank_movements;
create policy bank_movements_select on public.bank_movements
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists bank_movements_insert on public.bank_movements;
create policy bank_movements_insert on public.bank_movements
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists bank_movements_update on public.bank_movements;
create policy bank_movements_update on public.bank_movements
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists bank_movements_delete on public.bank_movements;
create policy bank_movements_delete on public.bank_movements
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) project_of_bank() — deprecated informativo
-- ═══════════════════════════════════════════════════════════════════════════
-- La función se conserva por si algún caller externo la usa (grep local no
-- muestra ninguno post-migración). Se puede borrar en una migración futura.
comment on function public.project_of_bank(uuid) is
  'DEPRECATED (0101): banks ya no es project-scope. RLS usa organization_id ahora.';
