-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 7a — Notificaciones in-app (campanita)                             │
-- │                                                                          │
-- │ Solo in-app por ahora. La estructura queda preparada para sumar canales │
-- │ (email/WhatsApp) sin migrar — basta con agregar columnas de delivery o   │
-- │ una tabla `notification_channels` cuando exista proveedor. Esta fase NO │
-- │ los cablea.                                                              │
-- │                                                                          │
-- │ Modelo:                                                                  │
-- │   - 1 row por evento notificable. Inmutable salvo `read_at` (UPDATE      │
-- │     column-level a authenticated y cliente_role).                       │
-- │   - Target: `target_role` ∈ team/cliente (broadcast intra-proyecto a un │
-- │     subset de roles) O `target_user_id` (a un usuario específico).      │
-- │     CHECK XOR garantiza que exactamente uno está seteado.                │
-- │   - Dedup: `UNIQUE NULLS NOT DISTINCT (project_id, dedup_key)`. Llamar  │
-- │     dos veces a `create_notification` con la misma key no spammea — el  │
-- │     ON CONFLICT DO NOTHING absorbe la segunda. Si dedup_key es NULL,    │
-- │     la fila pasa siempre (notificaciones one-off).                      │
-- │                                                                          │
-- │ Permisos (split como en F6):                                            │
-- │   SELECT  → has_project_access AND (target matchea al usuario)         │
-- │   UPDATE  → mismo predicado, columna `read_at` únicamente               │
-- │   INSERT  → solo via helper `create_notification` (SECURITY DEFINER)   │
-- │   DELETE  → bloqueado (sin policy)                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Helper de rol: ¿el caller es del "equipo" (admin/operador/superadmin)?
--    Espejo SECURITY DEFINER de `is_cliente()` / `is_superadmin()`. Se usa
--    en la RLS de notifications para resolver `target_role='team'` sin pegarle
--    a `profiles` desde la policy (que tendría que evaluar role en cada
--    evaluación de fila — más caro y abre superficie a recursión).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.user_role_is_team()
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  v_result boolean;
begin
  -- plpgsql en vez de sql: la versión SQL compila las queries en CREATE TIME
  -- y resuelve referencias al schema usando el search_path activo en ese
  -- momento. Si el SET LOCAL search_path de una transacción previa quedó
  -- pisado (ej. al pegar el archivo en un editor que mantiene estado), la
  -- compilación SQL puede no ver `public.profiles` aunque exista. plpgsql
  -- resuelve los nombres al llamar la función, no al definirla — más robusto
  -- frente a entornos con search_path inestable como el SQL editor de Studio.
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'admin', 'operador')
  ) into v_result;
  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Tabla `notifications`
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  launch_id       uuid references public.launches(id) on delete cascade,

  -- type queda como text + check soft. Es enum-like pero con cierre laxo para
  -- que 7b/7c puedan agregar valores ('alert_crossed', 'launch_started', etc.)
  -- sin migración. La UI igual filtra por la lista conocida; valores nuevos se
  -- muestran tal cual.
  type            text not null,
  severity        text not null default 'info'
                  check (severity in ('info', 'warning', 'error')),
  title           text not null,
  body            text,

  -- Target: exactamente uno de los dos. CHECK XOR es la frontera dura.
  target_role     text check (target_role is null or target_role in ('team', 'cliente')),
  target_user_id  uuid references auth.users(id) on delete cascade,

  read_at         timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  dedup_key       text,

  created_at      timestamptz not null default now(),

  constraint notifications_target_xor check (
    (target_role is not null and target_user_id is null) or
    (target_role is null     and target_user_id is not null)
  )
);

-- Hot path: el panel pide "últimas N de mi scope, no leídas primero". Indice
-- compuesto por (project_id, created_at desc) cubre eso; el filtro de target
-- queda al RLS.
create index if not exists notifications_project_created_idx
  on public.notifications(project_id, created_at desc);

-- Lookup por user específico (cuando target_user_id está seteado). Partial
-- para mantenerlo compacto.
create index if not exists notifications_target_user_idx
  on public.notifications(target_user_id, created_at desc)
  where target_user_id is not null;

-- Hot path para el contador "no leídas": filtrar por project + unread.
create index if not exists notifications_project_unread_idx
  on public.notifications(project_id)
  where read_at is null;

-- Dedup hard a nivel DB. NULLS NOT DISTINCT trata NULL como un valor único
-- → permite varias rows con dedup_key=NULL (notificaciones one-off) pero
-- bloquea la segunda con la misma clave dentro del mismo proyecto.
create unique index if not exists notifications_dedup_idx
  on public.notifications(project_id, dedup_key)
  where dedup_key is not null;

