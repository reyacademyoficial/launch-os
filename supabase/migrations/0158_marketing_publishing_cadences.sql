-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Módulo Marketing — 2/9: publishing_cadences                               │
-- │                                                                          │
-- │ Cadencia de publicación por (content_owner, plataforma, formato).        │
-- │ Alimenta el cálculo "días de contenido" en `src/lib/marketing/stock.ts`  │
-- │ (dividir stock disponible / posts_per_day → días de cobertura).          │
-- │                                                                          │
-- │ Granularidad: owner × platform × format. Motivación en marketing-plan:   │
-- │ "reels IG" y "carousels IG" tienen ritmos distintos aunque compartan     │
-- │ plataforma. Si aparece evidencia de que nadie discrimina en la           │
-- │ práctica, se colapsa la PK. Registrada como deuda del módulo.            │
-- │                                                                          │
-- │ `allow_repeat_asset` habilita/deshabilita reciclaje del mismo asset —    │
-- │ el usuario explicó: "20 reels de una grabación no significa poder subir  │
-- │ 3 del mismo por día porque es el mismo contenido". Cuando false, un      │
-- │ asset consumido por un upload sale del stock disponible.                 │
-- │                                                                          │
-- │ Nivel org — TEMPLATE de 0090. Trigger extra: valida que el owner es      │
-- │ de la misma org (evita cross-org cadences por payload manipulado).       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.publishing_cadences (
  content_owner_id      uuid not null references public.content_owners(id) on delete cascade,
  platform              text not null check (platform in ('instagram','facebook','tiktok','youtube')),
  format                text not null check (format in ('reel','short','long','carousel','story','post')),

  organization_id       uuid not null references public.organization(id) on delete restrict,

  posts_per_day         integer not null check (posts_per_day > 0),
  allow_repeat_asset    boolean not null default false,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  primary key (content_owner_id, platform, format)
);

-- Índices para lookups del selector de stock y del dashboard.
create index if not exists publishing_cadences_org_idx
  on public.publishing_cadences(organization_id);
create index if not exists publishing_cadences_owner_idx
  on public.publishing_cadences(content_owner_id);
create index if not exists publishing_cadences_platform_idx
  on public.publishing_cadences(platform);

drop trigger if exists set_updated_at on public.publishing_cadences;
create trigger set_updated_at before update on public.publishing_cadences
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Guard de coherencia: la cadencia y el owner deben vivir en la misma org.
--
-- El caller (server action) setea explícito organization_id vía
-- resolveCurrentOrganizationId(). Este trigger blinda contra payloads
-- manipulados o cross-org que superen la RLS del owner. Mismo patrón que
-- tickets ↔ clients en 0110.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.publishing_cadences_owner_org_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_org uuid;
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
      'cadence.organization_id (%) does not match owner.organization_id (%)',
      new.organization_id, v_owner_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists publishing_cadences_owner_org_match_tg on public.publishing_cadences;
create trigger publishing_cadences_owner_org_match_tg
  before insert or update of content_owner_id, organization_id on public.publishing_cadences
  for each row execute function public.publishing_cadences_owner_org_match();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0090
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.publishing_cadences enable row level security;

revoke all on public.publishing_cadences from public;
revoke all on public.publishing_cadences from cliente_role;

grant select, insert, update, delete on public.publishing_cadences to authenticated;

drop policy if exists publishing_cadences_select on public.publishing_cadences;
create policy publishing_cadences_select on public.publishing_cadences
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists publishing_cadences_insert on public.publishing_cadences;
create policy publishing_cadences_insert on public.publishing_cadences
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists publishing_cadences_update on public.publishing_cadences;
create policy publishing_cadences_update on public.publishing_cadences
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists publishing_cadences_delete on public.publishing_cadences;
create policy publishing_cadences_delete on public.publishing_cadences
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
