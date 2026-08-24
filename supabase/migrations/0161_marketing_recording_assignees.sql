-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 5/9: recording_assignees (junction M:N con rol)      │
-- │                                                                          │
-- │ Personas asignadas a una recording_session, con rol semántico:          │
-- │ filmaker, experto, asistente. PK compuesta (session, person, role) —    │
-- │ una misma persona puede tener DOS roles en la misma sesión (raro pero  │
-- │ posible: el experto también graba). El rol en la PK evita rebotar la    │
-- │ segunda fila.                                                            │
-- │                                                                          │
-- │ SHAPE                                                                    │
-- │   recording_assignees(recording_session_id, person_id, role,           │
-- │                       organization_id, created_at)                     │
-- │   PK compuesta con role.                                                │
-- │                                                                          │
-- │ ON DELETE                                                                │
-- │   recording_session_id CASCADE — si la sesión desaparece, se limpian.  │
-- │   person_id            CASCADE — si la persona sale, sale del rol.     │
-- │                                                                          │
-- │ Trigger org-match: session.org = organization_id (evita cross-org por  │
-- │ payload manipulado).                                                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.recording_assignees (
  recording_session_id  uuid not null
    references public.recording_sessions(id) on delete cascade,
  person_id             uuid not null
    references public.organization_people(id) on delete cascade,
  role                  text not null check (role in ('filmaker','experto','asistente')),
  organization_id       uuid not null
    references public.organization(id) on delete restrict,
  created_at            timestamptz not null default now(),

  primary key (recording_session_id, person_id, role)
);

create index if not exists recording_assignees_session_idx
  on public.recording_assignees(recording_session_id);
create index if not exists recording_assignees_person_idx
  on public.recording_assignees(person_id);
create index if not exists recording_assignees_org_idx
  on public.recording_assignees(organization_id);
create index if not exists recording_assignees_person_role_idx
  on public.recording_assignees(person_id, role);

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: assignee.organization_id = session.organization_id.
-- Blinda payloads que intenten cross-org.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.recording_assignees_session_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_org uuid;
begin
  select organization_id into v_session_org
    from public.recording_sessions
    where id = new.recording_session_id;

  if v_session_org is null then
    raise exception 'recording_session % not found', new.recording_session_id
      using errcode = '23503';
  end if;

  if v_session_org <> new.organization_id then
    raise exception
      'recording_assignee.organization_id (%) does not match session.organization_id (%)',
      new.organization_id, v_session_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists recording_assignees_session_org_match_tg on public.recording_assignees;
create trigger recording_assignees_session_org_match_tg
  before insert or update of recording_session_id, organization_id on public.recording_assignees
  for each row execute function public.recording_assignees_session_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.recording_assignees enable row level security;

revoke all on public.recording_assignees from public;
revoke all on public.recording_assignees from cliente_role;
grant select, insert, update, delete on public.recording_assignees to authenticated;

drop policy if exists recording_assignees_select on public.recording_assignees;
create policy recording_assignees_select on public.recording_assignees
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists recording_assignees_insert on public.recording_assignees;
create policy recording_assignees_insert on public.recording_assignees
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists recording_assignees_update on public.recording_assignees;
create policy recording_assignees_update on public.recording_assignees
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists recording_assignees_delete on public.recording_assignees;
create policy recording_assignees_delete on public.recording_assignees
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
