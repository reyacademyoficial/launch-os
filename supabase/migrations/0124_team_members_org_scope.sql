-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque Kingrow — team_members pasa a scope organización                  │
-- │                                                                          │
-- │ El schema original (0013) modeló `team_members.project_id NOT NULL`     │
-- │ porque en Fase 4 los setters/closers eran metadata por proyecto. Con la │
-- │ realidad de Kingrow, un mismo comercial trabaja para múltiples          │
-- │ proyectos de la misma org (Rey Academy hoy, otras marcas mañana). Tener │
-- │ una fila por (persona, proyecto) obliga a duplicar altas y complica     │
-- │ leaderboard/ranking cross-proyecto.                                     │
-- │                                                                          │
-- │ QUÉ CAMBIA                                                               │
-- │   1. `team_members.organization_id` NOT NULL (nuevo). Backfill desde    │
-- │      projects.organization_id de la fila actual project_id.             │
-- │   2. `team_members.project_id` pasa a NULLABLE. Los existentes se        │
-- │      backfillean a NULL — un team_member ya no vive dentro de un        │
-- │      proyecto sino dentro de la org. Se preserva la columna por si       │
-- │      mañana aparece un caso legítimo "closer exclusivo de tal proyecto".│
-- │   3. UNIQUE parcial (organization_id, lower(name)) where active para    │
-- │      evitar re-duplicación futura (una persona activa una sola vez).   │
-- │   4. RLS:                                                                │
-- │       · SELECT → has_organization_access(organization_id)  (nuevo       │
-- │         helper — miembro de CUALQUIER proyecto de la org lee: operador  │
-- │         necesita listar closers para asignar en el sale-modal).         │
-- │       · I/U/D → can_edit_organization(organization_id)                  │
-- │         (superadmin — mismo criterio que el resto de tablas org-scope).│
-- │   5. Índices: drop project_*, crear (organization_id) y                 │
-- │      (organization_id, active).                                          │
-- │                                                                          │
-- │ QUÉ NO CAMBIA                                                            │
-- │   · FKs entrantes: sales.team_member_id, leads.team_member_id,         │
-- │     team_member_payouts.team_member_id, ghl_user_mappings.team_member_id│
-- │     todos siguen apuntando por id — no rompen.                          │
-- │   · team_member_payouts sigue project-scope (`project_id NOT NULL`) —  │
-- │     el guard cross-tenant pasa a chequear org (payout.project.org ==   │
-- │     team_member.org). Se ajusta en el server action, no en la DB.      │
-- │                                                                          │
-- │ SEGURIDAD DEL DEPLOY (producción)                                        │
-- │   La tabla NO está vacía. Backup obligatorio de project_id en           │
-- │   `_backup_team_members_project_id_0124` ANTES del backfill. El        │
-- │   UNIQUE se crea DESPUÉS del NOT NULL de organization_id — si por      │
-- │   casualidad hubiera duplicados (misma org, mismo name, activos), la  │
-- │   migración falla explícita, no silenciosa.                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Backup del team_members.project_id ANTES del backfill
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public._backup_team_members_project_id_0124 (
  team_member_id     uuid primary key,
  project_id_before  uuid not null,
  organization_id    uuid not null,
  backed_up_at       timestamptz not null default now()
);

insert into public._backup_team_members_project_id_0124
  (team_member_id, project_id_before, organization_id)
select tm.id, tm.project_id, p.organization_id
  from public.team_members tm
  join public.projects p on p.id = tm.project_id
 where tm.project_id is not null
on conflict (team_member_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Agregar organization_id (nullable primero para backfillear)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.team_members
  add column if not exists organization_id uuid
  references public.organization(id) on delete restrict;

-- Backfill desde projects.organization_id
update public.team_members tm
   set organization_id = p.organization_id
  from public.projects p
 where tm.project_id = p.id
   and tm.organization_id is null;

-- Guard: si queda alguna fila sin organization_id resuelta, la migración falla
-- (no debería, pero mejor explícito que un NOT NULL sorpresivo).
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
    from public.team_members
   where organization_id is null;
  if v_orphans > 0 then
    raise exception '0124: % team_members sin organization_id (no se pudo resolver desde projects). Abortando.', v_orphans;
  end if;
end $$;

alter table public.team_members
  alter column organization_id set not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) project_id → nullable + backfill a NULL para todos los existentes
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.team_members
  alter column project_id drop not null;

update public.team_members
   set project_id = null
 where project_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Índices: drop project_*, crear org_*
-- ═══════════════════════════════════════════════════════════════════════════
drop index if exists public.team_members_project_idx;
drop index if exists public.team_members_project_active_idx;

create index if not exists team_members_org_idx
  on public.team_members(organization_id);
create index if not exists team_members_org_active_idx
  on public.team_members(organization_id, active);

-- UNIQUE parcial: una persona activa una sola vez por org (case-insensitive).
-- Historial de inactivos con mismo nombre queda OK (permite reciclar).
create unique index if not exists team_members_org_name_active_uniq
  on public.team_members(organization_id, lower(name))
  where active = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Helper: has_organization_access(org_id) — READ permission org-scope
--    True si el user tiene project_members en ALGÚN proyecto de esta org.
--    Necesario para que operador/coordinador puedan listar team_members al
--    asignar closer a un lead (el select en el sale-modal).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.has_organization_access(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_kingrow_admin()
      or exists (
        select 1
        from public.project_members m
        join public.projects        p on p.id = m.project_id
        where p.organization_id = p_organization_id
          and m.user_id         = auth.uid()
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) RLS: reemplazar policies project-scope por org-scope
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.team_members enable row level security;

revoke all on public.team_members from public;
revoke all on public.team_members from cliente_role;

grant select, insert, update, delete on public.team_members to authenticated;

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (public.has_organization_access(organization_id));

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Documentar deprecación de project_id
-- ═══════════════════════════════════════════════════════════════════════════
comment on column public.team_members.project_id is
  'DEPRECATED (0124): team_members es org-scope. Se mantiene la columna nullable por si aparece un caso legítimo project-exclusive. Backup en _backup_team_members_project_id_0124.';
