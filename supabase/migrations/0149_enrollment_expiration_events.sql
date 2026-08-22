-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0149 — enrollment_expiration_events (Fase D lifecycle)                   │
-- │                                                                          │
-- │ Log de intentos de baja automática de enrollments vencidos. Los inserta  │
-- │ el cron `/api/cron/academia-daily` (o la función manual `expireEnrollment` │
-- │ disparada desde UI). Sirve para:                                         │
-- │   1) Auditar qué enrollments se marcaron 'expired' y cuándo.             │
-- │   2) Rastrear el disparo del webhook a GHL (o skip si el course no       │
-- │      tiene `ghl_expiration_webhook_url` configurada).                    │
-- │   3) Reintentar los 'failed' hasta 3 veces.                              │
-- │                                                                          │
-- │ Diseño:                                                                  │
-- │   - Denorm de project_id + course_id (via cohort → course) para RLS y   │
-- │     agregados sin joins caros.                                          │
-- │   - webhook_url: SNAPSHOT del momento del intento — si el operador cambia│
-- │     la URL después, el event conserva la que se llamó realmente.        │
-- │   - webhook_status: 'pending' → 'sent' | 'failed' | 'skipped'.          │
-- │       'skipped' = no había URL configurada, se marcó 'expired' sin llamar.│
-- │   - retries: contador de reintentos ejecutados. El cron re-agarra        │
-- │     'failed' con retries<3.                                             │
-- │   - RLS: solo LECTURA para authenticated con acceso al proyecto. Las    │
-- │     inserciones/updates las hace el service_role del cron o el server   │
-- │     action manual. Ningún operador insertea eventos a mano.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) enrollment_expiration_events
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.enrollment_expiration_events (
  id                uuid        primary key default gen_random_uuid(),
  enrollment_id     uuid        not null references public.enrollments(id) on delete cascade,
  course_id         uuid        not null references public.courses(id)     on delete cascade,
  project_id        uuid        not null references public.projects(id)    on delete cascade,
  triggered_at      timestamptz not null default now(),
  webhook_url       text,
  webhook_status    text        not null default 'pending'
                       check (webhook_status in ('pending','sent','failed','skipped')),
  webhook_response  text,
  retries           integer     not null default 0,
  last_attempt_at   timestamptz
);

create index if not exists enrollment_expiration_events_enrollment_idx
  on public.enrollment_expiration_events(enrollment_id);
create index if not exists enrollment_expiration_events_project_idx
  on public.enrollment_expiration_events(project_id);
-- Índice para el barrido de reintentos: agarra los 'failed' o 'pending'
-- ordenados por último intento.
create index if not exists enrollment_expiration_events_retry_idx
  on public.enrollment_expiration_events(webhook_status, last_attempt_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: denormaliza project_id + course_id desde enrollment.
--    'b_' antepuesto para garantizar orden < 'guard_propia_project'.
--    Solo BEFORE INSERT — enrollment_id es inmutable en la práctica.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enrollment_expiration_events_denorm()
returns trigger
language plpgsql
as $$
declare
  v_course_id  uuid;
  v_project_id uuid;
begin
  select co.course_id, co.project_id
    into v_course_id, v_project_id
    from public.enrollments e
    join public.cohorts co on co.id = e.cohort_id
   where e.id = new.enrollment_id;

  if v_project_id is null then
    raise exception 'enrollment_expiration_events: enrollment % no existe', new.enrollment_id
      using errcode = '23503';
  end if;

  new.course_id  := v_course_id;
  new.project_id := v_project_id;
  return new;
end;
$$;

drop trigger if exists b_denorm_from_enrollment on public.enrollment_expiration_events;
create trigger b_denorm_from_enrollment
  before insert on public.enrollment_expiration_events
  for each row execute function public.enrollment_expiration_events_denorm();

drop trigger if exists guard_propia_project on public.enrollment_expiration_events;
create trigger guard_propia_project
  before insert or update of project_id on public.enrollment_expiration_events
  for each row execute function public.guard_propia_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — read-only para authenticated. INSERT/UPDATE via service_role.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.enrollment_expiration_events enable row level security;

-- Grant SELECT a authenticated (los admin/coordinador con acceso al proyecto
-- pueden inspeccionar el log via la ficha del alumno o auditoría).
-- Revocamos INSERT/UPDATE/DELETE — el service_role los hace bypassando RLS.
grant select on public.enrollment_expiration_events to authenticated;
revoke insert, update, delete on public.enrollment_expiration_events from authenticated;

drop policy if exists enrollment_expiration_events_select on public.enrollment_expiration_events;
create policy enrollment_expiration_events_select on public.enrollment_expiration_events
  for select to authenticated
  using (public.has_project_access(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on table public.enrollment_expiration_events is
  'Log de intentos de baja automática de enrollments vencidos. Insertado por el cron academia-daily o por acción manual desde UI.';
comment on column public.enrollment_expiration_events.webhook_url is
  'Snapshot de la URL llamada en el momento del intento. Null si status=skipped.';
comment on column public.enrollment_expiration_events.webhook_response is
  'Snippet (max 500 chars) del body de respuesta del webhook o mensaje de error.';
comment on column public.enrollment_expiration_events.retries is
  'Cantidad de reintentos ejecutados sobre este mismo event. Máx 3.';
