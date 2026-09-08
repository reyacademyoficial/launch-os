-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — horario semanal recurrente por editor                 │
-- │                                                                          │
-- │ Complementa (no reemplaza) `editor_availability` (0164): esa tabla sigue │
-- │ sirviendo para excepciones puntuales (licencia, vacaciones). Ésta define │
-- │ la regla general — qué días de la semana y en qué franja horaria un     │
-- │ editor está activo. Ej: Adrián lunes a viernes 09:00-14:00 → 5 filas,    │
-- │ una por día, mismo horario.                                             │
-- │                                                                          │
-- │ `day_of_week` sigue la convención ISO usada en el resto del módulo       │
-- │ (`mondayOf` en editor-load.ts): 1=lunes … 7=domingo.                     │
-- │                                                                          │
-- │ Un editor puede tener a lo sumo una franja por día (unique person+day) — │
-- │ si en la práctica alguien trabaja mañana y tarde separadas, se resuelve  │
-- │ como deuda cuando aparezca el caso real.                                │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Mismo trigger org-match que 0164.          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.editor_weekly_schedule (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organization(id) on delete restrict,
  person_id         uuid not null references public.organization_people(id) on delete cascade,

  day_of_week       smallint not null check (day_of_week between 1 and 7),
  start_time        time not null,
  end_time          time not null,

  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint editor_weekly_schedule_time_ok check (end_time > start_time),
  constraint editor_weekly_schedule_person_day_uq unique (person_id, day_of_week)
);

create index if not exists editor_weekly_schedule_org_idx
  on public.editor_weekly_schedule(organization_id);
create index if not exists editor_weekly_schedule_person_idx
  on public.editor_weekly_schedule(person_id);

drop trigger if exists set_updated_at on public.editor_weekly_schedule;
create trigger set_updated_at before update on public.editor_weekly_schedule
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: schedule.org = person.org. Mismo patrón que
-- editor_availability (0164).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.editor_weekly_schedule_person_org_match()
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
      'editor_weekly_schedule.organization_id (%) does not match person.organization_id (%)',
      new.organization_id, v_person_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists editor_weekly_schedule_person_org_match_tg on public.editor_weekly_schedule;
create trigger editor_weekly_schedule_person_org_match_tg
  before insert or update of person_id, organization_id on public.editor_weekly_schedule
  for each row execute function public.editor_weekly_schedule_person_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.editor_weekly_schedule enable row level security;

revoke all on public.editor_weekly_schedule from public;
revoke all on public.editor_weekly_schedule from cliente_role;

grant select, insert, update, delete on public.editor_weekly_schedule to authenticated;

drop policy if exists editor_weekly_schedule_select on public.editor_weekly_schedule;
create policy editor_weekly_schedule_select on public.editor_weekly_schedule
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists editor_weekly_schedule_insert on public.editor_weekly_schedule;
create policy editor_weekly_schedule_insert on public.editor_weekly_schedule
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_weekly_schedule_update on public.editor_weekly_schedule;
create policy editor_weekly_schedule_update on public.editor_weekly_schedule
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_weekly_schedule_delete on public.editor_weekly_schedule;
create policy editor_weekly_schedule_delete on public.editor_weekly_schedule
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
