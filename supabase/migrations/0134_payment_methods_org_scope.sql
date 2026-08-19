-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque Kingrow — payment_methods pasa a scope organización               │
-- │                                                                          │
-- │ El schema original (0043) modeló `payment_methods.project_id NOT NULL`   │
-- │ porque en Fase 11 cada proyecto administraba su propio catálogo (Stripe,│
-- │ transferencia, Mercado Pago…). Con la realidad de Kingrow como operador  │
-- │ único, esa asunción es la misma que ya se corrigió en 0101 para banks:  │
-- │ TODOS los métodos de pago los administra Kingrow y los proyectos los    │
-- │ consumen. Un mismo "Mercado Pago" hoy se replica N veces (una por       │
-- │ proyecto) y la UI de Kingrow pide elegir proyecto para crear uno.       │
-- │                                                                          │
-- │ QUÉ CAMBIA                                                               │
-- │   1. `payment_methods.organization_id` NOT NULL (nuevo). Backfill desde  │
-- │      `projects.organization_id` de la fila project_id actual.            │
-- │   2. `payment_methods.project_id` pasa a NULLABLE. Los existentes se    │
-- │      backfillean a NULL — un método ya no vive dentro de un proyecto   │
-- │      sino dentro de la org. Se preserva la columna por si mañana        │
-- │      aparece un caso legítimo "método exclusivo de tal proyecto".       │
-- │   3. Swap del UNIQUE: (project_id, name) → (organization_id, name).     │
-- │      Un nombre puede repetirse ENTRE orgs pero no DENTRO de la misma.   │
-- │   4. RLS:                                                                │
-- │       · SELECT → has_organization_access(organization_id) — mismo       │
-- │         helper que team_members (0124): CUALQUIER miembro de un         │
-- │         proyecto de la org lee. Necesario para que operador/coordinador │
-- │         vean los métodos en los dropdowns de sale-modal / cobros al     │
-- │         cargar/editar ventas de sus proyectos.                          │
-- │       · I/U/D → can_edit_organization(organization_id) (superadmin).    │
-- │   5. Índices: drop project_*, crear (organization_id) y                 │
-- │      (organization_id, active).                                          │
-- │                                                                          │
-- │ QUÉ NO CAMBIA                                                            │
-- │   · `payment_methods.bank_id` sigue apuntando a banks (0044). Como     │
-- │     banks ya es org-scope desde 0101, esto queda coherente.             │
-- │   · `payments.payment_method_id` FK con ON DELETE RESTRICT — no cambia. │
-- │   · Cliente_role sigue sin GRANT (0043 grantea sólo a authenticated).   │
-- │     Se agrega REVOKE explícito como defense-in-depth (patrón 0052).    │
-- │   · `payment_modalities` sigue project-scope: define regla de comisión, │
-- │     que sí es por proyecto (tabla de precios distinta). NO confundir.   │
-- │                                                                          │
-- │ SEGURIDAD DEL DEPLOY (producción)                                        │
-- │   La tabla NO está vacía. Backup obligatorio de project_id en           │
-- │   `_backup_payment_methods_project_id_0134` ANTES del backfill. El     │
-- │   UNIQUE(organization_id, name) se crea DESPUÉS del backfill — si hay  │
-- │   duplicados (misma org, mismo name), la migración falla explícita, no │
-- │   silenciosa. Asunción de deploy (confirmada con el operador): los     │
-- │   nombres actuales son únicos dentro de la org.                         │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Backup del payment_methods.project_id ANTES del backfill
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public._backup_payment_methods_project_id_0134 (
  payment_method_id  uuid primary key,
  project_id_before  uuid not null,
  organization_id    uuid not null,
  backed_up_at       timestamptz not null default now()
);

insert into public._backup_payment_methods_project_id_0134
  (payment_method_id, project_id_before, organization_id)
select pm.id, pm.project_id, p.organization_id
  from public.payment_methods pm
  join public.projects p on p.id = pm.project_id
 where pm.project_id is not null
on conflict (payment_method_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Agregar organization_id (nullable primero para backfillear)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payment_methods
  add column if not exists organization_id uuid
  references public.organization(id) on delete restrict;

update public.payment_methods pm
   set organization_id = p.organization_id
  from public.projects p
 where pm.project_id = p.id
   and pm.organization_id is null;

do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
    from public.payment_methods
   where organization_id is null;
  if v_orphans > 0 then
    raise exception '0134: % payment_methods sin organization_id (no se pudo resolver desde projects). Abortando.', v_orphans;
  end if;
end $$;

alter table public.payment_methods
  alter column organization_id set not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) project_id → nullable + backfill a NULL para todos los existentes
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payment_methods
  alter column project_id drop not null;

update public.payment_methods
   set project_id = null
 where project_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Swap del UNIQUE: (project_id, name) → (organization_id, name)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nombre por convención de Postgres para `unique (project_id, name)` del
-- schema original: `payment_methods_project_id_name_key`. Si el nombre difiere
-- en la DB destino, verificar con information_schema.table_constraints antes
-- del deploy y actualizar este DROP en consecuencia.
alter table public.payment_methods
  drop constraint if exists payment_methods_project_id_name_key;

alter table public.payment_methods
  drop constraint if exists payment_methods_organization_id_name_key;
alter table public.payment_methods
  add  constraint payment_methods_organization_id_name_key
  unique (organization_id, name);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Índices: drop project_*, crear org_*
-- ═══════════════════════════════════════════════════════════════════════════
drop index if exists public.payment_methods_project_idx;

create index if not exists payment_methods_org_idx
  on public.payment_methods(organization_id);
create index if not exists payment_methods_org_active_idx
  on public.payment_methods(organization_id, active);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) RLS: reemplazar policies project-scope por org-scope
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payment_methods enable row level security;

-- Defense-in-depth: cliente_role fue creado en 0023 con NOINHERIT y sin
-- grants sobre payment_methods. El REVOKE explícito blinda contra cambios
-- futuros en el bootstrap de Supabase (ver feedback_supabase_default_privileges).
revoke all on public.payment_methods from public;
revoke all on public.payment_methods from cliente_role;

grant select, insert, update, delete on public.payment_methods to authenticated;

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using (public.has_organization_access(organization_id));

drop policy if exists payment_methods_insert on public.payment_methods;
create policy payment_methods_insert on public.payment_methods
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists payment_methods_update on public.payment_methods;
create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists payment_methods_delete on public.payment_methods;
create policy payment_methods_delete on public.payment_methods
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Documentar deprecación de project_id
-- ═══════════════════════════════════════════════════════════════════════════
comment on column public.payment_methods.project_id is
  'DEPRECATED (0134): payment_methods es org-scope. Se mantiene la columna nullable por si aparece un caso legítimo project-exclusive. Backup en _backup_payment_methods_project_id_0134.';
