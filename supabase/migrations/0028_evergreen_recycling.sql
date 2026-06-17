-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 8a — Evergreen + reciclado de no-compradores                        │
-- │                                                                          │
-- │ Modelo (aclaración):                                                     │
-- │   Un "evergreen" NO es venta continua sin cierre. Es un lanzamiento     │
-- │   normal (mismas etapas, mismo schema, fechas, durations) que corre     │
-- │   constantemente. Lo único nuevo: al cerrarlo, los leads que NO         │
-- │   compraron se TRANSFIEREN al "lanzamiento destino" — el lead deja de  │
-- │   pertenecer al evergreen y pasa al destino. Misma fila, cambia de    │
-- │   launch_id. Mantiene su source, status, asignación y notes.          │
-- │                                                                          │
-- │ ¿Por qué mover y no duplicar?                                            │
-- │   El unique parcial `(project_id, phone_normalized)` de 0016 prohíbe   │
-- │   que un lead con teléfono coexista dos veces en el mismo proyecto.   │
-- │   Como evergreen y destino están en el mismo proyecto, duplicar     │
-- │   chocaría siempre. Además "transferir" es literalmente lo que el     │
-- │   usuario pidió: el lead sigue su pipeline en el destino.            │
-- │                                                                          │
-- │ Cambios:                                                                 │
-- │   1) `launches.is_evergreen` + `launches.recycle_target_launch_id`     │
-- │   2) `leads.recycled_from_launch_id` (traza del origen evergreen)     │
-- │   3) función `recycle_evergreen_leads(p_launch_id)` SECURITY DEFINER  │
-- │      idempotente: la llama `closeLaunch` server-action.               │
-- │                                                                          │
-- │ Trazabilidad:                                                             │
-- │   `recycled_from_launch_id IS NOT NULL` es la señal única de "vino   │
-- │   reciclado". `source` NO se pisa — un lead que entró por meta sigue  │
-- │   con source='meta' tras el move, ahora en otro launch_id. La UI       │
-- │   muestra "↩ desde <evergreen>" cuando recycled_from está seteado.    │
-- │                                                                          │
-- │ Idempotencia:                                                            │
-- │   El UPDATE filtra `recycled_from_launch_id IS NULL`. Después del     │
-- │   primer recycle, los leads movidos ya tienen el campo seteado → la  │
-- │   segunda llamada no los mueve de nuevo. `closeLaunch` además gatea  │
-- │   con la transición `closed_at IS NULL → NOW()`.                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) launches: is_evergreen + recycle_target_launch_id
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches
  add column if not exists is_evergreen boolean not null default false,
  add column if not exists recycle_target_launch_id uuid
    references public.launches(id) on delete set null;

-- Solo evergreens pueden tener target. Un launch normal con target seteado no
-- tiene sentido — la columna sería ignorada por todo el resto del flujo.
alter table public.launches
  drop constraint if exists launches_recycle_target_requires_evergreen_chk;
alter table public.launches
  add constraint launches_recycle_target_requires_evergreen_chk
  check (recycle_target_launch_id is null or is_evergreen = true);

-- Un evergreen no puede reciclarse a sí mismo (loop infinito conceptual).
alter table public.launches
  drop constraint if exists launches_recycle_target_not_self_chk;
alter table public.launches
  add constraint launches_recycle_target_not_self_chk
  check (recycle_target_launch_id is null or recycle_target_launch_id <> id);

-- Lookup por evergreens (UI del header + filtros).
create index if not exists launches_evergreen_idx
  on public.launches(project_id)
  where is_evergreen = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) leads: recycled_from_launch_id + 'evergreen' como source válido
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists recycled_from_launch_id uuid
    references public.launches(id) on delete set null;

-- Extender check de source: solo sumamos 'whatsapp' — el modelo TS
-- (`LeadSource` en src/lib/leads/types.ts) ya lo lista, y el sync de GHL
-- puede tagear leads con `source: 'whatsapp'` (sync-ghl.ts:604). El check
-- viejo no lo contemplaba; alinear acá evita rechazar filas existentes y
-- futuros inserts del sync.
--
-- NO sumamos 'evergreen' como source: el modelo de reciclado MUEVE el lead
-- preservando su source original. La traza de "vino reciclado" vive en
-- `recycled_from_launch_id`, no en source. Mezclar lo dos confundía la
-- semántica ("¿qué pasa si un lead 'meta' se recicla? su origen REAL sigue
-- siendo meta").
alter table public.leads
  drop constraint if exists leads_source_check;
alter table public.leads
  add constraint leads_source_check
  check (source in (
    'manual', 'import', 'meta', 'ghl', 'whatsapp', 'otro'
  ));

create index if not exists leads_recycled_from_idx
  on public.leads(recycled_from_launch_id)
  where recycled_from_launch_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Función `recycle_evergreen_leads(p_launch_id)`
--    Mueve los leads sin venta del evergreen al lanzamiento destino, marca
--    la traza en `recycled_from_launch_id`. Devuelve cantidad transferida.
--    Idempotente: filtra `recycled_from_launch_id IS NULL` para no re-mover
--    leads que ya fueron transferidos antes. La llama el server-action
--    `closeLaunch` tras confirmar la transición a cerrado.
--    SECURITY DEFINER para que la RLS de leads no bloquee el UPDATE; el
--    server-action ya validó permisos del caller.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.recycle_evergreen_leads(
  p_launch_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project_id   uuid;
  v_target_id    uuid;
  v_is_evergreen boolean;
  v_count        integer;
begin
  -- 1) Leer config del evergreen.
  select project_id, recycle_target_launch_id, is_evergreen
    into v_project_id, v_target_id, v_is_evergreen
    from public.launches
   where id = p_launch_id;

  if v_project_id is null then
    return 0;  -- launch inexistente
  end if;

  -- 2) Guard: solo evergreens con target reciclan. Caller silencioso.
  if not coalesce(v_is_evergreen, false) or v_target_id is null then
    return 0;
  end if;

  -- 3) Mover los leads sin venta. UPDATE en lote — una sola query, sin
  --    loop. Filtros:
  --      - launch_id = evergreen origen
  --      - sin sale asociada (NOT EXISTS, UNIQUE(lead_id) en 0014)
  --      - recycled_from_launch_id IS NULL → idempotencia: si ya fue movido,
  --        no lo toco. Eso también evita pisar la traza si un lead pasó por
  --        dos evergreens distintos (queda con el primer origen).
  --    Alias `l` explícito para que la correlation desde el NOT EXISTS
  --    quede sin ambigüedad.
  with moved as (
    update public.leads l
       set launch_id = v_target_id,
           recycled_from_launch_id = p_launch_id
     where l.launch_id = p_launch_id
       and l.recycled_from_launch_id is null
       and not exists (
         select 1 from public.sales s where s.lead_id = l.id
       )
    returning 1
  )
  select count(*)::int into v_count from moved;

  return coalesce(v_count, 0);
end;
$$;

-- Llamada desde server-action que ya validó permisos vía
-- requireCanEditLaunchesIn. No exponer al cliente (no hay grant a
-- cliente_role).
grant execute on function public.recycle_evergreen_leads(uuid)
  to authenticated, service_role;
