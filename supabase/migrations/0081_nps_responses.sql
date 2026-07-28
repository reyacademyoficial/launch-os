-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3 (Kingrow · Clientes) — NPS por cliente gestionado              │
-- │                                                                          │
-- │ Encuestas de satisfacción a la empresa gestionada. NO es NPS de los     │
-- │ alumnos del launch (esos vivirían en otra tabla, si algún día se        │
-- │ trackean) — es NPS del contacto principal del cliente hacia Kingrow.    │
-- │                                                                          │
-- │ N filas por project (una por encuesta): permite ver EVOLUCIÓN del      │
-- │ sentimiento y calcular NPS agregado por período.                        │
-- │                                                                          │
-- │ NPS score: 0..10 (escala estándar de recomendación).                    │
-- │   - Promotor: 9-10                                                      │
-- │   - Pasivo:   7-8                                                       │
-- │   - Detractor: 0-6                                                      │
-- │ El clasificador es puro TS (src/lib/clients/health.ts) — la tabla      │
-- │ guarda solo el número crudo para poder recalcular si mañana cambia el   │
-- │ criterio (p.ej. si querés unificar con ratings 5-estrellas).            │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0058.                                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.nps_responses (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organization(id) on delete restrict,
  project_id           uuid not null references public.projects(id)     on delete cascade,

  -- Contacto que respondió. Opcional (puede ser encuesta anónima o
  -- consolidada). Si algún día se quiere linkear con `organization_people`
  -- de la contraparte, es aditivo.
  respondent_name      text,
  respondent_email     text,

  -- Escala estándar 0..10. Not null porque una encuesta sin score no
  -- aporta nada — mejor rebota que quedar como fila fantasma.
  score                integer not null check (score between 0 and 10),

  -- Comentario libre. Opcional pero es el 80% del valor cualitativo de
  -- un NPS — el clasificador numérico solo indica dirección.
  comment              text,

  -- Fecha efectiva de la respuesta. Distinto de created_at (que es cuándo
  -- se cargó al sistema). Default = now() para simplificar carga rápida.
  responded_at         timestamptz not null default now(),

  -- Canal de la encuesta (email, meet, form, chat). Texto libre para no
  -- constreñir a un enum que después haya que ampliar.
  channel              text,

  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists nps_responses_project_idx
  on public.nps_responses(project_id, responded_at desc);
create index if not exists nps_responses_org_idx
  on public.nps_responses(organization_id, responded_at desc);

drop trigger if exists set_updated_at on public.nps_responses;
create trigger set_updated_at before update on public.nps_responses
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de consistencia org (mismo racional que 0080): rellena
-- organization_id desde projects. Evita filas cuya org discrepa de la del
-- project — que romperían el filtrado org-scope de las policies.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.nps_responses_set_org_from_project()
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

drop trigger if exists set_org_from_project on public.nps_responses;
create trigger set_org_from_project
  before insert or update of project_id on public.nps_responses
  for each row execute function public.nps_responses_set_org_from_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0058
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.nps_responses enable row level security;

revoke all on public.nps_responses from public;
revoke all on public.nps_responses from cliente_role;

grant select, insert, update, delete on public.nps_responses to authenticated;

drop policy if exists nps_responses_select on public.nps_responses;
create policy nps_responses_select on public.nps_responses
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists nps_responses_insert on public.nps_responses;
create policy nps_responses_insert on public.nps_responses
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists nps_responses_update on public.nps_responses;
create policy nps_responses_update on public.nps_responses
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists nps_responses_delete on public.nps_responses;
create policy nps_responses_delete on public.nps_responses
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
