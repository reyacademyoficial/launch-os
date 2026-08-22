-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0144 — enrollments: vigencia de acceso + status 'expired'                │
-- │                                                                          │
-- │ Fase A del plan Academia. Extiende enrollments con lifecycle temporal:  │
-- │   - purchased_at: fecha en que se compró el curso (opcional, fallback   │
-- │       si no hay sale_id). Distinto de enrolled_at, que es cuando se     │
-- │       hace la inscripción operativa.                                     │
-- │   - access_expires_at: fecha desde la cual el alumno pierde acceso.    │
-- │       El cron diario (Fase D) detecta enrollments vencidas y las marca │
-- │       'expired' + dispara webhook a GHL para bajar el contacto.        │
-- │   - status ahora incluye 'expired' (baja automática por vencimiento).  │
-- │                                                                          │
-- │ Trigger de autocompletado:                                              │
-- │   Al insertar un enrollment, si access_expires_at es null y el         │
-- │   course.default_access_days está seteado, autocalcula:                │
-- │     access_expires_at = enrolled_at + default_access_days              │
-- │   Esto evita que el operador tenga que calcularlo cada vez.            │
-- │   Si el operador ya pasó access_expires_at explícito, gana el explícito.│
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Nuevas columnas
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.enrollments
  add column if not exists purchased_at date;

alter table public.enrollments
  add column if not exists access_expires_at date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Ampliar CHECK de status para incluir 'expired'
--    Postgres no permite modificar un CHECK — hay que dropear y recrear.
--    Buscamos el nombre del constraint (default: enrollments_status_check).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.enrollments
  drop constraint if exists enrollments_status_check;

alter table public.enrollments
  add constraint enrollments_status_check
  check (status in ('active','completed','dropped','suspended','expired'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Trigger de autocompletado de access_expires_at
--    Nombre 'a_autofill_expiration' — 'a' garantiza que corre antes que
--    'guard_propia_project'. Va como BEFORE INSERT (no en UPDATE — si el
--    operador cambia el enrolled_at después, no queremos rescribir la
--    expiración; que la ajuste manualmente si es necesario).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enrollments_autofill_expiration()
returns trigger
language plpgsql
as $$
declare
  v_default_days integer;
begin
  -- Solo autocalcular si el operador NO pasó access_expires_at explícito.
  if new.access_expires_at is not null then
    return new;
  end if;

  -- Traer default_access_days del course (via cohort → course).
  select c.default_access_days into v_default_days
    from public.cohorts co
    join public.courses c on c.id = co.course_id
   where co.id = new.cohort_id;

  if v_default_days is not null then
    new.access_expires_at := new.enrolled_at + v_default_days;
  end if;

  return new;
end;
$$;

drop trigger if exists a_autofill_expiration on public.enrollments;
create trigger a_autofill_expiration
  before insert on public.enrollments
  for each row execute function public.enrollments_autofill_expiration();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Índice para el cron de expiración (Fase D)
--    Filtro parcial: solo enrollments 'active' con expiración. Los ya expirados
--    o sin vigencia no interesan al cron.
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists enrollments_active_expiring_idx
  on public.enrollments(access_expires_at)
  where status = 'active' and access_expires_at is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on column public.enrollments.purchased_at is
  'Fecha de compra del curso. Fallback si no hay sale_id linkeado.';
comment on column public.enrollments.access_expires_at is
  'Fecha desde la cual el alumno pierde acceso. Autocalculada por trigger si course.default_access_days está seteado.';
