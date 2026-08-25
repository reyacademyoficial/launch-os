-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 7/9: editor_availability                              │
-- │                                                                          │
-- │ Bloques de disponibilidad por persona. Alimenta el planning semanal de   │
-- │ edición: si un editor tiene 5 assets asignados en una semana pero está   │
-- │ marcado como no-disponible, la UI pinta warning.                         │
-- │                                                                          │
-- │ Modelo simple, NO slots-por-hora: un editor está o no está disponible   │
-- │ en un rango de días completo. Un mismo person_id puede tener varias      │
-- │ filas superpuestas — la resolución "está disponible el 2026-09-15?" se   │
-- │ hace client-side sumando/restando ventanas (típicamente pocas filas).    │
-- │                                                                          │
-- │ SHAPE                                                                    │
-- │   (id, organization_id, person_id, date_from, date_to, available,       │
-- │    notes, ...timestamps)                                                 │
-- │                                                                          │
-- │ ON DELETE                                                                │
-- │   person_id CASCADE — si la persona sale de la org, sus rows también.  │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Trigger extra org-match person.            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.editor_availability (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organization(id) on delete restrict,
  person_id         uuid not null references public.organization_people(id) on delete cascade,

  date_from         date not null,
  date_to           date not null,
  available         boolean not null,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint editor_availability_range_ok
    check (date_to >= date_from)
);

create index if not exists editor_availability_org_idx
  on public.editor_availability(organization_id);
create index if not exists editor_availability_person_range_idx
  on public.editor_availability(person_id, date_from, date_to);
create index if not exists editor_availability_range_idx
  on public.editor_availability(date_from, date_to);

drop trigger if exists set_updated_at on public.editor_availability;
create trigger set_updated_at before update on public.editor_availability
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: availability.org = person.org. Mismo patrón que
-- recording_assignees (0161) — evita filas cross-org por payload.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.editor_availability_person_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_org uuid;
begin
  select organization_id into v_person_org
    from public.organization_people
    where id = new.person_id;

  if v_person_org is null then
    raise exception 'organization_person % not found', new.person_id
      using errcode = '23503';
  end if;

  if v_person_org <> new.organization_id then
    raise exception
      'editor_availability.organization_id (%) does not match person.organization_id (%)',
      new.organization_id, v_person_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists editor_availability_person_org_match_tg on public.editor_availability;
create trigger editor_availability_person_org_match_tg
  before insert or update of person_id, organization_id on public.editor_availability
  for each row execute function public.editor_availability_person_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.editor_availability enable row level security;

revoke all on public.editor_availability from public;
revoke all on public.editor_availability from cliente_role;

grant select, insert, update, delete on public.editor_availability to authenticated;

drop policy if exists editor_availability_select on public.editor_availability;
create policy editor_availability_select on public.editor_availability
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists editor_availability_insert on public.editor_availability;
create policy editor_availability_insert on public.editor_availability
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_availability_update on public.editor_availability;
create policy editor_availability_update on public.editor_availability
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_availability_delete on public.editor_availability;
create policy editor_availability_delete on public.editor_availability
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
