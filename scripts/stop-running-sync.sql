-- ─── Frenar sincronizaciones colgadas en 'running' ───────────────────────────
--
-- Uso: pegar en SQL Editor de Supabase Studio y correr las secciones que
-- necesites. Cada sección es autocontenida — corré una a la vez.
--
-- IMPORTANTE — qué hace y qué NO hace:
--   - Marca la fila de `integration_runs` como `status='error'` para que la UI
--     desbloquee el botón de sync y el watchdog no la vuelva a expirar.
--   - NO cancela el proceso Node.js que está haciendo requests contra GHL.
--     El sync corre dentro de un Server Action; hasta que ese proceso termine
--     (por timeout o completando) va a seguir pegándole a la API. Cuando el
--     proceso finalmente termine, va a intentar hacer un UPDATE sobre esta
--     misma fila y va a pisar tu 'error' con su propio status final.
--   - Para frenar de verdad las requests HTTP: reiniciá el server (Ctrl+C en
--     `npm run dev`, o redeploy en Vercel).
--
-- ═════════════════════════════════════════════════════════════════════════

-- ─── 1) DIAGNÓSTICO: ver qué está corriendo ahora ───────────────────────────

select
  ir.id,
  ir.provider,
  ir.stage,
  ir.launch_id,
  l.name       as launch_name,
  p.name       as project_name,
  ir.started_at,
  now() - ir.started_at as running_for
from public.integration_runs ir
join public.launches l on l.id = ir.launch_id
join public.projects p on p.id = l.project_id
where ir.status = 'running'
order by ir.started_at asc;

-- ═════════════════════════════════════════════════════════════════════════

-- ─── 2) OPCIÓN A: frenar TODOS los runs colgados en 'running' ───────────────
-- Reutiliza la función `expire_stale_integration_runs` con umbral 0 (marca
-- cualquier run running como error, sin importar cuándo empezó). Emite las
-- notificaciones al equipo igual que el watchdog automático.

-- select public.expire_stale_integration_runs(interval '0 seconds') as expired;

-- ═════════════════════════════════════════════════════════════════════════

-- ─── 3) OPCIÓN B: frenar solo el run de UN launch específico ────────────────
-- Reemplazá el placeholder <LAUNCH_ID> por el UUID del launch (lo ves en el
-- SELECT de diagnóstico arriba, columna `launch_id`).

-- update public.integration_runs
--    set status = 'error',
--        finished_at = now(),
--        error_detail = coalesce(error_detail, '{}'::jsonb) || jsonb_build_object(
--          'cause', 'manual_cancel',
--          'message', 'Cancelado manualmente desde SQL — proceso subyacente puede seguir corriendo hasta timeout.',
--          'cancelled_at', now()
--        )
--  where status = 'running'
--    and launch_id = '<LAUNCH_ID>'::uuid;

-- ═════════════════════════════════════════════════════════════════════════

-- ─── 4) OPCIÓN C: frenar solo un provider (ej. solo GHL) ────────────────────
-- Reemplazá <PROVIDER> por 'ghl', 'meta', 'sendflow' o 'ghl_messages'.

-- update public.integration_runs
--    set status = 'error',
--        finished_at = now(),
--        error_detail = coalesce(error_detail, '{}'::jsonb) || jsonb_build_object(
--          'cause', 'manual_cancel',
--          'message', 'Cancelado manualmente desde SQL — proceso subyacente puede seguir corriendo hasta timeout.',
--          'cancelled_at', now()
--        )
--  where status = 'running'
--    and provider = '<PROVIDER>';
