-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 7c — Avisos al cliente vía triggers SQL                            │
-- │                                                                          │
-- │ El cliente recibe dos tipos de notificación in-app (campanita del         │
-- │ portal, F6):                                                              │
-- │                                                                          │
-- │   1. `launch_started`: cuando un launch pasa a status='Activo'. Es la    │
-- │      señal pública de "tu lanzamiento arrancó". Dedup por launch — un   │
-- │      mismo launch que entre y salga de Activo no genera spam.            │
-- │                                                                          │
-- │   2. `ai_summary_ready`: cuando el equipo (o el propio cliente desde    │
-- │      su portal) corre un análisis IA con status='success'. El cliente   │
-- │      lo ve como "hay un análisis nuevo de tu launch". Dedup por run_id  │
-- │      → cada run que entra a la tabla emite a lo sumo 1 notif.          │
-- │                                                                          │
-- │ Ambos triggers van en DB para que disparen sea cual sea el origen del   │
-- │ INSERT/UPDATE (Server Action, sync, service-role). target_role='cliente'│
-- │ + la RLS de notifications (0024) garantizan que solo los clientes del   │
-- │ proyecto los ven. El equipo NO los ve — frontera intacta.               │
-- │                                                                          │
-- │ Modelo de targeting: target_role='cliente' (broadcast a TODOS los       │
-- │ clientes del proyecto). Si el proyecto tiene varios clientes, todos     │
-- │ reciben. Si querés notificar a uno solo, usar target_user_id desde el   │
-- │ helper create_notification en otro código (no es 7c MVP).               │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Trigger en launches: AFTER UPDATE OF status → notif si pasa a 'Activo'.
--    Compara OLD.status vs NEW.status para disparar SOLO en la transición.
--    UPDATE que no toca status no entra al trigger por la cláusula
--    `OF status`. UPDATE que setea status='Activo' partiendo de NULL o de
--    otro valor → entra y emite. UPDATE que ya estaba Activo → entra al
--    trigger pero el IF interno lo descarta (no transición).
--
--    Dedup por launch_id: si el launch sale a 'Finalizado' y vuelve a
--    'Activo' (caso reabrir), la dedup_key (launch_started:<launch>) ya
--    existe y create_notification absorbe la segunda. Decidido: una sola
--    "te arrancó" por launch, en su vida.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.notify_launch_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
begin
  -- Solo nos interesa la transición a 'Activo'. Comparación tolerante a NULL
  -- (a la fila vieja le falta status) usando IS DISTINCT FROM.
  if NEW.status is null or NEW.status <> 'Activo' then
    return NEW;
  end if;
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  v_name := coalesce(NEW.name, 'Tu lanzamiento');

  perform public.create_notification(
    p_project_id  := NEW.project_id,
    p_launch_id   := NEW.id,
    p_type        := 'launch_started',
    p_title       := 'Tu lanzamiento arrancó',
    p_severity    := 'info',
    p_body        := v_name || ' está activo. Ya podés ver KPIs en tu portal.',
    p_target_role := 'cliente',
    p_target_user_id := null,
    p_dedup_key   := 'launch_started:' || NEW.id::text,
    p_metadata    := jsonb_build_object('launch_name', v_name)
  );

  return NEW;
end;
$$;

drop trigger if exists on_launch_status_active on public.launches;
create trigger on_launch_status_active
  after update of status on public.launches
  for each row execute function public.notify_launch_started();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger en ai_runs: AFTER INSERT → notif al cliente cuando status='success'.
--    El INSERT viene del Server Action que el equipo dispara desde la tab IA,
--    o del propio cliente desde su portal (F6). Filtramos a status='success'
--    para no notificar análisis fallidos.
--
--    Dedup por run_id: ai_runs son inmutables (UPDATE blindado por 0015 y
--    0023), así que una notif por run es suficiente. El cliente la ve al
--    momento del fetch siguiente de la campanita.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.notify_ai_summary_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_launch_name text;
begin
  if NEW.status is distinct from 'success' then
    return NEW;
  end if;

  -- Traer el nombre del launch para el body de la notif. Si el launch fue
  -- borrado entre INSERT del ai_run y el trigger (poco probable, FK
  -- ON DELETE CASCADE habría tirado el run), fallback a un genérico.
  select name into v_launch_name from public.launches where id = NEW.launch_id;
  v_launch_name := coalesce(v_launch_name, 'Tu lanzamiento');

  perform public.create_notification(
    p_project_id  := NEW.project_id,
    p_launch_id   := NEW.launch_id,
    p_type        := 'ai_summary_ready',
    p_title       := 'Análisis IA listo',
    p_severity    := 'info',
    p_body        := 'Hay un análisis nuevo de ' || v_launch_name || ' en tu portal.',
    p_target_role := 'cliente',
    p_target_user_id := null,
    p_dedup_key   := 'ai_summary:' || NEW.id::text,
    p_metadata    := jsonb_build_object('ai_run_id', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists on_ai_run_success on public.ai_runs;
create trigger on_ai_run_success
  after insert on public.ai_runs
  for each row execute function public.notify_ai_summary_ready();