alter table public.notifications enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Grants
--    - authenticated: SELECT total + UPDATE solo `read_at`. Sin grant
--      INSERT/DELETE — el INSERT pasa por el helper SECURITY DEFINER.
--    - cliente_role (F6): mismo modelo. Su frontera ya viene heredada del
--      role mismo + el predicado RLS.
-- ═══════════════════════════════════════════════════════════════════════════
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select on public.notifications to cliente_role;
grant update (read_at) on public.notifications to cliente_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) RLS policies
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated, cliente_role
  using (
    public.has_project_access(project_id) and (
      target_user_id = auth.uid()
      or (target_role = 'team'    and public.user_role_is_team())
      or (target_role = 'cliente' and public.is_cliente())
    )
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated, cliente_role
  using (
    public.has_project_access(project_id) and (
      target_user_id = auth.uid()
      or (target_role = 'team'    and public.user_role_is_team())
      or (target_role = 'cliente' and public.is_cliente())
    )
  )
  with check (
    public.has_project_access(project_id) and (
      target_user_id = auth.uid()
      or (target_role = 'team'    and public.user_role_is_team())
      or (target_role = 'cliente' and public.is_cliente())
    )
  );

-- (sin INSERT/DELETE policies — la única forma de escribir es via el helper
--  create_notification de abajo, llamado por service-role o SECURITY DEFINER
--  triggers.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Helper `create_notification` — punto único de inserción.
--    SECURITY DEFINER para bypass RLS. ON CONFLICT DO NOTHING absorbe los
--    duplicados deduplicados por (project_id, dedup_key) — el caller no
--    tiene que verificar nada.
--
--    Devuelve la id de la fila insertada O NULL si la dedup absorbió. Útil
--    para que el caller sepa si su evento generó notificación nueva (logging,
--    métricas).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_notification(
  p_project_id     uuid,
  p_type           text,
  p_title          text,
  p_severity       text default 'info',
  p_body           text default null,
  p_target_role    text default null,
  p_target_user_id uuid default null,
  p_launch_id      uuid default null,
  p_dedup_key      text default null,
  p_metadata       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (
    project_id, launch_id, type, severity, title, body,
    target_role, target_user_id, dedup_key, metadata
  )
  values (
    p_project_id, p_launch_id, p_type, p_severity, p_title, p_body,
    p_target_role, p_target_user_id, p_dedup_key, p_metadata
  )
  on conflict (project_id, dedup_key) where dedup_key is not null
    do nothing
  returning id into v_id;

  return v_id; -- NULL si el ON CONFLICT absorbió
end;
$$;

-- El helper se invoca desde:
--   - Triggers SQL (7c — launch_started, ai_summary).
--   - Service-role TS (7a — sync_failed, config_missing) y 7b
--     (alert_crossed).
-- Ningún rol cliente lo llama. Grant a service_role + authenticated por si
-- futuras features lo necesitan desde server actions; el cliente sigue sin
-- poder porque no tiene grant a `notifications` insert.
grant execute on function public.create_notification(
  uuid, text, text, text, text, text, uuid, uuid, text, jsonb
) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Watchdog 7a — extender expire_stale_integration_runs para notificar.
--    Cuando se expira un run, además de marcarlo error, dejamos un aviso al
--    equipo del proyecto. Dedup por run_id → cada run colgado emite una sola
--    notificación, no una por cada vez que se llama al watchdog.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.expire_stale_integration_runs(
  p_threshold interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_expired record;
begin
  -- 1) Marcar runs colgados (mismo comportamiento que 0019).
  with expired as (
    update public.integration_runs
       set status = 'error',
           finished_at = now(),
           error_detail = coalesce(error_detail, '{}'::jsonb) || jsonb_build_object(
             'cause', 'watchdog_expired',
             'message', 'Sync colgado en estado running más de ' || p_threshold ||
                        '. Marcado como error por el watchdog para desbloquear el botón.',
             'expired_at', now(),
             'threshold', p_threshold::text
           )
     where status = 'running'
       and started_at < now() - p_threshold
     returning id, launch_id, provider
  )
  select count(*)::integer into v_count from expired;

  -- 2) Notificar al equipo por cada run expirado. Loop separado para poder
  -- joinear con launches y obtener project_id. Si no hubo expirados, este
  -- loop no hace nada.
  for v_expired in
    select r.id, r.launch_id, r.provider, l.project_id
      from public.integration_runs r
      join public.launches l on l.id = r.launch_id
     where r.status = 'error'
       and r.finished_at >= now() - interval '5 seconds' -- recién marcados
       and (r.error_detail->>'cause') = 'watchdog_expired'
  loop
    perform public.create_notification(
      p_project_id  := v_expired.project_id,
      p_launch_id   := v_expired.launch_id,
      p_type        := 'stale_run',
      p_title       := 'Sync ' || v_expired.provider || ' quedó colgado',
      p_severity    := 'warning',
      p_body        := 'El watchdog marcó el sync como error para desbloquear el botón. Volvé a sincronizar — el proceso es idempotente.',
      p_target_role := 'team',
      p_dedup_key   := 'stale_run:' || v_expired.id::text,
      p_metadata    := jsonb_build_object(
                         'run_id',   v_expired.id,
                         'provider', v_expired.provider
                       )
    );
  end loop;

  return v_count;
end;
$$;

-- (los grants execute de la función anterior siguen vigentes — no cambia la
--  firma)
