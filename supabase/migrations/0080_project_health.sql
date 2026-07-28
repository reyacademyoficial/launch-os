-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3 (Kingrow · Clientes) — Salud comercial por proyecto gestionado │
-- │                                                                          │
-- │ CONTEXTO                                                                 │
-- │                                                                          │
-- │ El "cliente" de Kingrow es un `project` (empresa gestionada), NO el     │
-- │ cliente final del lanzamiento. Este módulo trackea la RELACIÓN          │
-- │ Kingrow↔empresa gestionada: qué tan sana está, hace cuánto no hay      │
-- │ contacto, en qué estado formal (activa, en riesgo, perdida).           │
-- │                                                                          │
-- │ POR QUÉ SATÉLITE Y NO COLUMNAS SOBRE `projects`                         │
-- │                                                                          │
-- │ `projects` es tabla LaunchOS (project-scope). La visibilidad de sus    │
-- │ filas está gobernada por has_project_access — un cliente autenticado    │
-- │ ve su project. "Health score interno de Kingrow" NO debe ser visible   │
-- │ al cliente jamás. Si vive como columna de `projects`, requiere         │
-- │ column-level GRANT/RLS (cosa que no hay hoy) o rezar. En tabla         │
-- │ satélite org-scope el REVOKE cliente_role blinda de raíz.              │
-- │                                                                          │
-- │ Además:                                                                  │
-- │   - Consistencia con Bloque 2 (organization_people vs team_members).   │
-- │   - Guardarraíl explícito de Bloque 3: no tocar LaunchOS.              │
-- │   - Habilita snapshots temporales sin cambiar schema el día que se     │
-- │     quiera trackear evolución del score.                                │
-- │                                                                          │
-- │ FORMA: 1 fila POR project (unique(project_id)). El health es el ESTADO │
-- │ ACTUAL, no una serie histórica — si mañana hace falta serie, se hace   │
-- │ nueva tabla `project_health_snapshots` referenciando esta.              │
-- │                                                                          │
-- │ organization_id DENORMALIZADO (patrón 0057/0058): la policy filtra por │
-- │ can_edit_organization sin join a projects. Se rellena con el trigger   │
-- │ `set_organization_id_from_project` para que el caller no lo pase (y    │
-- │ para evitar filas inconsistentes con project.organization_id).         │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053/0058.                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.project_health (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,
  project_id            uuid not null references public.projects(id)     on delete cascade,

  -- Score 0..100. Es un heurístico calculado por el operador o por una
  -- futura función server-side (attendance de reuniones, NPS reciente,
  -- tickets abiertos, etc.). Nullable porque puede no estar calculado
  -- todavía; el selector de health en TS trata NULL como "sin dato".
  health_score          integer check (health_score is null or (health_score between 0 and 100)),

  -- Estado formal de la relación. Los cuatro valores cubren el lifecycle
  -- típico: onboarding (nuevo, no llegó a régimen), activa (régimen),
  -- en_riesgo (churn probable), perdida (churn confirmado).
  relationship_status   text not null default 'activa'
                        check (relationship_status in ('onboarding','activa','en_riesgo','perdida')),

  -- Último touchpoint registrado (reunión, mensaje, etc). Nullable porque
  -- puede no haber contacto aún al crear el registro.
  last_contact_at       timestamptz,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- 1 fila por project — este es el registro de salud CANÓNICO.
  unique (project_id)
);

create index if not exists project_health_org_idx
  on public.project_health(organization_id);
create index if not exists project_health_status_idx
  on public.project_health(organization_id, relationship_status);

drop trigger if exists set_updated_at on public.project_health;
create trigger set_updated_at before update on public.project_health
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger: rellenar organization_id desde projects si el caller no lo pasa.
-- Evita filas con org distinta a la del project (rompería las policies y el
-- filtrado org-scope). Idempotente: si ya viene seteado y coincide, no toca;
-- si viene distinto, corrige (fuente de verdad = projects.organization_id).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.project_health_set_org_from_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.organization_id into new.organization_id
    from public.projects p
   where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_project on public.project_health;
create trigger set_org_from_project
  before insert or update of project_id on public.project_health
  for each row execute function public.project_health_set_org_from_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0058
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.project_health enable row level security;

revoke all on public.project_health from public;
revoke all on public.project_health from cliente_role;

grant select, insert, update, delete on public.project_health to authenticated;

drop policy if exists project_health_select on public.project_health;
create policy project_health_select on public.project_health
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists project_health_insert on public.project_health;
create policy project_health_insert on public.project_health
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists project_health_update on public.project_health;
create policy project_health_update on public.project_health
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists project_health_delete on public.project_health;
create policy project_health_delete on public.project_health
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
