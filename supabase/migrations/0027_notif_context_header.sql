-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ UX fix — agregar "Proyecto X · Launch Y" al body de las notifs SQL.      │
-- │                                                                          │
-- │ Sin esto, una notif dice solo "Sync meta falló" — cuando manejás varios │
-- │ proyectos/lanzamientos, no sabés a cuál pertenece sin abrir cada uno.   │
-- │ Tres triggers a tocar (todos creados en 0024/0026):                     │
-- │                                                                          │
-- │   1. expire_stale_integration_runs — emite `stale_run` cuando el        │
-- │      watchdog mata un sync colgado.                                     │
-- │   2. notify_launch_started        — emite `launch_started` al cliente. │
-- │   3. notify_ai_summary_ready      — emite `ai_summary_ready` al cliente.│
-- │                                                                          │
-- │ Patrón aplicado: el body arranca con `<project.name> · <launch.name>`  │
-- │ seguido de un newline y el texto original. La UI del NotificationPanel │
-- │ ya hace `line-clamp-2`, así que las dos primeras líneas son las que    │
-- │ rinden — header + sumario quedan visibles sin abrir nada.              │
-- │                                                                          │
-- │ Idempotencia: solo se reemplazan las funciones, no se tocan los         │
-- │ triggers (que apuntan a las funciones por nombre). dedup_key sigue     │
-- │ igual, así que notifs viejas no se vuelven a disparar.                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Watchdog con contexto
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

  for v_expired in
    select r.id,
           r.launch_id,
           r.provider,
           l.project_id,
           coalesce(p.name, 'Proyecto')     as project_name,
           coalesce(l.name, 'Lanzamiento')  as launch_name
      from public.integration_runs r
      join public.launches l on l.id = r.launch_id
      join public.projects p on p.id = l.project_id
     where r.status = 'error'
       and r.finished_at >= now() - interval '5 seconds'
       and (r.error_detail->>'cause') = 'watchdog_expired'
  loop
    perform public.create_notification(
      p_project_id  := v_expired.project_id,
      p_launch_id   := v_expired.launch_id,
      p_type        := 'stale_run',
      p_title       := 'Sync ' || v_expired.provider || ' quedó colgado',
      p_severity    := 'warning',
      p_body        := v_expired.project_name || ' · ' || v_expired.launch_name ||
                       E'\nEl watchdog marcó el sync como error para desbloquear el botón. Volvé a sincronizar — el proceso es idempotente.',
      p_target_role := 'team',
      p_dedup_key   := 'stale_run:' || v_expired.id::text,
      p_metadata    := jsonb_build_object(
                         'run_id',       v_expired.id,
                         'provider',     v_expired.provider,
                         'project_name', v_expired.project_name,
                         'launch_name',  v_expired.launch_name
                       )
    );
  end loop;

  return v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger launch_started con contexto
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.notify_launch_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_launch_name  text;
  v_project_name text;
begin
  if NEW.status is null or NEW.status <> 'Activo' then
    return NEW;
  end if;
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  v_launch_name := coalesce(NEW.name, 'Tu lanzamiento');
  select coalesce(name, 'Proyecto') into v_project_name
    from public.projects where id = NEW.project_id;
  v_project_name := coalesce(v_project_name, 'Proyecto');

  perform public.create_notification(
    p_project_id     := NEW.project_id,
    p_launch_id      := NEW.id,
    p_type           := 'launch_started',
    p_title          := 'Tu lanzamiento arrancó',
    p_severity       := 'info',
    p_body           := v_project_name || ' · ' || v_launch_name ||
                        E'\nEstá activo. Ya podés ver KPIs en tu portal.',
    p_target_role    := 'cliente',
    p_target_user_id := null,
    p_dedup_key      := 'launch_started:' || NEW.id::text,
    p_metadata       := jsonb_build_object(
                          'project_name', v_project_name,
                          'launch_name',  v_launch_name
                        )
  );

  return NEW;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Trigger ai_summary_ready con contexto
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.notify_ai_summary_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_launch_name  text;
  v_project_name text;
begin
  if NEW.status is distinct from 'success' then
    return NEW;
  end if;

  select coalesce(name, 'Tu lanzamiento') into v_launch_name
    from public.launches where id = NEW.launch_id;
  v_launch_name := coalesce(v_launch_name, 'Tu lanzamiento');

  select coalesce(name, 'Proyecto') into v_project_name
    from public.projects where id = NEW.project_id;
  v_project_name := coalesce(v_project_name, 'Proyecto');

  perform public.create_notification(
    p_project_id     := NEW.project_id,
    p_launch_id      := NEW.launch_id,
    p_type           := 'ai_summary_ready',
    p_title          := 'Análisis IA listo',
    p_severity       := 'info',
    p_body           := v_project_name || ' · ' || v_launch_name ||
                        E'\nHay un análisis nuevo en tu portal.',
    p_target_role    := 'cliente',
    p_target_user_id := null,
    p_dedup_key      := 'ai_summary:' || NEW.id::text,
    p_metadata       := jsonb_build_object(
                          'ai_run_id',    NEW.id,
                          'project_name', v_project_name,
                          'launch_name',  v_launch_name
                        )
  );

  return NEW;
end;
$$;
