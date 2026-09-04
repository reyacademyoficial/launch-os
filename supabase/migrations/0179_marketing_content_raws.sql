-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 11/13: content_raws (Crudos)                          │
-- │                                                                          │
-- │ Material SIN editar. Nace típicamente después de una `recording_session` │
-- │ realizada (uno o más archivos por sesión — distintas cámaras, distintos  │
-- │ cortes), pero también puede cargarse suelto (material importado, cámara  │
-- │ que no pasó por una sesión registrada). `source_recording_session_id` es │
-- │ nullable a propósito — mismo criterio de vínculos opcionales que ya usa  │
-- │ todo el módulo (grabación sin planificación, asset sin sesión, etc.).    │
-- │                                                                          │
-- │ De acá sale Edición (`content_edits`, 0180): un evento de edición se     │
-- │ arma "sobre" un crudo. Reemplaza el atajo anterior donde                 │
-- │ "Registrar producción" creaba directo los archivos editados desde la     │
-- │ sesión de grabación, sin dejar rastro del material crudo.                │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090 (mismo patrón que 0157/0162).               │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_raws (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organization(id) on delete restrict,
  content_owner_id              uuid not null references public.content_owners(id) on delete restrict,

  -- Nullable: un crudo puede no venir de una sesión registrada.
  source_recording_session_id   uuid references public.recording_sessions(id) on delete set null,

  name                          text not null,
  drive_url                     text not null,

  notes                         text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists content_raws_org_idx
  on public.content_raws(organization_id);
create index if not exists content_raws_owner_idx
  on public.content_raws(content_owner_id);
create index if not exists content_raws_session_idx
  on public.content_raws(source_recording_session_id)
  where source_recording_session_id is not null;

drop trigger if exists set_updated_at on public.content_raws;
create trigger set_updated_at before update on public.content_raws
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: raw.org = owner.org, y (si aplica) session.org.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_raws_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org   uuid;
  v_session_org uuid;
begin
  select organization_id into v_owner_org
    from public.content_owners
    where id = new.content_owner_id;

  if v_owner_org is null then
    raise exception 'content_owner % not found', new.content_owner_id
      using errcode = '23503';
  end if;

  if v_owner_org <> new.organization_id then
    raise exception
      'content_raw.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  if new.source_recording_session_id is not null then
    select organization_id into v_session_org
      from public.recording_sessions
      where id = new.source_recording_session_id;
    if v_session_org is not null and v_session_org <> new.organization_id then
      raise exception
        'content_raw.organization_id (%) does not match source_session.organization_id (%)',
        new.organization_id, v_session_org
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists content_raws_org_match_tg on public.content_raws;
create trigger content_raws_org_match_tg
  before insert or update of
    content_owner_id, organization_id, source_recording_session_id
  on public.content_raws
  for each row execute function public.content_raws_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_raws enable row level security;

revoke all on public.content_raws from public;
revoke all on public.content_raws from cliente_role;

grant select, insert, update, delete on public.content_raws to authenticated;

drop policy if exists content_raws_select on public.content_raws;
create policy content_raws_select on public.content_raws
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_raws_insert on public.content_raws;
create policy content_raws_insert on public.content_raws
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_raws_update on public.content_raws;
create policy content_raws_update on public.content_raws
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_raws_delete on public.content_raws;
create policy content_raws_delete on public.content_raws
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
