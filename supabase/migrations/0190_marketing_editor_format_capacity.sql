-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — capacidad máxima por formato por editor               │
-- │                                                                          │
-- │ "Adrián edita máximo 6 reels O 10 nuggets O 1 podcast por día" — cada     │
-- │ fila es un tope alternativo: un editor no suma los tres, cada formato    │
-- │ representa "si sólo hiciera ESO todo el día, cuántos entrarían".         │
-- │                                                                          │
-- │ El cálculo de carga (editor-load.ts) usa esto para convertir una         │
-- │ edición en curso a una FRACCIÓN del día: 1/max_per_day del formato       │
-- │ esperado (content_edits.target_format, 0191). Un podcast (≈ 'long') con  │
-- │ max_per_day=1 consume el día entero (1/1); un reel con max_per_day=6     │
-- │ consume 1/6.                                                            │
-- │                                                                          │
-- │ `format` acá usa el mismo enum de 0192 (otro/nugget/anuncios/reel/long)  │
-- │ — "formato" en este módulo es el TIPO de pieza, no el layout de          │
-- │ publicación.                                                            │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Mismo trigger org-match que 0164/0189.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.editor_format_capacity (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organization(id) on delete restrict,
  person_id         uuid not null references public.organization_people(id) on delete cascade,

  format            text not null check (format in (
    'otro','nugget','anuncios','reel','long'
  )),
  max_per_day       integer not null check (max_per_day > 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint editor_format_capacity_person_format_uq unique (person_id, format)
);

-- Re-corrible: si la tabla ya existía de una corrida anterior a 0192 (con el
-- CHECK viejo de formato), `create table if not exists` la deja intacta —
-- este bloque corrige el constraint igual, se haya creado la tabla arriba
-- o ya existiera.
alter table public.editor_format_capacity drop constraint if exists editor_format_capacity_format_check;
alter table public.editor_format_capacity
  add constraint editor_format_capacity_format_check
  check (format in ('otro','nugget','anuncios','reel','long'));

create index if not exists editor_format_capacity_org_idx
  on public.editor_format_capacity(organization_id);
create index if not exists editor_format_capacity_person_idx
  on public.editor_format_capacity(person_id);

drop trigger if exists set_updated_at on public.editor_format_capacity;
create trigger set_updated_at before update on public.editor_format_capacity
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard org-match: capacity.org = person.org.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.editor_format_capacity_person_org_match()
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
      'editor_format_capacity.organization_id (%) does not match person.organization_id (%)',
      new.organization_id, v_person_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists editor_format_capacity_person_org_match_tg on public.editor_format_capacity;
create trigger editor_format_capacity_person_org_match_tg
  before insert or update of person_id, organization_id on public.editor_format_capacity
  for each row execute function public.editor_format_capacity_person_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.editor_format_capacity enable row level security;

revoke all on public.editor_format_capacity from public;
revoke all on public.editor_format_capacity from cliente_role;

grant select, insert, update, delete on public.editor_format_capacity to authenticated;

drop policy if exists editor_format_capacity_select on public.editor_format_capacity;
create policy editor_format_capacity_select on public.editor_format_capacity
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists editor_format_capacity_insert on public.editor_format_capacity;
create policy editor_format_capacity_insert on public.editor_format_capacity
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_format_capacity_update on public.editor_format_capacity;
create policy editor_format_capacity_update on public.editor_format_capacity
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists editor_format_capacity_delete on public.editor_format_capacity;
create policy editor_format_capacity_delete on public.editor_format_capacity
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
