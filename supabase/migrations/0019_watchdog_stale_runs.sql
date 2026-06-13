-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Watchdog — expirar integration_runs colgados                             │
-- │                                                                          │
-- │ Síntoma: si un sync se corta a mitad (timeout del Server Action, pestaña │
-- │ cerrada, deploy mid-run), la fila queda en status='running' para siempre.│
-- │ Eso bloquea el botón "Sincronizar" — el gate en la UI desactiva el botón │
-- │ mientras hay un run 'running'.                                           │
-- │                                                                          │
-- │ Solución: una función que marca como 'error' todo run 'running' cuyo     │
-- │ started_at sea anterior a un umbral (default 15 min). Se invoca:        │
-- │   - desde el orchestrator antes de insertar un nuevo run (limpia DB).   │
-- │   - desde la capa de read (runs.ts) como belt-and-suspenders.           │
-- │                                                                          │
-- │ No es un cron: corre on-demand. Si nadie sincroniza, las filas viejas    │
-- │ siguen ahí, pero tampoco molestan a nadie hasta que alguien vuelva a    │
-- │ entrar a la página. Eso está OK — no es un sistema crítico de salud.    │
-- │                                                                          │
-- │ SECURITY DEFINER + grant authenticated: la UI (cliente RLS) lo llama    │
-- │ al renderizar el detalle. La función opera sobre integration_runs, que │
-- │ no tiene policies de UPDATE para authenticated; sin SECURITY DEFINER no │
-- │ podría tocar la tabla.                                                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

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
     returning 1
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$$;

-- Tanto el cliente RLS (UI/lectores) como service-role (orchestrator) deben
-- poder llamarlo. Mismo patrón que las otras helpers SECURITY DEFINER.
grant execute on function public.expire_stale_integration_runs(interval) to authenticated;
grant execute on function public.expire_stale_integration_runs(interval) to service_role;
