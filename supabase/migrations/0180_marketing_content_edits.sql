-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 12/13: content_edits (eventos de edición)             │
-- │                                                                          │
-- │ El evento de trabajo real: "editar tal crudo". Reemplaza                 │
-- │ `content_assets.editor_person_id` + `edit_due_date` (0175), que hoy      │
-- │ viven repetidos en cada archivo final en vez de en un evento atómico.    │
-- │                                                                          │
-- │ `source_content_raw_id` es NULLABLE — mismo criterio de vínculos         │
-- │ opcionales del resto del módulo. El único flujo de UI que se construye   │
-- │ es "crear edición desde un crudo", pero no se fuerza a nivel DB.         │
-- │                                                                          │
-- │ `completed_at` se puebla al "Marcar como realizada" — ahí es cuando se   │
-- │ cargan los `content_assets` de salida (0181) con                         │
-- │ `source_content_edit_id` apuntando acá. Antes de eso, el evento vive     │
-- │ "en cola" (mismo espíritu que `content_assets.edited_at` en el modelo    │
-- │ viejo, ahora a nivel evento en vez de a nivel archivo).                  │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090.                                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.content_edits (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organization(id) on delete restrict,
  content_owner_id         uuid not null references public.content_owners(id) on delete restrict,

  -- Nullable a propósito (ver comentario arriba).
  source_content_raw_id    uuid references public.content_raws(id) on delete set null,

  title                    text not null,

  -- Editor a cargo. Nullable — se puede crear el evento antes de asignar.
  editor_person_id         uuid references public.organization_people(id) on delete set null,

  -- Fecha objetivo (futuro). Bucket del planning semanal — reemplaza
  -- content_assets.edit_due_date.
  due_date                 date,

  -- Cuándo se cerró la edición (pasado). Setearlo es lo que dispara la carga
  -- de content_assets de salida desde la UI.
  completed_at             timestamptz,

  notes                    text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists content_edits_org_idx
  on public.content_edits(organization_id);
create index if not exists content_edits_owner_idx
  on public.content_edits(content_owner_id);
create index if not exists content_edits_raw_idx
  on public.content_edits(source_content_raw_id)
  where source_content_raw_id is not null;
create index if not exists content_edits_editor_idx
  on public.content_edits(editor_person_id)
  where editor_person_id is not null;
-- Cola de trabajo: eventos sin cerrar ordenados por vencimiento. Mismo
-- espíritu que content_assets_edit_queue_idx (0175), ahora a nivel evento.
create index if not exists content_edits_queue_idx
  on public.content_edits(organization_id, due_date)
  where completed_at is null;

drop trigger if exists set_updated_at on public.content_edits;
create trigger set_updated_at before update on public.content_edits
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: edit.org = owner.org, y (si aplica) raw.org.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.content_edits_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org uuid;
  v_raw_org   uuid;
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
      'content_edit.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  if new.source_content_raw_id is not null then
    select organization_id into v_raw_org
      from public.content_raws
      where id = new.source_content_raw_id;
    if v_raw_org is not null and v_raw_org <> new.organization_id then
      raise exception
        'content_edit.organization_id (%) does not match source_raw.organization_id (%)',
        new.organization_id, v_raw_org
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists content_edits_org_match_tg on public.content_edits;
create trigger content_edits_org_match_tg
  before insert or update of
    content_owner_id, organization_id, source_content_raw_id
  on public.content_edits
  for each row execute function public.content_edits_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_edits enable row level security;

revoke all on public.content_edits from public;
revoke all on public.content_edits from cliente_role;

grant select, insert, update, delete on public.content_edits to authenticated;

drop policy if exists content_edits_select on public.content_edits;
create policy content_edits_select on public.content_edits
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists content_edits_insert on public.content_edits;
create policy content_edits_insert on public.content_edits
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_edits_update on public.content_edits;
create policy content_edits_update on public.content_edits
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists content_edits_delete on public.content_edits;
create policy content_edits_delete on public.content_edits
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
